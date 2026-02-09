#!/usr/bin/env node

/**
 * Generate fantasy-contextual NFL game blurbs for a specific matchup.
 *
 * Each blurb:
 * - Focuses on fantasy players from BOTH teams in the matchup
 * - Ties into the larger fantasy matchup narrative
 * - Highlights how that NFL game impacts the fantasy matchup outcome
 *
 * Usage:
 *   node scripts/generate-matchup-nfl-blurbs.mjs
 *
 * Env:
 *   ANTHROPIC_API_KEY - required
 *   HOME_TEAM_ID - franchise ID (e.g., "0013")
 *   AWAY_TEAM_ID - franchise ID (e.g., "0015")
 *   WEEK - week number (default: 15)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Anthropic } from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const week = process.env.WEEK || '15';
const year = process.env.YEAR || '2025';
const homeTeamId = process.env.HOME_TEAM_ID || '0013';
const awayTeamId = process.env.AWAY_TEAM_ID || '0015';

const dataDir = path.join(root, 'data/theleague/mfl-feeds/2025');
const outputPath = path.join(root, `data/theleague/matchup-nfl-blurbs-${homeTeamId}-${awayTeamId}.json`);

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8'));
}

function normalizeTeamCode(teamCode) {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  const map = {
    WAS: 'WSH', JAC: 'JAX', GBP: 'GB', KCC: 'KC',
    NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB',
    LVR: 'LV', HST: 'HOU', BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI'
  };
  return map[upper] || upper;
}

/**
 * Build the matchup context: which fantasy players are in which NFL games
 */
