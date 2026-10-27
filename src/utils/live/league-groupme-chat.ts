/**
 * A league's GroupMe as the MFL Football app's Chat tab.
 *
 * Leagues that talk in GroupMe never use MFL's own chat, so for them the app
 * shows the GroupMe group instead (docs/plans/mfl-live-store-app.md,
 * "Outside chat"). This step covers the leagues whose GroupMe the site
 * already reaches: a registry league with `chat.provider === 'groupme'`. Its
 * group is found the way Roger finds it — from the bot id the registry names,
 * via `GET /v3/bots` (scripts/lib/groupme-groups.mjs) — and read with the
 * service token, which owns those bots and so is a member of the group.
 *
 * An owner posts AS THEMSELVES, never through a bot (the owner, 2026-10-27):
 * the first time they tap Send, the app asks them to sign in to GroupMe, and
 * from then on their own token posts (src/utils/live/groupme-owner-auth.ts).
 *
 * Reads the group live on every open rather than through the site's Redis
 * mirror: that mirror's keys are TheLeague's alone (`groupme:messages`), and a
 * second league writing to them would mix the two chats.
 */

import type { LeagueChatConfig, LeagueDefinition } from '../../config/leagues';
import { getLeagueById } from '../../config/leagues';
import type { GroupMeApiMessage } from '../../types/groupme';
import { resolveLeagueGroupId } from '../../../scripts/lib/groupme-groups.mjs';
import { fetchMessages } from '../groupme-client';
import { getRedis } from '../redis-client';
import type { ChatMessageView } from './mfl-live-app-chat';

/** GroupMe caps a message at 1000 characters. */
export const GROUPME_CHAT_MAX_LENGTH = 1000;

/** How many messages the tab opens with. GroupMe pages at 100. */
const PAGE = 50;

export interface LeagueGroupMe {
  /** Registry slug — the key the group-id cache already uses. */
  slug: string;
  groupId: string;
}

function serviceToken(): string | null {
  return process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN || null;
}

/** The registry's GroupMe config for an MFL league id, or null. */
export function groupMeConfigFor(
  leagueId: string,
): { league: LeagueDefinition; chat: Extract<LeagueChatConfig, { provider: 'groupme' }> } | null {
  const league = getLeagueById(leagueId);
  const chat = league?.chat;
  if (!league || !chat || chat.provider !== 'groupme') return null;
  return { league, chat };
}

/**
 * The GroupMe group the app should show for this MFL league, or null when the
 * league has none we can read (no registry GroupMe, no token, group unknown).
 */
export async function resolveLeagueGroupMe(leagueId: string): Promise<LeagueGroupMe | null> {
  const config = groupMeConfigFor(leagueId);
  const token = serviceToken();
  if (!config || !token) return null;
  const groupEnv = config.league.schefter?.env?.groupId;
  const redis = await getRedis().catch(() => null);
  const { groupId } = await resolveLeagueGroupId({
    league: {
      slug: config.league.slug,
      groupMeGroupId: (groupEnv && process.env[groupEnv]) || null,
      groupMeRogerBotId: process.env[config.chat.botEnv] || null,
    },
    redis,
    token,
  }).catch(() => ({ groupId: null }));
  return groupId ? { slug: config.league.slug, groupId } : null;
}

export type GroupMeReadResult = { ok: true; messages: GroupMeApiMessage[] } | { ok: false };

/** The newest messages, oldest first. */
export async function readGroupMeChat(groupId: string): Promise<GroupMeReadResult> {
  if (!serviceToken()) return { ok: false };
  try {
    const messages = await fetchMessages({ groupId, limit: PAGE });
    return { ok: true, messages: [...messages].reverse() };
  } catch {
    return { ok: false };
  }
}

/** `Team Name:\n` — what the website's GroupMe compose relays a message as. */
export function relayPrefix(teamName: string): string {
  return `${teamName}:\n`;
}

/**
 * GroupMe messages as the app's chat view.
 *
 * `teams` names every franchise in the league; a bot message whose text starts
 * with one of their prefixes is shown as that team's, and `mine` when it is
 * the account's own. Any bot, not just ours: the website's GroupMe compose
 * relays owners' messages in the same `Team:` shape through its own bot. Everyone else shows under their GroupMe name, so
 * `franchiseId` is '' for them. System messages ("X joined") are left out.
 */
export function buildGroupMeChatView(
  messages: GroupMeApiMessage[],
  me: string,
  teams: Record<string, string>,
  /** The account's own GroupMe user, once signed in: their messages are `mine`. */
  myUserId: string | null = null,
): ChatMessageView[] {
  const prefixes = Object.entries(teams)
    .filter(([, name]) => name)
    .map(([franchiseId, name]) => ({ franchiseId, name, prefix: relayPrefix(name) }))
    // Longest first, so "Bring The Pain II" never matches as "Bring The Pain".
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const out: ChatMessageView[] = [];
  for (const m of messages) {
    if (m.sender_type === 'system') continue;
    const images = (m.attachments ?? [])
      .filter((a) => a.type === 'image' && typeof a.url === 'string' && a.url.startsWith('https://'))
      .map((a) => a.url as string);
    let text = m.text ?? '';
    let franchiseId = '';
    let franchiseName = m.name || 'GroupMe';
    const relayed = m.sender_type === 'bot' ? prefixes.find((p) => text.startsWith(p.prefix)) : undefined;
    if (relayed) {
      franchiseId = relayed.franchiseId;
      franchiseName = relayed.name;
      text = text.slice(relayed.prefix.length);
    }
    if (!text && images.length === 0) continue;
    out.push({
      id: m.id,
      franchiseId,
      franchiseName,
      text,
      postedAt: Number.isFinite(m.created_at) ? new Date(m.created_at * 1000).toISOString() : null,
      postedLabel: '',
      mine: (franchiseId !== '' && franchiseId === me) || (myUserId !== null && m.user_id === myUserId),
      avatarUrl: !relayed && m.avatar_url?.startsWith('https://') ? m.avatar_url : null,
      imageUrls: images,
    });
  }
  return out;
}

/** Unread since the marker: other people's messages after it. */
export function countUnreadGroupMe(view: ChatMessageView[], lastReadId: string | null): number {
  if (!lastReadId) return 0;
  const index = view.findIndex((m) => m.id === lastReadId);
  // GroupMe ids grow with time, so a trimmed-out marker still orders.
  const after = index >= 0 ? view.slice(index + 1) : view.filter((m) => compareIds(m.id, lastReadId) > 0);
  return after.filter((m) => !m.mine).length;
}

function compareIds(a: string, b: string): number {
  return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;
}
