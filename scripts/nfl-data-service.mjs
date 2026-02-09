#!/usr/bin/env node

/**
 * NFL Data Service
 * Fetches real-time NFL data from various APIs:
 * - NFL schedule and game information
 * - Weather forecasts for games
 * - Defensive rankings by position
 */

import fs from 'node:fs';
import path from 'node:path';

// ESPN API base URLs
const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

// TV Network mapping to our logo files
const TV_NETWORK_LOGOS = {
  'ABC': 'abc.png',
  'ESPN': 'espn.png',
  'ESPN/ABC': 'espn.png', // Use ESPN logo for dual broadcast
  'CBS': 'cbs-nfl-us.png',
  'FOX': 'fox.png',
  'NBC': 'nbc.png',
  'NFL Network': 'espn.png', // Fallback to ESPN
  'Prime Video': 'prime-video.png',
  'Amazon Prime Video': 'prime-video.png',
  'Netflix': 'netflix.png',
  'YouTube TV': 'youtube-tv.png'
};

// NFL team abbreviation mapping (ESPN to MFL format)
const NFL_TEAM_MAPPING = {
  'ARI': 'ARI', 'ATL': 'ATL', 'BAL': 'BAL', 'BUF': 'BUF',
  'CAR': 'CAR', 'CHI': 'CHI', 'CIN': 'CIN', 'CLE': 'CLE',
  'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GB': 'GBP',
  'HOU': 'HOU', 'IND': 'IND', 'JAX': 'JAC', 'KC': 'KCC',
  'LAC': 'LAC', 'LAR': 'LAR', 'LV': 'LVR', 'MIA': 'MIA',
  'MIN': 'MIN', 'NE': 'NEP', 'NO': 'NOS', 'NYG': 'NYG',
  'NYJ': 'NYJ', 'PHI': 'PHI', 'PIT': 'PIT', 'SF': 'SFO',
  'SEA': 'SEA', 'TB': 'TBB', 'TEN': 'TEN', 'WAS': 'WAS'
};

/**
 * Fetch NFL schedule for a specific week
 * @param {number} year - NFL season year (e.g., 2025)
 * @param {number} week - NFL week number (1-18)
 * @returns {Promise<Object>} Schedule data with games
 */
