/**
 * Assembling the draft hub's data from the feeds each route globs.
 *
 * The globs themselves have to live in the routes (a static import specifier
 * can't be a runtime variable), but everything done WITH them is identical for
 * both leagues, so it lives here rather than being written twice and drifting.
 */

import type { LazyFeedGlob } from './draft-results-feeds';
import { seasonsFromGlob } from './draft-results-feeds';
import { buildDraftBoard, type DraftResultsPick, type DraftResultsTeam, type PlayerResolver, type RawDraftResultPick } from './draft-results-view';
import type { RawDraftUnit } from './draft-utils';

const asArray = <T,>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

const unwrap = (mod: unknown): any =>
  mod && typeof mod === 'object' && 'default' in (mod as any) ? (mod as any).default : mod;

const seasonOf = (path: string): number | null => {
  const m = path.match(/mfl-feeds\/(\d{4})\//);
  return m ? parseInt(m[1], 10) : null;
};

export interface HubSeason {
  year: number;
  /** Pick slots on the board, filled or not. */
  slots: number;
  /** Slots carrying a real selection. */
  made: number;
  /** Every unit's picks, flattened — the hub does not switch conferences. */
  rawUnits: RawDraftUnit<RawDraftResultPick>[];
}

/** Read one season's slot/selection counts without building a whole board. */
export async function readHubSeason(feeds: LazyFeedGlob, year: number): Promise<HubSeason> {
  const key = Object.keys(feeds).find((p) => seasonOf(p) === year);
  const empty: HubSeason = { year, slots: 0, made: 0, rawUnits: [] };
  if (!key) return empty;

  let raw: any;
  try {
    raw = unwrap(await feeds[key]());
  } catch {
    return empty;
  }

  const rawUnits = asArray<any>(raw?.draftResults?.draftUnit).filter(Boolean);
  let slots = 0;
  let made = 0;
  for (const u of rawUnits) {
    for (const p of asArray<any>(u?.draftPick)) {
      if (!p?.round || !p?.pick) continue;
      slots++;
      // Only a numeric id is a selection: MFL writes '----' for a pick the
      // commissioner skipped, and an empty string for one not yet made.
      if (p.player && /^\d+$/.test(p.player)) made++;
    }
  }
  return { year, slots, made, rawUnits };
}

/**
 * The most recent season with any selection recorded, plus the newest season
 * on the board (which may be a stub for a draft that hasn't happened).
 *
 * Both are needed: the hub counts down using the NEWEST board and recaps using
 * the most recent COMPLETED one, and outside of draft week those are different
 * seasons.
 */
export async function readHubSeasons(feeds: LazyFeedGlob): Promise<{
  newest: HubSeason;
  lastDrafted: HubSeason | null;
}> {
  const years = seasonsFromGlob(feeds).sort((a, b) => b - a);
  if (years.length === 0) {
    return { newest: { year: 0, slots: 0, made: 0, rawUnits: [] }, lastDrafted: null };
  }

  const newest = await readHubSeason(feeds, years[0]);
  if (newest.made > 0) return { newest, lastDrafted: newest };

  // Walk back until a draft that actually happened. Bounded rather than
  // unbounded: a league with no drafted season at all should not read every
  // year in the archive on every hub request.
  for (const year of years.slice(1, 4)) {
    const season = await readHubSeason(feeds, year);
    if (season.made > 0) return { newest, lastDrafted: season };
  }
  return { newest, lastDrafted: null };
}

/**
 * The opening picks of a season, for the hub's recap strip.
 *
 * Takes the FIRST unit only. For the AFL that is one conference's opening
 * round rather than a merged one — the conferences draft on different days, so
 * interleaving them into a single "first six picks" would invent an order that
 * never existed.
 */
export function openingPicks(
  season: HubSeason | null,
  teams: DraftResultsTeam[],
  resolvePlayer: PlayerResolver,
  limit = 6
): DraftResultsPick[] {
  if (!season || season.rawUnits.length === 0) return [];
  const board = buildDraftBoard(
    season.rawUnits[0],
    new Map(teams.map((t) => [t.id, t])),
    resolvePlayer
  );
  return board.slice(0, limit);
}

/**
 * A franchise's picks in a given draft year, grouped by round.
 *
 * Reads MFL's `futureDraftPicks`, which is the only feed that reflects trades
 * for a draft that hasn't been boarded yet.
 */
export function capitalByRound(
  futurePicks: any,
  franchiseId: string,
  year: number
): { round: number; count: number }[] {
  const franchises = asArray<any>(futurePicks?.futureDraftPicks?.franchise);
  const mine = franchises.find((f) => f?.id === franchiseId);
  if (!mine) return [];

  const counts = new Map<number, number>();
  for (const p of asArray<any>(mine.futureDraftPick)) {
    if (parseInt(p?.year, 10) !== year) continue;
    const round = parseInt(p?.round, 10);
    if (!Number.isFinite(round)) continue;
    counts.set(round, (counts.get(round) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, count]) => ({ round, count }));
}

/**
 * Read one year's feed out of a lazy glob, or null.
 *
 * Used for the calendar and futureDraftPicks, which are wanted for ONE year —
 * globbed rather than imported by year because a static import specifier can't
 * carry a runtime year, and writing the year in would be a league constant
 * that silently goes stale at the next rollover.
 */
export async function loadYearFeed(feeds: LazyFeedGlob, year: number): Promise<any> {
  const key = Object.keys(feeds).find((p) => seasonOf(p) === year);
  if (!key) return null;
  try {
    return unwrap(await feeds[key]());
  } catch {
    return null;
  }
}

/**
 * Assemble everything the draft hub renders, from a league's feed globs.
 *
 * The globs are built in the route; everything done with them is identical for
 * both leagues and lives here, which is what keeps each route a thin wrapper
 * (`tests/page-fork-ratchet.test.ts` measures precisely that).
 */
export async function buildDraftHubProps(input: {
  draftFeeds: LazyFeedGlob;
  calendarFeeds: LazyFeedGlob;
  futurePickFeeds: LazyFeedGlob;
  leagueYear: number;
  unionSlug: string;
  teamsForYear: (year: number) => DraftResultsTeam[];
  /** The signed-in owner's franchise id, or null if not a member here. */
  myFranchiseId: string | null;
  now?: Date;
}) {
  const [{ nextDraftStart, resolveDraftHubStatus }, { getGlobalPlayerMap }] = await Promise.all([
    import('./draft-hub-state'),
    import('./player-map'),
  ]);

  const now = input.now ?? new Date();
  const [{ newest, lastDrafted }, calendar, futurePicks] = await Promise.all([
    readHubSeasons(input.draftFeeds),
    loadYearFeed(input.calendarFeeds, input.leagueYear),
    loadYearFeed(input.futurePickFeeds, input.leagueYear),
  ]);

  const status = resolveDraftHubStatus({
    now,
    year: newest.year,
    slots: newest.slots,
    made: newest.made,
    startsAt: nextDraftStart(calendar ?? [], now),
  });

  // The recap is labelled with the season it came from, which outside of
  // draft week is NOT the season the countdown is about.
  const recapYear = lastDrafted?.year ?? null;
  const identities = getGlobalPlayerMap(input.unionSlug);
  const recap = openingPicks(
    lastDrafted,
    input.teamsForYear(recapYear ?? input.leagueYear),
    (id) => identities.get(id)
  );

  const currentTeams = input.teamsForYear(input.leagueYear);
  const myTeam = input.myFranchiseId
    ? currentTeams.find((t) => t.id === input.myFranchiseId) ?? null
    : null;

  // futureDraftPicks only ever describes FUTURE drafts, so the capital card is
  // about the next one, not the one just completed.
  const capitalYear = input.leagueYear + 1;
  const myCapital = myTeam ? capitalByRound(futurePicks, myTeam.id, capitalYear) : [];

  return {
    status,
    recap,
    recapYear,
    myTeam: myTeam ? { id: myTeam.id, name: myTeam.name, icon: myTeam.icon } : null,
    myCapital,
    capitalYear: myTeam ? capitalYear : null,
  };
}
