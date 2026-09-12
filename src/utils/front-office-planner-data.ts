/**
 * SSR data assembly for TheLeague's Front Office League Planner
 * (components/shared/front-office-hub/TheLeaguePlannerPanel.astro).
 *
 * DELIBERATE DUPLICATION, not extraction — see front-office-pages.ts's header
 * and docs/plans (Front Office Phase 2). This module re-derives the same
 * "League Planner" slice that `src/pages/theleague/rosters.astro`'s
 * `?view=planner` tab computes (roughly its lines 632–1390), but narrowed to
 * exactly what the planner needs:
 *
 * - ONE season (the current league year) — rosters.astro carries ~20 seasons
 *   for its season picker; Front Office has none.
 * - No roster-table / analytics fields (weekly scores, odds, injuries, trend
 *   weeks, snap counts, college logos for the table) — those are irrelevant
 *   here and were the bulk of rosters.astro's per-player payload.
 * - Per-team cap metrics are PRECOMPUTED server-side for all 16 teams, as
 *   ready-to-render display strings, not raw numbers recomputed client-side.
 *   Front Office has no cut/declare/extend actions — it's read-only planning
 *   — so unlike rosters.astro there is no live client-side cap math at all;
 *   switching teams just swaps in a different team's already-computed
 *   strings. This is the single biggest simplification versus rosters.astro.
 *
 * Where rosters.astro's own logic is already extracted into a shared module
 * (scripts/lib/roster-season-payload.mjs — the per-player salary/contract
 * resolution that actually matters for cap correctness), THIS FILE IMPORTS
 * IT rather than re-deriving it, so a same-day roster move or contract edit
 * resolves identically on both pages. Only small, already-duplicated-by-the-
 * page pure helpers (getCollegeAssets, the salary-averages row shape) are
 * copied — the same helpers rosters.astro itself has never extracted.
 */
import fs from 'node:fs';
import path from 'node:path';

import { getActiveTeams, getCurrentIconPath, getCurrentBannerPath } from './league-assets';
import leagueAssets from '../data/theleague.assets.json';
import collegeLogos from '../data/college-logos.json';
import espnCollegeIds from '../../data/theleague/espn-college-ids.json';
import { getPlayerMap } from './player-map';
import { getPlayerHeadshot, divisionOrder } from '../constants/roster-constants';
import { getCachedRosters } from './mfl-roster-cache';
import { getLeagueBySlug } from '../config/leagues';
import { getCurrentLeagueYear, getCurrentSeasonYear } from './league-year';
import { analyzeFreeAgentNeeds, type PositionNeed } from './free-agent-needs';
import { getPlannerPhase, type PlannerPhaseInfo } from './planner-phase';
import { calculateDraftOrder, buildActualDraftPicks, convertActualPicksToPredictions } from './draft-utils';
import { extractToiletBowlWinners, extractLeagueChampion } from './toilet-bowl-utils';
import { convertAssetsToPredictions, isValidAssetsData, extractAssetsFromTransactions } from './assets-utils';
import { calculateAverageAge } from './age-utils';
import { currencyFormatter, formatCapSpaceDisplay } from './formatters';
import {
  SALARY_CAP,
  TARGET_ACTIVE_COUNT,
  RESERVE_FOR_ROOKIES,
  calculateCapCharges,
  aggregateDeadMoney,
  getFrozenSalaryAveragesYear,
} from './salary-calculations';
import {
  buildSeasonPayload as buildSeasonPayloadShared,
  indexPlayersFeed,
  indexRosterFeed,
  buildSeasonSalaryAdjustments,
  buildSeasonLeagueMeta,
} from '../../scripts/lib/roster-season-payload.mjs';

const THELEAGUE_ID = getLeagueBySlug('theleague')!.id;

// ---- small fs-based feed loaders (mirrors rosters.astro's loadFeedJson —
// this repo's established idiom for "just the current year", no glob) ----

const loadFeedJson = (year: string | number, filename: string): any => {
  const feedPath = path.resolve(process.cwd(), `data/theleague/mfl-feeds/${year}/${filename}`);
  try {
    if (fs.existsSync(feedPath)) return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    // Missing/malformed feed — caller treats as absent.
  }
  return null;
};