async function buildMatchupContext() {
  const rosters = loadJson('rosters.json');
  const players = loadJson('players.json');
  const franchises = loadJson('league.json').league.franchises.franchise;
  
  // Load live MFL data (same as main matchup preview page)
  let liveProjections = {};
  let mflInjuryData = {};
  
  try {
    // Use JavaScript wrapper to avoid TypeScript import issues
    const { getMFLData } = await import('./mfl-api-wrapper.js');
    
    console.log('🔄 Fetching live data from MFL API...');
    const { injuryData, projections } = await getMFLData('13522', '2025', week);
    
    mflInjuryData = injuryData;
    liveProjections = projections;
    
    console.log(`✅ Loaded live injury data for ${Object.keys(mflInjuryData).length} players from MFL API`);
    console.log(`✅ Loaded live projections for ${Object.keys(liveProjections).length} players from MFL API`);
    
  } catch (error) {
    console.warn('Failed to load MFL live data, using fallback:', error);
    
    // Fallback to static projections if live fetch fails
    const projections = loadJson('projectedScores.json');
    const projList = Array.isArray(projections.projectedScores.playerScore)
      ? projections.projectedScores.playerScore
      : [projections.projectedScores.playerScore];
    projList.forEach(p => {
      if (p.id && p.score) {
        liveProjections[p.id] = parseFloat(p.score) || 0;
      }
    });
    console.log(`📁 Using static projections for ${Object.keys(liveProjections).length} players as fallback`);
  }
  
  // Load live injury data (same source as main page)
  let realInjuryData = new Map();
  
  try {
    // Try to load live injury data first
    const liveInjuryPath = path.join(root, `data/theleague/live-injury-data-week-${week}.json`);
    
    if (fs.existsSync(liveInjuryPath)) {
      const liveInjuryData = JSON.parse(fs.readFileSync(liveInjuryPath, 'utf8'));
      
      if (liveInjuryData.injuries) {
        Object.entries(liveInjuryData.injuries).forEach(([playerId, injuryInfo]) => {
          realInjuryData.set(playerId, {
            injuryStatus: injuryInfo.injuryStatus,
            injuryBodyPart: injuryInfo.injuryBodyPart || ''
          });
        });
        console.log(`✅ Loaded live injury data for ${realInjuryData.size} players (week ${week})`);
      }
    } else {
      // Fallback to MFL player salaries data
      const playerSalariesPath = path.join(root, 'src/data/mfl-player-salaries-2025.json');
      if (fs.existsSync(playerSalariesPath)) {
        const playerSalariesData = JSON.parse(fs.readFileSync(playerSalariesPath, 'utf8'));
        if (playerSalariesData?.players) {
          playerSalariesData.players.forEach(player => {
            if (player.id && player.sleeper?.injuryStatus) {
              realInjuryData.set(player.id, {
                injuryStatus: player.sleeper.injuryStatus,
                injuryBodyPart: player.sleeper.injuryBodyPart
              });
            }
          });
        }
        console.log(`📁 Using fallback injury data from MFL player salaries for ${realInjuryData.size} players`);
      }
    }
  } catch (error) {
    console.warn('Could not load injury data:', error);
  }
  
  // Convert MFL injury data to lookup map (same logic as main page)
  const injuryData = new Map();
  Object.entries(mflInjuryData).forEach(([playerId, playerData]) => {
    if (playerData.injuryStatus) {
      injuryData.set(playerId, {
        injuryStatus: playerData.injuryStatus,
        injuryBodyPart: playerData.injuryBodyPart || ''
      });
    }
  });
  
  // Merge with real injury data from MFL player salaries (same as main page)
  realInjuryData.forEach((injuryInfo, playerId) => {
    injuryData.set(playerId, injuryInfo);
  });
  
  // Debug: Look for Geno Smith in live MFL data
  let genoFound = false;
  Object.entries(mflInjuryData).forEach(([playerId, playerData]) => {
    if (playerData.name && playerData.name.includes('Geno') && playerData.name.includes('Smith')) {
      console.log(`🔍 Found Geno Smith in MFL API: ID ${playerId}, Name: ${playerData.name}`);
      console.log(`   Live Injury Status: ${playerData.injuryStatus || 'Healthy'}`);
      genoFound = true;
    }
  });
  if (!genoFound) {
    console.log(`⚠️  Geno Smith not found in MFL API data`);
  }
  
  // Load live starting lineup data (same as main page)
  let startingLineups = new Map();
  
  try {
    // Try to load live starting lineup data first
    const liveLineupsPath = path.join(root, `data/theleague/live-starting-lineups-week-${week}.json`);
    
    if (fs.existsSync(liveLineupsPath)) {
      const liveData = JSON.parse(fs.readFileSync(liveLineupsPath, 'utf8'));
      
      if (liveData.lineups) {
        Object.entries(liveData.lineups).forEach(([playerId, lineupData]) => {
          startingLineups.set(playerId, {
            isStarting: lineupData.isStarting,
            franchiseId: lineupData.franchiseId,
            week: lineupData.week
          });
        });
        console.log(`✅ Loaded live starting lineup data for ${startingLineups.size} players (week ${week})`);
      }
    } else {
      // Fallback to static weekly results data
      const weeklyResultsPath = path.join(root, 'data/theleague/mfl-feeds/2025/weekly-results-raw.json');
      
      if (fs.existsSync(weeklyResultsPath)) {
        const weeklyResults = JSON.parse(fs.readFileSync(weeklyResultsPath, 'utf8'));
        const weekData = weeklyResults.find(w => 
          w.weeklyResults?.matchup?.[0]?.franchise?.[0]?.week === week ||
          w.weeklyResults?.week === week
        );
        
        if (weekData?.weeklyResults?.matchup) {
          weekData.weeklyResults.matchup.forEach(matchup => {
            matchup.franchise?.forEach(franchise => {
              if (franchise.player) {
                franchise.player.forEach(player => {
                  startingLineups.set(player.id, {
                    isStarting: player.status === 'starter',
                    franchiseId: franchise.id,
                    week: parseInt(week)
                  });
                });
              }
            });
          });
        }
        console.log(`📁 Using fallback starting lineup data for ${startingLineups.size} players`);
      }
    }
  } catch (error) {
    console.warn('Could not load starting lineup data:', error);
  }

  // Get team names
  const homeTeam = franchises.find(f => f.id === homeTeamId);
  const awayTeam = franchises.find(f => f.id === awayTeamId);

  // Get rosters
  const homeRoster = rosters.rosters.franchise.find(f => f.id === homeTeamId);
  const awayRoster = rosters.rosters.franchise.find(f => f.id === awayTeamId);

  const playerMap = new Map();
  const playersList = Array.isArray(players.players.player)
    ? players.players.player
    : [players.players.player];
  playersList.forEach(p => playerMap.set(p.id, p));

  // Use live projections from MFL API (same as main page)
  const projMap = new Map();
  Object.entries(liveProjections).forEach(([id, score]) => {
    projMap.set(id, score);
  });

  // Build player lists by NFL game
  const nflGames = new Map();

  function addPlayer(playerId, fantasyTeamId, fantasyTeamName) {
    const player = playerMap.get(playerId);
    if (!player) return;
    
    // Only include starters in the analysis
    const lineupData = startingLineups.get(playerId);
    if (!lineupData || !lineupData.isStarting) {
      return; // Skip bench players
    }

    const nflTeam = normalizeTeamCode(player.team);
    let projection = projMap.get(playerId) || 0;
    
    // Apply injury status rule: Out, Doubtful, or IR players get 0 projected points
    const playerInjuryData = injuryData.get(playerId);
    
    // Debug: Check Geno Smith specifically
    if (player.name.includes('Smith') && player.name.includes('Geno')) {
      console.log(`🔍 Geno Smith debug:`);
      console.log(`   Player ID: ${playerId}`);
      console.log(`   Original projection: ${projMap.get(playerId) || 0}`);
      console.log(`   Injury data found: ${playerInjuryData ? 'YES' : 'NO'}`);
      if (playerInjuryData) {
        console.log(`   Injury status: ${playerInjuryData.injuryStatus}`);
      }
    }
    
    // Apply same injury logic as main page: Out, Doubtful, IR players get 0 projected points
    if (playerInjuryData?.injuryStatus && ['Out', 'Doubtful', 'IR'].includes(playerInjuryData.injuryStatus)) {
      projection = 0;
      console.log(`🏥 Setting ${player.name} projection to 0 due to injury status: ${playerInjuryData.injuryStatus}`);
    }

    if (!nflGames.has(nflTeam)) {
      nflGames.set(nflTeam, []);
    }

    nflGames.get(nflTeam).push({
      id: playerId,
      name: player.name,
      position: player.position,
      nflTeam,
      projection,
      fantasyTeamId,
      fantasyTeamName,
      isStarting: true, // All players in this analysis are starters
      injuryStatus: playerInjuryData?.injuryStatus || 'Healthy'
    });
  }

  // Add home team players
  const homePlayers = Array.isArray(homeRoster.player)
    ? homeRoster.player
    : [homeRoster.player];
  homePlayers.forEach(p => addPlayer(p.id, homeTeamId, homeTeam.name));

  // Add away team players
  const awayPlayers = Array.isArray(awayRoster.player)
    ? awayRoster.player
    : [awayRoster.player];
  awayPlayers.forEach(p => addPlayer(p.id, awayTeamId, awayTeam.name));

  return {
    homeTeam: { id: homeTeamId, name: homeTeam.name },
    awayTeam: { id: awayTeamId, name: awayTeam.name },
    nflGames
  };
}

