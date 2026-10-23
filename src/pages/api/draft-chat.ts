/**
 * GET  /api/draft-chat?room=<roomId>&v=<version>
 * POST /api/draft-chat  { room, message }
 *
 * Draft-room chat on Redis (replaced PartyKit's socket, Oct 2026). The panel
 * polls GET every couple of seconds; `v` is the version it already has, and
 * the answer is just `{ version }` when nothing changed.
 *
 * Both need a signed-in owner of the room's own league. The sender's
 * franchise is the signed session's, never a message field: PartyKit relayed
 * whatever `senderId` a client sent.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import { chatRoomLeague, postChatMessage, readChat, toggleChatReaction } from '../../utils/draft-chat-store';
import { MockDraftStoreError } from '../../utils/mock-draft-store';
import { REACTION_EMOJIS, type ChatMessage } from '../../types/draft-room';

export const prerender = false;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function gate(request: Request, room: unknown) {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return { error: reply({ error: 'Sign in to use the draft chat.' }, 401) };
  const league = chatRoomLeague(room);
  if (!league) return { error: reply({ error: 'Unknown chat room.' }, 400) };
  if (league !== user.leagueId) return { error: reply({ error: 'This chat belongs to another league.' }, 403) };
  return { user, room: room as string };
}

const failed = (err: unknown) => {
  console.error('[draft-chat] Failed:', (err as Error).message);
  return reply({ error: 'Chat is unavailable right now.' }, err instanceof MockDraftStoreError ? err.status : 500);
};

export const GET: APIRoute = async ({ request, url }) => {
  const g = gate(request, url.searchParams.get('room'));
  if ('error' in g) return g.error;
  const known = url.searchParams.get('v');
  try {
    return reply(await readChat(g.room, known == null ? undefined : Number(known)));
  } catch (err) {
    return failed(err);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { room?: unknown; message?: Partial<ChatMessage> } | null;
  const g = gate(request, body?.room);
  if ('error' in g) return g.error;
  const m = body?.message ?? {};
  const id = str(m.id, 64);
  if (!id) return reply({ error: 'A message needs an id.' }, 400);

  try {
    if (m.type === 'reaction') {
      const emoji = str(m.emoji, 16);
      if (!(REACTION_EMOJIS as readonly string[]).includes(emoji) || !m.targetId) {
        return reply({ error: 'Unknown reaction.' }, 400);
      }
      const version = await toggleChatReaction(g.room, str(m.targetId, 64), emoji, g.user.franchiseId);
      return version == null ? reply({ error: 'Chat is busy — try again.' }, 503) : reply({ version });
    }
    if (m.type !== 'chat' && m.type !== 'pick' && m.type !== 'system') {
      return reply({ error: 'Unknown message type.' }, 400);
    }
    const isPick = m.type === 'pick';
    const message: ChatMessage = {
      id,
      type: m.type,
      senderId: isPick ? 'system' : g.user.franchiseId,
      senderName: isPick ? 'Draft' : str(m.senderName, 80) || 'Owner',
      senderIcon: isPick ? '' : str(m.senderIcon, 300),
      text: str(m.text, 1000),
      timestamp: Date.now(),
      ...(typeof m.gifUrl === 'string' && m.gifUrl.startsWith('https://') ? { gifUrl: str(m.gifUrl, 500) } : {}),
      ...(m.replyTo ? { replyTo: str(m.replyTo, 64) } : {}),
    };
    if (!message.text && !message.gifUrl) return reply({ error: 'Empty message.' }, 400);
    const version = await postChatMessage(g.room, message);
    return version == null ? reply({ error: 'Chat is busy — try again.' }, 503) : reply({ version });
  } catch (err) {
    return failed(err);
  }
};
