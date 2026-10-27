/**
 * The MFL Football app's Set Lineup view (package J) for ANY MFL league the
 * signed-in account is in — the body of `GET /api/mfl-live/lineup`.
 *
 * Built from the same pieces as the site's Set Lineup page
 * (src/components/shared/lineup/LineupPage.astro), never a copy of them:
 *   - the slot layout from the league's own starter rules (`lineupSlotsFor`,
 *     in its any-league mode: any count, IDP positions included);
 *   - the saved lineup through `resolveWeekLineup`, which keeps "no lineup
 *     on file" and "couldn't read it" apart;
 *   - what the slots MEAN through `resolveLineupFillState` — only an
 *     `unsaved-offer` may be submitted untouched, and a `read-failed` may not
 *     be submitted at all;
 *   - the suggestion's seating through `assignLineupSlots`;
 *   - the problems list through `findLineupProblems`.
 *
 * `buildAppLineupView` is pure (raw MFL payloads in, wire view out) so the
 * tests can pin every state; `loadAppLineup` does the fetching, all of it with
 * the OWNER's cookie, since a private league's exports need it.
 */

import type {
  MflLiveAppLineup,
  MflLiveAppLineupPlayer,
} from '../../../packages/shared-types/src/mfl-live-app-j';
import { getLeagueById, DEFAULT_LEAGUE_SLUG, type CanonicalLeagueSlug } from '../../config/leagues';
import { mflFetch } from '../mfl-fetch';
import { buildMflExportUrl } from '../mfl-url';
import {
  assignLineupSlots,
  eligibleSlotsFor,
  lineupSlotsFor,
  normalizeLineupPosition,
  type MflStarterRules,
} from '../lineup-slots';
import { resolveLineupFillState, resolveRostersPayload, resolveWeekLineup } from '../lineup-sources';
import { findLineupProblems, type ProblemPlayer } from '../lineup-problems';
import { findIrViolations } from '../lineup-ir-violations';
import { loadLiveInjuryMap } from '../mfl-injuries-live-map';
import type { InjuryMap } from '../mfl-injuries';
import { getPlayerMap, type PlayerIdentity } from '../player-map';
import { normalizeTeamCode } from '../nfl-logo';
import { getCurrentWeekForYear } from '../current-week';
import { isSeasonWindowOpen } from '../pecking-order-season-window.mjs';

/** The league the request is for, as F2's `requireOwnerLeague` verified it. */
export interface AppLineupLeague {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  franchiseName: string;
  year: number;
  /** `https://www49.myfantasyleague.com`, or null when MFL gave none. */
  host: string | null;
}

const DEFAULT_EXPORT_HOST = 'https://api.myfantasyleague.com';

/** Designations that mean the player will not play this week (as lineup-problems.ts). */
const OUT_STATUSES = new Set(['out', 'ir', 'suspended']);

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** The league's web host without protocol, for MFL's fix links. */
export function webHostOf(host: string | null): string {
  try {
    return host ? new URL(host).hostname : 'www.myfantasyleague.com';
  } catch {
    return 'www.myfantasyleague.com';
  }
}

/** The registry league behind an MFL id, when it is one of ours. */
function registrySlug(leagueId: string): CanonicalLeagueSlug | null {
  return (getLeagueById(leagueId)?.slug as CanonicalLeagueSlug | undefined) ?? null;
}

/** MFL's "Last, First" → "First Last"; a team defense's name is left alone. */
function displayName(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : name;
}

/** Is the NFL season being played? Labor Day + 3 onward, asked of both candidate years. */
export function isLineupSeason(now: Date): boolean {
  const y = now.getUTCFullYear();
  return isSeasonWindowOpen(y, now) || isSeasonWindowOpen(y - 1, now);
}

export interface AppLineupInputs {
  league: AppLineupLeague;
  week: number;
  currentWeek: number;
  nowMs: number;
  /** Raw MFL payloads; null for a call that failed. */
  leaguePayload: any;
  rostersPayload: any;
  weekResultsPayload: any;
  ytdResultsPayload: any;
  projectionsPayload: any;
  nflSchedulePayload: any;
  playersPayload: any;
  injuries: InjuryMap;
  identities: ReadonlyMap<string, PlayerIdentity>;
}

