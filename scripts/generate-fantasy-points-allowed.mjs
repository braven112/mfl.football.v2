import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const YEAR = '2025';
const LEAGUE_DIR = path.join(ROOT_DIR, `data/theleague/mfl-feeds/${YEAR}`);

const PLAYERS_FILE = path.join(LEAGUE_DIR, 'players.json');
const SCHEDULE_FILE = path.join(LEAGUE_DIR, 'nflSchedule.json');
const RESULTS_FILE = path.join(LEAGUE_DIR, 'weekly-results-raw.json');
const OUTPUT_FILE = path.join(LEAGUE_DIR, 'fantasyPointsAllowed.json');

function loadJSON(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeTeam(team) {
  if (!team) return 'FA';
  // Standardize to MFL Schedule codes if needed, or keeping them as is if consistent
  // MFL Schedule uses: KCC, LVR, NEP, TBB, SFO, JAC, WAS, LAR
  return team.toUpperCase();
}

function main() {
  console.log('Generatng Fantasy Points Allowed...');

  const playersData = loadJSON(PLAYERS_FILE);
  const scheduleData = loadJSON(SCHEDULE_FILE);
  const resultsData = loadJSON(RESULTS_FILE);

  if (!playersData || !scheduleData || !resultsData) {
    console.error('Missing source data files.');
    process.exit(1);
  }

  // 1. Map Player ID -> NFL Team & Position
  const playerMap = new Map();
  const players = playersData.players?.player || [];
  (Array.isArray(players) ? players : [players]).forEach(p => {
    playerMap.set(p.id, {
      team: normalizeTeam(p.team),
      position: p.position
    });
  });

  // 2. Map NFL Schedule: Week -> Team -> Opponent
  const scheduleMap = {}; // week -> team -> opponent
  const nflSchedule = scheduleData.fullNflSchedule?.nflSchedule || [];
  
  nflSchedule.forEach(weekData => {
    const week = parseInt(weekData.week, 10);
    if (!scheduleMap[week]) scheduleMap[week] = {};
    
    const matchups = Array.isArray(weekData.matchup) ? weekData.matchup : [weekData.matchup];
    matchups.forEach(m => {
      if (!m || !m.team) return;
      const teams = Array.isArray(m.team) ? m.team : [m.team];
      if (teams.length === 2) {
        const t1 = normalizeTeam(teams[0].id);
        const t2 = normalizeTeam(teams[1].id);
        scheduleMap[week][t1] = t2;
        scheduleMap[week][t2] = t1;
      }
    });
  });

  // 3. Aggregate Points
  // Opponent -> Position -> { totalPoints, weeks }
  const pointsAllowed = {};

  const weeks = Array.isArray(resultsData) ? resultsData : [resultsData]; // resultsData is array of weekly objects?
  // Check structure of RESULTS_FILE
  // usually array of { weeklyResults: { ... } } or just object
  
  const resultsArray = Array.isArray(resultsData) ? resultsData : (resultsData.weeklyResults ? [resultsData] : []);

  resultsArray.forEach(weekItem => {
    const weekResults = weekItem.weeklyResults;
    if (!weekResults) return;
    
    const week = parseInt(weekResults.week, 10);
    const matchups = Array.isArray(weekResults.matchup) ? weekResults.matchup : [weekResults.matchup];
    
    matchups.forEach(matchup => {
      const franchises = Array.isArray(matchup.franchise) ? matchup.franchise : [matchup.franchise];
      franchises.forEach(franchise => {
        const franchisePlayers = Array.isArray(franchise.player) ? franchise.player : (franchise.player ? [franchise.player] : []);
        
        franchisePlayers.forEach(p => {
          // Only count actual scores > 0? Or all scores? 
          // Usually points allowed counts everything, or maybe starters only?
          // MFL Points Allowed usually counts "all players on roster"? No, that's too much.
          // It counts "Starters" usually.
          // Let's count STARTERS for now. `status: 'starter'`
          if (p.status !== 'starter') return;
          
          const score = parseFloat(p.score);
          if (isNaN(score)) return;

          const playerInfo = playerMap.get(p.id);
          if (!playerInfo || !playerInfo.team || playerInfo.team === 'FA') return;

          const opponent = scheduleMap[week]?.[playerInfo.team];
          if (!opponent) return; // Bye week or data missing

          if (!pointsAllowed[opponent]) pointsAllowed[opponent] = {};
          if (!pointsAllowed[opponent][playerInfo.position]) pointsAllowed[opponent][playerInfo.position] = { total: 0, weeks: new Set() };

          pointsAllowed[opponent][playerInfo.position].total += score;
          pointsAllowed[opponent][playerInfo.position].weeks.add(week);
        });
      });
    });
  });

  // 4. Calculate Averages and Ranks
  const finalOutput = {}; // Team -> { QB: { avg, rank }, ... }
  
  // Flatten
  const flatList = [];
  Object.keys(pointsAllowed).forEach(team => {
    Object.keys(pointsAllowed[team]).forEach(pos => {
      const data = pointsAllowed[team][pos];
      const avg = data.total / data.weeks.size;
      flatList.push({ team, pos, avg });
    });
  });

  // Rank by position
  const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']; // Add others if needed
  
  positions.forEach(pos => {
    // Filter and sort
    const posList = flatList.filter(i => i.pos === pos).sort((a, b) => a.avg - b.avg);
    // Rank 1 = Lowest Points Allowed (Best Defense)
    // Rank 32 = Highest Points Allowed (Worst Defense)
    
    posList.forEach((item, index) => {
      if (!finalOutput[item.team]) finalOutput[item.team] = {};
      finalOutput[item.team][pos] = {
        avg: parseFloat(item.avg.toFixed(1)),
        rank: index + 1
      };
    });
  });

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ fantasyPointsAllowed: finalOutput }, null, 2));
  console.log(`Generated Fantasy Points Allowed for ${Object.keys(finalOutput).length} teams.`);
}

main();