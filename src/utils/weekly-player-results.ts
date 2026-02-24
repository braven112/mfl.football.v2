/**
 * Weekly Player Results Utility
 *
 * Build-time utility that merges weekly scores, NFL schedule, and
 * fantasy points allowed data into a compact per-player weekly lookup.
 * Used by the PlayerDetailsModal to show season results.
 */

export interface WeekEntry {
  w: number;           // week number
  p: number | null;    // fantasy points (null = no score)
  opp: string | null;  // opponent team code (null = bye)
  home: boolean;       // was this a home game?
  avg: number | null;  // opponent avg fantasy pts allowed vs position
  rank: number | null; // opponent rank vs position (1-32)
  st: string;          // status: 'S' | 'NS' | 'BYE' | ''
  fn: string;          // franchise name (fantasy team)
  fi: string;          // franchise id (e.g. "0002") for icon lookup
}

export interface WeeklyResultsPayload {
  [playerId: string]: WeekEntry[];
}

/**
 * Normalize MFL team codes to the format used in fantasyPointsAllowed.json
 * MFL schedule uses: KCC, NEP, GBP, LVR, TBB, NOS, SFO, HST, BLT, CLV, ARZ
 * FPA data uses:     KC,  NE,  GB,  LV,  TB,  NO,  SF,  HOU, BAL, CLE, ARI
 */
const MFL_TO_FPA: Record<string, string> = {
  KCC: 'KC',
  GBP: 'GB',
  NEP: 'NE',
  NOS: 'NO',
  SFO: 'SF',
  TBB: 'TB',
  LVR: 'LV',
  HST: 'HOU',
  BLT: 'BAL',
  CLV: 'CLE',
  ARZ: 'ARI',
};

function normalizeFpaCode(mflCode: string): string {
  if (!mflCode) return '';
  const upper = mflCode.toUpperCase();
  return MFL_TO_FPA[upper] ?? upper;
}

/**
 * Build a per-week schedule map from the MFL nflSchedule response.
 * Returns: Map<week, Map<normalizedTeamCode, { opp: string, isHome: boolean }>>
 */
function buildScheduleMap(
  nflScheduleData: any
): Map<number, Map<string, { opp: string; isHome: boolean }>> {
  const scheduleMap = new Map<number, Map<string, { opp: string; isHome: boolean }>>();

  const weeks = nflScheduleData?.fullNflSchedule?.nflSchedule;
  if (!Array.isArray(weeks)) return scheduleMap;

  for (const weekData of weeks) {
    const weekNum = parseInt(weekData.week, 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 18) continue;

    const weekMap = new Map<string, { opp: string; isHome: boolean }>();
    const matchups = Array.isArray(weekData.matchup) ? weekData.matchup : [];

    for (const matchup of matchups) {
      const teams = Array.isArray(matchup.team) ? matchup.team : [];
      if (teams.length !== 2) continue;

      const t0code = normalizeFpaCode(teams[0].id);
      const t1code = normalizeFpaCode(teams[1].id);
      const t0home = teams[0].isHome === '1';
      const t1home = teams[1].isHome === '1';

      weekMap.set(t0code, { opp: t1code, isHome: t0home });
      weekMap.set(t1code, { opp: t0code, isHome: t1home });
    }

    scheduleMap.set(weekNum, weekMap);
  }

  return scheduleMap;
}

/**
 * Build the weekly player results payload for embedding in pages.
 *
 * @param weeklyResultsRaw - Array of weekly results (from weekly-results-raw.json)
 * @param nflScheduleData - Full NFL schedule (from nflSchedule.json)
 * @param fantasyPointsAllowed - FPA data (from fantasyPointsAllowed.json)
 * @param playersData - MFL players feed (from players.json) for position/team lookup
 * @param leagueData - League config (from league.json) for franchise names
 * @param endWeek - Last regular season week (default 17)
 */
