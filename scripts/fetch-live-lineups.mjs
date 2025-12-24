#!/usr/bin/env node

/**
 * Fetch live starting lineups from MFL API for build-time data
 * 
 * This script runs during build to ensure we have the latest starting lineups
 * for accurate matchup previews and injury status detection.
 * 
 * Usage:
 *   node scripts/fetch-live-lineups.mjs
 * 
 * Env:
 *   MFL_LEAGUE_ID - MFL league ID (default: 13522)
 *   MFL_YEAR - Season year (default: 2025)
 *   CURRENT_WEEK - Current NFL week (default: 15)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const leagueId = process.env.MFL_LEAGUE_ID || '13522';
const year = process.env.MFL_YEAR || '2025';
const currentWeek = process.env.CURRENT_WEEK || '15';

/**
 * Fetch starting lineups from MFL API
 */
async function fetchLiveStartingLineups() {
  try {
    console.log(`🔄 Fetching live starting lineups for Week ${currentWeek}...`);

    // Use weeklyResults endpoint which includes starting lineup data
    // League 13522 is on server 49
    const baseUrl = 'https://www49.myfantasyleague.com';
    const url = `${baseUrl}/${year}/export?TYPE=weeklyResults&L=${leagueId}&W=${currentWeek}&JSON=1`;

    console.log(`📡 Calling MFL API: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MFL API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Debug: Log the actual API response structure
    console.log('🔍 MFL API Response structure:', {
      keys: Object.keys(data),
      hasWeeklyResults: !!data.weeklyResults,
      hasMatchup: !!data.weeklyResults?.matchup,
      dataType: typeof data,
      sampleData: JSON.stringify(data).substring(0, 200) + '...'
    });

    // Process starting lineup data from weeklyResults
    const startingLineups = new Map();
    let totalStarters = 0;
    let totalFranchises = 0;

    if (data.weeklyResults?.matchup) {
      const matchups = Array.isArray(data.weeklyResults.matchup)
        ? data.weeklyResults.matchup
        : [data.weeklyResults.matchup];

      matchups.forEach(matchup => {
        const franchises = Array.isArray(matchup.franchise)
          ? matchup.franchise
          : [matchup.franchise];

        franchises.forEach(franchise => {
          totalFranchises++;
          if (franchise.player) {
            const players = Array.isArray(franchise.player)
              ? franchise.player
              : [franchise.player];

            players.forEach(player => {
              if (player.status === 'starter') {
                totalStarters++;
                startingLineups.set(player.id, {
                  isStarting: true,
                  franchiseId: franchise.id,
                  week: parseInt(currentWeek)
                });
              } else if (player.status === 'nonstarter') {
                startingLineups.set(player.id, {
                  isStarting: false,
                  franchiseId: franchise.id,
                  week: parseInt(currentWeek)
                });
              }
            });
          }
        });
      });
    }
    
    console.log(`✅ Processed ${totalFranchises} franchises with ${totalStarters} total starters`);
    
    // Convert Map to object for JSON serialization
    const lineupsObject = {};
    startingLineups.forEach((value, key) => {
      lineupsObject[key] = value;
    });
    
    // Save to data file
    const outputPath = path.join(root, `data/theleague/live-starting-lineups-week-${currentWeek}.json`);
    const outputData = {
      generatedAt: new Date().toISOString(),
      week: parseInt(currentWeek),
      year: parseInt(year),
      leagueId,
      totalStarters,
      totalFranchises,
      lineups: lineupsObject
    };
    
    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`💾 Saved live starting lineups to ${outputPath}`);
    console.log(`📊 Summary: ${totalStarters} starters across ${totalFranchises} teams`);
    
    return outputData;
    
  } catch (error) {
    console.error('❌ Failed to fetch live starting lineups:', error);
    
    // Create fallback data structure
    const fallbackPath = path.join(root, `data/theleague/live-starting-lineups-week-${currentWeek}.json`);
    const fallbackData = {
      generatedAt: new Date().toISOString(),
      week: parseInt(currentWeek),
      year: parseInt(year),
      leagueId,
      error: error.message,
      totalStarters: 0,
      totalFranchises: 0,
      lineups: {}
    };
    
    fs.writeFileSync(fallbackPath, JSON.stringify(fallbackData, null, 2));
    console.log(`⚠️  Created fallback file: ${fallbackPath}`);
    
    throw error;
  }
}

/**
 * Fetch injury data from MFL API
 */
async function fetchLiveInjuryData() {
  try {
    console.log(`🔄 Fetching live injury data...`);

    // Use api.myfantasyleague.com for injuries endpoint (no league ID needed)
    const baseUrl = 'https://api.myfantasyleague.com';
    const url = `${baseUrl}/${year}/export?TYPE=injuries&JSON=1`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MFL API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();

    // Process injury data from MFL injuries API
    const injuryData = {};
    let injuredPlayers = 0;

    if (data.injuries?.injury) {
      const injuries = Array.isArray(data.injuries.injury)
        ? data.injuries.injury
        : [data.injuries.injury];

      injuries.forEach(injury => {
        if (injury.id && injury.status) {
          injuredPlayers++;
          injuryData[injury.id] = {
            injuryStatus: normalizeInjuryStatus(injury.status),
            injuryBodyPart: injury.details || '',
            expectedReturn: injury.exp_return || ''
          };

          // Debug: Log Geno Smith specifically
          if (injury.id === '11150') {
            console.log(`🔍 Found Geno Smith injury data:`, {
              id: injury.id,
              status: injury.status,
              details: injury.details,
              normalized: normalizeInjuryStatus(injury.status)
            });
          }
        }
      });
    }
    
    console.log(`✅ Found ${injuredPlayers} players with injury status`);
    
    // Save injury data
    const outputPath = path.join(root, `data/theleague/live-injury-data-week-${currentWeek}.json`);
    const outputData = {
      generatedAt: new Date().toISOString(),
      week: parseInt(currentWeek),
      year: parseInt(year),
      leagueId,
      injuredPlayers,
      injuries: injuryData
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`💾 Saved live injury data to ${outputPath}`);
    
    return outputData;
    
  } catch (error) {
    console.error('❌ Failed to fetch live injury data:', error);
    return { injuries: {} };
  }
}

/**
 * Normalize injury status (same logic as TypeScript client)
 */
function normalizeInjuryStatus(status) {
  if (!status) return 'Healthy';

  const normalized = status.toLowerCase().trim();

  // Handle IR variants (IR-PUP, IR-R, IR-NFI, etc.)
  if (normalized.startsWith('ir-') || normalized.startsWith('ir ')) {
    return 'IR';
  }

  switch (normalized) {
    case 'out':
    case 'o':
      return 'Out';
    case 'doubtful':
    case 'd':
      return 'Doubtful';
    case 'questionable':
    case 'q':
      return 'Questionable';
    case 'ir':
    case 'injured reserve':
      return 'IR';
    case 'suspended':
      return 'Suspended';
    case 'retired':
      return 'Retired';
    case 'holdout':
      return 'Holdout';
    default:
      return 'Healthy';
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`\n🏈 Fetching live MFL data for Week ${currentWeek}...`);
  console.log(`   League: ${leagueId} (${year})\n`);
  
  try {
    // Fetch both starting lineups and injury data
    const [lineupData, injuryData] = await Promise.all([
      fetchLiveStartingLineups(),
      fetchLiveInjuryData()
    ]);
    
    console.log(`\n✅ Successfully fetched live MFL data:`);
    console.log(`   📋 Starting lineups: ${lineupData.totalStarters} starters`);
    console.log(`   🏥 Injury data: ${injuryData.injuredPlayers} injured players`);
    console.log(`   📅 Week: ${currentWeek} (${year})\n`);
    
  } catch (error) {
    console.error(`\n❌ Failed to fetch live MFL data:`, error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { fetchLiveStartingLineups, fetchLiveInjuryData };