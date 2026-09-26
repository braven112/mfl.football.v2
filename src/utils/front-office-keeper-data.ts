/**
 * SSR data assembly for the AFL's half of the Front Office hub.
 *
 * Called through `buildFrontOfficePanelData` (front-office-panel-data.ts),
 * never directly by a route — that module owns the shape both leagues
 * render through `FrontOfficePanel.astro`.
 *
 * Roster-building is duplicated from `src/pages/afl-fantasy/rosters.astro`
 * (~lines 141-177) and its `plannerDraftPicks` assembly (~lines 388-422),
 * on purpose rather than extracted, so this does not touch that page.
 *
 * TWO SCOPES, AND THE DIFFERENCE MATTERS
 *
 * - **Every team** gets analytics and draft chips. The hub's switcher swaps
 *   display without fetching, so all 24 have to be in the payload. Both
 *   come off ONE read of players.json + rosters.json, so widening from one
 *   team to all of them is CPU on already-loaded data, not 24× the I/O.
 * - **The viewer's own team only** gets the keeper board and trade-block
 *   state. This is a privacy boundary, not a size one: an AFL keeper plan
 *   is a private strategic scratchpad and `/api/afl-keepers` enforces
 *   owner-only read. Rendering another owner's board would draw an empty
 *   planner backed by a 403.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getAllTeams, type AflFamilySlug } from './afl-conference';
import { getLeagueBySlug } from '../config/leagues';
import { getLeagueYearForSlug } from './league-year';
import { EMPTY_ANALYTICS, type FrontOfficeTeamSummary, type FrontOfficeTeamView } from './front-office-panel-data';
import type { FrontOfficeDraftChipGroup } from './front-office-planner-data';
import { getCachedRosterFranchises } from './mfl-roster-cache';
import { getCachedTradeBait } from './mfl-trade-bait-cache';
import { parseTradeBaitByFranchise } from './trade-bait';
import { buildKeeperPlannerStats } from './afl-keeper-planner-stats';
import { calculateAge } from './age-utils';
import {
  buildRosterAnalytics,
  groupByNflTeam,
  groupByCollege,
  type AnalyticsPlayer,
  type RosterAnalytics,
  type RosterGroup,
} from './roster-analytics';
import type { KeeperPlannerPlayer, KeeperPlannerDraftPick } from '../components/afl-fantasy/KeeperPlanner.astro';

const loadFeedJson = (leagueYearStr: string, filename: string, dataPath: string): any => {
  const feedPath = path.resolve(process.cwd(), `${dataPath}/mfl-feeds/${leagueYearStr}/${filename}`);
  try {
    if (fs.existsSync(feedPath)) return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    // Missing/malformed feed — caller treats as absent.
  }
  return null;
};

/**
 * The analytics row type moved to `roster-analytics.ts` as `AnalyticsPlayer`
 * when TheLeague's hub needed the same shape — a league's data module should
 * not have to import a type out of the OTHER league's data module to
 * describe the same player. Re-exported under the old name so existing
 * importers keep working.
 */
export type FrontOfficeAnalyticsPlayer = AnalyticsPlayer;

/** The AFL's contribution to the panel. Shapes match front-office-panel-data.ts. */
export interface AflFrontOfficeData {
  leagueYear: number;
  teamsList: FrontOfficeTeamSummary[];
  byTeam: Record<string, FrontOfficeTeamView>;
  /** Stacks for the SELECTED team only — 24 teams' worth would double the page. */
  playersByNflTeam: RosterGroup<AnalyticsPlayer>[];
  playersByCollege: RosterGroup<AnalyticsPlayer>[];
  /** Owner-private. Null unless the viewer owns the selected team. */
  keepers: { roster: KeeperPlannerPlayer[]; draftPicks: KeeperPlannerDraftPick[] } | null;
}

