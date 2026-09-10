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
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { getCurrentNFLWeek as resolveCurrentNFLWeek } from './article-utils/week-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/**
 * Current NFL week, from the published NFL schedule.
 *
 * Was a local `seasonConfigs` map of Week 1 Thursdays plus a "first Thursday of
 * September" fallback — one of six such tables in this repo, all of which had
 * 2026 opening Thursday Sep 10 when it actually opened Wednesday Sep 9.
 * week-resolver walks the real week starts (see src/utils/nfl-week-starts.mjs).
 */
function getCurrentNFLWeek() {
  const seasonYear = new Date().getFullYear();
  // Before the season opens, preview week 1 rather than reporting no week.
  return resolveCurrentNFLWeek(seasonYear) || 1;
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

  // Skip-if-unchanged: the odds payload is stable outside game windows, and
  // this runs from the 5-minute roster-sync cron — an identical rewrite
  // would create a commit per run.
  const wrote = writeJsonIfChanged(outputFile, oddsData);
  console.log(
    wrote ? `\n✅ Saved live odds to ${outputFile}` : `\n✅ Live odds unchanged; left ${outputFile} untouched`
  );
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
