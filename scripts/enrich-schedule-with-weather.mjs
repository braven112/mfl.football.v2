#!/usr/bin/env node

/**
 * Enrich NFL schedule with real weather data from National Weather Service API
 *
 * Usage:
 *   node scripts/enrich-schedule-with-weather.mjs --week 15 --year 2025
 *
 * Uses the free NWS API (weather.gov) - no API key required!
 * For non-US venues, falls back to basic weather based on season/location
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

/**
 * Calculate current NFL week based on season start
 */
function getCurrentNFLWeek(seasonYear = 2025) {
  const seasonConfigs = {
    2024: new Date('2024-09-05T20:20:00-04:00'),
    2025: new Date('2025-09-04T20:20:00-04:00'),
    2026: new Date('2026-09-10T20:20:00-04:00'),
  };

  let week1Start = seasonConfigs[seasonYear];
  if (!week1Start) {
    // Fallback: assume first Thursday of September
    const sept1 = new Date(seasonYear, 8, 1);
    const dayOfWeek = sept1.getDay();
    const daysUntilThursday = dayOfWeek <= 4 ? 4 - dayOfWeek : 11 - dayOfWeek;
    week1Start = new Date(seasonYear, 8, 1 + daysUntilThursday, 20, 20);
  }

  const now = new Date();
  if (now < week1Start) return 1; // Default to week 1 if before season

  const msSinceStart = now.getTime() - week1Start.getTime();
  const weeksSinceStart = Math.floor(msSinceStart / (7 * 24 * 60 * 60 * 1000));
  return Math.min(weeksSinceStart + 1, 22); // Cap at 22 weeks
}

function getCurrentSeasonYear() {
  const now = new Date();
  return now.getFullYear();
}

// Parse command line args
const args = process.argv.slice(2);
const weekIndex = args.indexOf('--week');
const yearIndex = args.indexOf('--year');

const currentYear = getCurrentSeasonYear();
const currentWeek = getCurrentNFLWeek(currentYear);

const week = weekIndex !== -1 ? args[weekIndex + 1] : String(currentWeek);
const year = yearIndex !== -1 ? args[yearIndex + 1] : String(currentYear);

/**
 * Stadium coordinates for NFL venues
 */
const STADIUM_COORDS = {
  'Raymond James Stadium': { lat: 27.9759, lon: -82.5033 },
  'Soldier Field': { lat: 41.8623, lon: -87.6167 },
  'Paycor Stadium': { lat: 39.0954, lon: -84.5160 },
  'GEHA Field at Arrowhead Stadium': { lat: 39.0489, lon: -94.4839 },
  'Gillette Stadium': { lat: 42.0909, lon: -71.2643 },
  'MetLife Stadium': { lat: 40.8128, lon: -74.0742 },
  'Lincoln Financial Field': { lat: 39.9008, lon: -75.1675 },
  'EverBank Stadium': { lat: 30.3239, lon: -81.6373 },
  'NRG Stadium': { lat: 29.6847, lon: -95.4107 },
  'Empower Field at Mile High': { lat: 39.7439, lon: -105.0201 },
  'SoFi Stadium': { lat: 33.9535, lon: -118.3392 },
  'Caesars Superdome': { lat: 29.9511, lon: -90.0812 },
  "Levi's Stadium": { lat: 37.4030, lon: -121.9697 },
  'Lumen Field': { lat: 47.5952, lon: -122.3316 },
  'AT&T Stadium': { lat: 32.7473, lon: -97.0945 },
  'Acrisure Stadium': { lat: 40.4468, lon: -80.0158 },
  'Mercedes-Benz Stadium': { lat: 33.7553, lon: -84.4006 },
  'Bank of America Stadium': { lat: 35.2258, lon: -80.8528 },
  'FirstEnergy Stadium': { lat: 41.5061, lon: -81.6995 },
  'Lucas Oil Stadium': { lat: 39.7601, lon: -86.1639 },
  'Lambeau Field': { lat: 44.5013, lon: -88.0622 },
  'Ford Field': { lat: 42.3400, lon: -83.0456 },
  'State Farm Stadium': { lat: 33.5276, lon: -112.2626 },
  'Allegiant Stadium': { lat: 36.0908, lon: -115.1836 },
  'M&T Bank Stadium': { lat: 39.2780, lon: -76.6227 },
  'Highmark Stadium': { lat: 42.7738, lon: -78.7870 },
  'Nissan Stadium': { lat: 36.1665, lon: -86.7713 },
  'Hard Rock Stadium': { lat: 25.9580, lon: -80.2389 },
  'Huntington Bank Field': { lat: 41.5061, lon: -81.6995 },
  'MetLife Stadium': { lat: 40.8128, lon: -74.0742 },
  'U.S. Bank Stadium': { lat: 44.9738, lon: -93.2577 },
  'Tottenham Hotspur Stadium': { lat: 51.6042, lon: -0.0662 }
};

