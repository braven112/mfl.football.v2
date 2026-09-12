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

export interface FrontOfficeKeeperData {
  roster: KeeperPlannerPlayer[];
  draftPicks: KeeperPlannerDraftPick[];
}

export async function buildFrontOfficeKeeperPlannerData(
  franchiseId: string,
  leagueYear: number,
  leagueId: string,
): Promise<FrontOfficeKeeperData> {
  const leagueYearStr = String(leagueYear);

  const playersData = loadFeedJson(leagueYearStr, 'players.json');
  const playersMap = new Map<string, { name: string; position: string; team: string; age: string; espn_id?: string }>();
  for (const p of (playersData?.players?.player ?? []) as any[]) {
    playersMap.set(p.id, {
      name: p.name || `Player ${p.id}`,
      position: p.position || 'N/A',
      team: p.team || 'FA',
      age: p.age || 'N/A',
      espn_id: p.espn_id,
    });
  }

  let rostersData = loadFeedJson(leagueYearStr, 'rosters.json');
  const liveFranchises = await getCachedRosterFranchises(leagueYearStr, leagueId);
  if (liveFranchises && liveFranchises.length > 0) {
    rostersData = { ...rostersData, rosters: { franchise: liveFranchises } };
  }
  const franchiseRoster = (rostersData?.rosters?.franchise as any[] | undefined)?.find((f) => f?.id === franchiseId);
  const rosterPlayers = (franchiseRoster?.player ?? []) as Array<{ id: string; status: string }>;
  const roster: KeeperPlannerPlayer[] = rosterPlayers.map((p) => {
    const info = playersMap.get(p.id);
    return {
      id: p.id,
      status: p.status || 'ROSTER',
      name: info?.name || `Player ${p.id}`,
      position: info?.position || 'N/A',
      team: info?.team || 'FA',
      age: info?.age || 'N/A',
      espnId: info?.espn_id,
    };
  });

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

  return { roster, draftPicks };
}
