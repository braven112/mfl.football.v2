#!/usr/bin/env node

/**
 * Enhanced test script with NFL game analysis
 * Incorporates player NFL matchups and defensive rankings
 */

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildCompleteNFLData,
  loadCachedNFLData,
  cacheNFLData
} from './nfl-data-service.mjs';

// Load .env file manually
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY environment variable');
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

// Helper to load JSON files
function loadJSON(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

// Load data
console.log('📊 Loading league data...');
const standings = loadJSON('data/theleague/mfl-feeds/2025/standings.json');
const weeklyResults = loadJSON('data/theleague/mfl-feeds/2025/weekly-results.json');
const league = loadJSON('data/theleague/mfl-feeds/2025/league.json');
const rosters = loadJSON('data/theleague/mfl-feeds/2025/rosters.json');
const players = loadJSON('data/theleague/mfl-feeds/2025/players.json');
const projectedScores = loadJSON('data/theleague/mfl-feeds/2025/projectedScores.json');

// Create player lookup map
const playerMap = new Map();
players.players.player.forEach(p => {
  playerMap.set(p.id, p);
});

// Create projected scores lookup map
const projectionMap = new Map();
projectedScores.projectedScores.playerScore?.forEach(p => {
  if (p.id && p.score) {
    projectionMap.set(p.id, parseFloat(p.score));
  }
});

// NFL data will be fetched from API via nfl-data-service.mjs

// Get franchise roster with player details
function getFranchiseRoster(franchiseId) {
  const franchise = rosters.rosters.franchise.find(f => f.id === franchiseId);
  if (!franchise) return [];

  return franchise.player
    .filter(p => p.status === 'ROSTER')
    .map(p => {
      const playerData = playerMap.get(p.id);
      return {
        ...p,
        playerData,
        salary: parseFloat(p.salary),
        name: playerData?.name || 'Unknown',
        position: playerData?.position || 'Unknown',
        nflTeam: playerData?.team || 'FA'
      };
    })
    .filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position))
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 10); // Top 10 players by salary
}

// Analyze NFL matchups for fantasy teams
function analyzeNFLMatchups(homeRoster, awayRoster, nflData, homeTeamId, awayTeamId) {
  const allPlayers = [...homeRoster, ...awayRoster];
  const matchups = [];

  allPlayers.forEach(player => {
    const opponent = nflData.schedule[player.nflTeam];
    if (!opponent) return;

    const defenseRank = nflData.defensiveRankings[player.position]?.[opponent];
    if (!defenseRank) return;

    // Get injury status if available
    const injury = nflData.injuries?.[player.id];

    // Determine which fantasy team owns this player
    const fantasyTeamId = homeRoster.includes(player) ? homeTeamId : awayTeamId;

    // Get real projected points from MFL API
    const projectedPoints = projectionMap.get(player.id) || null;

    matchups.push({
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      opponent,
      defenseRank,
      isGoodMatchup: defenseRank >= 20, // Facing bottom-tier defense
      isToughMatchup: defenseRank <= 10, // Facing top-tier defense
      salary: player.salary,
      playerId: player.id,
      espnId: player.playerData?.espn_id,
      nflId: player.playerData?.nfl_id,
      fantasyTeamId: fantasyTeamId,
      projectedPoints: projectedPoints,
      injury: injury ? {
        status: injury.status,
        details: injury.details,
        expectedReturn: injury.expectedReturn
      } : null
    });
  });

  // Sort by salary (most important players first)
  matchups.sort((a, b) => b.salary - a.salary);

  return matchups;
}

// Group matchups by NFL game and count players
function analyzeNFLGames(homeRoster, awayRoster, nflData, homeTeamId, awayTeamId) {
  const allPlayers = [...homeRoster, ...awayRoster];
  const gameMap = new Map();

  allPlayers.forEach(player => {
    const opponent = nflData.schedule[player.nflTeam];
    if (!opponent) return;

    // Create unique game key (alphabetically sorted teams to avoid duplicates)
    const teams = [player.nflTeam, opponent].sort();
    const gameKey = `${teams[0]}_vs_${teams[1]}`;

    if (!gameMap.has(gameKey)) {
      const gameDetails = nflData.gameDetails[gameKey] || {
        time: 'TBD',
        day: 'Sun',
        channel: 'TBD',
        channelLogo: null,
        weather: '☀️',
        temp: '--',
        conditions: 'Unknown'
      };

      gameMap.set(gameKey, {
        team1: teams[0],
        team2: teams[1],
        players: [],
        playerCount: 0,
        time: gameDetails.time,
        day: gameDetails.day,
        channel: gameDetails.channel,
        channelLogo: gameDetails.channelLogo,
        weather: gameDetails.weather,
        temp: gameDetails.temp,
        conditions: gameDetails.conditions
      });
    }

    const game = gameMap.get(gameKey);

    // Determine which fantasy team owns this player
    const fantasyTeamId = homeRoster.includes(player) ? homeTeamId : awayTeamId;

    // Get real projected points from MFL API
    const projectedPoints = projectionMap.get(player.id) || null;

    game.players.push({
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      salary: player.salary,
      espnId: player.playerData?.espn_id,
      fantasyTeamId: fantasyTeamId,
      projectedPoints: projectedPoints
    });
    game.playerCount++;
  });

  // Convert to array and sort by player count (most relevant games first)
  const games = Array.from(gameMap.values())
    .sort((a, b) => b.playerCount - a.playerCount);

  return games;
}

