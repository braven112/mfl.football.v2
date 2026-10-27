import type { APIRoute } from 'astro';
import type {
  MflLiveAppChatSourcePostResponse,
  MflLiveAppChatSourceResponse,
} from '../../../../packages/shared-types/src/mfl-live-app-n';
import { fetchMyGroups } from '../../../utils/groupme-client';
import { readGroupMeLink, removeGroupMeLink, startGroupMeSignIn } from '../../../utils/live/groupme-owner-auth';
import { groupMeConfigFor, resolveLeagueGroupMe } from '../../../utils/live/league-groupme-chat';
import {
  readLeagueConnection,
  removeLeagueConnection,
  saveLeagueConnection,
} from '../../../utils/live/league-groupme-connection';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { pushAccountKey } from '../../../utils/push-expo';

export const prerender = false;

/**
 * Which chat a league's Chat tab shows in the MFL Football app, and switching
 * it — contract in packages/shared-types/src/mfl-live-app-n.ts. Any owner in
 * the league may connect a GroupMe group of their own or switch back to MFL
 * chat ("any owner, for now"); see
 * src/utils/live/league-groupme-connection.ts.
 */

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  const group = await resolveLeagueGroupMe(league.leagueId);
  const account = pushAccountKey(user);
  let link = account ? await readGroupMeLink(account) : null;
  let groups: Array<{ id: string; name: string; members: number }> = [];
  if (link) {
    const mine = await fetchMyGroups(link.token);
    if (mine.ok) groups = mine.groups;
    else if (mine.unauthorized && account) {
      await removeGroupMeLink(account);
      link = null;
    }
  }

  return appJson({
    ok: true,
    leagueId: league.leagueId,
    source: group ? 'groupme' : 'mfl',
    fixed: group?.fixed ?? groupMeConfigFor(league.leagueId) !== null,
    connectedBy: group?.connectedBy
      ? { ...group.connectedBy, mine: group.connectedBy.franchiseId === league.franchiseId }
      : null,
    groupName: group?.groupName ?? null,
    groupMe: link ? { signedIn: true, name: link.name, groups } : { signedIn: false },
  } satisfies MflLiveAppChatSourceResponse);
};

const fail = (
  error: Extract<MflLiveAppChatSourcePostResponse, { ok: false }>['error'],
  message: string,
  extra: { signInUrl?: string } = {},
) =>
  // 200: expected answers the app acts on (its client drops a non-2xx body).
  appJson({ ok: false, error, message, ...extra } satisfies MflLiveAppChatSourcePostResponse);

export const POST: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  if (groupMeConfigFor(league.leagueId)) {
    return fail('fixed', "This league's chat is set up on our side and can't be changed here.");
  }
  const account = pushAccountKey(user);
  if (!account) return fail('unavailable', 'Sign out and back in, then try again.');

  const body = (await request.json().catch(() => null)) as { signIn?: unknown; groupId?: unknown } | null;

  if (body?.signIn === true) {
    const signInUrl = await startGroupMeSignIn(account);
    return signInUrl
      ? appJson({ ok: true, signInUrl } satisfies MflLiveAppChatSourcePostResponse)
      : fail('unavailable', 'GroupMe sign-in is unavailable right now. Try again shortly.');
  }

  if (body?.groupId === null) {
    return (await removeLeagueConnection(league.leagueId))
      ? appJson({ ok: true } satisfies MflLiveAppChatSourcePostResponse)
      : fail('unavailable', 'Could not switch back just now. Try again.');
  }

  const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : '';
  if (!/^\d+$/.test(groupId)) return fail('not-your-group', 'Pick one of your GroupMe groups.');

  const askToSignIn = async (message: string) => {
    const signInUrl = await startGroupMeSignIn(account);
    return fail('groupme-sign-in', message, signInUrl ? { signInUrl } : {});
  };
  const link = await readGroupMeLink(account);
  if (!link) return askToSignIn('Sign in to GroupMe to connect a group.');
  // Only a group this owner is in: the group is read with their sign-in, and
  // nobody may point a league at a group they cannot see.
  const mine = await fetchMyGroups(link.token);
  if (!mine.ok) {
    if (mine.unauthorized) {
      await removeGroupMeLink(account);
      return askToSignIn('GroupMe signed you out. Sign in again to connect a group.');
    }
    return fail('unavailable', 'Could not reach GroupMe. Try again.');
  }
  const chosen = mine.groups.find((g) => g.id === groupId);
  if (!chosen) return fail('not-your-group', "That isn't one of your GroupMe groups.");

  const previous = await readLeagueConnection(league.leagueId);
  const saved = await saveLeagueConnection(league.leagueId, {
    groupId: chosen.id,
    groupName: chosen.name,
    account,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    connectedAt: new Date().toISOString(),
  });
  if (!saved) return fail('unavailable', 'Could not save that just now. Try again.');
  if (previous && previous.groupId !== chosen.id) {
    console.info(`[chat-source] league ${league.leagueId} moved from group ${previous.groupId} to ${chosen.id}`);
  }
  return appJson({ ok: true } satisfies MflLiveAppChatSourcePostResponse);
};
