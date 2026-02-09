#!/usr/bin/env node

/**
 * Fetch relevant ESPN news articles for players in a matchup
 *
 * Usage:
 *   node scripts/fetch-player-news.mjs --week 15
 *
 * Fetches news for all NFL teams with fantasy players in the matchup
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
const week = weekIndex !== -1 ? args[weekIndex + 1] : '15';

// ESPN team ID mapping (ESPN uses different IDs than NFL codes)
const ESPN_TEAM_IDS = {
  'ARI': 22, 'ATL': 1, 'BAL': 33, 'BUF': 2, 'CAR': 29, 'CHI': 3,
  'CIN': 4, 'CLE': 5, 'DAL': 6, 'DEN': 7, 'DET': 8, 'GB': 9,
  'HOU': 34, 'IND': 11, 'JAX': 30, 'KC': 12, 'LV': 13, 'LAC': 24,
  'LAR': 14, 'MIA': 15, 'MIN': 16, 'NE': 17, 'NO': 18, 'NYG': 19,
  'NYJ': 20, 'PHI': 21, 'PIT': 23, 'SF': 25, 'SEA': 26, 'TB': 27,
  'TEN': 10, 'WSH': 28
};

/**
 * Normalize team codes
 */
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
 * Fetch news for a specific NFL team
 */
async function fetchTeamNews(teamCode) {
  const espnTeamId = ESPN_TEAM_IDS[teamCode];
  if (!espnTeamId) {
    console.warn(`⚠️  No ESPN team ID for ${teamCode}`);
    return [];
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${espnTeamId}`;
    console.log(`📰 Fetching news for ${teamCode} (ESPN ID: ${espnTeamId})...`);

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`⚠️  Failed to fetch news for ${teamCode}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const articles = data.articles || [];

    // Get top 3 most recent articles
    return articles.slice(0, 3).map(article => ({
      headline: article.headline || '',
      description: article.description || '',
      published: article.published || '',
      link: article.links?.web?.href || '',
      images: article.images?.[0]?.url || '',
      type: article.type || 'Story'
    }));
  } catch (error) {
    console.warn(`⚠️  Error fetching news for ${teamCode}:`, error.message);
    return [];
  }
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function
 */
async function main() {
  console.log(`\n📰 NFL News Fetcher\n`);

  // Load roster data to determine which teams have fantasy players
  const rostersPath = path.join(root, 'data/theleague/mfl-feeds/2025/rosters.json');
  const playersPath = path.join(root, 'data/theleague/mfl-feeds/2025/players.json');

  if (!fs.existsSync(rostersPath) || !fs.existsSync(playersPath)) {
    console.error('❌ Missing roster or player data');
    process.exit(1);
  }

  const rosters = JSON.parse(fs.readFileSync(rostersPath, 'utf-8'));
  const players = JSON.parse(fs.readFileSync(playersPath, 'utf-8'));

  // Get teams 0013 and 0015
  const homeTeamId = '0013';
  const awayTeamId = '0015';

  const homeRoster = rosters.rosters.franchise.find(f => f.id === homeTeamId);
  const awayRoster = rosters.rosters.franchise.find(f => f.id === awayTeamId);

  // Build player map
  const playerMap = new Map();
  const playersList = Array.isArray(players.players.player)
    ? players.players.player
    : [players.players.player];
  playersList.forEach(p => playerMap.set(p.id, p));

  // Get all NFL teams for players
  const nflTeams = new Set();

  const homePlayers = Array.isArray(homeRoster.player) ? homeRoster.player : [homeRoster.player];
  const awayPlayers = Array.isArray(awayRoster.player) ? awayRoster.player : [awayRoster.player];

  homePlayers.forEach(p => {
    const player = playerMap.get(p.id);
    if (player) nflTeams.add(normalizeTeamCode(player.team));
  });

  awayPlayers.forEach(p => {
    const player = playerMap.get(p.id);
    if (player) nflTeams.add(normalizeTeamCode(player.team));
  });

  console.log(`📊 Found ${nflTeams.size} NFL teams with fantasy players\n`);

  // Fetch news for each team
  const newsData = {};
  let count = 0;

  for (const team of Array.from(nflTeams).sort()) {
    const articles = await fetchTeamNews(team);

    if (articles.length > 0) {
      newsData[team] = articles;
      console.log(`   ✅ ${team}: ${articles.length} articles`);
      count += articles.length;
    } else {
      console.log(`   ⚠️  ${team}: No articles`);
    }

    // Delay between requests to be respectful
    await delay(300);
  }

  // Save to file
  const outputPath = path.join(root, `data/theleague/nfl-news-week${week}.json`);
  const output = {
    week: parseInt(week),
    fetchedAt: new Date().toISOString(),
    source: 'ESPN News API',
    teams: newsData,
    totalArticles: count
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✅ Fetched ${count} news articles for ${Object.keys(newsData).length} teams`);
  console.log(`💾 Saved to: ${outputPath}\n`);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
