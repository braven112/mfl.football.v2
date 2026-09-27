/**
 * One entry point for the Front Office hub's data, both leagues.
 *
 * `buildFrontOfficePanelData(slug, …)` returns ONE shape that
 * `FrontOfficePanel.astro` renders. The two leagues genuinely read
 * different sources — TheLeague's season payload with salaries and
 * contracts, the AFL's raw MFL feeds plus keeper stats — so this does not
 * pretend there is one pipeline. It normalizes the OUTPUT, which is the
 * part the component cares about, and keeps each league's loading in its
 * own module (`front-office-planner-data.ts`, `front-office-keeper-data.ts`).
 *
 * Sections are optional fields, not a discriminated union: a section
 * renders when its data is present, and whether it is present is decided
 * by `leagueHasFeature`, never by a slug compare in the component.
 *
 * WHAT IS PRE-RENDERED FOR EVERY TEAM, AND WHAT IS NOT
 *
 * The hub's team switcher swaps display; it never fetches. So anything it
 * can switch between has to be in the payload for all teams. Phase A
 * measured the cost of getting that wrong (16 teams of NFL/college stacks
 * doubled the page), so the split is deliberate:
 *
 * - **Per team:** metrics, roster + cap charts, draft chips, FA needs.
 *   All small; charts are ~26 KB of SVG a team.
 * - **Selected team only:** the NFL/college stacks (~19 PlayerCells at
 *   ~2 KB each). Switching offers a link that reloads the page.
 * - **Viewer's own team only:** the AFL's Keeper Planner. Not a size
 *   decision — a privacy one. See `keepers` below.
 */
import { getLeagueBySlug, leagueHasFeature } from '../config/leagues';
import type { FrontOfficeLeagueSlug } from '../components/shared/front-office-nav/front-office-pages';
import type { AnalyticsPlayer, RosterAnalytics, CapAnalytics, RosterGroup } from './roster-analytics';
import {
  buildFrontOfficePlannerData,
  type FrontOfficePlannerData,
  type FrontOfficeDraftChipGroup,
  type FrontOfficeTeamSummary,
} from './front-office-planner-data';
import { buildAflFrontOfficeData, type AflFrontOfficeData } from './front-office-keeper-data';

export type { FrontOfficeTeamSummary, FrontOfficeDraftChipGroup };

/** One tile in the metric strip. Already formatted — no raw numbers ship. */
export interface FrontOfficeMetric {
  label: string;
  value: string;
  /** Stable id so the switcher's client script can retarget the text. */
  valueId: string;
  /** Neutral line under the value (a player's name, a count). */
  subtitle?: string | null;
  subtitleId?: string;
  /** COLOURED line under the value — reserved for something the owner has
   *  to act on, like "Must cut 3 players". A plain fact rendered here comes
   *  out red and reads as an error. */
  hint?: string | null;
  hintId?: string;
}

export interface FrontOfficeTeamView {
  metrics: FrontOfficeMetric[];
  analytics: RosterAnalytics;
  /** Null for a league with `salaryCap: false` — the cap block then vanishes. */
  cap: CapAnalytics | null;
  draftChips: FrontOfficeDraftChipGroup[];
}

export interface FrontOfficePanelData {
  leagueSlug: FrontOfficeLeagueSlug;
  leagueYear: number;
  teamsList: FrontOfficeTeamSummary[];
  selectedTeamId: string;
  /** Whether the selected team is the signed-in viewer's own. */
  isOwnTeam: boolean;
  signedIn: boolean;

  /** Everything the switcher can swap between, keyed by franchise id. */
  byTeam: Record<string, FrontOfficeTeamView>;
  /** Footnote under the metric strip, or null. */
  metricsNote: string | null;

  /** Stacks for the SELECTED team only — see this file's header. */
  playersByNflTeam: RosterGroup<AnalyticsPlayer>[];
  playersByCollege: RosterGroup<AnalyticsPlayer>[];

  /** Present only where `leagueHasFeature(slug, 'contracts')`. */
  contracts: FrontOfficePlannerData | null;
  /**
   * Whether to render the write affordances — declare buttons and the cut
   * card. Owner-only AND contracts-only: `/api/cut-player` authenticates
   * with the viewer's own MFL cookie and verifies they roster the player,
   * and `/api/contracts/declare` checks `isFranchiseOwner`, so offering
   * either for someone else's team is offering a button the server refuses.
   */
  canAct: boolean;
  /**
   * Present only where `leagueHasFeature(slug, 'keepers')` AND the viewer
   * owns the selected team.
   *
   * This is the one section that is not merely un-actionable for another
   * team — it is unreadable. An AFL keeper plan is a private strategic
   * scratchpad (`/api/afl-keepers` enforces owner-only read, and says so),
   * so rendering the planner for someone else's team would draw an empty
   * board backed by a 403. Owner-only is the honest shape, not a
   * limitation of the switcher.
   */
  keepers: AflFrontOfficeData['keepers'] | null;
}