export function buildAppLineupView(input: AppLineupInputs): MflLiveAppLineup {
  const { league, week, currentWeek } = input;
  const slug = registrySlug(league.leagueId);
  const registry = slug ? getLeagueById(league.leagueId) : null;
  const nowEpoch = Math.floor(input.nowMs / 1000);

  const layout = lineupSlotsFor(input.leaguePayload?.league?.starters as MflStarterRules | undefined, {
    anyLeague: true,
  });

  // Kickoffs from MFL's own NFL schedule — the source of truth for locks.
  const kickoffByTeam = new Map<string, number>();
  for (const game of asArray(input.nflSchedulePayload?.nflSchedule?.matchup)) {
    const kickoff = parseInt((game as any)?.kickoff, 10) || 0;
    for (const t of asArray((game as any)?.team)) {
      if ((t as any)?.id) kickoffByTeam.set(normalizeTeamCode((t as any).id), kickoff);
    }
  }
  const scheduleKnown = kickoffByTeam.size > 0;
  const firstKickoff = scheduleKnown
    ? Math.min(...[...kickoffByTeam.values()].filter((k) => k > 0))
    : null;

  const projections = new Map<string, number>();
  for (const p of asArray(input.projectionsPayload?.projectedScores?.playerScore)) {
    const score = parseFloat((p as any)?.score);
    if ((p as any)?.id && Number.isFinite(score)) projections.set((p as any).id, score);
  }

  const livePlayers = new Map<string, any>();
  for (const p of asArray(input.playersPayload?.players?.player)) {
    if ((p as any)?.id) livePlayers.set((p as any).id, p);
  }

  // Our own leagues fall back to the committed rosters feed when MFL answers
  // a throttled call with an error body; any other league has only MFL.
  const rostersData = slug
    ? resolveRostersPayload(input.rostersPayload, slug, league.year)
    : input.rostersPayload;
  const franchise = asArray(rostersData?.rosters?.franchise).find(
    (f: any) => f?.id === league.franchiseId,
  ) as any;
  const rosterRows = asArray(franchise?.player) as any[];

  const players: MflLiveAppLineupPlayer[] = rosterRows.map((rp) => {
    const identity = input.identities.get(rp.id);
    const live = livePlayers.get(rp.id);
    const position = identity?.position ?? normalizeLineupPosition(live?.position || '');
    const nflTeam = identity?.nflTeam ?? normalizeTeamCode(live?.team || '');
    const playsInNfl = Boolean(nflTeam) && !/^FA\*?$/.test(nflTeam);
    const kickoff = kickoffByTeam.get(nflTeam) || null;
    const injury = input.injuries[rp.id]?.injuryStatus ?? null;
    const rosterStatus = rp.status || 'ROSTER';
    return {
      id: rp.id,
      // Identity synced to disk first: the live `players` call is the one
      // that vanishes under throttling (docs/claude/rules/lineups.md).
      name: identity?.name || displayName(live?.name) || `Player ${rp.id}`,
      position,
      nflTeam,
      rosterStatus,
      canStart: rosterStatus === 'ROSTER',
      slots: layout ? eligibleSlotsFor(position, layout) : [],
      projection: projections.get(rp.id) ?? null,
      injury,
      out: Boolean(injury && OUT_STATUSES.has(injury.toLowerCase())),
      // A bye is a real NFL team missing from a schedule we actually read.
      isBye: scheduleKnown && playsInNfl && kickoff === null,
      kickoff,
      locked: kickoff !== null && nowEpoch >= kickoff,
    };
  });

  const weekLineup = resolveWeekLineup({
    weekScopedPayload: input.weekResultsPayload,
    ytdPayload: input.ytdResultsPayload?.allWeeklyResults ?? input.ytdResultsPayload,
    week,
    franchiseId: league.franchiseId,
    league: slug,
    leagueYear: league.year,
  });
  const starterIds = new Set(weekLineup.starters.map((s) => s.id));
  const hasStarters = starterIds.size > 0;
  const weekIsPast = week < currentWeek;

  const candidates = hasStarters
    ? players.filter((p) => starterIds.has(p.id))
    // The same legal-starter filter as the page's fill: active roster only,
    // and on an open week nobody locked or on bye.
    : players
        .filter((p) => p.canStart && (weekIsPast || (!p.locked && !p.isBye)))
        .sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1));
  const assigned = layout
    ? assignLineupSlots(candidates.map((p) => ({ id: p.id, position: p.position, gameLocked: p.locked })), layout)
    : [];
  const slots = assigned.map(({ position, playerId, locked }) => ({ position, playerId, locked }));

  const fill = resolveLineupFillState({
    hasStarters,
    lineupReadOk: weekLineup.lineupReadOk,
    weekIsPast,
    hasProjections: projections.size > 0,
    slotsFilled: slots.length > 0 && slots.every((s) => s.playerId !== null),
    fromCache: weekLineup.fromCache,
    weekScheduled: weekLineup.weekScheduled,
    franchiseListed: weekLineup.franchiseListed,
  });
  // A league whose rules we can't lay out can't be submitted from here:
  // MFL would refuse a lineup shaped by a guess.
  const supported = layout !== null;

  const problemPlayers = new Map<string, ProblemPlayer>(
    players.map((p) => [p.id, {
      id: p.id,
      name: p.name,
      isBye: p.isBye,
      gameLocked: p.locked,
      injury: p.injury ? { injuryStatus: p.injury } : null,
    }]),
  );
  const irViolations = findIrViolations(
    players.map((p) => ({ id: p.id, name: p.name, rosterStatus: p.rosterStatus })),
    input.injuries,
    registry?.irEligibleInjuryStatuses,
  );
  const problems = supported
    ? findLineupProblems({
        slots,
        players: problemPlayers,
        week,
        irViolations,
        irEligibleStatuses: registry?.irEligibleInjuryStatuses,
      })
    : [];

  return {
    leagueId: league.leagueId,
    leagueName: league.leagueName,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    year: league.year,
    week,
    currentWeek,
    supported,
    starterCount: layout?.positions.length ?? 0,
    slots,
    positionMax: layout?.positionMax ?? {},
    players: [...players].sort((a, b) => a.name.localeCompare(b.name)),
    mode: fill.mode,
    canSubmit: supported && fill.canSubmitEdits,
    canSubmitUnsaved: supported && fill.canSubmitUnsaved,
    fillIsProjected: fill.fillIsProjected,
    problems,
    inSeason: isLineupSeason(new Date(input.nowMs)),
    firstKickoff: firstKickoff && Number.isFinite(firstKickoff) ? firstKickoff : null,
  };
}