/**
 * Load NFL schedule and match with fantasy players
 */
function getMatchupGames(context) {
  const scheduleFile = `week${week}-${year}.json`;
  const schedulePath = path.join(root, 'data/theleague/nfl-cache', scheduleFile);

  if (!fs.existsSync(schedulePath)) {
    console.warn(`NFL schedule not found: ${schedulePath}`);
    return [];
  }

  const scheduleData = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  const schedule = scheduleData.schedule || {};
  const gameDetails = scheduleData.gameDetails || {};

  const processedGames = new Set();
  const games = [];

  Object.entries(schedule).forEach(([teamCode, opponentCode]) => {
    const team1 = normalizeTeamCode(teamCode);
    const team2 = normalizeTeamCode(opponentCode);
    const key = [team1, team2].sort().join('-');

    if (processedGames.has(key)) return;
    processedGames.add(key);

    // Get fantasy players in this game
    const team1Players = context.nflGames.get(team1) || [];
    const team2Players = context.nflGames.get(team2) || [];
    const allPlayers = [...team1Players, ...team2Players];

    if (allPlayers.length === 0) return; // No fantasy players in this game

    const detailKey1 = `${team1}_vs_${team2}`;
    const detailKey2 = `${team2}_vs_${team1}`;
    const details = gameDetails[detailKey1] || gameDetails[detailKey2] || {};

    // Organize by fantasy team
    const homePlayers = allPlayers.filter(p => p.fantasyTeamId === context.homeTeam.id);
    const awayPlayers = allPlayers.filter(p => p.fantasyTeamId === context.awayTeam.id);

    games.push({
      nflTeam1: team1,
      nflTeam2: team2,
      homePlayers,
      awayPlayers,
      day: details.day || 'Sun',
      time: details.time || '10:00 AM PST',
      channel: details.channel || '',
      weather: details.weather || ''
    });
  });

  // Sort by total players (most relevant games first)
  games.sort((a, b) => {
    const aTotal = a.homePlayers.length + a.awayPlayers.length;
    const bTotal = b.homePlayers.length + b.awayPlayers.length;
    return bTotal - aTotal;
  });

  return games;
}

