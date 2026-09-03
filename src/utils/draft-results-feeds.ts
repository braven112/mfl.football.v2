/**
 * Loading one season's draftResults out of a LAZY `import.meta.glob`.
 *
 * Both Draft Results routes glob their own league's feeds (a static import
 * specifier can't be a runtime variable), but the glob's shape and the "which
 * seasons exist" question are identical, so they live here rather than being
 * written twice.
 *
 * Lazy, not eager, and that is the whole point: the glob's KEYS answer "what
 * seasons do we have" at build time for free, while only the season being
 * viewed is actually read. The AFL's draftResults are 1.2 MB across 24 years —
 * eager-globbing would put all of it in the serverless chunk to render one
 * board, which is the same mistake `compute-player-identity-union.mjs` was
 * written to undo.
 */

import type { RawDraftUnit } from './draft-utils';
import type { RawDraftResultPick } from './draft-results-view';

/** What Vite hands back for a lazy glob. */
export type LazyFeedGlob = Record<string, () => Promise<unknown>>;

export interface DraftResultsSeason {
  year: number;
  rawUnit: RawDraftUnit<RawDraftResultPick> | RawDraftUnit<RawDraftResultPick>[] | undefined;
  /** Rounds in the season's FIRST unit — used to compare draft shapes. */
  rounds: number;
  /** Units with at least one pick. An empty conference is not a unit. */
  units: number;
}

const seasonOf = (path: string): number | null => {
  const m = path.match(/mfl-feeds\/(\d{4})\//);
  return m ? parseInt(m[1], 10) : null;
};

const asArray = <T,>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

/** Every season the glob matched, ascending. */
export function seasonsFromGlob(feeds: LazyFeedGlob): number[] {
  return Object.keys(feeds)
    .map(seasonOf)
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);
}

/** A module may be the JSON itself or a `{ default }` wrapper. */
const unwrap = (mod: unknown): any =>
  mod && typeof mod === 'object' && 'default' in (mod as any) ? (mod as any).default : mod;

/**
 * Read one season. Returns an empty season rather than throwing — a missing or
 * malformed feed should render "no picks recorded", not a 500.
 */
export async function loadDraftResultsSeason(
  feeds: LazyFeedGlob,
  year: number
): Promise<DraftResultsSeason> {
  const key = Object.keys(feeds).find((p) => seasonOf(p) === year);
  if (!key) return { year, rawUnit: undefined, rounds: 0, units: 0 };

  let raw: any;
  try {
    raw = unwrap(await feeds[key]());
  } catch {
    return { year, rawUnit: undefined, rounds: 0, units: 0 };
  }

  const rawUnit = raw?.draftResults?.draftUnit;
  const populated = asArray<any>(rawUnit).filter(
    (u) => asArray(u?.draftPick).some((p: any) => p?.round && p?.pick)
  );
  const rounds = new Set(
    asArray<any>(populated[0]?.draftPick)
      .map((p: any) => parseInt(p?.round, 10))
      .filter((n) => Number.isFinite(n))
  ).size;

  return { year, rawUnit, rounds, units: populated.length };
}

/**
 * Assemble a Draft Results view from a league's feed glob.
 *
 * The glob itself must be built in the route (a static import specifier can't
 * be a runtime variable), but everything downstream of it is identical for
 * both leagues. Keeping it here is what lets each route stay a thin wrapper —
 * `tests/page-fork-ratchet.test.ts` measures exactly that, and two 85-line
 * wrappers doing their own assembly is the shape it exists to catch.
 */
export async function buildDraftResultsView(input: {
  feeds: LazyFeedGlob;
  params: URLSearchParams;
  /** The league config, already year-resolved by the caller's own import. */
  teamsForYear: (year: number) => import('./draft-results-view').DraftResultsTeam[];
  labelForUnit: (code: string) => string;
  resolvePlayer: import('./draft-results-view').PlayerResolver;
}) {
  const { resolveDefaultYear, resolveDraftResultsView, resolveRequestedYear } = await import(
    './draft-results-view'
  );

  const availableYears = seasonsFromGlob(input.feeds);
  const year =
    resolveRequestedYear(input.params, availableYears) ??
    resolveDefaultYear(availableYears, () => true) ??
    availableYears[0];

  const [season, latest] = await Promise.all([
    loadDraftResultsSeason(input.feeds, year),
    loadDraftResultsSeason(input.feeds, Math.max(...availableYears)),
  ]);

  return resolveDraftResultsView({
    availableYears,
    year,
    rawUnit: season.rawUnit,
    // Franchise names and slots move between seasons, so the board is
    // labelled with the config as it stood THAT year, not as it stands now.
    teams: input.teamsForYear(year),
    params: input.params,
    labelForUnit: input.labelForUnit,
    resolvePlayer: input.resolvePlayer,
    currentRounds: latest.rounds,
    currentUnits: latest.units,
  });
}
