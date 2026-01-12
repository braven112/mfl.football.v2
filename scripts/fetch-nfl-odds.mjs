
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '../src/data/nfl/live-odds.json');

async function fetchOdds() {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const data = await response.json();
    
    const games = {};
    
    // Process each game
    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      const homeTeam = competition.competitors.find(c => c.homeAway === 'home')?.team?.abbreviation;
      const awayTeam = competition.competitors.find(c => c.homeAway === 'away')?.team?.abbreviation;
      
      if (!homeTeam || !awayTeam) continue;
      
      const odds = competition.odds?.[0];
      const weather = event.weather;
      
      const gameData = {
        id: event.id,
        date: event.date,
        homeTeam: normalizeTeam(homeTeam),
        awayTeam: normalizeTeam(awayTeam),
        status: event.status?.type?.shortDetail,
        spread: odds?.details || 'N/A',
        overUnder: odds?.overUnder || 'N/A',
        homeScore: competition.competitors.find(c => c.homeAway === 'home')?.score || '0',
        awayScore: competition.competitors.find(c => c.homeAway === 'away')?.score || '0',
        weather: weather ? {
          temperature: weather.temperature,
          displayValue: weather.displayValue,
          conditionId: weather.conditionId
        } : null
      };
      
      // Store by team abbreviation for easy lookup
      games[gameData.homeTeam] = { ...gameData, isHome: true, opponent: gameData.awayTeam };
      games[gameData.awayTeam] = { ...gameData, isHome: false, opponent: gameData.homeTeam };
    }
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(games, null, 2));
    console.log(`Successfully saved NFL odds to ${OUTPUT_PATH}`);
    
  } catch (error) {
    console.error('Error fetching NFL odds:', error);
    process.exit(1);
  }
}

function normalizeTeam(abv) {
  const map = {
    'WSH': 'WAS',
    // ESPN uses LAR, JAX, etc. which match our logo filenames (LAR.svg, JAX.svg)
    // and our internal normalization in rosters.astro.
    // So we only need to fix WSH -> WAS.
  };
  return map[abv] || abv;
}

fetchOdds();
