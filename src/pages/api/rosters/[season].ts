import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { getFeedData } from '../../../lib/mfl-data-loader';
import { SALARY_CAP, ROSTER_LIMIT, normalizeStatus } from '../../../utils/salary-calculations';
import { parseNumber } from '../../../utils/formatters';

export const prerender = false;

/**
 * GET /api/rosters/[season]
 *
 * Returns the roster data for a specific historical season.
 * Historical data is immutable so responses are cached aggressively.
 * Current season redirects to the inline data (no API needed).
 */
export const GET: APIRoute = async ({ params }) => {
  const season = params.season;
  if (!season || !/^\d{4}$/.test(season)) {
    return new Response(JSON.stringify({ error: 'Invalid season' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const currentYear = String(getCurrentLeagueYear());

  // Read the static salary file for this season
  const salaryFilePath = path.resolve(
    process.cwd(),
    `src/data/mfl-player-salaries-${season}.json`
  );

  let salaryData: any;
  try {
    if (!fs.existsSync(salaryFilePath)) {
      return new Response(JSON.stringify({ error: 'Season not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    salaryData = JSON.parse(fs.readFileSync(salaryFilePath, 'utf8'));
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to read season data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch MFL feeds for this season (static files for historical, live for current)
  const [rostersFeed, playersFeed, standingsFeed, salaryAdjFeed] = await Promise.all([
    getFeedData('theleague', '13522', season, 'rosters'),
    getFeedData('theleague', '13522', season, 'players'),
    getFeedData('theleague', '13522', season, 'standings'),
    getFeedData('theleague', '13522', season, 'salaryAdjustments'),
  ]);

  // Build player feed lookup
  const feedPlayers: Record<string, any> = {};
  const playersList = playersFeed?.players?.player ?? [];
  (Array.isArray(playersList) ? playersList : [playersList].filter(Boolean)).forEach((p: any) => {
    if (p?.id) feedPlayers[p.id] = p;
  });

  // Build live roster data lookup
  const liveRosterData: Record<string, any> = {};
  const franchises = rostersFeed?.rosters?.franchise ?? [];
  (Array.isArray(franchises) ? franchises : []).forEach((franchise: any) => {
    const franchiseId = franchise.id;
    if (!franchiseId) return;
    const players = Array.isArray(franchise.player) ? franchise.player : [franchise.player].filter(Boolean);
    players.forEach((player: any) => {
      if (player?.id) {
        liveRosterData[player.id] = {
          franchiseId,
          salary: player.salary,
          contractYear: player.contractYear,
          contractInfo: player.contractInfo,
          status: player.status,
        };
      }
    });
  });

  // Build players array from static salary data
  const rawPlayers = salaryData?.players ?? [];
  const seasonYear = Number.parseInt(season, 10) || getCurrentLeagueYear();

  const players = rawPlayers
    .filter((player: any) => !!liveRosterData[player.id])
    .map((player: any) => {
      const liveData = liveRosterData[player.id];
      const salary = liveData?.salary ? parseNumber(liveData.salary) : parseNumber(player.salary);
      const contractYears = Number.parseInt(liveData?.contractYear ?? player.contractYear ?? '0', 10) || 0;
      const franchiseId = liveData?.franchiseId ?? 'FA';
      const status = liveData?.status ?? player.status ?? 'ROSTER';
      const totalRemaining = salary * Math.max(contractYears || 1, 1);
      const nflTeam = (player.team ?? '').toUpperCase().replace('JAC', 'JAX');
      const contractType = status && status !== 'ROSTER' ? status
        : player.draftYear && seasonYear - Number(player.draftYear) <= 2 ? 'Rookie' : 'Standard';
      const feedPlayer = feedPlayers[player.id] ?? null;

      return {
        id: player.id,
        espnId: null,
        name: player.name,
        position: player.position ?? 'N/A',
        salary,
        contractYears,
        totalRemaining,
        franchiseId,
        status,
        contractType,
        points: parseNumber(player.points),
        projectedPoints: '-',
        recentScores: [],
        avgRecent: '-',
        avgSeason: '-',
        nflTeam,
        opponent: 'BYE',
        oppStats: null,
        gameOdds: null,
        draftYear: feedPlayer?.draft_year ? parseInt(feedPlayer.draft_year, 10) : null,
        draftTeam: (feedPlayer?.draft_team ?? '').toUpperCase() || null,
        draftRound: feedPlayer?.draft_round ? parseInt(feedPlayer.draft_round, 10) : null,
        draftPick: feedPlayer?.draft_pick ? parseInt(feedPlayer.draft_pick, 10) : null,
        nflLogo: nflTeam ? `/assets/nfl-logos/${nflTeam}.svg` : null,
        rosterSlot: normalizeStatus(status),
        byeWeek: null,
        birthdate: player.birthdate ?? null,
        headshot: null,
        college: player.sleeper?.college ?? player.college ?? null,
        collegeLogo: null,
        collegeLogoDark: null,
        height: player.sleeper?.height ?? null,
        weight: player.sleeper?.weight ?? null,
        number: player.sleeper?.number ?? null,
        experience: null,
        depthChartPosition: null,
        depthChartOrder: null,
        injuryStatus: null,
        injuryBodyPart: null,
        sleeperId: null,
        sleeperFullName: null,
        sleeperPosition: null,
        fantasyPositions: null,
        gsisId: null,
        sleeperAge: null,
        sleeperStatus: null,
        sleeperActive: null,
        offenseSnaps: null,
        defenseSnaps: null,
        stSnaps: null,
        gamesPlayed: null,
        depthChartAhead: null,
        tradeBait: false,
        contractInfo: liveData?.contractInfo || '',
      };
    });

  // Also add players in live rosters but not in static file
  const staticIds = new Set(rawPlayers.map((p: any) => p.id));
  Object.entries(liveRosterData).forEach(([playerId, liveData]: [string, any]) => {
    if (staticIds.has(playerId)) return;
    const feedPlayer = feedPlayers[playerId];
    if (!feedPlayer) return;
    const salary = liveData?.salary ? parseNumber(liveData.salary) : 0;
    const contractYears = Number.parseInt(liveData?.contractYear ?? '0', 10) || 0;
    const nflTeam = (feedPlayer?.team ?? '').toUpperCase().replace('JAC', 'JAX');
    players.push({
      id: playerId,
      espnId: null,
      name: feedPlayer?.name ?? `Player ${playerId}`,
      position: feedPlayer?.position ?? 'N/A',
      salary,
      contractYears,
      totalRemaining: salary * Math.max(contractYears || 1, 1),
      franchiseId: liveData?.franchiseId ?? 'FA',
      status: liveData?.status ?? 'ROSTER',
      contractType: 'Standard',
      points: 0,
      projectedPoints: '-',
      recentScores: [],
      avgRecent: '-',
      avgSeason: '-',
      nflTeam,
      opponent: 'BYE',
      oppStats: null,
      gameOdds: null,
      draftYear: feedPlayer?.draft_year ? parseInt(feedPlayer.draft_year, 10) : null,
      draftTeam: (feedPlayer?.draft_team ?? '').toUpperCase() || null,
      draftRound: feedPlayer?.draft_round ? parseInt(feedPlayer.draft_round, 10) : null,
      draftPick: feedPlayer?.draft_pick ? parseInt(feedPlayer.draft_pick, 10) : null,
      nflLogo: nflTeam ? `/assets/nfl-logos/${nflTeam}.svg` : null,
      rosterSlot: normalizeStatus(liveData?.status),
      byeWeek: null,
      birthdate: null,
      headshot: null,
      college: null,
      collegeLogo: null,
      collegeLogoDark: null,
      height: null,
      weight: null,
      number: null,
      experience: null,
      depthChartPosition: null,
      depthChartOrder: null,
      injuryStatus: null,
      injuryBodyPart: null,
      sleeperId: null,
      sleeperFullName: null,
      sleeperPosition: null,
      fantasyPositions: null,
      gsisId: null,
      sleeperAge: null,
      sleeperStatus: null,
      sleeperActive: null,
      offenseSnaps: null,
      defenseSnaps: null,
      stSnaps: null,
      gamesPlayed: null,
      depthChartAhead: null,
      tradeBait: false,
      contractInfo: liveData?.contractInfo || '',
    });
  });

  // Group by franchise
  const positionOrder = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  const sortByPosition = (arr: any[]) =>
    [...arr].sort((a, b) => {
      const ai = positionOrder.indexOf((a.position ?? '').toUpperCase());
      const bi = positionOrder.indexOf((b.position ?? '').toUpperCase());
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const grouped: Record<string, any[]> = {};
  players.forEach((player: any) => {
    const key = player.franchiseId || 'FA';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(player);
  });

  const teams: Record<string, any> = {};
  // Build standings lookup
  const standingsRows = standingsFeed?.leagueStandings?.franchise ?? standingsFeed?.standings?.standing ?? [];
  const standingsList = Array.isArray(standingsRows) ? standingsRows : Object.values(standingsRows ?? {});
  const records: Record<string, string> = {};
  standingsList.forEach((row: any) => {
    const id = row.franchise_id ?? row.franchiseId ?? row.id ?? row.franchise;
    if (!id) return;
    const w = parseInt(row.h2hw ?? row.wins ?? row.w ?? '0', 10) || 0;
    const l = parseInt(row.h2hl ?? row.losses ?? row.l ?? '0', 10) || 0;
    const t = parseInt(row.h2ht ?? row.ties ?? row.t ?? '0', 10) || 0;
    records[id] = `${w}-${l}-${t}`;
  });

  Object.entries(grouped).forEach(([teamId, teamPlayers]) => {
    const buckets = { ACTIVE: [] as any[], PRACTICE: [] as any[], INJURED: [] as any[] };
    teamPlayers.forEach((player: any) => {
      if (player.status === 'TAXI_SQUAD') buckets.PRACTICE.push(player);
      else if (player.status === 'INJURED_RESERVE') buckets.INJURED.push(player);
      else buckets.ACTIVE.push(player);
    });
    const activeSorted = sortByPosition(buckets.ACTIVE);
    const practiceSorted = sortByPosition(buckets.PRACTICE);
    const injuredSorted = sortByPosition(buckets.INJURED);
    const activeSalary = activeSorted.reduce((sum, p) => sum + parseNumber(p.salary), 0);
    const injuredSalary = injuredSorted.reduce((sum, p) => sum + parseNumber(p.salary), 0);
    const practiceSalary = practiceSorted.reduce((sum, p) => sum + parseNumber(p.salary) * 0.5, 0);

    teams[teamId] = {
      players: activeSorted,
      practiceSquad: practiceSorted,
      injuredReserve: injuredSorted,
      record: records[teamId] ?? null,
      totals: {
        totalSalary: activeSalary + injuredSalary + practiceSalary,
        rosterCount: activeSorted.length,
        openSpots: Math.max(ROSTER_LIMIT - activeSorted.length, 0),
        practiceCount: practiceSorted.length,
        injuredCount: injuredSorted.length,
      },
    };
  });

  // Parse salary adjustments
  const adjustmentsRaw = salaryAdjFeed?.salaryAdjustments?.salaryAdjustment ?? [];
  const salaryAdjustments = Array.isArray(adjustmentsRaw) ? adjustmentsRaw : [adjustmentsRaw].filter(Boolean);

  const payload = {
    metadata: { capLimit: SALARY_CAP, rosterLimit: ROSTER_LIMIT, season },
    teams,
    salaryAdjustments,
  };

  // Historical seasons are immutable — cache aggressively
  const isHistorical = season !== currentYear;
  const cacheControl = isHistorical
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=120, s-maxage=120';

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
    },
  });
};
