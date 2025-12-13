#!/usr/bin/env node

/**
 * Fetch NFL schedule and broadcast info from ESPN API
 *
 * Usage:
 *   node scripts/fetch-espn-schedule.mjs --week 15 --year 2024
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// Parse command line args
const args = process.argv.slice(2);
const weekIndex = args.indexOf('--week');
const yearIndex = args.indexOf('--year');

const week = weekIndex !== -1 ? args[weekIndex + 1] : '15';
const year = yearIndex !== -1 ? args[yearIndex + 1] : '2024';

// seasontype: 2 = regular season, 3 = playoffs
const seasonType = parseInt(week) <= 18 ? 2 : 3;

const ESPN_API = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=${seasonType}`;

/**
 * Normalize team codes to match MFL format
 */
function normalizeTeamCode(espnAbbrev) {
  const map = {
    'WSH': 'WSH',
    'JAX': 'JAX',
    'GB': 'GB',
    'KC': 'KC',
    'NE': 'NE',
    'NO': 'NO',
    'SF': 'SF',
    'TB': 'TB',
    'LV': 'LV',
    'HOU': 'HOU',
    'BAL': 'BAL',
    'CLE': 'CLE',
    'ARI': 'ARI'
  };

  return map[espnAbbrev] || espnAbbrev;
}

/**
 * Get day of week from date
 */
function getDayOfWeek(dateString) {
  const date = new Date(dateString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

/**
 * Format time to PT
 */
function formatTimePT(dateString) {
  const date = new Date(dateString);
  const timeString = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles'
  });

  return `${timeString} PST`;
}

/**
 * Fetch schedule from ESPN
 */
async function fetchSchedule() {
  console.log(`📡 Fetching NFL schedule for Week ${week}, ${year}...`);
  console.log(`   ESPN API: ${ESPN_API}\n`);

  try {
    const response = await fetch(ESPN_API);

    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.events || data.events.length === 0) {
      throw new Error('No games found in ESPN response');
    }

    console.log(`✅ Found ${data.events.length} games\n`);

    return data.events;
  } catch (error) {
    console.error('❌ Error fetching ESPN data:', error.message);
    throw error;
  }
}

/**
 * Process ESPN data into our format
 */
function processGames(events) {
  const schedule = {};
  const gameDetails = {};

  events.forEach(event => {
    const competition = event.competitions[0];
    const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
    const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

    if (!homeTeam || !awayTeam) return;

    const homeCode = normalizeTeamCode(homeTeam.team.abbreviation);
    const awayCode = normalizeTeamCode(awayTeam.team.abbreviation);

    // Add to schedule (team -> opponent mapping)
    schedule[homeCode] = awayCode;
    schedule[awayCode] = homeCode;

    // Extract broadcast info
    const broadcast = competition.broadcasts?.[0] || {};
    const channelName = broadcast.names?.[0] || broadcast.market || '';

    // Get venue info
    const venue = competition.venue || {};
    const isIndoor = venue.indoor || false;

    // Get weather if available
    const weather = competition.weather || {};

    // Format game time
    const gameDate = event.date;
    const day = getDayOfWeek(gameDate);
    const time = formatTimePT(gameDate);

    // Map channel to logo filename
    const channelLogoMap = {
      'CBS': 'cbs-nfl-us.png',
      'FOX': 'fox.png',
      'NBC': 'nbc.png',
      'ESPN': 'espn.png',
      'ABC': 'abc.png',
      'NFL Network': 'nfl-network.png',
      'Amazon Prime Video': 'prime-video.png',
      'Prime Video': 'prime-video.png'
    };

    const channelLogo = channelLogoMap[channelName] || '';

    // Create game detail key
    const detailKey = `${awayCode}_vs_${homeCode}`;

    gameDetails[detailKey] = {
      time,
      day,
      channel: channelName,
      channelLogo,
      weather: isIndoor ? '🏟️' : (weather.displayValue ? getWeatherEmoji(weather.displayValue) : '☀️'),
      temp: weather.temperature ? `${weather.temperature}°F` : '',
      conditions: weather.displayValue || '',
      venue: {
        name: venue.fullName || '',
        city: venue.address?.city || '',
        state: venue.address?.state || '',
        indoor: isIndoor
      }
    };
  });

  return { schedule, gameDetails };
}

/**
 * Get weather emoji from description
 */
function getWeatherEmoji(description) {
  const desc = description.toLowerCase();
  if (desc.includes('rain') || desc.includes('shower')) return '🌧️';
  if (desc.includes('snow')) return '❄️';
  if (desc.includes('cloud')) return '☁️';
  if (desc.includes('clear') || desc.includes('sunny')) return '☀️';
  if (desc.includes('wind')) return '💨';
  return '☀️';
}

/**
 * Save data to file
 */
function saveData(data, week, year) {
  const outputDir = path.join(root, 'data/theleague/nfl-cache');
  const outputFile = path.join(outputDir, `week${week}-${year}.json`);

  // Ensure directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Add metadata
  const output = {
    week: parseInt(week),
    year: parseInt(year),
    fetchedAt: new Date().toISOString(),
    source: 'ESPN API',
    ...data
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log(`✅ Saved schedule data to ${outputFile}\n`);

  // Preview
  const gameCount = Object.keys(data.gameDetails).length;
  console.log(`📊 Summary:`);
  console.log(`   Games: ${gameCount}`);
  console.log(`   Teams: ${Object.keys(data.schedule).length / 2}`);

  // Show sample broadcasts
  console.log(`\n📺 Sample broadcasts:`);
  Object.entries(data.gameDetails).slice(0, 3).forEach(([matchup, details]) => {
    console.log(`   ${matchup}: ${details.channel} - ${details.day} ${details.time}`);
  });
}

/**
 * Main function
 */
async function main() {
  console.log(`\n🏈 ESPN NFL Schedule Fetcher\n`);

  const events = await fetchSchedule();
  const data = processGames(events);
  saveData(data, week, year);

  console.log(`\n✅ Done!\n`);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