// Format NFL matchups for prompt
function formatNFLMatchups(matchups) {
  const highlights = [];

  // Find best matchups (high value players facing weak defenses)
  const goodMatchups = matchups.filter(m => m.isGoodMatchup).slice(0, 2);
  goodMatchups.forEach(m => {
    highlights.push(`${m.name} (${m.position}, ${m.nflTeam}) faces ${m.opponent} who ranks ${m.defenseRank}th vs ${m.position}s - favorable matchup`);
  });

  // Find tough matchups (high value players facing strong defenses)
  const toughMatchups = matchups.filter(m => m.isToughMatchup).slice(0, 2);
  toughMatchups.forEach(m => {
    highlights.push(`${m.name} (${m.position}, ${m.nflTeam}) faces ${m.opponent} who ranks ${m.defenseRank}th vs ${m.position}s - difficult matchup`);
  });

  return highlights.join('\n  - ');
}

// Get franchise info
function getFranchiseInfo(franchiseId) {
  const standing = standings.leagueStandings.franchise.find(f => f.id === franchiseId);
  if (!standing) return null;

  const [wins, losses, ties] = standing.h2hwlt.split('-').map(Number);

  const last3Weeks = weeklyResults.weeks
    .filter(w => w.week >= 12 && w.week <= 14)
    .map(w => ({
      week: w.week,
      score: w.scores[franchiseId]
    }));

  const recentScores = last3Weeks.map(w => w.score).filter(s => s > 0);
  const projection = recentScores.length > 0
    ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
    : parseFloat(standing.avgpf);

  return {
    id: franchiseId,
    name: standing.fname,
    record: { wins, losses, ties },
    standing: parseInt(standing.vp),
    pointsFor: parseFloat(standing.pf),
    pointsAgainst: parseFloat(standing.pa),
    avgPF: parseFloat(standing.avgpf),
    avgPA: parseFloat(standing.avgpa),
    streak: standing.strk,
    last3Weeks,
    powerRanking: parseFloat(standing.pwr),
    projection: projection
  };
}

// Format helper
function formatLastThree(weeks) {
  return weeks.map(w => `Week ${w.week}: ${w.score.toFixed(1)} pts`).join(', ');
}

// Build the prompt with NFL matchup analysis
function buildPrompt(homeTeam, awayTeam, nflMatchupAnalysis, week) {
  return `You are an NFL insider writing like Adam Schefter. Write a professional,
factual 80-120 word fantasy football playoff matchup preview for Week ${week}.

TONE & STYLE:
- Professional journalism (Adam Schefter style)
- Authoritative and analytical
- Focus on NFL games and player matchups - THIS IS THE PRIMARY FOCUS
- Use specific stats and defensive rankings
- Direct, no-nonsense approach
- Use clear paragraph breaks for readability (2-3 tight paragraphs)
- Be EXTREMELY concise - every word must count

MATCHUP DETAILS:
Home: ${homeTeam.name} (${homeTeam.record.wins}-${homeTeam.record.losses}, ${homeTeam.standing}th in standings)
  - Seed: 4 (in Championship Bracket)
  - Points For: ${homeTeam.pointsFor.toFixed(1)} (${homeTeam.avgPF.toFixed(1)} PPG average)
  - Last 3 weeks: ${formatLastThree(homeTeam.last3Weeks)}
  - Power ranking: ${homeTeam.powerRanking.toFixed(1)}
  - Week 15 Projection: ${homeTeam.projection.toFixed(1)} points

Away: ${awayTeam.name} (${awayTeam.record.wins}-${awayTeam.record.losses}, ${awayTeam.standing}th in standings)
  - Seed: 5 (in Championship Bracket)
  - Points For: ${awayTeam.pointsFor.toFixed(1)} (${awayTeam.avgPF.toFixed(1)} PPG average)
  - Last 3 weeks: ${formatLastThree(awayTeam.last3Weeks)}
  - Power ranking: ${awayTeam.powerRanking.toFixed(1)}
  - Week 15 Projection: ${awayTeam.projection.toFixed(1)} points

NFL MATCHUP ANALYSIS (MAIN FOCUS):
${nflMatchupAnalysis}

PLAYOFF STAKES:
- First-round playoff game
- Winner advances to face 1-seed in Week 16 semifinals
- Loser drops to consolation playoffs, continues playing for final standings placement
- This is about championship positioning - winner keeps title hopes alive
- Both teams earned playoff spots through strong regular seasons

WRITING REQUIREMENTS:
- STRICT WORD COUNT: 80-120 words (no more, no less)
- Use 2-3 tight paragraphs with clear breaks between them
- PRIMARY FOCUS: NFL games and player matchups (defensive rankings, key games)
- Lead with the most compelling NFL matchup storyline
- Include 1-2 key statistics about team performance
- De-emphasize "single elimination" language - just say "playoffs"
- Focus on championship implications and playoff advancement
- MUST include the projection/prediction at the end
- Format prediction like: "Projection: [Team Name] [score] - [Team Name] [score], with [winning team] advancing by [margin] points"
- Write in present tense
- Use exact team names provided
- Sound like Adam Schefter analyzing the NFL matchups that will decide this fantasy game

Write the preview now:`;
}

