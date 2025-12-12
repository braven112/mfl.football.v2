/**
 * Test script to verify team projections calculations
 */
import fs from 'node:fs';
import path from 'node:path';

// Read the data files
const rostersData = JSON.parse(
  fs.readFileSync('data/theleague/mfl-feeds/2025/rosters.json', 'utf8')
);

const projectedScoresData = JSON.parse(
  fs.readFileSync('data/theleague/mfl-feeds/2025/projectedScores.json', 'utf8')
);

const leagueConfig = JSON.parse(
  fs.readFileSync('src/data/theleague.config.json', 'utf8')
);

// Build a map of player_id -> projected score
const playerProjectionMap = new Map();
const playerScores = projectedScoresData?.projectedScores?.playerScore || [];

for (const player of playerScores) {
  if (player.id && player.score) {
    const score = parseFloat(player.score);
    if (!isNaN(score)) {
      playerProjectionMap.set(player.id, score);
    }
  }
}

// Calculate total projection for each franchise
const franchises = rostersData?.rosters?.franchise || [];
const teamProjections = [];

for (const franchise of franchises) {
  if (!franchise.id) continue;

  let totalProjection = 0;
  const players = franchise.player || [];
  let rosterCount = 0;

  for (const player of players) {
    // Only count ROSTER players
    if (player.status === 'ROSTER' && player.id) {
      const projection = playerProjectionMap.get(player.id) || 0;
      totalProjection += projection;
      if (projection > 0) rosterCount++;
    }
  }

  // Get team name from config
  const teamConfig = leagueConfig.teams.find(t => t.franchiseId === franchise.id);
  const teamName = teamConfig?.name || franchise.id;

  teamProjections.push({
    franchiseId: franchise.id,
    teamName,
    projection: totalProjection,
    playersWithProjections: rosterCount,
  });
}

// Sort by projection (highest first)
teamProjections.sort((a, b) => b.projection - a.projection);

// Display results
console.log('\n=== Week 15 Team Projections ===\n');
console.log('Rank | Team                           | Projection | Players');
console.log('-----|--------------------------------|------------|--------');

teamProjections.forEach((team, index) => {
  const rank = (index + 1).toString().padStart(2);
  const name = team.teamName.padEnd(30);
  const proj = team.projection.toFixed(2).padStart(10);
  const players = team.playersWithProjections.toString().padStart(7);
  console.log(`${rank}   | ${name} | ${proj} | ${players}`);
});

console.log('\n');

// Also print specific matchup example (Team 0013 vs 0015 from matchup-preview-example)
const team0013 = teamProjections.find(t => t.franchiseId === '0013');
const team0015 = teamProjections.find(t => t.franchiseId === '0015');

if (team0013 && team0015) {
  console.log('=== Example Matchup (from matchup-preview-example.astro) ===');
  console.log(`${team0013.teamName}: ${team0013.projection.toFixed(1)} pts (was hardcoded as 98.0)`);
  console.log(`${team0015.teamName}: ${team0015.projection.toFixed(1)} pts (was hardcoded as 113.0)`);
  console.log('');
}
