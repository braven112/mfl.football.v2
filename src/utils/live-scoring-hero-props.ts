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
import { getCurrentSeasonYear } from './league-year';
import { loadLiveScoringPayload } from './live-scoring-source';
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
  /**
   * The page's own origin. No longer used to fetch anything — the feed is read
   * from MFL in-process — but kept optional so both homepages need no change.
   */
  origin?: URL;
  teams: LiveScoringTeamSource[];
  /** The SIGNED-IN franchise. Marks "your" matchup and drives the scope below. */
  userFranchiseId?: string;
  /**
   * Franchise ids the compact grid may draw from. The AFL passes the viewer's
   * conference; TheLeague passes nothing and stays league-wide. Omitted for a
   * signed-out viewer, who has no conference to be scoped to.
   */
  scopeFranchiseIds?: string[];
  /** Injectable for tests; defaults to the real MFL read. */
  loadImpl?: typeof loadLiveScoringPayload;
}

/** Everything the island needs, or `undefined` when the feed could not be read. */
export type BuiltLiveScoringProps = Omit<LiveScoringHeroProps, 'phase' | 'gameWindow' | 'isLive'>;

export async function buildLiveScoringHeroProps(
  input: BuildLiveScoringHeroPropsInput,
): Promise<BuiltLiveScoringProps | undefined> {
  const { league, week, teams, userFranchiseId, scopeFranchiseIds } = input;
  const registry = getLeagueBySlug(league);
  if (!registry) return undefined;

  const load = input.loadImpl ?? loadLiveScoringPayload;

  try {
    // Read MFL IN-PROCESS, not by fetching our own `/api/live-scoring` over the
    // public internet. The self-fetch this replaces is the same one that broke
    // the live-scoring PAGE on 2026-09-09 — our own edge in the path of an SSR
    // render, failing in a way that leaves no log entry because the request
    // never reaches the route. It degraded more quietly here (the homepage just
    // drops back to its normal hero) which is exactly why it could sit unnoticed.
    //
    // `registry.id`, NOT `registry.leagueId` — the registry entry names it `id`
    // and only `getLeagueContext` renames it. The loader resolves the MFL host
    // from that id, so the league and its server cannot disagree.
    //
    // The SEASON year — live scoring is results-shaped. The route defaulted to
    // this when the old URL omitted `year`; reading MFL directly means saying
    // so, and the league year would name a season MFL is not scoring for the
    // six months between Feb 14 and Labor Day.
    const data = await load({ leagueId: registry.id, year: getCurrentSeasonYear(), week });

    // `ok: false` is the UPSTREAM MFL failure, and it is the one that looks
    // exactly like a healthy empty week unless the flag is read. An outage
    // returns undefined so the homepage keeps its normal hero; a genuinely
    // empty week renders the hero with nothing in it, which is correct.
    if (data.ok === false) return undefined;

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