export async function buildAflFrontOfficeData(args: {
  selectedTeamId: string;
  viewerFranchiseId: string | null;
  viewerMflCookie?: string;
  leagueId: string;
  /** Which AFL-family league: the AFL by default, or the demo's keeper slot. */
  leagueSlug?: AflFamilySlug;
  /** That league's registry dataPath. */
  dataPath?: string;
}): Promise<AflFrontOfficeData> {
  const { selectedTeamId, viewerFranchiseId, viewerMflCookie, leagueId } = args;
  const leagueSlug = args.leagueSlug ?? 'afl-fantasy';
  const dataPath = args.dataPath ?? getLeagueBySlug('afl-fantasy')!.dataPath;
  const leagueYear = getLeagueYearForSlug(leagueSlug);
  const leagueYearStr = String(leagueYear);
  const isOwnTeam = !!viewerFranchiseId && viewerFranchiseId === selectedTeamId;

  const allTeams = getAllTeams(leagueSlug);
  const teamsList: FrontOfficeTeamSummary[] = allTeams.map((t) => ({
    id: t.franchiseId,
    name: t.nameShort || t.name,
    division: t.division ?? '',
    icon: t.icon ?? '',
    banner: t.banner ?? '',
  }));
  const teamNameLookup = new Map<string, string>(allTeams.map((t) => [t.franchiseId, t.nameShort || t.name]));

  const playersMap = loadPlayersMap(leagueYearStr, dataPath);

  let rostersData = loadFeedJson(leagueYearStr, 'rosters.json', dataPath);
  const liveFranchises = await getCachedRosterFranchises(leagueYearStr, leagueId);
  if (liveFranchises && liveFranchises.length > 0) {
    rostersData = { ...rostersData, rosters: { franchise: liveFranchises } };
  }
  const franchises = (rostersData?.rosters?.franchise as any[] | undefined) ?? [];
  const rosterByTeam = new Map<string, Array<{ id: string; status: string }>>(
    franchises.map((f: any) => [String(f?.id), (f?.player ?? []) as Array<{ id: string; status: string }>]),
  );

  const futurePicksData = loadFeedJson(leagueYearStr, 'futureDraftPicks.json', dataPath);
  const picksByTeam = new Map<string, KeeperPlannerDraftPick[]>();
  for (const f of (futurePicksData?.futureDraftPicks?.franchise as any[] | undefined) ?? []) {
    picksByTeam.set(String(f?.id), toDraftPicks(f?.futureDraftPick, String(f?.id), teamNameLookup));
  }

  // ---- every team: analytics + draft chips, off the one feed read ----
  const byTeam: Record<string, FrontOfficeTeamView> = {};
  let selectedAnalyticsRoster: AnalyticsPlayer[] = [];
  for (const team of teamsList) {
    const rows = rosterByTeam.get(team.id) ?? [];
    const analyticsRoster = rows.map((p) => toAnalyticsPlayer(p, playersMap));
    if (team.id === selectedTeamId) selectedAnalyticsRoster = analyticsRoster;
    const analytics = analyticsRoster.length ? buildRosterAnalytics(analyticsRoster) : EMPTY_ANALYTICS;
    byTeam[team.id] = {
      metrics: aflMetrics(analytics, rows.length),
      analytics,
      // The AFL runs salaryCap: false, so there is nothing to put here and
      // the cap block does not render. Not a slug check — an absent value.
      cap: null,
      draftChips: toDraftChipGroups(picksByTeam.get(team.id) ?? []),
    };
  }

  // ---- viewer's own team only: the keeper board ----
  let keepers: AflFrontOfficeData['keepers'] = null;
  if (isOwnTeam) {
    const rows = rosterByTeam.get(selectedTeamId) ?? [];
    const statsById = buildKeeperPlannerStats(leagueYear, dataPath);
    // MFL's tradeBait export is owner-gated for a private league like the
    // AFL and this deployment holds no server-level MFL credentials, so
    // without the viewer's cookie the trade-block state is simply unknown —
    // the action sheet then offers "Add to trade block" for everyone, which
    // the API handles idempotently (it reads, merges, writes).
    const liveTradeBait = await getCachedTradeBait(leagueYearStr, leagueId, viewerMflCookie);
    const tradeBaitSet = liveTradeBait
      ? (parseTradeBaitByFranchise({ franchises: liveTradeBait })?.get(selectedTeamId) ?? new Set<string>())
      : new Set<string>();

    keepers = {
      roster: rows.map((p) => {
        const info = playersMap.get(p.id);
        const stats = statsById.get(p.id);
        return {
          id: p.id,
          status: p.status || 'ROSTER',
          name: info?.name || `Player ${p.id}`,
          position: info?.position || 'N/A',
          team: info?.team || 'FA',
          age: info?.age || 'N/A',
          espnId: info?.espn_id,
          birthdate: info?.birthdate ? Number(info.birthdate) : null,
          isOnTradeBait: tradeBaitSet.has(p.id),
          ppg: stats?.ppg ?? null,
          gamesPlayed: stats?.gamesPlayed,
          positionalFinish: stats?.positionalFinish ?? null,
          dynastyAdpRank: stats?.dynastyAdpRank ?? null,
          redraftAdpRank: stats?.redraftAdpRank ?? null,
        };
      }),
      // The chip row above already prints this team's picks, so the board's
      // own `kp-picks` strip stays empty here. KeeperPlanner still renders
      // it for rosters.astro, which has no chip row.
      draftPicks: [],
    };
  }

  return {
    leagueYear,
    teamsList,
    byTeam,
    playersByNflTeam: groupByNflTeam(selectedAnalyticsRoster),
    playersByCollege: groupByCollege(selectedAnalyticsRoster),
    keepers,
  };
}

// ---- helpers ----

type PlayerInfo = {
  name: string;
  position: string;
  team: string;
  age: string;
  espn_id?: string;
  college?: string;
  birthdate?: string;
  height?: string;
  weight?: string;
  jersey?: string;
  draft_year?: string;
  draft_round?: string;
  draft_pick?: string;
  draft_team?: string;
};

