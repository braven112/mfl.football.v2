#!/usr/bin/env node
/**
 * Fetch historical auction data from 2020-2025
 *
 * This script fetches auctionResults and transactions for each year to build
 * a comprehensive historical database for auction price prediction.
 *
 * Caching strategy:
 * - Historical years (< current year): Cached permanently once fetched
 * - Use --force flag to override and refetch
 *
 * Usage:
 *   node scripts/fetch-historical-auctions.mjs [--force]
 *
 * Environment variables:
 *   MFL_LEAGUE_ID (required) - e.g., 13522
 *   MFL_APIKEY (optional) - MFL API key for authenticated requests
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const getNonEmpty = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const leagueId = getNonEmpty(process.env.MFL_LEAGUE_ID) || '13522';
const force = process.argv.includes('--force');

// Determine league name for output directory
const leagueName = leagueId === '19621' ? 'afl-fantasy' : 'theleague';

// Years to fetch (2020-2025)
const HISTORICAL_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const currentYear = new Date().getFullYear();

console.log('📊 Fetching Historical Auction Data (2020-2025)');
console.log('===============================================');
console.log(`League ID: ${leagueId}`);
console.log(`League: ${leagueName}`);
console.log(`Force refetch: ${force ? 'YES' : 'NO'}`);
console.log('');

/**
 * Check if auction data exists for a given year
 */
const hasAuctionData = (year) => {
  const auctionFile = path.join('data', leagueName, 'mfl-feeds', year.toString(), 'auctionResults.json');

  if (!fs.existsSync(auctionFile)) {
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(auctionFile, 'utf8'));
    // Check if data looks valid (has some structure)
    return data && typeof data === 'object';
  } catch (err) {
    console.warn(`⚠️  Invalid auction data for ${year}:`, err.message);
    return false;
  }
};

/**
 * Fetch data for a specific year
 */
const fetchYear = (year) => {
  const isHistorical = year < currentYear;
  const hasData = hasAuctionData(year);

  if (!force && isHistorical && hasData) {
    console.log(`✅ ${year}: Auction data already cached (use --force to refetch)`);
    return true;
  }

  console.log(`📥 ${year}: Fetching auction data...`);

  try {
    // Use the existing fetch-mfl-feeds.mjs script with MFL_YEAR env var
    const env = {
      ...process.env,
      MFL_LEAGUE_ID: leagueId,
      MFL_YEAR: year.toString(),
    };

    // Add --force flag if specified
    const forceFlag = force ? '--force' : '';

    execSync(`node scripts/fetch-mfl-feeds.mjs ${forceFlag}`, {
      env,
      stdio: 'inherit',
    });

    console.log(`✅ ${year}: Successfully fetched`);
    return true;
  } catch (error) {
    console.error(`❌ ${year}: Failed to fetch -`, error.message);
    return false;
  }
};

/**
 * Main execution
 */
const main = async () => {
  const results = {
    success: [],
    skipped: [],
    failed: [],
  };

  for (const year of HISTORICAL_YEARS) {
    const isHistorical = year < currentYear;
    const hasData = hasAuctionData(year);

    if (!force && isHistorical && hasData) {
      results.skipped.push(year);
      console.log(`⏭️  ${year}: Skipping (already cached)`);
      console.log('');
      continue;
    }

    const success = fetchYear(year);
    console.log('');

    if (success) {
      results.success.push(year);
    } else {
      results.failed.push(year);
    }
  }

  // Summary
  console.log('');
  console.log('📊 Summary');
  console.log('==========');
  console.log(`✅ Successfully fetched: ${results.success.length} years`);
  if (results.success.length > 0) {
    console.log(`   ${results.success.join(', ')}`);
  }

  console.log(`⏭️  Skipped (cached): ${results.skipped.length} years`);
  if (results.skipped.length > 0) {
    console.log(`   ${results.skipped.join(', ')}`);
  }

  console.log(`❌ Failed: ${results.failed.length} years`);
  if (results.failed.length > 0) {
    console.log(`   ${results.failed.join(', ')}`);
  }

  console.log('');
  console.log('📁 Auction data location:');
  console.log(`   data/${leagueName}/mfl-feeds/{year}/auctionResults.json`);
  console.log(`   data/${leagueName}/mfl-feeds/{year}/transactions.json`);

  if (results.failed.length > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
