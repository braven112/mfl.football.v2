#!/usr/bin/env node

/**
 * Test script for NFL Data Service
 * Verifies API integration and data quality
 */

import {
  fetchNFLSchedule,
  fetchWeatherForGames,
  fetchDefensiveRankings,
  buildCompleteNFLData,
  cacheNFLData,
  loadCachedNFLData,
  getTVLogoPath
} from './nfl-data-service.mjs';

async function main() {
  console.log('🧪 Testing NFL Data Service\n');
  console.log('='.repeat(80) + '\n');

  try {
    // Test 1: Fetch NFL Schedule
    console.log('TEST 1: Fetch NFL Schedule');
    console.log('-'.repeat(80));
    const schedule = await fetchNFLSchedule(2024, 15);
    console.log(`\n📊 Sample games:`);
    schedule.games.slice(0, 3).forEach(game => {
      console.log(`  ${game.awayTeam} @ ${game.homeTeam}`);
      console.log(`    Time: ${game.day} ${game.time}`);
      console.log(`    Network: ${game.network} (Logo: ${game.networkLogo || 'N/A'})`);
      console.log(`    Venue: ${game.venue.name} (Indoor: ${game.venue.indoor})`);
      console.log('');
    });

    // Test 2: Fetch Weather
    console.log('\nTEST 2: Fetch Weather Data');
    console.log('-'.repeat(80));
    const weather = await fetchWeatherForGames(schedule.games.slice(0, 3));
    console.log(`\n🌤️  Sample weather:`);
    Object.entries(weather).forEach(([gameKey, data]) => {
      console.log(`  ${gameKey}:`);
      console.log(`    ${data.icon} ${data.temp} - ${data.conditions}`);
      if (data.indoor) console.log(`    (Indoor stadium)`);
    });

    // Test 3: Fetch Defensive Rankings
    console.log('\n\nTEST 3: Fetch Defensive Rankings');
    console.log('-'.repeat(80));
    const rankings = await fetchDefensiveRankings(2024, 15);
    console.log(`\n🛡️  Sample QB defense rankings:`);
    Object.entries(rankings.rankings.QB).slice(0, 5).forEach(([team, rank]) => {
      console.log(`  ${team}: #${rank}`);
    });

    // Test 4: Build Complete Data
    console.log('\n\nTEST 4: Build Complete NFL Data');
    console.log('-'.repeat(80));
    const completeData = await buildCompleteNFLData(2024, 15);
    console.log(`\n✅ Complete data structure:`);
    console.log(`  Year: ${completeData.year}`);
    console.log(`  Week: ${completeData.week}`);
    console.log(`  Teams in schedule: ${Object.keys(completeData.schedule).length}`);
    console.log(`  Games with details: ${Object.keys(completeData.gameDetails).length}`);
    console.log(`  Defense positions tracked: ${Object.keys(completeData.defensiveRankings).length}`);
    console.log(`  Fetched at: ${completeData.fetchedAt}`);
    console.log(`\n  Data sources:`);
    Object.entries(completeData.sources).forEach(([key, value]) => {
      console.log(`    ${key}: ${value}`);
    });

    // Test 5: Caching
    console.log('\n\nTEST 5: Cache and Load');
    console.log('-'.repeat(80));
    cacheNFLData(completeData);
    const cached = loadCachedNFLData(2024, 15);
    console.log(`  Cached data loaded: ${cached ? '✅' : '❌'}`);
    if (cached) {
      console.log(`  Cache age: ${Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000)}s`);
    }

    // Test 6: TV Logo Paths
    console.log('\n\nTEST 6: TV Logo Paths');
    console.log('-'.repeat(80));
    const networks = ['ABC', 'CBS', 'ESPN', 'FOX', 'NBC', 'Prime Video'];
    networks.forEach(network => {
      const logo = getTVLogoPath(network);
      console.log(`  ${network}: ${logo || 'Not found'}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