const loadSrcDataJson = (filename: string): any => {
  const filePath = path.resolve(process.cwd(), `src/data/${filename}`);
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // Missing/malformed file — caller treats as absent.
  }
  return null;
};

const collegeLogosNormalized = Object.fromEntries(
  Object.entries(collegeLogos ?? {}).map(([name, data]) => [name.toLowerCase(), data]),
);

/** Verbatim copy of rosters.astro's inline helper (never extracted there either). */
const getCollegeAssets = (collegeName?: string | null) => {
  if (!collegeName) return null;
  return (collegeLogosNormalized as any)[collegeName.toLowerCase()] ?? null;
};

/** Verbatim copy of rosters.astro's salaryAveragesBySeason row shape (line ~1050). */
const buildSalaryAveragesEntry = (data: any) => {
  if (!data?.positions) return null;
  return {
    extensionSalaries: {
      QB: data.positions.QB?.top5Average ?? 0,
      RB: data.positions.RB?.top5Average ?? 0,
      WR: data.positions.WR?.top5Average ?? 0,
      TE: data.positions.TE?.top5Average ?? 0,
      PK: data.positions.PK?.top5Average ?? 0,
      DEF: data.positions.Def?.top5Average ?? 0,
    },
    franchiseSalaries: {
      QB: data.positions.QB?.top3Average ?? 0,
      RB: data.positions.RB?.top3Average ?? 0,
      WR: data.positions.WR?.top3Average ?? 0,
      TE: data.positions.TE?.top3Average ?? 0,
      PK: data.positions.PK?.top3Average ?? 0,
      DEF: data.positions.Def?.top3Average ?? 0,
    },
    teamOptionSalaries: {
      QB: data.positions.QB?.top10Average ?? 0,
      RB: data.positions.RB?.top10Average ?? 0,
      WR: data.positions.WR?.top10Average ?? 0,
      TE: data.positions.TE?.top10Average ?? 0,
      PK: data.positions.PK?.top10Average ?? 0,
      DEF: data.positions.Def?.top10Average ?? 0,
    },
  };
};

export interface FrontOfficeTeamSummary {
  id: string;
  name: string;
  division: string;
  icon: string;
  banner: string;
}

/** Precomputed, ready-to-render metric strings for one team. No raw numbers ship. */
export interface FrontOfficeTeamMetrics {
  capSpaceDisplay: string;
  avgPerPlayerDisplay: string;
  playersSignedDisplay: string;
  cutHint: string | null;
  deadMoneyDisplay: string;
  averageAgeDisplay: string;
}

/** Trimmed player shape for the extension components — see rosters.astro:7963-7982. */
export interface FrontOfficeTagPlayer {
  id: string;
  name: string;
  position: string;
  salary: number;
  points: number;
  franchiseId: string;
  nflTeam: string;
  headshot: string;
  nflLogo: string;
  contractYears: number;
  gamesPlayed?: number;
  birthdate: number | null;
}

export interface FrontOfficePlannerData {
  teamsList: FrontOfficeTeamSummary[];
  leagueYear: number;
  plannerPhase: PlannerPhaseInfo;
  extensionSeason: string;
  salaryAveragesBySeason: Record<string, ReturnType<typeof buildSalaryAveragesEntry>>;
  allPlayers: FrontOfficeTagPlayer[];
  freeAgentNeedsByTeam: Record<string, PositionNeed[]>;
  teamMetrics: Record<string, FrontOfficeTeamMetrics>;
  draftNextYear: number;
  draftPredictions: any[];
  actualDraftPicks: any[];
  assetsPredictions: any[];
  assetTeamIds: string[];
  assets2027Predictions: any[];
  asset2027TeamIds: string[];
}

