/**
 * SSR data assembly for the AFL's Front Office Keeper Planner
 * (components/shared/front-office-hub/AflKeeperPlannerPanel.astro).
 *
 * Duplicated from `src/pages/afl-fantasy/rosters.astro`'s roster-building
 * (~lines 141-177) and `plannerDraftPicks` assembly (~lines 388-422) — see
 * that panel's header comment for why this is a duplicate, not an
 * extraction. Much smaller than TheLeague's equivalent
 * (front-office-planner-data.ts) because the AFL's Keeper Planner only ever
 * shows the signed-in owner's own team — no cap math, no league-wide player
 * list, no team switching.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getAllTeams } from './afl-conference';
import { getCachedRosterFranchises } from './mfl-roster-cache';
import { buildKeeperPlannerStats } from './afl-keeper-planner-stats';
import { calculateAge } from './age-utils';
import {
  buildRosterAnalytics,
  groupByNflTeam,
  groupByCollege,
  type RosterAnalytics,
  type RosterGroup,
} from './afl-roster-analytics';
import type { KeeperPlannerPlayer, KeeperPlannerDraftPick } from '../components/afl-fantasy/KeeperPlanner.astro';

const loadFeedJson = (leagueYearStr: string, filename: string): any => {
  const feedPath = path.resolve(process.cwd(), `data/afl-fantasy/mfl-feeds/${leagueYearStr}/${filename}`);
  try {
    if (fs.existsSync(feedPath)) return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    // Missing/malformed feed — caller treats as absent.
  }
  return null;
};

/** A roster row with the extra fields the analytics cards and player-details
 *  modal need (college, birthdate, draft/measurables) that KeeperPlanner
 *  itself has no use for. */
export interface FrontOfficeAnalyticsPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  espnId?: string;
  status: string;
  college: string | null;
  birthdate: string | null;
  height: string | null;
  weight: string | null;
  jersey: string | null;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  draftTeam: string | null;
}

export interface FrontOfficeKeeperData {
  roster: KeeperPlannerPlayer[];
  draftPicks: KeeperPlannerDraftPick[];
  analytics: RosterAnalytics;
  playersByNflTeam: RosterGroup<FrontOfficeAnalyticsPlayer>[];
  playersByCollege: RosterGroup<FrontOfficeAnalyticsPlayer>[];
}

export async function buildFrontOfficeKeeperPlannerData(
  franchiseId: string,
  leagueYear: number,
  leagueId: string,
): Promise<FrontOfficeKeeperData> {
  const leagueYearStr = String(leagueYear);

  const playersData = loadFeedJson(leagueYearStr, 'players.json');
  const playersMap = new Map<
    string,
    {
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
    }
  >();
  for (const p of (playersData?.players?.player ?? []) as any[]) {
    playersMap.set(p.id, {
      name: p.name || `Player ${p.id}`,
      position: p.position || 'N/A',
      team: p.team || 'FA',
      // MFL's players feed has no `age` field, only `birthdate` (Unix
      // seconds) — see calculateAgeFromBirthdate's header comment in
      // rosters.astro, which this mirrors via the shared age-utils helper.
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

  let rostersData = loadFeedJson(leagueYearStr, 'rosters.json');
  const liveFranchises = await getCachedRosterFranchises(leagueYearStr, leagueId);
  if (liveFranchises && liveFranchises.length > 0) {
    rostersData = { ...rostersData, rosters: { franchise: liveFranchises } };
  }
  const franchiseRoster = (rostersData?.rosters?.franchise as any[] | undefined)?.find((f) => f?.id === franchiseId);
  const rosterPlayers = (franchiseRoster?.player ?? []) as Array<{ id: string; status: string }>;
  const statsById = buildKeeperPlannerStats(leagueYear);
  const roster: KeeperPlannerPlayer[] = rosterPlayers.map((p) => {
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
      ppg: stats?.ppg ?? null,
      gamesPlayed: stats?.gamesPlayed,
      positionalFinish: stats?.positionalFinish ?? null,
      dynastyAdpRank: stats?.dynastyAdpRank ?? null,
      redraftAdpRank: stats?.redraftAdpRank ?? null,
    };
  });

  // Richer rows for the analytics cards + player-details modal — kept
  // separate from `roster` (KeeperPlannerPlayer[]) rather than widening that
  // shared type with fields the planner board itself never reads.
  const analyticsRoster: FrontOfficeAnalyticsPlayer[] = rosterPlayers.map((p) => {
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
  });
  const analytics = buildRosterAnalytics(analyticsRoster);
  const playersByNflTeam = groupByNflTeam(analyticsRoster);
  const playersByCollege = groupByCollege(analyticsRoster);

  const futurePicksData = loadFeedJson(leagueYearStr, 'futureDraftPicks.json');
  const allTeams = getAllTeams();
  const teamNameLookup = new Map<string, string>(allTeams.map((t) => [t.franchiseId, t.nameShort || t.name]));
  const franchise = (futurePicksData?.futureDraftPicks?.franchise as any[] | undefined)?.find(
    (f) => f?.id === franchiseId,
  );
  const picks = franchise?.futureDraftPick;
  let draftPicks: KeeperPlannerDraftPick[] = [];
  if (picks) {
    const arr = Array.isArray(picks) ? picks : [picks];
    draftPicks = arr
      .filter((p: any) => p?.year && p?.round && p?.originalPickFor)
      .map((p: any) => ({
        year: String(p.year),
        round: String(p.round),
        originalPickFor: String(p.originalPickFor),
        originalPickForName: teamNameLookup.get(String(p.originalPickFor)),
        isTraded: String(p.originalPickFor) !== franchiseId,
      }))
      .sort((a, b) => (a.year !== b.year ? a.year.localeCompare(b.year) : parseInt(a.round, 10) - parseInt(b.round, 10)));
  }

  return { roster, draftPicks, analytics, playersByNflTeam, playersByCollege };
}