/**
 * Fetch weather from National Weather Service
 */
async function fetchNWSWeather(lat, lon, venueName) {
  try {
    // First, get the grid point for this location
    const pointUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const pointResponse = await fetch(pointUrl, {
      headers: {
        'User-Agent': '(MFL Fantasy Football, brandon.shields@alaskaair.com)'
      }
    });

    if (!pointResponse.ok) {
      return null;
    }

    const pointData = await pointResponse.json();
    const forecastUrl = pointData.properties.forecast;

    // Get the forecast
    const forecastResponse = await fetch(forecastUrl, {
      headers: {
        'User-Agent': '(MFL Fantasy Football, brandon.shields@alaskaair.com)'
      }
    });

    if (!forecastResponse.ok) {
      return null;
    }

    const forecastData = await forecastResponse.json();

    // Get the first period (current/upcoming forecast)
    const period = forecastData.properties.periods[0];

    return {
      temp: period.temperature,
      conditions: period.shortForecast,
      emoji: getWeatherEmoji(period.shortForecast)
    };
  } catch (error) {
    console.warn(`⚠️  NWS API error for ${venueName}:`, error.message);
    return null;
  }
}

/**
 * Get weather emoji from forecast description
 */
function getWeatherEmoji(description) {
  const desc = description.toLowerCase();

  if (desc.includes('rain') || desc.includes('shower')) return '🌧️';
  if (desc.includes('snow') || desc.includes('flurries')) return '❄️';
  if (desc.includes('cloud') || desc.includes('overcast')) return '☁️';
  if (desc.includes('clear') || desc.includes('sunny')) return '☀️';
  if (desc.includes('wind')) return '💨';
  if (desc.includes('thunder') || desc.includes('storm')) return '⛈️';
  if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) return '🌫️';
  if (desc.includes('partly')) return '⛅';

  return '☀️';
}

/**
 * Add delay between API calls to be respectful
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function
 */
async function main() {
  console.log(`\n🌤️  NFL Weather Enrichment\n`);

  // Load the schedule file
  const scheduleFile = path.join(root, `data/theleague/nfl-cache/week${week}-${year}.json`);

  if (!fs.existsSync(scheduleFile)) {
    console.error(`❌ Schedule file not found: ${scheduleFile}`);
    console.error('   Run fetch-espn-schedule.mjs first\n');
    process.exit(1);
  }

  console.log(`📖 Reading schedule from ${scheduleFile}...`);
  const scheduleData = JSON.parse(fs.readFileSync(scheduleFile, 'utf-8'));

  const gameDetails = scheduleData.gameDetails;
  const games = Object.keys(gameDetails);

  console.log(`🏟️  Found ${games.length} games\n`);
  console.log(`⏳ Fetching weather data from NWS API...\n`);

  let updated = 0;
  let skipped = 0;

  for (const gameKey of games) {
    const game = gameDetails[gameKey];
    const venue = game.venue;

    // Skip indoor venues
    if (venue.indoor) {
      game.weather = '🏟️';
      game.temp = '72°F';
      game.conditions = 'Indoor';
      console.log(`🏟️  ${gameKey}: ${venue.name} - Indoor`);
      skipped++;
      continue;
    }

    // Get coordinates for this stadium
    const coords = STADIUM_COORDS[venue.name];

    if (!coords) {
      console.log(`⚠️  ${gameKey}: No coordinates for ${venue.name} - using defaults`);
      skipped++;
      continue;
    }

    // Fetch weather for this location
    const weather = await fetchNWSWeather(coords.lat, coords.lon, venue.name);

    if (weather) {
      game.weather = weather.emoji;
      game.temp = `${weather.temp}°F`;
      game.conditions = weather.conditions;

      console.log(`✅ ${gameKey}: ${venue.name}`);
      console.log(`   ${weather.emoji} ${weather.temp}°F - ${weather.conditions}`);
      updated++;
    } else {
      console.log(`⚠️  ${gameKey}: ${venue.name} - Weather API failed, using defaults`);
      skipped++;
    }

    // Delay 500ms between calls to be respectful to NWS API
    await delay(500);
  }

  // Save updated schedule
  scheduleData.weatherEnrichedAt = new Date().toISOString();
  fs.writeFileSync(scheduleFile, JSON.stringify(scheduleData, null, 2));

  console.log(`\n✅ Weather enrichment complete!`);
  console.log(`   Updated: ${updated} outdoor games`);
  console.log(`   Indoor: ${skipped} games`);
  console.log(`\n📝 Saved to: ${scheduleFile}\n`);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
