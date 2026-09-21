/**
 * This week's pairings from MFL's `schedule` export.
 *
 * ── WHY A SECOND SOURCE OF PAIRINGS EXISTS ────────────────────────────────
 * MFL serves `liveScoring` in TWO shapes, and only one of them says who is
 * playing whom:
 *
 *   {"liveScoring":{"matchup":[{"franchise":[{…},{…}]}, …]}}   ← pairs
 *   {"liveScoring":{"franchise":[{…},{…}, …]}}                 ← no pairs
 *
 * `parseLiveScoringPayload` reads both — scores, starters and bench are
 * identical either way — but it can only fill `snapshot.matchups` from the
 * first. TheLeague and the AFL happen to serve the grouped shape, so for a
 * year nothing on this site ever saw the second one.
 *
 * Archie's Fantasy Football League (id 10105, 99 franchises, every team
 * playing TWO games a week) serves the flat shape, and the result was a board
 * that said "No matchup this week" to all 99 of its owners while their
 * starters were on the field and MFL's own `schedule` export listed their
 * games. A feed we read correctly, scoring correctly, reported as a bye: the
 * one combination of `statusFor`'s four honest states that is a lie.
 *
 * So when a league is scoring but came back unpaired, we ask the league's own
 * `schedule` export who it has playing this week. Cheap by construction: a
 * week's pairings do not change while it is played, so one read per
 * league-week serves every poll of every device in the process.
 *
 * SERVER-SIDE ONLY — an outside league is read with the owner's own MFL
 * cookie, from the host `myleagues` named for it.
 */

import type { MatchupPairing } from '../types/live-scoring';
import type { BoardLeague } from './sunday-ticket-selection';
import { buildMflExportUrl } from './mfl-url';
import { mflFetch } from './mfl-fetch';

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** MFL writes franchise ids 4-digit and zero-padded everywhere else. */
function franchiseId(value: unknown): string {
  const raw = `${value ?? ''}`.trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? raw.padStart(4, '0') : raw;
}

interface ScheduleFranchise {
  id?: unknown;
  isHome?: unknown;
}

/**
 * Pairings for ONE week, from a `schedule` export.
 *
 * THE WEEK IS CHECKED, NEVER ASSUMED. `TYPE=schedule` answers with every week
 * when `W` is omitted and with one `weeklySchedule` object when it is given —
 * and MFL has been known to answer a `W` it does not have with the nearest one
 * it does. Pasting another week's pairings over a live board would be a
 * confident wrong answer of exactly the kind this fallback exists to remove,
 * so a week that does not match contributes nothing.
 *
 * Returns `[]` for anything it cannot read. The caller keeps whatever the
 * `liveScoring` payload gave it, which is "no pairings" — visibly less, never
 * wrong.
 */
export function parseSchedulePairings(payload: unknown, week: number): MatchupPairing[] {
  const weeks = asArray<any>((payload as any)?.schedule?.weeklySchedule);
  const mine = weeks.find((w) => Number(w?.week) === week);
  if (!mine) return [];

  const out: MatchupPairing[] = [];
  for (const matchup of asArray<any>(mine.matchup)) {
    const teams = asArray<ScheduleFranchise>(matchup?.franchise)
      .map((f) => ({ id: franchiseId(f?.id), isHome: `${f?.isHome ?? ''}` === '1' }))
      .filter((f) => f.id);
    // A one-sided entry is MFL's way of writing a BYE. It is a real thing in a
    // league with an odd franchise count, and it is not a pairing.
    if (teams.length < 2) continue;

    // `isHome` when MFL states it, position when it does not. The grouped
    // `liveScoring` shape carries the same flag and `parseLiveScoringPayload`
    // reads it positionally there; nothing on this board renders home/away
    // today, so that stays as it is rather than being changed from under it.
    const home = teams.find((t) => t.isHome) ?? teams[0];
    const away = teams.find((t) => t.id !== home.id) ?? teams[1];
    if (!away || home.id === away.id) continue;
    out.push({ home: home.id, away: away.id });
  }
  return out;
}

/**
 * How long one league-week's pairings stay good in process.
 *
 * A published schedule does not move while the week is played, so this is an
 * hour rather than the 20s a SCORE gets. Same reasoning as
 * `readLeagueFranchiseNames`: the read exists to fill a gap in a payload the
 * board already has, and paying for it on every poll would make a fallback
 * more expensive than the thing it falls back from.
 */