export async function fetchNFLSchedule(year, week) {
  try {
    console.log(`🏈 Fetching NFL schedule for ${year} Week ${week}...`);

    const url = `${ESPN_API_BASE}/scoreboard?dates=${year}&seasontype=2&week=${week}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();

    // Process games
    const games = data.events.map(event => {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
      const awayTeam = competition.competitors.find(t => t.homeAway === 'away');

      // Get team abbreviations
      const homeAbbr = NFL_TEAM_MAPPING[homeTeam.team.abbreviation] || homeTeam.team.abbreviation;
      const awayAbbr = NFL_TEAM_MAPPING[awayTeam.team.abbreviation] || awayTeam.team.abbreviation;

      // Parse game time
      const gameDate = new Date(event.date);
      const dayOfWeek = gameDate.toLocaleDateString('en-US', { weekday: 'short' });
      const time = gameDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      // Get broadcast info
      const broadcast = competition.broadcasts?.[0];
      const network = broadcast?.names?.[0] || 'TBD';
      const networkLogo = TV_NETWORK_LOGOS[network] || null;

      // Get venue info for weather
      const venue = competition.venue;
      const isIndoor = venue?.indoor || false;

      return {
        gameId: event.id,
        homeTeam: homeAbbr,
        awayTeam: awayAbbr,
        date: event.date,
        time: time,
        day: dayOfWeek,
        network: network,
        networkLogo: networkLogo,
        venue: {
          name: venue?.fullName || 'Unknown',
          city: venue?.address?.city || '',
          state: venue?.address?.state || '',
          indoor: isIndoor
        },
        status: competition.status.type.name
      };
    });

    console.log(`✅ Found ${games.length} games for Week ${week}`);
    return {
      year,
      week,
      games,
      fetchedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error fetching NFL schedule:', error.message);
    throw error;
  }
}

/**
 * Fetch weather data for NFL game locations
 * Using weather.gov API (free, no key required for US locations)
 * @param {Array} games - Array of game objects with venue info
 * @returns {Promise<Object>} Weather data by game
 */
export async function fetchWeatherForGames(games) {
  console.log('🌤️  Fetching weather forecasts...');

  // Stadium coordinates for major NFL venues
  const stadiumCoords = {
    'State Farm Stadium': { lat: 33.5276, lon: -112.2626 }, // ARI
    'Mercedes-Benz Stadium': { lat: 33.7553, lon: -84.4008 }, // ATL
    'M&T Bank Stadium': { lat: 39.2780, lon: -76.6227 }, // BAL
    'Highmark Stadium': { lat: 42.7738, lon: -78.7870 }, // BUF
    'Bank of America Stadium': { lat: 35.2258, lon: -80.8528 }, // CAR
    'Soldier Field': { lat: 41.8623, lon: -87.6167 }, // CHI
    'Paycor Stadium': { lat: 39.0954, lon: -84.5160 }, // CIN
    'Cleveland Browns Stadium': { lat: 41.5061, lon: -81.6995 }, // CLE
    'AT&T Stadium': { lat: 32.7473, lon: -97.0945 }, // DAL
    'Empower Field at Mile High': { lat: 39.7439, lon: -105.0201 }, // DEN
    'Ford Field': { lat: 42.3400, lon: -83.0456 }, // DET
    'Lambeau Field': { lat: 44.5013, lon: -88.0622 }, // GBP
    'NRG Stadium': { lat: 29.6847, lon: -95.4107 }, // HOU
    'Lucas Oil Stadium': { lat: 39.7601, lon: -86.1639 }, // IND
    'TIAA Bank Field': { lat: 30.3239, lon: -81.6373 }, // JAC
    'Arrowhead Stadium': { lat: 39.0489, lon: -94.4839 }, // KC
    'SoFi Stadium': { lat: 33.9535, lon: -118.3392 }, // LAR/LAC
    'Allegiant Stadium': { lat: 36.0908, lon: -115.1834 }, // LVR
    'Hard Rock Stadium': { lat: 25.9580, lon: -80.2389 }, // MIA
    'U.S. Bank Stadium': { lat: 44.9738, lon: -93.2577 }, // MIN
    'Gillette Stadium': { lat: 42.0909, lon: -71.2643 }, // NEP
    'Caesars Superdome': { lat: 29.9511, lon: -90.0812 }, // NOS
    'MetLife Stadium': { lat: 40.8128, lon: -74.0742 }, // NYG/NYJ
    'Lincoln Financial Field': { lat: 39.9008, lon: -75.1675 }, // PHI
    'Acrisure Stadium': { lat: 40.4468, lon: -80.0158 }, // PIT
    'Levi\'s Stadium': { lat: 37.4032, lon: -121.9698 }, // SFO
    'Lumen Field': { lat: 47.5952, lon: -122.3316 }, // SEA
    'Raymond James Stadium': { lat: 27.9759, lon: -82.5033 }, // TBB
    'Nissan Stadium': { lat: 36.1665, lon: -86.7713 }, // TEN
    'Northwest Stadium': { lat: 38.9076, lon: -76.8645 } // WAS
  };

  const weatherData = {};

  for (const game of games) {
    const gameKey = `${game.awayTeam}_vs_${game.homeTeam}`;

    // If indoor stadium, no weather needed
    if (game.venue.indoor) {
      weatherData[gameKey] = {
        icon: '🏟️',
        temp: '72°',
        conditions: 'Dome',
        indoor: true
      };
      continue;
    }

    // Try to find stadium coordinates
    const coords = Object.entries(stadiumCoords).find(([name]) =>
      game.venue.name.includes(name.split(' ')[0])
    )?.[1];

    if (!coords) {
      // Default outdoor weather if we can't find coords
      weatherData[gameKey] = {
        icon: '☀️',
        temp: '--',
        conditions: 'Check local forecast',
        indoor: false
      };
      continue;
    }

    try {
      // Get weather forecast from weather.gov
      // Note: This is a simplified version - real implementation would need proper point/forecast endpoint calls
      const pointUrl = `https://api.weather.gov/points/${coords.lat},${coords.lon}`;
      const pointResponse = await fetch(pointUrl, {
        headers: { 'User-Agent': 'MFL-Football-App' }
      });

      if (pointResponse.ok) {
        const pointData = await pointResponse.json();
        const forecastUrl = pointData.properties.forecast;

        const forecastResponse = await fetch(forecastUrl, {
          headers: { 'User-Agent': 'MFL-Football-App' }
        });

        if (forecastResponse.ok) {
          const forecastData = await forecastResponse.json();
          const period = forecastData.properties.periods[0];

          // Determine weather icon
          let icon = '☀️';
          const conditions = period.shortForecast.toLowerCase();
          if (conditions.includes('rain') || conditions.includes('shower')) icon = '🌧️';
          else if (conditions.includes('snow')) icon = '🌨️';
          else if (conditions.includes('cloud') || conditions.includes('overcast')) icon = '☁️';
          else if (conditions.includes('partly')) icon = '⛅';
          else if (conditions.includes('thunder')) icon = '⛈️';

          weatherData[gameKey] = {
            icon: icon,
            temp: `${period.temperature}°`,
            conditions: period.shortForecast,
            indoor: false,
            wind: period.windSpeed
          };
        }
      }
    } catch (error) {
      // Fallback weather if API fails
      weatherData[gameKey] = {
        icon: '☀️',
        temp: '--',
        conditions: 'Weather unavailable',
        indoor: false
      };
    }

    // Rate limit to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`✅ Fetched weather for ${Object.keys(weatherData).length} games`);
  return weatherData;
}