export async function buildFrontOfficePlannerData(selectedTeamId: string): Promise<FrontOfficePlannerData> {
  const leagueYear = getCurrentLeagueYear();
  const leagueYearStr = String(leagueYear);

  const activeTeams = getActiveTeams(leagueAssets as any);
  const teamsList: FrontOfficeTeamSummary[] = activeTeams
    .map((team: any) => ({
      id: team.id,
      name: team.name,
      division: team.division ?? '',
      icon: getCurrentIconPath(team) ?? '',
      banner: getCurrentBannerPath(team) ?? '',
    }))
    .sort((a, b) => {
      const divIndexA = (divisionOrder as readonly string[]).indexOf(a.division);
      const divIndexB = (divisionOrder as readonly string[]).indexOf(b.division);
      if (divIndexA !== divIndexB) return divIndexA - divIndexB;
      return a.name.localeCompare(b.name);
    });

  // ---- one-season SeasonPayloadContext (see roster-season-payload.mjs's
  // SeasonPayloadContext typedef) — real values for what affects salary/cap
  // math, neutral/empty for everything display-only (odds, injuries, weekly
  // scores, trend weeks). Same "neutral live-only inputs" pattern the
  // historical-season prebuild script already uses for every OTHER season. ----
  const playersData = loadFeedJson(leagueYearStr, 'players.json');
  const rostersData = loadFeedJson(leagueYearStr, 'rosters.json');
  const leagueData = loadFeedJson(leagueYearStr, 'league.json');
  const salaryAdjustmentsData = loadFeedJson(leagueYearStr, 'salaryAdjustments.json');
  const projectedScoresData = loadFeedJson(leagueYearStr, 'projectedScores.json');
  const rawSalaryData = loadSrcDataJson(`mfl-player-salaries-${leagueYearStr}.json`);

  const playersFeedBySeason: Record<string, any> = {
    [leagueYearStr]: indexPlayersFeed(playersData) ?? {},
  };

  const cachedRosterPlayers = await getCachedRosters(leagueYearStr, THELEAGUE_ID);
  const liveRosterDataByPlayerId: Record<string, any> = {
    [leagueYearStr]: cachedRosterPlayers ?? indexRosterFeed(rostersData) ?? {},
  };

  const feedSalaryAdjustmentsBySeason: Record<string, any> = {
    [leagueYearStr]: buildSeasonSalaryAdjustments(salaryAdjustmentsData, getPlayerMap(leagueYear)) ?? [],
  };

  const leagueMetaBySeason: Record<string, any> = {
    [leagueYearStr]: buildSeasonLeagueMeta(leagueData) ?? null,
  };

  const seasonPayloadContext = {
    playersFeedBySeason,
    getIdentityMap: (year: number) => getPlayerMap(year),
    liveRosterDataByPlayerId,
    projectedScoresBySeason: { [leagueYearStr]: projectedScoresData },
    currentSeasonYearStr: leagueYearStr,
    currentLeagueYear: leagueYear,
    liveOddsData: {},
    isDemoMode: false,
    fantasyPointsAllowedBySeason: {},
    trendWeeks: [],
    playerScoresMap: new Map(),
    espnCollegeIds,
    // buildSeasonPayloadShared's JSDoc-inferred context type wants a
    // 2-arg (mflId, espnId) shape; the real getPlayerHeadshot also takes an
    // optional teamCode third arg. Adapt rather than widen the shared type.
    getPlayerHeadshot: (mflId?: string, espnId?: string | null) => getPlayerHeadshot(mflId, espnId ?? undefined),
    getCollegeAssets,
    mflInjuryData: {},
    recordsBySeason: {},
    leagueMetaBySeason,
    feedSalaryAdjustmentsBySeason,
  };

  // buildSeasonPayloadShared is plain JS (JSDoc only); its return type
  // doesn't carry the {metadata, teams, salaryAdjustments} shape into TS.
  const seasonData: any = buildSeasonPayloadShared(seasonPayloadContext, leagueYearStr, rawSalaryData, new Set());
  const capLimit = seasonData.metadata?.capLimit ?? SALARY_CAP;

  // ---- extension salary averages (Extensions section) ----
  const currentYearAverages = loadSrcDataJson(`mfl-salary-averages-${leagueYearStr}.json`);
  const priorYearStr = String(leagueYear - 1);
  const priorYearAverages = loadSrcDataJson(`mfl-salary-averages-${priorYearStr}.json`);
  const extensionSeason = String(
    getFrozenSalaryAveragesYear({ [`mfl-salary-averages-${leagueYearStr}.json`]: currentYearAverages }, (d) => d),
  );
  const salaryAveragesBySeason: Record<string, ReturnType<typeof buildSalaryAveragesEntry>> = {};
  const currentEntry = buildSalaryAveragesEntry(currentYearAverages);
  if (currentEntry) salaryAveragesBySeason[leagueYearStr] = currentEntry;
  const priorEntry = buildSalaryAveragesEntry(priorYearAverages);
  if (priorEntry) salaryAveragesBySeason[priorYearStr] = priorEntry;

  // ---- league-wide player list, trimmed, for FranchiseOptions /
  // VeteranExtensionCandidates (both filter this by franchiseId themselves —
  // see those components' own client scripts) ----
  const allPlayers: FrontOfficeTagPlayer[] = Object.values(seasonData.teams ?? {}).flatMap((team: any) =>
    [...(team.players ?? []), ...(team.practiceSquad ?? []), ...(team.injuredReserve ?? [])].map((player: any) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      salary: player.salary,
      points: player.points || 0,
      franchiseId: player.franchiseId,
      nflTeam: player.nflTeam,
      headshot: player.headshot,
      nflLogo: player.nflLogo,
      contractYears: player.contractYears,
      gamesPlayed: player.gamesPlayed ?? undefined,
      birthdate: player.birthdate ?? null,
    })),
  );

  // ---- per-team precomputed metrics (Front Office is read-only — no cap
  // math ships to the client at all, only these ready-made strings) ----
  const teamMetrics: Record<string, FrontOfficeTeamMetrics> = {};
  for (const team of teamsList) {
    const teamData = seasonData.teams?.[team.id] ?? {
      players: [],
      practiceSquad: [],
      injuredReserve: [],
    };
    const rows = [
      ...(teamData.players ?? []).map((p: any) => ({ ...p, displayTag: 'active' })),
      ...(teamData.practiceSquad ?? []).map((p: any) => ({ ...p, displayTag: 'practice' })),
      ...(teamData.injuredReserve ?? []).map((p: any) => ({ ...p, displayTag: 'injured' })),
    ];
    const capCharges = calculateCapCharges(rows);
    const deadMoney = aggregateDeadMoney(seasonData.salaryAdjustments ?? [], team.id);
    const capChargesWithDead = capCharges.map((v, i) => v + (deadMoney[i] ?? 0));
    const nextYearCapCharge = capChargesWithDead[1] ?? 0;
    const playersNextYear = rows.filter((p) => (p.contractYears ?? 0) > 1).length;
    const remainingSlots = Math.max(TARGET_ACTIVE_COUNT - playersNextYear, 1);
    const playersToCut = Math.max(playersNextYear - TARGET_ACTIVE_COUNT, 0);
    const deadMoneyNextYear = deadMoney[1] ?? 0;
    const capSpaceNextYear = Math.max(capLimit - nextYearCapCharge - RESERVE_FOR_ROOKIES, 0);
    const avgPerPlayer = capSpaceNextYear / remainingSlots;
    const averageAge = calculateAverageAge(rows as any);

    teamMetrics[team.id] = {
      capSpaceDisplay: formatCapSpaceDisplay(Math.max(capLimit - nextYearCapCharge, 0)),
      avgPerPlayerDisplay: `${currencyFormatter.format(avgPerPlayer)} × ${remainingSlots}`,
      playersSignedDisplay: String(playersNextYear),
      cutHint:
        playersToCut > 0
          ? `Must cut ${playersToCut} ${playersToCut === 1 ? 'player' : 'players'} by cutdown`
          : null,
      deadMoneyDisplay: currencyFormatter.format(deadMoneyNextYear),
      averageAgeDisplay: averageAge !== null ? `${averageAge} years` : 'N/A',
    };
  }

  // ---- planner phase (drives section order + whether both draft years show) ----
  const plannerPhase = getPlannerPhase();

  // ---- free agent needs, per team (rosters.astro:1365-1390) ----
  const faProjScores = projectedScoresData?.projectedScores?.playerScore || [];
  const faPlayerFeed = playersFeedBySeason[leagueYearStr] ?? {};
  const faRosterData = liveRosterDataByPlayerId[leagueYearStr] ?? {};
  const freeAgentNeedsByTeam: Record<string, PositionNeed[]> = {};
  const faPlayerIdentityMap = getPlayerMap(leagueYear);
  teamsList.forEach((team) => {
    const needs = analyzeFreeAgentNeeds(team.id, faProjScores, faPlayerFeed, faRosterData);
    for (const need of needs) {
      for (const fa of need.topFreeAgents) {
        const faIdentity = faPlayerIdentityMap.get(fa.id);
        const feedPlayer = faPlayerFeed[fa.id];
        fa.headshot =
          faIdentity?.headshot ??
          getPlayerHeadshot(fa.id, feedPlayer?.espn_id || (espnCollegeIds as any).players?.[fa.id]?.espnCollegeId);
        if (feedPlayer?.birthdate) fa.birthdate = Number(feedPlayer.birthdate);
      }
    }
    freeAgentNeedsByTeam[team.id] = needs;
  });

  // ---- draft predictions / assets (rosters.astro:1256-1363) — season year,
  // not league year: standings/brackets/draft results describe the season
  // that was PLAYED, not the roster-management clock. ----
  const draftSeasonYear = getCurrentSeasonYear();
  const draftNextYear = draftSeasonYear + 1;
  const standingsData = loadFeedJson(draftSeasonYear, 'standings.json');
  const bracketData = loadFeedJson(draftSeasonYear, 'playoff-brackets.json');
  const draftResultsData = loadFeedJson(draftNextYear, 'draftResults.json');
  const transactionsData = loadFeedJson(draftSeasonYear, 'transactions.json');

  let draftPredictions: any[] = [];
  let actualDraftPicks: any[] = [];
  let assetsPredictions: any[] = [];
  let assetTeamIds: string[] = [];
  let assets2027Predictions: any[] = [];
  let asset2027TeamIds: string[] = [];

  if (standingsData?.leagueStandings?.franchise) {
    const teamConfigMap = new Map(
      teamsList.map((team) => [team.id, { id: team.id, name: team.name, icon: team.icon, banner: team.banner }]),
    );

    const toiletBowlWinners = bracketData ? extractToiletBowlWinners(bracketData) : [];
    const leagueWinnerId = bracketData ? extractLeagueChampion(bracketData) : '';

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
      assetsPredictions = convertActualPicksToPredictions(actualDraftPicks, teamConfigMap);
    } else if (transactionsData) {
      const assetsData = extractAssetsFromTransactions(transactionsData, standingsData, draftNextYear, draftPredictions);
      if (isValidAssetsData(assetsData)) {
        assetsPredictions = convertAssetsToPredictions(assetsData, teamConfigMap);
      }
    }

    assetTeamIds = Array.from(new Set(assetsPredictions.map((p) => p.franchiseId))).filter(Boolean);
    if (selectedTeamId && !assetTeamIds.includes(selectedTeamId)) assetTeamIds.unshift(selectedTeamId);

    if (plannerPhase.showDualDraftCards && transactionsData) {
      const teamConfigMap2027 = new Map(
        teamsList.map((team) => [team.id, { id: team.id, name: team.name, icon: team.icon, banner: team.banner }]),
      );
      const assets2027Data = extractAssetsFromTransactions(
        transactionsData,
        standingsData,
        draftNextYear + 1,
        draftPredictions,
      );
      if (isValidAssetsData(assets2027Data)) {
        assets2027Predictions = convertAssetsToPredictions(assets2027Data, teamConfigMap2027);
      }
      asset2027TeamIds = Array.from(new Set(assets2027Predictions.map((p) => p.franchiseId))).filter(Boolean);
      if (selectedTeamId && !asset2027TeamIds.includes(selectedTeamId)) asset2027TeamIds.unshift(selectedTeamId);
    }
  }

  return {
    teamsList,
    leagueYear,
    plannerPhase,
    extensionSeason,
    salaryAveragesBySeason,
    allPlayers,
    freeAgentNeedsByTeam,
    teamMetrics,
    draftNextYear,
    draftPredictions,
    actualDraftPicks,
    assetsPredictions,
    assetTeamIds,
    assets2027Predictions,
    asset2027TeamIds,
  };
}