/**
 * Build prompt for AI to generate contextual blurbs
 */
function buildPrompt(context, games, matchupStory) {
  const systemPrompt = `You are writing contextual NFL game analysis for a fantasy football matchup between ${context.homeTeam.name} and ${context.awayTeam.name}.

🚨 ABSOLUTE CRITICAL RULES - PLAYER RESTRICTIONS:
- You can ONLY mention players explicitly listed in the "homePlayers" and "awayPlayers" arrays for each specific NFL game
- NEVER mention any player not in those exact lists
- NEVER reference players from other NFL games
- NEVER mention players from other fantasy teams not in this matchup
- NEVER mention bench players - ALL players in the lists are STARTERS ONLY
- If you mention a player name, it MUST appear in the provided player list for that game

ANALYSIS PRIORITY ORDER:
1. DEFENSIVE MATCHUP ANALYSIS: Focus on key players vs opponent defense rankings (e.g., "McCaffrey vs #4 run defense", "Jefferson vs #28 pass defense")
2. KEY PLAYER PROJECTIONS: Highlight top projected players with position-appropriate language (see thresholds below)
3. MAJOR LINEUP OPTIMIZATION: Only flag if starter has 10+ point projection difference vs bench alternative
4. INJURY CONCERNS: Note injured starters only if significantly impactful to game outcome

PROJECTION LANGUAGE GUIDELINES:
HIGH PROJECTIONS - Use "explosive/elite/massive" language ONLY for:
- QB: 30+ points (anything less is "solid" or "decent")
- RB/WR: 25+ points (anything less is "good" or "solid") 
- TE: 20+ points (anything less is "reliable" or "steady")
- K: 20+ points (anything less is "consistent" or "solid")
- DEF: 20+ points (anything less is "dependable" or "steady")

LOW PROJECTIONS - Use "concerning/limited/minimal" language for:
- QB: Under 15 points = "limited QB production" or "concerning projection"
- RB/WR/TE: Under 10 points = "minimal impact" or "limited upside"
- K: Under 3 points = "concerning kicker floor" or "minimal scoring"
- DEF: Under 5 points = "limited defensive upside" or "concerning floor"

Examples with PROJECTION language:
- Sam Darnold 20.7 pts = "projected for solid QB production" (NOT "explosive" - under 30)
- Saquon Barkley 16.5 pts = "projects reliable RB output" (NOT "elite" - under 25)
- DeAndre Hopkins 3.3 pts = "projects minimal WR impact" (under 10 - concerning)
- Cade Stover 2.3 pts = "expected limited TE production" (under 10 - concerning)

WRONG: "Barkley brings 16.5 points" (sounds like already happened)
RIGHT: "Barkley projected for 16.5 points" (clearly a projection)

Each blurb must:
- Be 100-150 characters (longer than before for better analysis)
- Prioritize defensive matchup rankings as the primary insight
- Reference ONLY the players shown in the specific game's player lists
- Focus on opponent defense rankings vs player positions as main talking point
- Include specific defensive rankings when available (e.g., "#4 vs RB", "#28 vs WR")
- If no players are listed for a game, focus on general game context without player names`;

  // Enhanced game data with lineup analysis context
  const gamesData = games.map(g => {
    // Analyze lineup issues for this game
    const lineupIssues = [];
    const injuryIssues = [];
    
    // Group players by team and analyze
    const teamGroups = {};
    [...g.homePlayers, ...g.awayPlayers].forEach(player => {
      if (!teamGroups[player.fantasyTeamId]) {
        teamGroups[player.fantasyTeamId] = { starters: [], bench: [] };
      }
      // For now, assume all players in the data are starters (we'd need starting lineup data to be more accurate)
      teamGroups[player.fantasyTeamId].starters.push(player);
    });

    return {
      nflMatchup: `${g.nflTeam1} @ ${g.nflTeam2}`,
      homePlayers: g.homePlayers.map(p => `${p.name} (${p.position}, proj: ${p.projection.toFixed(1)})`),
      awayPlayers: g.awayPlayers.map(p => `${p.name} (${p.position}, proj: ${p.projection.toFixed(1)})`),
      gameInfo: `${g.day} ${g.time}${g.channel ? ', ' + g.channel : ''}`,
      topProjection: Math.max(...[...g.homePlayers, ...g.awayPlayers].map(p => p.projection)),
      playerCount: g.homePlayers.length + g.awayPlayers.length
    };
  });

  const userPrompt = `FANTASY MATCHUP:
${context.homeTeam.name} vs ${context.awayTeam.name}

MATCHUP STORY (for context):
${matchupStory || 'Playoff implications - both teams fighting for seeding'}

NFL GAMES WITH FANTASY PLAYERS:
${JSON.stringify(gamesData, null, 2)}

Generate a contextual analysis for each NFL game. Each blurb should:

🚨 CRITICAL PLAYER AND DATA RESTRICTIONS: 
- You can ONLY mention players from the "homePlayers" and "awayPlayers" arrays for each specific game
- NEVER mention players not in those exact lists
- ALL players provided are STARTERS ONLY - no bench players included
- NEVER INVENT OR MAKE UP PROJECTION NUMBERS - use ONLY the exact projections provided in the data
- If you mention a projection, it MUST match the exact number shown in the player data
- Focus analysis on starting players and their matchups only
- If a player name is not in the provided lists, DO NOT mention them

PRIORITY 1 - DEFENSIVE MATCHUP ANALYSIS: Focus on key players facing specific defense rankings (e.g., "McCaffrey vs #4 run defense")
PRIORITY 2 - KEY PLAYER PROJECTIONS: Use position-appropriate language based on projection thresholds
PRIORITY 3 - MAJOR LINEUP ISSUES: Only flag lineup optimization for 10+ point projection differences
PRIORITY 4 - INJURY IMPACT: Note injured starters only if significantly game-changing

PROJECTION LANGUAGE RULES:
HIGH THRESHOLDS (use "explosive/elite/massive"):
- QB 30+ pts | RB/WR 25+ pts | TE 20+ pts | K 20+ pts | DEF 20+ pts

NORMAL RANGE (use "solid/decent/reliable"):
- QB 15-29 pts | RB/WR/TE 10-24 pts | K 3-19 pts | DEF 5-19 pts

LOW THRESHOLDS (use "concerning/limited/minimal"):
- QB <15 pts | RB/WR/TE <10 pts | K <3 pts | DEF <5 pts

NEVER use explosive language below high thresholds!
ALWAYS call out concerning projections below low thresholds!

Requirements:
- 100-150 characters (longer for better defensive analysis)
- Focus primarily on defensive matchup rankings vs player positions
- ONLY mention players explicitly listed in each game's homePlayers/awayPlayers arrays
- NEVER INVENT PROJECTION NUMBERS - use only the exact projections provided in the data
- ALWAYS use PROJECTION language: "projected for", "projects to", "expected to score"
- NEVER use past tense or imply results already happened: NO "scored", "brought", "delivered"
- Include specific defensive rankings when discussing matchups (e.g., "#4 vs RB", "#28 vs WR")
- Prioritize opponent defense quality as the main talking point
- If you mention a projection number, it MUST exactly match the data provided
- If no players are provided for a game, write general analysis without any player names

🚨 ABSOLUTELY CRITICAL: 
- NEVER INVENT, GUESS, OR MAKE UP ANY PROJECTION NUMBERS
- If a player shows "proj: 0.0" then they have ZERO projected points
- If a player shows "proj: 16.5" then use exactly 16.5, not 16.0 or 17.0
- ONLY use the exact projection numbers shown in the player data
- If you mention any projection number, it MUST exactly match what's provided
- ALWAYS use PROJECTION language - "projected for", "projects to", "expected", NOT past tense
- NEVER imply players have already scored points - these are FUTURE projections

Return JSON only (no markdown):
[
  {
    "nflMatchup": "SF @ LAR", 
    "blurb": "McCaffrey projected for 22.1 points vs #4 run defense - tough matchup. Kupp projects 15.3 points vs #28 pass defense.",
    "chars": 125
  }
]

Constraints: Array of objects only. Fields: nflMatchup, blurb (100-150 chars), chars. No extra text.
NEVER make up projection numbers - use ONLY the exact numbers provided in the player data!`;

  return { systemPrompt, userPrompt };
}