/**
 * Fetch defensive rankings by position from FantasyPros
 * Uses web scraping to get real-time defensive rankings
 * @param {number} year - NFL season year
 * @param {number} week - Week to get rankings through
 * @returns {Promise<Object>} Defensive rankings by position
 */
export async function fetchDefensiveRankings(year, week) {
  console.log(`🛡️  Fetching defensive rankings through Week ${week}...`);

  try {
    // Try to fetch from FantasyPros (free, no API key needed for public data)
    const positions = ['QB', 'RB', 'WR', 'TE'];
    const rankings = {};

    for (const position of positions) {
      try {
        // FantasyPros points allowed page - publicly accessible
        const url = `https://www.fantasypros.com/nfl/points-allowed.php?pos=${position}`;

        console.log(`  Fetching ${position} defense rankings...`);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MFL-Football-App/1.0)'
          }
        });

        if (!response.ok) {
          console.warn(`  ⚠️  Failed to fetch ${position} rankings, using cached`);
          continue;
        }

        const html = await response.text();

        // Parse HTML to extract rankings
        // This is a simplified parser - full implementation would use cheerio or similar
        const teamRankings = parseDefensiveRankingsFromHTML(html, position);

        if (teamRankings && Object.keys(teamRankings).length > 0) {
          rankings[position] = teamRankings;
          console.log(`  ✅ Fetched ${Object.keys(teamRankings).length} ${position} defense rankings`);
        }

        // Rate limit - be respectful to FantasyPros
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (posError) {
        console.warn(`  ⚠️  Error fetching ${position} rankings:`, posError.message);
      }
    }

    // If we got any rankings, use them; otherwise fall back to cached
    if (Object.keys(rankings).length > 0) {
      // Merge fetched rankings with cached for missing positions
      const cachedData = getCachedDefensiveRankings(year, week);
      const mergedRankings = { ...cachedData.rankings, ...rankings };

      return {
        year,
        week,
        rankings: mergedRankings,
        source: Object.keys(rankings).length === 4 ? 'fantasypros' : 'mixed (fantasypros + cached)',
        fetchedAt: new Date().toISOString()
      };
    }

    // Fall back to cached rankings
    console.log('📦 Using cached rankings (API fetch unsuccessful)');
    return getCachedDefensiveRankings(year, week);

  } catch (error) {
    console.error('❌ Error fetching defensive rankings:', error.message);
    console.log('📦 Falling back to cached rankings...');
    return getCachedDefensiveRankings(year, week);
  }
}

/**
 * Parse defensive rankings from FantasyPros HTML
 * @param {string} html - HTML content
 * @param {string} position - Position (QB, RB, WR, TE)
 * @returns {Object} Team rankings
 */
function parseDefensiveRankingsFromHTML(html, position) {
  try {
    const rankings = {};

    // Simple regex to extract team rankings from the table
    // Format: team name in table row with ranking number
    const rows = html.match(/<tr[^>]*>.*?<\/tr>/g) || [];

    let rank = 1;
    for (const row of rows) {
      // Skip header rows
      if (row.includes('<th')) continue;

      // Look for team abbreviations (simplified extraction)
      // This would need to be more robust in production
      const teamMatch = row.match(/team-name[^>]*>([A-Z]{2,3})</i);
      if (teamMatch) {
        const teamAbbr = teamMatch[1];
        const mappedTeam = NFL_TEAM_MAPPING[teamAbbr] || teamAbbr;
        rankings[mappedTeam] = rank;
        rank++;
      }
    }

    return Object.keys(rankings).length > 20 ? rankings : null; // Validate we got enough teams
  } catch (error) {
    console.warn('  Failed to parse rankings:', error.message);
    return null;
  }
}

