/**
 * The MFL Football app's draft room WRITES: replacing your MFL pre-draft list
 * and making your pick, for any MFL league the account is in. Package R step 2.
 *
 * Both act with the owner's own MFL cookie as the team `requireOwnerLeague`
 * resolved — never a franchise from the request — and both go through
 * `mflFetch`, so a staging or preview build refuses to send
 * (`describeMflFailure`).
 *
 * ── THE QUEUE IS OVERWRITTEN WHOLE ────────────────────────────────────────
 * MFL's `myDraftList` import replaces the list; there is no insert or move
 * (src/utils/mfl-draft-list.ts). An owner who edited the list on MFL's website
 * after the app loaded it would lose that edit to a blind push, so the app
 * sends the list it started from and nothing is written unless MFL still holds
 * exactly that.
 *
 * ── A PICK IS ONLY "MADE" WHEN THE BOARD SAYS SO ──────────────────────────
 * MFL's live-draft command (`live_draft`, CMD=DRAFT) is the documented way an
 * owner picks, but this repo has never driven it and its reply format has not
 * been seen live (docs/claude/insights/domains/mfl-api.md). So its reply is
 * read only for an explicit MFL error, and success is decided by re-reading
 * the board: the slot must show the player. Anything short of that is
 * `not-confirmed`, which the app shows as "check the board before picking
 * again" — never as success, and never as a failure that invites a second
 * pick into the next slot.
 */

import type {
  MflLiveAppDraftPickResponse,
  MflLiveAppDraftQueueResponse,
  MflLiveAppDraftRoom,
} from '../../../packages/shared-types/src/mfl-live-app-draft';
import type { OwnerLeague } from './owner-league';
import { bareHost, identityFor, readMflLiveDraft, toPlayer } from './mfl-live-draft';
import { normalizePlayerIds, parseMflError, pushDraftList } from '../mfl-draft-list';
import { describeMflFailure, mflFetch } from '../mfl-fetch';

/** A pre-draft list is a few hundred players at most. */
export const MAX_QUEUE = 1000;

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Replace the owner's MFL pre-draft list with `playerIds`, but only if MFL
 * still holds `basedOn`.
 */
export async function saveDraftQueue(
  league: OwnerLeague,
  mflUserCookie: string,
  input: { playerIds: unknown[]; basedOn: unknown[] },
): Promise<MflLiveAppDraftQueueResponse> {
  const playerIds = normalizePlayerIds(input.playerIds);
  const basedOn = normalizePlayerIds(input.basedOn);
  const target = { id: league.leagueId, mflHost: bareHost(league) };
  const players = async (ids: string[]) => {
    const identity = await identityFor(league.year, ids);
    return ids.map((id) => toPlayer(id, identity, league.year));
  };

  if (playerIds.length === 0) {
    // pushDraftList refuses an empty list on purpose: MFL would take it and
    // erase the board. Say what to do instead of what we refused.
    return { ok: false, error: 'empty', message: 'Keep at least one player on your list. MFL can’t save an empty one from the app.' };
  }

  // Read MFL's list as the room shows it (players already taken dropped), so
  // it compares like for like with what the phone sent as `basedOn`.
  const room = await readMflLiveDraft(league, mflUserCookie).catch(() => null);
  // A failed read before a full overwrite is a stop: we'd be replacing a list we couldn't see.
  if (!room?.queue) {
    return { ok: false, error: 'unavailable', message: 'MyFantasyLeague didn’t send your current list, so nothing was changed. Try again.' };
  }
  if (!sameList(room.queue.map((p) => p.id), basedOn)) {
    return {
      ok: false,
      error: 'changed-on-mfl',
      message: 'Your list changed on MyFantasyLeague since the app loaded it, so nothing was saved. Here’s your list as it is now.',
      queue: room.queue,
    };
  }

  const pushed = await pushDraftList({ league: target, year: league.year, mflUserCookie, playerIds });
  if (!pushed.ok) {
    return {
      ok: false,
      error: pushed.blocked ? 'blocked' : 'rejected',
      message: pushed.error ?? 'MyFantasyLeague didn’t save your list.',
    };
  }
  return { ok: true, queue: await players(playerIds) };
}