/** GET an MFL export with the owner's cookie; null on any failure. */
async function fetchExport(url: string, ownerCookie: string): Promise<any> {
  try {
    const res = await mflFetch({ url, method: 'GET', mflUserCookie: ownerCookie, timeoutMs: 8_000 });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    // MFL answers a throttled request with HTTP 200 and an error body.
    return body && !body.error ? body : null;
  } catch {
    return null;
  }
}

export async function loadAppLineup(opts: {
  league: AppLineupLeague;
  ownerCookie: string;
  week?: number | null;
  now?: Date;
}): Promise<MflLiveAppLineup> {
  const { league, ownerCookie } = opts;
  const now = opts.now ?? new Date();
  const currentWeek = getCurrentWeekForYear(league.year);
  const week = opts.week ?? currentWeek;
  const host = league.host ?? DEFAULT_EXPORT_HOST;
  const url = (type: string, params: Record<string, string | number> = {}) =>
    buildMflExportUrl({ type, leagueId: league.leagueId, year: league.year, host, params });

  const [leaguePayload, rostersPayload, weekResultsPayload, ytdResultsPayload, projectionsPayload, nflSchedulePayload, injuries] =
    await Promise.all([
      fetchExport(url('league'), ownerCookie),
      fetchExport(url('rosters', { FRANCHISE: league.franchiseId }), ownerCookie),
      fetchExport(url('weeklyResults', { W: week }), ownerCookie),
      fetchExport(url('weeklyResults', { W: 'YTD' }), ownerCookie),
      fetchExport(url('projectedScores', { W: week }), ownerCookie),
      fetchExport(url('nflSchedule', { W: week }), ownerCookie),
      // MFL's injury report is league-agnostic; the site keeps one copy.
      loadLiveInjuryMap(DEFAULT_LEAGUE_SLUG).catch(() => ({}) as InjuryMap),
    ]);

  const identities = getPlayerMap(league.year);
  // Names the synced feed lacks (IDP players, a fresh signing) come from MFL.
  const ownFranchise = asArray(rostersPayload?.rosters?.franchise).find((f: any) => f?.id === league.franchiseId) as any;
  const rosterIds = asArray(ownFranchise?.player)
    .map((p: any) => p?.id)
    .filter((id: unknown): id is string => typeof id === 'string');
  const missing = rosterIds.filter((id) => !identities.has(id));
  const playersPayload = missing.length
    ? await fetchExport(url('players', { PLAYERS: missing.join(',') }), ownerCookie)
    : null;

  return buildAppLineupView({
    league,
    week,
    currentWeek,
    nowMs: now.getTime(),
    leaguePayload,
    rostersPayload,
    weekResultsPayload,
    ytdResultsPayload,
    projectionsPayload,
    nflSchedulePayload,
    playersPayload,
    injuries,
    identities,
  });
}
