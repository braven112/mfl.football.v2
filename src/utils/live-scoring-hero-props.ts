/**
 * Assemble `LiveScoringHeroProps` for one league's homepage.
 *
 * Both homepages need the same six things — the week, the league's identity,
 * the viewer's franchise, a teams map, and the opening scores — and the block
 * that built them lived only in TheLeague's `index.astro`. Copying it into the
 * AFL's would have been the 22nd forked sibling in a repo that already carries
 * ~57,800 lines of them, so it lives here and both routes call it.
 *
 * BEST-EFFORT BY DESIGN. Every failure path returns `undefined` rather than
 * throwing or half-filling: the homepage then renders its normal hero instead
 * of a scoreboard with no scores in it. A live hero is a nice-to-have on a page
 * that has plenty else to show.
 */
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import type { LiveScoringHeroProps, MatchupPairing, TeamInfo } from '../types/live-scoring';

/** The brand fields a teams map needs, as both leagues' configs already carry them. */
export interface LiveScoringTeamSource {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  color?: string;
  icon?: string;
}

export interface BuildLiveScoringHeroPropsInput {
  league: CanonicalLeagueSlug;
  week: number;
  /** The page's own origin — `Astro.url` — so the API call resolves. */
  origin: URL;
  teams: LiveScoringTeamSource[];
  /** The SIGNED-IN franchise. Marks "your" matchup and drives the scope below. */
  userFranchiseId?: string;
  /**
   * Franchise ids the compact grid may draw from. The AFL passes the viewer's
   * conference; TheLeague passes nothing and stays league-wide. Omitted for a
   * signed-out viewer, who has no conference to be scoped to.
   */
  scopeFranchiseIds?: string[];
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Everything the island needs, or `undefined` when the feed could not be read. */
export type BuiltLiveScoringProps = Omit<LiveScoringHeroProps, 'phase' | 'gameWindow' | 'isLive'>;

export async function buildLiveScoringHeroProps(
  input: BuildLiveScoringHeroPropsInput,
): Promise<BuiltLiveScoringProps | undefined> {
  const { league, week, origin, teams, userFranchiseId, scopeFranchiseIds } = input;
  const registry = getLeagueBySlug(league);
  if (!registry) return undefined;

  const doFetch = input.fetchImpl ?? fetch;

  try {
    // `L` is mandatory — see LiveScoringHeroProps.leagueId. The endpoint
    // answers for TheLeague without it, on the server exactly as in the client.
    // `registry.id`, NOT `registry.leagueId` — the registry entry names it
    // `id`, and only `getLeagueContext` renames it. Reading the wrong one
    // yields `undefined`, which fails the endpoint's `/^\d+$/` check and falls
    // back to TheLeague: the precise bug this parameter exists to prevent,
    // silently, with no type error to catch it.
    const url = new URL(
      `/api/live-scoring?week=${week}&L=${encodeURIComponent(registry.id)}`,
      origin,
    );
    const res = await doFetch(url);
    if (!res.ok) return undefined;

    // `.json()` rejects on a non-JSON body, which is how a proxy or an error
    // page arrives. Caught by the outer try — a rejection here is a failure to
    // read the feed, not an empty one.
    const data = await res.json();

    // `res.ok` is NOT "the call worked". The endpoint answers 200 with
    // `ok: false` when the UPSTREAM MFL request failed, precisely so callers
    // can tell an outage from a healthy offseason feed (which is `ok: true`
    // with empty collections). Merging the two is the trap
    // docs/claude/rules/lineups.md names: "no games" and "couldn't read it"
    // must never become the same value. Here they differ — an outage returns
    // undefined so the homepage keeps its normal hero, while a genuinely empty
    // week renders the hero with nothing in it, which is correct.
    if (data?.ok === false || data?.error) return undefined;

    const teamsMap: Record<string, TeamInfo> = {};
    for (const t of teams) {
      teamsMap[t.franchiseId] = {
        franchiseId: t.franchiseId,
        name: t.name,
        nameMedium: t.nameMedium,
        nameShort: t.nameShort,
        abbrev: t.abbrev,
        color: t.color ?? '',
        icon: t.icon,
      };
    }

    return {
      week,
      leagueId: registry.id,
      leagueName: registry.name,
      userFranchiseId,
      ...(scopeFranchiseIds?.length ? { scopeFranchiseIds } : {}),
      matchups: (data?.matchups ?? []) as MatchupPairing[],
      teams: teamsMap,
      initialScores: data?.scores,
      initialRemaining: data?.remaining,
    };
  } catch {
    return undefined;
  }
}