function loadPlayersMap(leagueYearStr: string, dataPath: string): Map<string, PlayerInfo> {
  const playersData = loadFeedJson(leagueYearStr, 'players.json', dataPath);
  const map = new Map<string, PlayerInfo>();
  for (const p of (playersData?.players?.player ?? []) as any[]) {
    map.set(p.id, {
      name: p.name || `Player ${p.id}`,
      position: p.position || 'N/A',
      team: p.team || 'FA',
      // MFL's players feed has no `age` field, only `birthdate` (Unix
      // seconds) — the shared age-utils helper mirrors rosters.astro.
      age: String(calculateAge(p.birthdate) ?? 'N/A'),
      espn_id: p.espn_id,
      college: p.college,
      birthdate: p.birthdate,
      height: p.height,
      weight: p.weight,
      jersey: p.jersey,
      draft_year: p.draft_year,
      draft_round: p.draft_round,
      draft_pick: p.draft_pick,
      draft_team: p.draft_team,
    });
  }
  return map;
}

function toAnalyticsPlayer(
  p: { id: string; status: string },
  playersMap: Map<string, PlayerInfo>,
): AnalyticsPlayer {
  const info = playersMap.get(p.id);
  return {
    id: p.id,
    status: p.status || 'ROSTER',
    name: info?.name || `Player ${p.id}`,
    position: info?.position || 'N/A',
    team: info?.team || 'FA',
    espnId: info?.espn_id,
    college: info?.college ?? null,
    birthdate: info?.birthdate ?? null,
    height: info?.height ?? null,
    weight: info?.weight ?? null,
    jersey: info?.jersey ?? null,
    draftYear: info?.draft_year ? Number(info.draft_year) : null,
    draftRound: info?.draft_round ? Number(info.draft_round) : null,
    draftPick: info?.draft_pick ? Number(info.draft_pick) : null,
    draftTeam: info?.draft_team ?? null,
  };
}

function toDraftPicks(
  picks: any,
  franchiseId: string,
  teamNameLookup: Map<string, string>,
): KeeperPlannerDraftPick[] {
  if (!picks) return [];
  const arr = Array.isArray(picks) ? picks : [picks];
  return arr
    .filter((p: any) => p?.year && p?.round && p?.originalPickFor)
    .map((p: any) => ({
      year: String(p.year),
      round: String(p.round),
      originalPickFor: String(p.originalPickFor),
      originalPickForName: teamNameLookup.get(String(p.originalPickFor)),
      isTraded: String(p.originalPickFor) !== franchiseId,
    }))
    .sort((a, b) =>
      a.year !== b.year ? a.year.localeCompare(b.year) : parseInt(a.round, 10) - parseInt(b.round, 10),
    );
}

/** Round labels (1st / 2nd / 3rd / Nth) — the AFL has no predicted draft
 *  order, so a chip names its round rather than a pick position. */
const roundLabel = (round: string): string => {
  const n = parseInt(round, 10);
  if (!Number.isFinite(n)) return round;
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  if (ones === 1) return `${n}st`;
  if (ones === 2) return `${n}nd`;
  if (ones === 3) return `${n}rd`;
  return `${n}th`;
};

function toDraftChipGroups(picks: KeeperPlannerDraftPick[]): FrontOfficeDraftChipGroup[] {
  const byYear = new Map<string, FrontOfficeDraftChipGroup['chips']>();
  for (const p of picks) {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year)!.push({
      id: `${p.year}-${p.round}-${p.originalPickFor}`,
      label: `${roundLabel(p.round)} round`,
      via: p.isTraded ? `via ${p.originalPickForName ?? p.originalPickFor}` : null,
      // MFL's futureDraftPicks carries only the ORIGINAL franchise, not the
      // hops between, so the AFL has no multi-hop chain either.
      chain: null,
    });
  }
  return [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, chips]) => ({ year, chips }));
}

function aflMetrics(analytics: RosterAnalytics, rosterSize: number): FrontOfficeTeamView['metrics'] {
  // No cap, no contracts — so the AFL's strip answers roster-shape questions
  // instead of money ones. Same component, different tiles.
  const avg = analytics.ageStats.avg;
  return [
    { label: 'Roster Size', value: String(rosterSize), valueId: 'fo-metric-roster' },
    { label: 'Average Age', value: avg ? `${avg.toFixed(1)} years` : 'N/A', valueId: 'fo-metric-age' },
    {
      label: 'Youngest',
      value: analytics.ageStats.youngest ? `${analytics.ageStats.youngest.age}` : '—',
      valueId: 'fo-metric-youngest',
      // A name is a fact, not a warning — subtitle, so it renders neutral.
      subtitle: analytics.ageStats.youngest?.name ?? null,
      subtitleId: 'fo-metric-youngest-sub',
    },
    {
      label: 'Oldest',
      value: analytics.ageStats.oldest ? `${analytics.ageStats.oldest.age}` : '—',
      valueId: 'fo-metric-oldest',
      subtitle: analytics.ageStats.oldest?.name ?? null,
      subtitleId: 'fo-metric-oldest-sub',
    },
  ];
}