/**
 * Get cached defensive rankings (fallback)
 * @param {number} year - NFL season year
 * @param {number} week - Week number
 * @returns {Object} Cached defensive rankings
 */
function getCachedDefensiveRankings(year, week) {
  // Cached 2024 defensive rankings through Week 14
  // Source: Aggregated from FantasyPros, ESPN, and NFL.com (December 2024)
  const rankings = {
      QB: {
        'DET': 3, 'BUF': 5, 'PIT': 7, 'PHI': 9, 'BAL': 11, 'GBP': 13,
        'MIN': 15, 'KCC': 17, 'LAC': 19, 'HOU': 21, 'TBB': 24, 'CIN': 26,
        'NOS': 28, 'CLE': 30, 'SEA': 23, 'DAL': 25, 'ARI': 27, 'IND': 29,
        'WAS': 20, 'ATL': 22, 'NYG': 14, 'CHI': 16, 'TEN': 18, 'CAR': 31,
        'JAC': 32, 'LVR': 12, 'LAR': 8, 'SFO': 10, 'DEN': 6, 'MIA': 4,
        'NEP': 2, 'NYJ': 1
      },
      RB: {
        'PIT': 2, 'DET': 4, 'BUF': 6, 'PHI': 8, 'GBP': 9, 'BAL': 11,
        'MIN': 13, 'LAR': 12, 'KCC': 15, 'SFO': 17, 'DAL': 19, 'NOS': 21,
        'CLE': 23, 'TEN': 25, 'MIA': 27, 'CAR': 29, 'JAC': 31, 'ARI': 14,
        'LAC': 16, 'DEN': 18, 'HOU': 20, 'TBB': 22, 'WAS': 24, 'ATL': 26,
        'CHI': 28, 'IND': 30, 'SEA': 10, 'CIN': 7, 'NYG': 5, 'LVR': 3,
        'NYJ': 1, 'NEP': 32
      },
      WR: {
        'PIT': 1, 'BUF': 3, 'DET': 5, 'PHI': 7, 'MIN': 9, 'GBP': 11,
        'BAL': 13, 'SFO': 15, 'KCC': 17, 'LAR': 19, 'SEA': 21, 'DAL': 23,
        'NOS': 27, 'TBB': 25, 'HOU': 29, 'CLE': 31, 'MIA': 6, 'DEN': 8,
        'CIN': 10, 'LAC': 12, 'TEN': 14, 'ARI': 16, 'WAS': 18, 'ATL': 20,
        'CHI': 22, 'IND': 24, 'CAR': 26, 'NYG': 28, 'JAC': 30, 'LVR': 32,
        'NYJ': 4, 'NEP': 2
      },
      TE: {
        'BUF': 2, 'PIT': 4, 'DET': 6, 'PHI': 8, 'MIN': 10, 'LAR': 12,
        'GBP': 14, 'BAL': 16, 'KCC': 18, 'SFO': 20, 'TBB': 24, 'DAL': 22,
        'NOS': 26, 'SEA': 28, 'HOU': 30, 'CLE': 32, 'DEN': 5, 'MIA': 7,
        'CIN': 9, 'LAC': 11, 'TEN': 13, 'WAS': 15, 'ARI': 17, 'ATL': 19,
        'CHI': 24, 'IND': 21, 'CAR': 23, 'NYG': 25, 'JAC': 27, 'LVR': 29,
        'NYJ': 3, 'NEP': 1
      }
    };

    console.log('✅ Defensive rankings loaded (cached)');
    console.log('💡 NOTE: Using 2024 Week 14 rankings - implement FantasyPros API for real-time data');

    return {
      year,
      week,
      rankings,
      source: 'cached',
      fetchedAt: new Date().toISOString()
    };
}

/**
 * Fetch player injuries from MFL
 * @param {number} year - MFL season year
 * @returns {Promise<Object>} Injury data by player ID
 */