/** How the pick command is sent. Isolated so a live check can correct it in one place. */
export function buildDraftPickRequest(
  league: Pick<OwnerLeague, 'leagueId' | 'year' | 'franchiseId'> & { host: string },
  pick: { playerId: string; round: number; pick: number },
): { url: string; body: string } {
  const url = `https://${league.host}/${league.year}/live_draft?L=${encodeURIComponent(league.leagueId)}`;
  const body = new URLSearchParams({
    CMD: 'DRAFT',
    PLAYER_PICK: pick.playerId,
    FRANCHISE_PICK: league.franchiseId,
    ROUND: String(pick.round),
    PICK: String(pick.pick),
  }).toString();
  return { url, body };
}

/** Is the pick on the board, by the right team, in the right slot? */
export function pickLanded(room: MflLiveAppDraftRoom, overall: number, playerId: string, franchiseId: string): boolean {
  const slot = room.slots.find((s) => s.overall === overall);
  return !!slot && slot.franchiseId === franchiseId && slot.player?.id === playerId;
}

/**
 * Why this pick may not be sent, or null when it may. Pure, so the guard that
 * keeps a stale screen from drafting into the wrong slot is pinned by tests.
 */
export function refusePick(
  room: MflLiveAppDraftRoom,
  overall: number,
  playerId: string,
): Extract<MflLiveAppDraftPickResponse, { ok: false }> | null {
  if (room.kind === 'auction') {
    return { ok: false, error: 'not-on-clock', message: 'This league drafts by auction, so there’s no pick to make.', room };
  }
  if (!room.onClock?.mine || room.onClock.overall !== overall) {
    return {
      ok: false,
      error: 'not-on-clock',
      message: room.onClock?.mine
        ? 'The board moved on since your screen loaded. Here it is now.'
        : 'It isn’t your pick right now. Here’s the board as it stands.',
      room,
    };
  }
  if (room.slots.some((s) => s.player?.id === playerId)) {
    return { ok: false, error: 'taken', message: 'That player has already been picked.', room };
  }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Make the owner's pick in the slot the app showed them on the clock. */
export async function makeDraftPick(
  league: OwnerLeague,
  mflUserCookie: string,
  input: { playerId: unknown; overall: unknown },
  options: { confirmDelaysMs?: number[] } = {},
): Promise<MflLiveAppDraftPickResponse> {
  const [playerId] = normalizePlayerIds([input.playerId]);
  const overall = Number(input.overall);
  if (!playerId || !Number.isInteger(overall) || overall < 1) {
    return { ok: false, error: 'rejected', message: 'That pick wasn’t complete. Pick the player again.' };
  }

  // Check the LIVE board, not the one the phone last saw.
  const before = await readMflLiveDraft(league, mflUserCookie).catch(() => null);
  if (!before) {
    return { ok: false, error: 'unavailable', message: 'MyFantasyLeague didn’t send the board, so no pick was sent. Try again.' };
  }
  const refused = refusePick(before, overall, playerId);
  if (refused) return refused;
  const slot = before.slots.find((s) => s.overall === overall)!;

  const request = buildDraftPickRequest(
    { ...league, host: bareHost(league) },
    { playerId, round: slot.round, pick: slot.pick },
  );
  try {
    const res = await mflFetch({ url: request.url, method: 'POST', mflUserCookie, body: request.body });
    const text = await res.text().catch(() => '');
    // Only an explicit MFL error element counts as a refusal here; anything
    // else (including a web page) is decided by the board below.
    const explicit = /<error[^>]*>/i.test(text) ? parseMflError(text) : null;
    if (explicit) return { ok: false, error: 'rejected', message: `MyFantasyLeague didn’t take the pick: ${explicit}`, room: before };
  } catch (err) {
    const failure = describeMflFailure(err);
    return { ok: false, error: failure.blocked ? 'blocked' : 'unavailable', message: failure.message, room: before };
  }

  // TODO(push, package H): once src/utils/push-events.ts lands (PR #1538),
  // notify the team now on the clock here:
  // notifyLeagueEvent({ kind: 'draft-on-clock', leagueId, franchiseId, overall, round, pick }).
  // The push thread's one-minute checker covers picks made on MFL's website.
  let latest: MflLiveAppDraftRoom | null = before;
  for (const delay of options.confirmDelaysMs ?? [800, 1500, 2500]) {
    await wait(delay);
    latest = (await readMflLiveDraft(league, mflUserCookie).catch(() => null)) ?? latest;
    if (latest && pickLanded(latest, overall, playerId, league.franchiseId)) return { ok: true, room: latest };
  }
  return {
    ok: false,
    error: 'not-confirmed',
    message: 'The pick was sent, but the board doesn’t show it yet. Check the board before you pick again.',
    ...(latest ? { room: latest } : {}),
  };
}