/**
 * Call Claude API
 */
async function callModel(systemPrompt, userPrompt) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  return resp.content
    .map(c => c.type === 'text' ? c.text : '')
    .join('')
    .trim();
}

/**
 * Post-process AI response
 */
function postProcess(raw, gamesWithPlayers) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse JSON:', err);
    console.error('Raw response:', raw);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('Response is not an array');
    return [];
  }

  // Match blurbs to games and validate (use filtered games with players)
  return parsed
    .map(item => {
      const matchup = item.nflMatchup || '';
      const blurb = item.blurb || '';
      const chars = blurb.length;

      if (chars > 250) {
        console.warn(`Dropping long blurb (${chars} chars) for ${matchup}`);
        return null;
      }

      const game = gamesWithPlayers.find(g =>
        matchup.includes(g.nflTeam1) && matchup.includes(g.nflTeam2)
      );

      if (!game) return null;

      return {
        nflMatchup: `${game.nflTeam1} @ ${game.nflTeam2}`,
        blurb,
        chars,
        homePlayers: game.homePlayers.map(p => p.name),
        awayPlayers: game.awayPlayers.map(p => p.name),
        gameInfo: {
          day: game.day,
          time: game.time,
          channel: game.channel,
          weather: game.weather
        }
      };
    })
    .filter(Boolean);
}