export function buildWeeklyPlayerResults(
  weeklyResultsRaw: any[],
  nflScheduleData: any,
  fantasyPointsAllowed: any,
  playersData: any,
  leagueData: any,
  endWeek = 17
): WeeklyResultsPayload {
  // Build franchise name map: "0002" → "Da Dangsters"
  const franchiseNames = new Map<string, string>();
  const franchises = leagueData?.league?.franchises?.franchise;
  if (Array.isArray(franchises)) {
    for (const f of franchises) {
      if (f.id && f.name) {
        franchiseNames.set(f.id, f.name.trim());
      }
    }
  }

  // Build player info map: playerId → { position, nflTeam }
  const playerInfo = new Map<string, { position: string; nflTeam: string }>();
  const players = playersData?.players?.player;
  if (Array.isArray(players)) {
    for (const p of players) {
      if (p.id) {
        // Normalize position: SWR/LWR/RWR → WR for FPA lookup
        let pos = (p.position || '').toUpperCase();
        if (['SWR', 'LWR', 'RWR'].includes(pos)) pos = 'WR';
        if (pos === 'DEF') pos = 'Def';
        playerInfo.set(p.id, {
          position: pos,
          nflTeam: normalizeFpaCode(p.team || ''),
        });
      }
    }
  }

  // Build schedule lookup
  const scheduleMap = buildScheduleMap(nflScheduleData);

  // Build FPA lookup
  const fpa = fantasyPointsAllowed?.fantasyPointsAllowed ?? {};

  // Extract player weekly data from weekly-results-raw
  // Structure: per player, per week → { pts, status, franchiseId }
  const playerWeekData = new Map<string, Map<number, { pts: number; status: string; franchiseId: string }>>();

  const rawWeeks = Array.isArray(weeklyResultsRaw) ? weeklyResultsRaw : [];
  for (const weekPayload of rawWeeks) {
    const weekResults = weekPayload?.weeklyResults;
    if (!weekResults) continue;

    const weekNum = parseInt(weekResults.week, 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > endWeek) continue;

    const matchups = Array.isArray(weekResults.matchup)
      ? weekResults.matchup
      : weekResults.matchup ? [weekResults.matchup] : [];

    for (const matchup of matchups) {
      const franchiseList = Array.isArray(matchup.franchise)
        ? matchup.franchise
        : matchup.franchise ? [matchup.franchise] : [];

      for (const franchise of franchiseList) {
        const franchiseId = franchise.id;
        const playerList = Array.isArray(franchise.player)
          ? franchise.player
          : franchise.player ? [franchise.player] : [];

        for (const player of playerList) {
          if (!player.id) continue;

          if (!playerWeekData.has(player.id)) {
            playerWeekData.set(player.id, new Map());
          }

          const score = parseFloat(player.score);
          playerWeekData.get(player.id)!.set(weekNum, {
            pts: isNaN(score) ? 0 : score,
            status: player.status === 'starter' ? 'S' : 'NS',
            franchiseId: franchiseId || '',
          });
        }
      }
    }
  }

  // Build final payload: for each player with weekly data, assemble full week array
  const payload: WeeklyResultsPayload = {};

  for (const [playerId, weekMap] of playerWeekData) {
    const info = playerInfo.get(playerId);
    if (!info) continue; // skip players not in the players feed

    const weeks: WeekEntry[] = [];

    for (let w = 1; w <= endWeek; w++) {
      const weekData = weekMap.get(w);
      const scheduleWeek = scheduleMap.get(w);
      const teamSchedule = scheduleWeek?.get(info.nflTeam);

      // Determine if bye week (team not in schedule for this week)
      const isBye = !teamSchedule;

      if (weekData) {
        // Player was on a roster this week
        const oppCode = teamSchedule?.opp ?? null;
        const oppStats = oppCode ? fpa[oppCode]?.[info.position] : null;

        weeks.push({
          w,
          p: weekData.pts,
          opp: isBye ? null : (teamSchedule?.isHome ? 'vs ' : 'at ') + (oppCode || '??'),
          home: teamSchedule?.isHome ?? false,
          avg: oppStats?.avg ?? null,
          rank: oppStats?.rank ?? null,
          st: isBye ? 'BYE' : weekData.status,
          fn: franchiseNames.get(weekData.franchiseId) || '',
          fi: weekData.franchiseId || '',
        });
      } else if (isBye) {
        // Bye week, player not on a roster entry
        weeks.push({
          w,
          p: null,
          opp: null,
          home: false,
          avg: null,
          rank: null,
          st: 'BYE',
          fn: '',
          fi: '',
        });
      } else {
        // Player not on any roster this week but it wasn't bye
        // Check if the player was on a roster at any point (fill gap weeks)
        weeks.push({
          w,
          p: null,
          opp: (teamSchedule?.isHome ? 'vs ' : 'at ') + (teamSchedule?.opp || '??'),
          home: teamSchedule?.isHome ?? false,
          avg: null,
          rank: null,
          st: '',
          fn: '',
          fi: '',
        });
      }
    }

    // Only include players who have at least one scored week
    const hasScores = weeks.some(w => w.p !== null);
    if (hasScores) {
      payload[playerId] = weeks;
    }
  }

  return payload;
}
