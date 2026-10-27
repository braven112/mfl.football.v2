import type { APIRoute } from 'astro';
import type {
  MflLiveAppChatCountResponse,
  MflLiveAppChatPostResponse,
  MflLiveAppChatResponse,
} from '../../../../packages/shared-types/src/mfl-live-app-n';
import { readLeagueFranchiseNames } from '../../../utils/broadcast-live-source';
import {
  countUnreadChat,
  MFL_CHAT_MAX_LENGTH,
  postMflChat,
  readMflChat,
  type MflChatMessage,
} from '../../../utils/mfl-chat';
import { readChatMarker, writeChatMarker } from '../../../utils/mfl-chat-read-state';
import { buildChatView } from '../../../utils/live/mfl-live-app-chat';
import { appJson, requireOwnerLeague, type OwnerLeague } from '../../../utils/live/owner-league';

export const prerender = false;

/**
 * The league's own MFL chat for the MFL Football app (package N), in any MFL
 * league the account has a team in.
 *
 *   GET ?league=           the chat, oldest first; marks it read.
 *   GET ?league=&count=1   just the unread count, for the tab badge.
 *   POST ?league= {text}   posts as the account's team, with its own cookie.
 *
 * How MFL's chat is read and written, and why it is a file rather than an
 * export: src/utils/mfl-chat.ts.
 */

/** Names for the chat, from the league's own export. `{}` when unreadable. */
function franchiseNames(league: OwnerLeague, cookie: string): Promise<Record<string, string>> {
  return readLeagueFranchiseNames(
    {
      id: league.leagueId,
      name: league.leagueName,
      franchiseId: league.franchiseId,
      franchiseName: league.franchiseName,
      registered: null,
      host: league.host,
      isSession: false,
    },
    league.year,
    cookie,
  );
}

async function markRead(league: OwnerLeague, messages: MflChatMessage[]): Promise<void> {
  const newest = messages[messages.length - 1];
  if (newest) await writeChatMarker(league.leagueId, league.franchiseId, { id: newest.id, at: newest.postedAt });
}

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  const chat = await readMflChat(league);
  if (!chat.ok) return appJson({ ok: false, error: 'chat-unavailable' } satisfies MflLiveAppChatResponse, 503);

  const marker = await readChatMarker(league.leagueId, league.franchiseId);
  const unread = countUnreadChat(chat.messages, league.franchiseId, marker);

  if (url.searchParams.get('count') === '1') {
    // First look ever: start counting from now rather than calling the
    // league's whole history unread.
    if (!marker) await markRead(league, chat.messages);
    return appJson({ ok: true, leagueId: league.leagueId, unread } satisfies MflLiveAppChatCountResponse);
  }

  const names = await franchiseNames(league, user.id);
  await markRead(league, chat.messages);
  return appJson({
    ok: true,
    leagueId: league.leagueId,
    franchiseId: league.franchiseId,
    messages: buildChatView(chat.messages, league.franchiseId, names),
    unread,
    maxLength: MFL_CHAT_MAX_LENGTH,
  } satisfies MflLiveAppChatResponse);
};

const fail = (error: Extract<MflLiveAppChatPostResponse, { ok: false }>['error'], message: string, status: number) =>
  appJson({ ok: false, error, message } satisfies MflLiveAppChatPostResponse, status);

export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return fail('empty', 'Type a message first.', 400);
  if (text.length > MFL_CHAT_MAX_LENGTH) {
    return fail('too-long', `Keep it under ${MFL_CHAT_MAX_LENGTH} characters.`, 400);
  }

  // Read first, so the message can be found by being new rather than by text.
  const before = await readMflChat(league);
  const seen = new Set(before.ok ? before.messages.map((m) => m.id) : []);

  const result = await postMflChat(user.id, league, text);
  if (!result.sent) {
    return fail(result.blocked ? 'blocked' : 'chat-unavailable', result.message, result.blocked ? 403 : 502);
  }
  // MFL answers 200 either way; only an affirmative refusal is a refusal.
  if (result.refused) return fail('refused', result.error ?? 'MFL did not accept the message.', 502);

  const after = await readMflChat(league);
  if (!after.ok) {
    return result.accepted
      ? appJson({ ok: true, messages: [] } satisfies MflLiveAppChatPostResponse)
      : fail('unconfirmed', 'MFL did not confirm the message. Check the chat before sending again.', 502);
  }
  const posted = after.messages.find((m) => !seen.has(m.id) && m.franchiseId === league.franchiseId);
  if (!posted && !result.accepted) {
    return fail('unconfirmed', 'MFL did not confirm the message. Check the chat before sending again.', 502);
  }

  await markRead(league, after.messages);
  const names = await franchiseNames(league, user.id);
  return appJson({
    ok: true,
    messages: buildChatView(after.messages, league.franchiseId, names),
  } satisfies MflLiveAppChatPostResponse);
};