async function main() {
  console.log(`\n🏈 Generating NFL game blurbs for matchup:`);
  console.log(`   ${homeTeamId} vs ${awayTeamId} (Week ${week})\n`);

  // Build context
  const context = await buildMatchupContext();
  console.log(`📊 Fantasy Teams:`);
  console.log(`   Home: ${context.homeTeam.name}`);
  console.log(`   Away: ${context.awayTeam.name}\n`);

  // Get games with fantasy players
  const games = getMatchupGames(context);
  console.log(`🎮 Found ${games.length} NFL games with fantasy players\n`);

  if (games.length === 0) {
    console.log('⚠️  No games found with fantasy players');
    return;
  }

  // Load matchup story if available
  const storyPath = path.join(root, `data/theleague/test-matchup-story-nfl.json`);
  let matchupStory = null;
  if (fs.existsSync(storyPath)) {
    const storyData = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
    matchupStory = storyData.story;
  }

  // Filter games to only include those with players (skip games with no starters to save API costs)
  const gamesWithPlayers = games.filter(g => 
    g.homePlayers.length > 0 || g.awayPlayers.length > 0
  );

  console.log(`💰 Cost optimization: Analyzing ${gamesWithPlayers.length} games with players (skipping ${games.length - gamesWithPlayers.length} games with no starters)`);

  // Generate blurbs
  const { systemPrompt, userPrompt } = buildPrompt(context, gamesWithPlayers, matchupStory);
  
  // Debug: Show what data is being sent to AI
  console.log('🔍 Sample game data being sent to AI:');
  if (gamesWithPlayers.length > 0) {
    const sampleGame = gamesWithPlayers.find(g => g.awayPlayers.some(p => p.name.includes('Smith')));
    if (sampleGame) {
      console.log(`   Game: ${sampleGame.nflTeam1} @ ${sampleGame.nflTeam2}`);
      console.log(`   Away Players: ${sampleGame.awayPlayers.map(p => `${p.name} (proj: ${p.projection})`).join(', ')}`);
    }
  }
  
  console.log('🤖 Calling Claude API...\n');

  const raw = await callModel(systemPrompt, userPrompt);
  const blurbs = postProcess(raw, gamesWithPlayers);

  // Save output
  const output = {
    generatedAt: new Date().toISOString(),
    week: parseInt(week),
    matchup: {
      home: context.homeTeam,
      away: context.awayTeam
    },
    blurbs
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`✅ Generated ${blurbs.length} contextual blurbs`);
  console.log(`💾 Saved to ${outputPath}\n`);

  // Preview
  console.log('📝 Sample blurbs:\n');
  blurbs.slice(0, 3).forEach(b => {
    console.log(`   ${b.nflMatchup}`);
    console.log(`   "${b.blurb}" (${b.chars} chars)`);
    console.log(`   Players: ${[...b.homePlayers, ...b.awayPlayers].join(', ')}\n`);
  });
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