// Generate story
async function generateStory(homeTeam, awayTeam, nflMatchupAnalysis, week) {
  console.log(`\n✍️  Generating story for Week ${week}...`);
  console.log(`   ${awayTeam.name} (${awayTeam.record.wins}-${awayTeam.record.losses})`);
  console.log(`   @ ${homeTeam.name} (${homeTeam.record.wins}-${homeTeam.record.losses})`);
  console.log('');

  const prompt = buildPrompt(homeTeam, awayTeam, nflMatchupAnalysis, week);

  console.log('🤖 Calling Claude API...');

  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 250,
    temperature: 0.8,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  return message.content[0].text;
}

// Main
async function main() {
  console.log('🏈 AI Matchup Story Generator - NFL Enhanced\n');

  const week = 15;
  const nflYear = 2024; // 2024 NFL season for Week 15

  // Fetch NFL data from APIs
  console.log('📡 Fetching NFL data from APIs...');
  let nflData = loadCachedNFLData(nflYear, week, 3600000); // Cache for 1 hour

  if (!nflData) {
    nflData = await buildCompleteNFLData(nflYear, week);
    cacheNFLData(nflData);
  } else {
    console.log('✅ Using cached NFL data\n');
  }

  const homeTeam = getFranchiseInfo('0013');
  const awayTeam = getFranchiseInfo('0015');

  if (!homeTeam || !awayTeam) {
    console.error('Failed to load team data');
    process.exit(1);
  }

  // Get rosters and analyze NFL matchups
  console.log('🔍 Analyzing NFL matchups...');
  const homeRoster = getFranchiseRoster('0013');
  const awayRoster = getFranchiseRoster('0015');
  const nflMatchups = analyzeNFLMatchups(homeRoster, awayRoster, nflData, '0013', '0015');
  const nflGames = analyzeNFLGames(homeRoster, awayRoster, nflData, '0013', '0015');
  const nflMatchupAnalysis = formatNFLMatchups(nflMatchups);

  console.log('\n📋 Top NFL Matchups:');
  console.log('  - ' + nflMatchupAnalysis.split('\n').join('\n'));

  console.log('\n🏈 NFL Games by Player Count:');
  nflGames.forEach(game => {
    console.log(`   ${game.team1} vs ${game.team2}: ${game.playerCount} player(s)`);
  });

  try {
    const story = await generateStory(homeTeam, awayTeam, nflMatchupAnalysis, week);

    console.log('\n' + '='.repeat(80));
    console.log('GENERATED STORY');
    console.log('='.repeat(80) + '\n');
    console.log(story);
    console.log('\n' + '='.repeat(80));

    const wordCount = story.split(/\s+/).length;
    console.log(`\n📊 Story Stats:`);
    console.log(`   Word count: ${wordCount}`);
    console.log(`   Model: claude-3-5-haiku-20241022`);
    console.log(`   Estimated cost: ~$0.002`);

    // Save to file
    const output = {
      generated: new Date().toISOString(),
      week,
      matchup: {
        home: homeTeam.name,
        away: awayTeam.name
      },
      story,
      nflMatchups: nflMatchups.slice(0, 5),
      nflGames: nflGames,
      metadata: {
        wordCount,
        model: 'claude-3-5-haiku-20241022',
        generatedAt: new Date().toISOString()
      }
    };

    const outPath = 'data/theleague/test-matchup-story-nfl.json';
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved to: ${outPath}`);

  } catch (error) {
    console.error('\n❌ Error generating story:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    process.exit(1);
  }
}

main();