const SCHEDULE_TTL_MS = 60 * 60 * 1000;

/**
 * How long an EMPTY answer stays good.
 *
 * Short, but not zero. Never caching an empty answer sounds like the repo's
 * never-cache-a-failure rule, and here it is the opposite: this read happens
 * on the board's poll path (25–90s, per viewer, per device), so a league whose
 * schedule is genuinely unpublished — or whose read was throttled — would be
 * re-fetched from MFL every single poll, forever, with no backoff. That is how
 * a board gets itself throttled, and a throttled MFL answers with an HTML page
 * under a 200.
 *
 * A minute is long enough to collapse a poll storm and short enough that a
 * schedule published mid-week appears almost immediately. Same value and same
 * reasoning as `PROJECTION_EMPTY_TTL_MS` in `broadcast-live-source.ts`.
 */
const SCHEDULE_EMPTY_TTL_MS = 60 * 1000;

const schedulePairingsCache = (): Map<string, { at: number; pairings: MatchupPairing[] }> => {
  const g = globalThis as {
    __mflSchedulePairingsCache?: Map<string, { at: number; pairings: MatchupPairing[] }>;
  };
  if (!g.__mflSchedulePairingsCache) g.__mflSchedulePairingsCache = new Map();
  return g.__mflSchedulePairingsCache;
};

/** Drop every cached league-week. Tests that assert on WHICH URL was fetched need this. */
export function clearSchedulePairingsCache(): void {
  schedulePairingsCache().clear();
}

/**
 * One league's pairings for `week`, read with the owner's own MFL cookie.
 *
 * THE HOST IS THE REGISTRY'S FOR A REGISTERED LEAGUE AND `myleagues`'s FOR
 * ANYONE ELSE — never `resolveHost`, whose allowlist is the registry's own
 * hosts and which therefore answers an outside league with the DEFAULT
 * league's host. `L` and the host are one composite key that MFL validates
 * neither half of: a server asked for a league it does not host answers with
 * its own league instead of erroring, so that mistake returns a 200, the right
 * schema, and another league's schedule. `hostOf` (my-leagues.ts) has already
 * constrained the outside host to HTTPS `*.myfantasyleague.com`, which matters
 * because the owner's `MFL_USER_ID` is about to be sent to it.
 *
 * Never throws: every failure is `[]`.
 */
export async function readLeagueSchedulePairings(
  league: BoardLeague,
  year: number,
  week: number,
  mflUserCookie: string,
): Promise<MatchupPairing[]> {
  const host = league.registered ? `https://${league.registered.mflHost}` : league.host;
  if (!mflUserCookie || !host || !week) return [];

  const key = `${league.id}:${year}:${week}`;
  const cache = schedulePairingsCache();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.pairings.length > 0 ? SCHEDULE_TTL_MS : SCHEDULE_EMPTY_TTL_MS)) {
    return hit.pairings;
  }

  const note = (reason: string) =>
    console.warn(`[live-scoring] schedule fallback ${league.id} week ${week}: ${reason}`);

  try {
    const url = buildMflExportUrl({
      type: 'schedule',
      leagueId: league.id,
      year,
      params: { W: week },
      host,
    });
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!response.ok) {
      note(`HTTP ${response.status}`);
      return [];
    }
    // `res.ok` is not "the data is good": MFL reports its own errors with a
    // 200, and a throttled MFL answers with an HTML page under one.
    const body = await response.json().catch(() => null);
    if (body === null) {
      note('body did not parse as JSON (HTML under a 200?)');
      return [];
    }
    if ((body as { error?: unknown })?.error) {
      note(`MFL error: ${String((body as { error?: unknown }).error).slice(0, 120)}`);
      return [];
    }

    const pairings = parseSchedulePairings(body, week);
    // An empty answer is cached BRIEFLY rather than not at all — see
    // `SCHEDULE_EMPTY_TTL_MS`. It is the shape a throttle or an unpublished
    // schedule produces, and this runs on a poll path, so "never cache a
    // failure" here would mean re-asking MFL every 25 seconds forever.
    if (pairings.length === 0) note('schedule carried no pairings for this week');

    cache.set(key, { at: Date.now(), pairings });
    // Bounded: one entry per league-week, and an owner in 40 leagues is
    // already an outlier.
    if (cache.size > 64) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return pairings;
  } catch (err) {
    note(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return [];
  }
}