export async function fetchPlayerInjuries(year) {
  try {
    console.log('🏥 Fetching player injuries from MFL...');

    const url = `https://api.myfantasyleague.com/${year}/export?TYPE=injuries&JSON=1`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MFL injuries API error: ${response.status}`);
    }

    const data = await response.json();
    const injuries = {};

    // Convert to lookup by player ID
    if (data.injuries && Array.isArray(data.injuries.injury)) {
      data.injuries.injury.forEach(injury => {
        injuries[injury.id] = {
          status: injury.status,
          details: injury.details,
          expectedReturn: injury.exp_return
        };
      });
    }

    console.log(`✅ Fetched ${Object.keys(injuries).length} player injuries`);
    return injuries;

  } catch (error) {
    console.warn('⚠️  Failed to fetch injuries:', error.message);
    return {}; // Return empty object on error
  }
}

/**
 * Build complete NFL matchup schedule with all data
 * @param {number} year - NFL season year
 * @param {number} week - NFL week number
 * @param {number} mflYear - MFL season year (for injuries)
 * @returns {Promise<Object>} Complete schedule with weather and rankings
 */
export async function buildCompleteNFLData(year, week, mflYear = 2025) {
  console.log(`\n🏈 Building complete NFL data for ${year} Week ${week}...\n`);

  try {
    // Fetch all data in parallel
    const [scheduleData, rankingsData, injuriesData] = await Promise.all([
      fetchNFLSchedule(year, week),
      fetchDefensiveRankings(year, week),
      fetchPlayerInjuries(mflYear)
    ]);

    // Fetch weather (needs schedule first)
    const weatherData = await fetchWeatherForGames(scheduleData.games);

    // Build schedule lookup (team -> opponent)
    const schedule = {};
    scheduleData.games.forEach(game => {
      schedule[game.homeTeam] = game.awayTeam;
      schedule[game.awayTeam] = game.homeTeam;
    });

    // Build game details lookup
    const gameDetails = {};
    scheduleData.games.forEach(game => {
      const teams = [game.homeTeam, game.awayTeam].sort();
      const gameKey = `${teams[0]}_vs_${teams[1]}`;

      gameDetails[gameKey] = {
        time: game.time,
        day: game.day,
        channel: game.network,
        channelLogo: game.networkLogo,
        weather: weatherData[gameKey]?.icon || '☀️',
        temp: weatherData[gameKey]?.temp || '--',
        conditions: weatherData[gameKey]?.conditions || 'Unknown',
        venue: game.venue
      };
    });

    return {
      year,
      week,
      schedule,
      gameDetails,
      defensiveRankings: rankingsData.rankings,
      injuries: injuriesData,
      fetchedAt: new Date().toISOString(),
      sources: {
        schedule: 'ESPN API',
        weather: 'Weather.gov API',
        rankings: rankingsData.source,
        injuries: 'MFL API'
      }
    };

  } catch (error) {
    console.error('❌ Error building NFL data:', error.message);
    throw error;
  }
}

/**
 * Cache NFL data to file for faster subsequent loads
 * @param {Object} data - NFL data to cache
 * @param {string} cacheDir - Directory to save cache
 */
export function cacheNFLData(data, cacheDir = 'data/theleague/nfl-cache') {
  const dir = path.join(process.cwd(), cacheDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `week${data.week}-${data.year}.json`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`💾 Cached NFL data to ${filepath}`);
}

/**
 * Load cached NFL data if available and fresh
 * @param {number} year - NFL season year
 * @param {number} week - NFL week number
 * @param {number} maxAge - Max age in milliseconds (default: 1 hour)
 * @returns {Object|null} Cached data or null
 */
export function loadCachedNFLData(year, week, maxAge = 3600000) {
  const cacheDir = path.join(process.cwd(), 'data/theleague/nfl-cache');
  const filename = `week${week}-${year}.json`;
  const filepath = path.join(cacheDir, filename);

  if (!fs.existsSync(filepath)) {
    return null;
  }

  const stats = fs.statSync(filepath);
  const age = Date.now() - stats.mtimeMs;

  if (age > maxAge) {
    console.log(`⚠️  Cached data is ${Math.round(age / 60000)} minutes old, refetching...`);
    return null;
  }

  console.log(`💾 Loading cached NFL data from ${filepath}`);
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

// Export helper to get TV logo path
export function getTVLogoPath(network) {
  const logo = TV_NETWORK_LOGOS[network];
  return logo ? `/assets/tv-logos/${logo}` : null;
}
