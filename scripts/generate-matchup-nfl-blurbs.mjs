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
function buildMatchupContext() {
  const rosters = loadJson('rosters.json');
  const players = loadJson('players.json');
  const projections = loadJson('projectedScores.json');
  const franchises = loadJson('league.json').league.franchises.franchise;

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

  const projMap = new Map();
  const projList = Array.isArray(projections.projectedScores.playerScore)
    ? projections.projectedScores.playerScore
    : [projections.projectedScores.playerScore];
  projList.forEach(p => projMap.set(p.id, parseFloat(p.score) || 0));

  // Build player lists by NFL game
  const nflGames = new Map();

  function addPlayer(playerId, fantasyTeamId, fantasyTeamName) {
    const player = playerMap.get(playerId);
    if (!player) return;

    const nflTeam = normalizeTeamCode(player.team);
    const projection = projMap.get(playerId) || 0;

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
      fantasyTeamName
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

CRITICAL RULES:
- NEVER mention players not listed in the data for that specific game
- NEVER use "strategy" language - use outcome/impact language instead
- Focus ONLY on the players actually playing in THIS game
- Analyze potential outcomes, not strategies

Each blurb must:
- Focus on the fantasy implications of THIS specific NFL game
- Reference ONLY the players shown in the game data
- Be 150-200 characters (player names shown separately, don't repeat)
- Analyze the potential impact/outcome for the matchup
- Avoid words like "strategy", "lineup", "game plan" - use "potential", "impact", "outcome" instead`;

  const gamesData = games.map(g => ({
    nflMatchup: `${g.nflTeam1} @ ${g.nflTeam2}`,
    homePlayers: g.homePlayers.map(p => `${p.name} (${p.position}, proj: ${p.projection.toFixed(1)})`),
    awayPlayers: g.awayPlayers.map(p => `${p.name} (${p.position}, proj: ${p.projection.toFixed(1)})`),
    gameInfo: `${g.day} ${g.time}${g.channel ? ', ' + g.channel : ''}`
  }));

  const userPrompt = `FANTASY MATCHUP:
${context.homeTeam.name} vs ${context.awayTeam.name}

MATCHUP STORY (for context):
${matchupStory || 'Playoff implications - both teams fighting for seeding'}

NFL GAMES WITH FANTASY PLAYERS:
${JSON.stringify(gamesData, null, 2)}

Generate a contextual analysis for each NFL game. Each blurb should:
1. Focus on fantasy implications (player names are shown separately)
2. Highlight what to watch for in this game
3. Be 150-200 chars total
4. Explain why this game matters to the matchup outcome
5. Provide strategic insight or game flow analysis
6. Tie to the matchup narrative (playoff implications, must-win, etc.)

Return JSON only (no markdown):
[
  {
    "nflMatchup": "SF @ LAR",
    "blurb": "High-scoring divisional battle could swing the matchup. Weather favorable, pace should be fast. This game will likely determine who gets the scoring edge.",
    "chars": 152
  }
]

Constraints: Array of objects only. Fields: nflMatchup, blurb (150-200 chars), chars. No extra text.`;

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
function postProcess(raw, games) {
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

  // Match blurbs to games and validate
  return parsed
    .map(item => {
      const matchup = item.nflMatchup || '';
      const blurb = item.blurb || '';
      const chars = blurb.length;

      if (chars > 250) {
        console.warn(`Dropping long blurb (${chars} chars) for ${matchup}`);
        return null;
      }

      const game = games.find(g =>
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
  const context = buildMatchupContext();
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

  // Generate blurbs
  const { systemPrompt, userPrompt } = buildPrompt(context, games, matchupStory);
  console.log('🤖 Calling Claude API...\n');

  const raw = await callModel(systemPrompt, userPrompt);
  const blurbs = postProcess(raw, games);

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