export async function buildFrontOfficePanelData(args: {
  leagueSlug: FrontOfficeLeagueSlug;
  selectedTeamId: string;
  /** The viewer's franchise IN THIS LEAGUE, or null. */
  viewerFranchiseId: string | null;
  /** The viewer's MFL cookie, for owner-gated AFL reads. */
  viewerMflCookie?: string;
}): Promise<FrontOfficePanelData> {
  const { leagueSlug, selectedTeamId, viewerFranchiseId, viewerMflCookie } = args;
  const league = getLeagueBySlug(leagueSlug)!;
  const isOwnTeam = !!viewerFranchiseId && viewerFranchiseId === selectedTeamId;
  const signedIn = !!viewerFranchiseId;

  if (leagueHasFeature(leagueSlug, 'contracts')) {
    const planner = await buildFrontOfficePlannerData(selectedTeamId);
    const byTeam: Record<string, FrontOfficeTeamView> = {};
    for (const team of planner.teamsList) {
      const m = planner.teamMetrics[team.id];
      const a = planner.teamAnalytics[team.id];
      byTeam[team.id] = {
        metrics: theLeagueMetrics(m),
        analytics: a?.analytics ?? EMPTY_ANALYTICS,
        cap: a?.cap ?? null,
        draftChips: planner.draftChipsByTeam[team.id] ?? [],
      };
    }
    const selected = planner.teamAnalytics[selectedTeamId];
    return {
      leagueSlug,
      leagueYear: planner.leagueYear,
      teamsList: planner.teamsList,
      selectedTeamId,
      isOwnTeam,
      signedIn,
      byTeam,
      metricsNote: planner.metricsNote,
      playersByNflTeam: selected?.playersByNflTeam ?? [],
      playersByCollege: selected?.playersByCollege ?? [],
      contracts: planner,
      canAct: isOwnTeam,
      keepers: null,
    };
  }

  // Keeper leagues (the AFL). No cap, no contracts — so no cap charts, no
  // extension cards, no FA-needs analysis.
  const afl = await buildAflFrontOfficeData({
    selectedTeamId,
    viewerFranchiseId,
    viewerMflCookie,
    leagueId: league.id,
    leagueSlug: leagueSlug === 'keeper' ? 'keeper' : 'afl-fantasy',
    dataPath: league.dataPath,
  });
  return {
    leagueSlug,
    leagueYear: afl.leagueYear,
    teamsList: afl.teamsList,
    selectedTeamId,
    isOwnTeam,
    signedIn,
    byTeam: afl.byTeam,
    metricsNote: null,
    playersByNflTeam: afl.playersByNflTeam,
    playersByCollege: afl.playersByCollege,
    contracts: null,
    // The AFL has no contracts or cap; its write surface is the keeper board.
    canAct: false,
    keepers: isOwnTeam ? afl.keepers : null,
  };
}

/** Shared empty state — a franchise with no season data renders blank, not a throw. */
export const EMPTY_ANALYTICS: RosterAnalytics = {
  rosterSize: 0,
  positionDistribution: [],
  donutSegments: [],
  ageBuckets: [],
  ageStats: { avg: null, oldest: null, youngest: null },
  ageByPositionDots: [],
  ageStripRange: { min: 22, max: 36, ticks: [] },
};

function theLeagueMetrics(m: FrontOfficePlannerData['teamMetrics'][string] | undefined): FrontOfficeMetric[] {
  const v = m ?? {
    capSpaceDisplay: '—',
    avgPerPlayerDisplay: '—',
    playersSignedDisplay: '—',
    cutHint: null,
    deadMoneyDisplay: '—',
    averageAgeDisplay: 'N/A',
  };
  return [
    { label: 'Cap Space', value: v.capSpaceDisplay, valueId: 'fo-metric-cap' },
    { label: 'Avg per Player*', value: v.avgPerPlayerDisplay, valueId: 'fo-metric-avg' },
    {
      label: 'Players Signed',
      value: v.playersSignedDisplay,
      valueId: 'fo-metric-signed',
      hint: v.cutHint,
      hintId: 'fo-metric-signed-hint',
    },
    { label: 'Dead Money', value: v.deadMoneyDisplay, valueId: 'fo-metric-dead' },
    { label: 'Average Age', value: v.averageAgeDisplay, valueId: 'fo-metric-age' },
  ];
}
