/**
 * The roster page's draft cards: next year's order, who owns which pick, and
 * the same for the year after when the planner asks for both.
 *
 * Extracted from `rosters.astro` frontmatter (Phase 7 of
 * docs/plans/rosters-page-split.md) as a PURE function of its inputs. The
 * feeds stay in the page because `import.meta.glob` specifiers must be
 * literal and relative to the file that writes them — so this takes the
 * loaded JSON rather than reaching for it, which is also what makes it
 * testable.
 *
 * Three decisions worth keeping visible, all of them the original's:
 *
 * - **Draft order comes from the SEASON year, not the league year.** The
 *   order is earned by the season that was played; reading it off the new
 *   league year would rank clubs by a season that has not happened.
 * - **Actual MFL picks beat computed ones.** Once `draftResults` exists it is
 *   authoritative, including trades. The transaction-derived path is a
 *   fallback for the window before MFL publishes, and it can miscalculate
 *   pick positions — so it is never preferred when real data is present.
 * - **The viewer's own club is always in the list.** A club that has traded
 *   away every pick appears in no asset row, and without this its owner would
 *   open the card to someone else's team.
 */
import {
  calculateDraftOrder,
  buildActualDraftPicks,
  convertActualPicksToPredictions,
} from '../draft-utils';
import { extractToiletBowlWinners, extractLeagueChampion } from '../toilet-bowl-utils';
import {
  convertAssetsToPredictions,
  isValidAssetsData,
  extractAssetsFromTransactions,
} from '../assets-utils';
import type { DraftPrediction, ToiletBowlResult } from '../../types/standings';

/**
 * The name/art a pick row is labelled with.
 *
 * `icon` and `banner` are REQUIRED here, which is stricter than
 * `draft-utils`' own `TeamConfig` and exactly as strict as
 * `assets-utils#convertAssetsToPredictions`. The page passes one map to both,
 * and its entries always carry the two (`getCurrentIconPath(team) ?? ''`), so
 * this states what the caller really supplies rather than casting the
 * difference away at each call.
 */
export interface DraftTeamConfig {
  id: string;
  name: string;
  icon: string;
  banner: string;
}

export type ActualDraftPick = ReturnType<typeof buildActualDraftPicks>[number];

export interface DraftAssetsInput {
  /** `teamsList` — every active club, in the page's own order. */
  teams: DraftTeamConfig[];
  /** `standings.json` for the season that was PLAYED. */
  standingsData: any;
  /** `playoff-brackets.json`; supplies the champion and the toilet-bowl winners. */
  bracketData: any;
  /** `draftResults.json` for the draft being ordered, when MFL has published it. */
  draftResultsData: any;
  /** `transactions.json` for the season played — the fallback pick source. */
  transactionsData: any;
  /** The year being drafted, i.e. season year + 1. */
  draftNextYear: number;
  /** The club on screen; always kept in the asset lists. */
  defaultTeamId: string | null;
  /** Whether the planner phase shows the year-after card too. */
  includeFollowingYear: boolean;
}

export interface DraftAssets {
  draftPredictions: DraftPrediction[];
  actualDraftPicks: ActualDraftPick[];
  assetsPredictions: DraftPrediction[];
  toiletBowlWinners: ToiletBowlResult[];
  assetTeamIds: string[];
  followingYearPredictions: DraftPrediction[];
  followingYearTeamIds: string[];
}

/** `teamsList` → the map every draft util takes. */
const toTeamConfigMap = (teams: DraftTeamConfig[]): Map<string, DraftTeamConfig> =>
  new Map(
    teams.map((team) => [
      team.id,
      { id: team.id, name: team.name, icon: team.icon, banner: team.banner },
    ]),
  );

/**
 * Franchise ids owning at least one pick, with the viewed club first if it
 * owns none — see the header note for why that case is real.
 */
const ownersOf = (predictions: DraftPrediction[], defaultTeamId: string | null): string[] => {
  const ids = Array.from(new Set(predictions.map((p) => p.franchiseId))).filter(Boolean);
  if (defaultTeamId && !ids.includes(defaultTeamId)) ids.unshift(defaultTeamId);
  return ids;
};

export function buildDraftAssets({
  teams,
  standingsData,
  bracketData,
  draftResultsData,
  transactionsData,
  draftNextYear,
  defaultTeamId,
  includeFollowingYear,
}: DraftAssetsInput): DraftAssets {
  let draftPredictions: DraftPrediction[] = [];
  let actualDraftPicks: ActualDraftPick[] = [];
  let assetsPredictions: DraftPrediction[] = [];
  let toiletBowlWinners: ToiletBowlResult[] = [];

  if (standingsData?.leagueStandings?.franchise) {
    const teamConfigMap = toTeamConfigMap(teams);

    // Optional — only the special picks need them.
    if (bracketData) {
      toiletBowlWinners = extractToiletBowlWinners(bracketData);
    }

    const leagueWinnerId = bracketData ? extractLeagueChampion(bracketData) : '';

    // Champion picks last; the toilet bowl decides 1.17 and 2.17/2.18.
    draftPredictions = calculateDraftOrder(
      standingsData.leagueStandings.franchise,
      teamConfigMap,
      leagueWinnerId,
      toiletBowlWinners,
    );

    if (draftResultsData) {
      actualDraftPicks = buildActualDraftPicks(draftResultsData, teamConfigMap);
    }

    if (actualDraftPicks.length > 0) {
      // Authoritative: real pick numbers, trades included.
      assetsPredictions = convertActualPicksToPredictions(
        actualDraftPicks,
        teamConfigMap,
      );
    } else if (transactionsData) {
      // Before MFL publishes the draft, derive from trades. This can get pick
      // POSITIONS wrong, which is why it never wins over real results.
      const assetsData = extractAssetsFromTransactions(
        transactionsData,
        standingsData,
        draftNextYear,
        draftPredictions,
      );
      if (isValidAssetsData(assetsData)) {
        assetsPredictions = convertAssetsToPredictions(assetsData, teamConfigMap);
      }
    }
  }

  let followingYearPredictions: DraftPrediction[] = [];
  let followingYearTeamIds: string[] = [];
  if (includeFollowingYear && transactionsData && standingsData?.leagueStandings?.franchise) {
    // The year after has no draft results by definition, so it is always the
    // transaction-derived path.
    const assetsData = extractAssetsFromTransactions(
      transactionsData,
      standingsData,
      draftNextYear + 1,
      draftPredictions,
    );
    if (isValidAssetsData(assetsData)) {
      followingYearPredictions = convertAssetsToPredictions(
        assetsData,
        toTeamConfigMap(teams),
      );
    }
    followingYearTeamIds = ownersOf(followingYearPredictions, defaultTeamId);
  }

  return {
    draftPredictions,
    actualDraftPicks,
    assetsPredictions,
    toiletBowlWinners,
    assetTeamIds: ownersOf(assetsPredictions, defaultTeamId),
    followingYearPredictions,
    followingYearTeamIds,
  };
}
