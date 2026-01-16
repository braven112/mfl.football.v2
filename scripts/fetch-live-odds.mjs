#!/usr/bin/env node

/**
 * Fetch Live NFL Odds Data
 *
 * Fetches current NFL game data including:
 * - Spreads and over/under lines
 * - Weather conditions
 * - Game status and scores
 *
 * Data source: ESPN API
 *
 * Usage:
 *   node scripts/fetch-live-odds.mjs
 *   node scripts/fetch-live-odds.mjs --week 15
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/**
 * Calculate current NFL week
 */
function getCurrentNFLWeek() {
  const seasonYear = new Date().getFullYear();
  const seasonConfigs = {
    2024: new Date('2024-09-05T20:20:00-04:00'),
    2025: new Date('2025-09-04T20:20:00-04:00'),
    2026: new Date('2026-09-10T20:20:00-04:00'),
  };

  let week1Start = seasonConfigs[seasonYear];
  if (!week1Start) {
    const sept1 = new Date(seasonYear, 8, 1);
    const dayOfWeek = sept1.getDay();
    const daysUntilThursday = dayOfWeek <= 4 ? 4 - dayOfWeek : 11 - dayOfWeek;
    week1Start = new Date(seasonYear, 8, 1 + daysUntilThursday, 20, 20);
  }

  const now = new Date();
  if (now < week1Start) return 1;

  const msSinceStart = now.getTime() - week1Start.getTime();
  const weeksSinceStart = Math.floor(msSinceStart / (7 * 24 * 60 * 60 * 1000));
  return Math.min(weeksSinceStart + 1, 22);
}

/**
 * Normalize team codes
 */
function normalizeTeamCode(espnAbbrev) {
  const map = {
    'WSH': 'WAS',
    'JAX': 'JAX',
    'JAC': 'JAX',
  };
  return map[espnAbbrev] || espnAbbrev;
}

/**
 * Fetch live odds and game data from ESPN
 */
async function fetchLiveOdds(week) {
  const seasonType = week <= 18 ? 2 : 3; // 2 = regular, 3 = playoffs
  const url = `${ESPN_API}?week=${week}&seasontype=${seasonType}`;

  console.log(`\n🏈 Fetching live NFL odds data...`);
  console.log(`   Week: ${week}`);
  console.log(`   API: ${url}\n`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.events || data.events.length === 0) {
      console.log('⚠️  No games found for this week');
      return {};
    }

    console.log(`✅ Found ${data.events.length} games\n`);

    const oddsData = {};

    data.events.forEach(event => {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
      const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

      if (!homeTeam || !awayTeam) return;

      const homeCode = normalizeTeamCode(homeTeam.team.abbreviation);
      const awayCode = normalizeTeamCode(awayTeam.team.abbreviation);

      // Extract odds from competition
      const odds = competition.odds?.[0] || {};
      const spread = odds.details || 'N/A';
      const overUnder = odds.overUnder || 'N/A';

      // Extract weather
      const weather = competition.weather ? {
        temperature: competition.weather.temperature,
        displayValue: competition.weather.displayValue,
        conditionId: competition.weather.conditionId
      } : null;

      // Game status
      const status = competition.status?.type?.shortDetail ||
                     competition.status?.type?.description ||
                     'Scheduled';

      // Create game record for both teams
      const gameRecord = {
        id: event.id,
        date: event.date,
        homeTeam: homeCode,
        awayTeam: awayCode,
        status,
        spread,
        overUnder,
        homeScore: homeTeam.score || '0',
        awayScore: awayTeam.score || '0',
        weather
      };

      // Add entry for home team
      oddsData[homeCode] = {
        ...gameRecord,
        isHome: true,
        opponent: awayCode
      };

      // Add entry for away team
      oddsData[awayCode] = {
        ...gameRecord,
        isHome: false,
        opponent: homeCode
      };

      console.log(`   ${awayCode} @ ${homeCode}: ${spread} | O/U: ${overUnder}`);
    });

    return oddsData;

  } catch (error) {
    console.error('❌ Error fetching ESPN data:', error.message);
    throw error;
  }
}

/**
 * Fetch fantasy points allowed data from ESPN
 */
async function fetchFantasyPointsAllowed() {
  console.log(`\n📊 Fetching fantasy points allowed data...`);

  // ESPN doesn't have a direct API for this, but we can use their team stats
  // For now, we'll use a static calculation based on season data
  // In production, you might want to scrape FantasyPros or use a paid API

  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams';

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log('⚠️  Could not fetch team stats, using existing data');
      return null;
    }

    // Note: ESPN's free API doesn't expose detailed fantasy points allowed
    // This would need a more sophisticated data source like FantasyPros API
    console.log('ℹ️  Fantasy points allowed data requires manual update or premium API');
    return null;

  } catch (error) {
    console.log('⚠️  Could not fetch fantasy points allowed:', error.message);
    return null;
  }
}

/**
 * Save data to files
 */
function saveOddsData(oddsData) {
  const outputFile = path.join(root, 'src/data/nfl/live-odds.json');

  // Ensure directory exists
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  fs.writeFileSync(outputFile, JSON.stringify(oddsData, null, 2));
  console.log(`\n✅ Saved live odds to ${outputFile}`);
}

/**
 * Main
 */
async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const weekIndex = args.indexOf('--week');
  const week = weekIndex !== -1 ? parseInt(args[weekIndex + 1], 10) : getCurrentNFLWeek();

  console.log('═'.repeat(50));
  console.log('  NFL Live Odds Fetcher');
  console.log('═'.repeat(50));

  try {
    // Fetch live odds
    const oddsData = await fetchLiveOdds(week);

    if (Object.keys(oddsData).length > 0) {
      saveOddsData(oddsData);
    }

    // Try to fetch fantasy points allowed (may not work without premium API)
    await fetchFantasyPointsAllowed();

    console.log('\n✅ Done!\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
