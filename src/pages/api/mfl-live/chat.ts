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
import { notifyLeagueEvent } from '../../../utils/push-events';
import { appJson, requireOwnerLeague, type OwnerLeague } from '../../../utils/live/owner-league';
import {
  buildGroupMeChatView,
  countUnreadGroupMe,
  GROUPME_CHAT_MAX_LENGTH,
  readGroupMeChat,
  resolveLeagueGroupMe,
  type LeagueGroupMe,
} from '../../../utils/live/league-groupme-chat';
import {
  readGroupMeLink,
  removeGroupMeLink,
  startGroupMeSignIn,
} from '../../../utils/live/groupme-owner-auth';
import { postAsMember } from '../../../utils/groupme-client';
import { pushAccountKey } from '../../../utils/push-expo';
import type { AuthUser } from '../../../utils/auth';

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
 *
 * A league that talks in GroupMe gets its group here instead, same routes,
 * same shape, `source: 'groupme'` — src/utils/live/league-groupme-chat.ts.
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

/**
 * The GroupMe read marker lives beside MFL's under its own key, so a league
 * moving between the two never compares a GroupMe id with an MFL one.
 */
const groupMeMarkerLeague = (league: OwnerLeague) => `${league.leagueId}:groupme`;

/** The account's own GroupMe user id, once they have signed in to GroupMe. */
async function myGroupMeUserId(user: AuthUser): Promise<string | null> {
  const account = pushAccountKey(user);
  return account ? ((await readGroupMeLink(account))?.userId ?? null) : null;
}

async function groupMeGet(league: OwnerLeague, group: LeagueGroupMe, user: AuthUser, countOnly: boolean) {
  const chat = await readGroupMeChat(group.groupId);
  if (!chat.ok) return appJson({ ok: false, error: 'chat-unavailable' } satisfies MflLiveAppChatResponse, 503);
  const names = await franchiseNames(league, user.id);
  const view = buildGroupMeChatView(chat.messages, league.franchiseId, names, await myGroupMeUserId(user));
  const markerLeague = groupMeMarkerLeague(league);
  const marker = await readChatMarker(markerLeague, league.franchiseId);
  const unread = countUnreadGroupMe(view, marker?.id ?? null);
  const newest = view[view.length - 1];
  // A count marks nothing, except on the first look ever: count from now.
  if (newest && (!countOnly || !marker)) {
    await writeChatMarker(markerLeague, league.franchiseId, { id: newest.id, at: newest.postedAt });
  }
  if (countOnly) {
    return appJson({ ok: true, leagueId: league.leagueId, unread } satisfies MflLiveAppChatCountResponse);
  }
  return appJson({
    ok: true,
    leagueId: league.leagueId,
    franchiseId: league.franchiseId,
    messages: view,
    unread,
    maxLength: GROUPME_CHAT_MAX_LENGTH,
    source: 'groupme',
  } satisfies MflLiveAppChatResponse);
}

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  const group = await resolveLeagueGroupMe(league.leagueId);
  if (group) return groupMeGet(league, group, user, url.searchParams.get('count') === '1');

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
    source: 'mfl',
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

  const group = await resolveLeagueGroupMe(league.leagueId);
  if (group) return groupMePost(league, group, user, text);
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
  // Alert the rest of the league. Keyed on MFL's own id so the push
  // thread's chat checker, which reads the same file, never sends it twice;
  // no id (MFL accepted but the file hasn't caught up) leaves it to that
  // checker. Never for a private message. Never throws.
  if (posted && !posted.toFranchiseId) {
    await notifyLeagueEvent({
      kind: 'chat',
      leagueId: league.leagueId,
      key: posted.id,
      fromFranchiseId: league.franchiseId,
      fromName: names[league.franchiseId] || league.franchiseName,
      text: posted.text,
      franchiseIds: Object.keys(names),
    });
  }
  return appJson({
    ok: true,
    messages: buildChatView(after.messages, league.franchiseId, names),
  } satisfies MflLiveAppChatPostResponse);
};


/**
 * Posts into the league's GroupMe AS the owner, with their own GroupMe
 * sign-in — never through a bot (the owner, 2026-10-27). No sign-in yet, or
 * one GroupMe has revoked: answer `groupme-sign-in` with a fresh link.
 */
async function groupMePost(league: OwnerLeague, group: LeagueGroupMe, user: AuthUser, text: string) {
  if (text.length > GROUPME_CHAT_MAX_LENGTH) {
    return fail('too-long', `Keep it under ${GROUPME_CHAT_MAX_LENGTH} characters.`, 400);
  }
  const account = pushAccountKey(user);
  if (!account) return fail('chat-unavailable', 'Sign out and back in, then try again.', 503);

  const askToSignIn = async (message: string) => {
    const signInUrl = await startGroupMeSignIn(account);
    if (!signInUrl) return fail('chat-unavailable', 'GroupMe sign-in is unavailable right now. Try again shortly.', 503);
    // 200, not 403: an expected answer the app acts on, and the app's
    // client throws away the body of any non-2xx.
    return appJson({ ok: false, error: 'groupme-sign-in', message, signInUrl } satisfies MflLiveAppChatPostResponse);
  };

  const link = await readGroupMeLink(account);
  if (!link) return askToSignIn('Sign in to GroupMe once to post as yourself.');

  const result = await postAsMember(group.groupId, link.token, text);
  if (result === 'unauthorized') {
    await removeGroupMeLink(account);
    return askToSignIn('GroupMe signed you out. Sign in again to post.');
  }
  if (result === 'blocked') return fail('blocked', 'Test builds do not post to GroupMe.', 403);
  if (result === 'not-a-member') {
    return fail('refused', `${link.name || 'Your GroupMe account'} is not in this league's GroupMe.`, 403);
  }
  if (result !== 'sent') return fail('refused', 'GroupMe did not accept the message. Try again.', 502);

  // GroupMe notifies the group itself, so no push from here.
  const after = await readGroupMeChat(group.groupId);
  if (!after.ok) return appJson({ ok: true, messages: [] } satisfies MflLiveAppChatPostResponse);
  const names = await franchiseNames(league, user.id);
  const view = buildGroupMeChatView(after.messages, league.franchiseId, names, link.userId);
  const newest = view[view.length - 1];
  if (newest) {
    await writeChatMarker(groupMeMarkerLeague(league), league.franchiseId, { id: newest.id, at: newest.postedAt });
  }
  return appJson({ ok: true, messages: view } satisfies MflLiveAppChatPostResponse);
}
