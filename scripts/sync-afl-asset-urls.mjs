#!/usr/bin/env node
/**
 * Syncs AFL Fantasy team asset URLs from MFL league feed to afl.config.json
 * Reads from: data/afl-fantasy/mfl-feeds/2025/league.json
 * Updates: data/afl-fantasy/afl.config.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AFL_DATA_PATH = getLeagueBySlug('afl-fantasy').dataPath;
const leagueFeedPath = path.join(projectRoot, AFL_DATA_PATH, 'mfl-feeds', '2025', 'league.json');
const configPath = path.join(projectRoot, AFL_DATA_PATH, 'afl.config.json');

/**
 * MFL stores each franchise's icon/banner as an ABSOLUTE URL to our own
 * production deployment, because that's the form we upload to MFL. Writing
 * that straight back into the config makes every page fetch its crests
 * cross-origin — a second DNS+TLS connection whose latency showed up as blank
 * team columns on cellular (Aug 2026). The files are committed under public/,
 * so store the same-origin path instead.
 *
 * Applied to the value BEFORE comparison as well as before assignment, so a
 * normalized config doesn't read as "changed" on every run and get rewritten
 * back to the absolute form.
 *
 * External hosts (blob storage, anything not ours) pass through untouched.
 */
const toSameOriginAsset = (url) => {
  if (!url || !/^https?:\/\//i.test(url)) return url ?? '';
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith('/assets/') ? parsed.pathname : url;
  } catch {
    return url;
  }
};

/**
 * Main execution
 */
const run = async () => {
  try {
    console.log('📡 Syncing AFL Fantasy asset URLs from MFL API\n');

    // Read MFL league feed
    const leagueData = JSON.parse(await fs.readFile(leagueFeedPath, 'utf-8'));
    const mflFranchises = leagueData?.league?.franchises?.franchise || [];

    if (mflFranchises.length === 0) {
      throw new Error('No franchises found in MFL league feed');
    }

    console.log(`Found ${mflFranchises.length} franchises in MFL feed`);

    // Read current config
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

    // Create a map of franchise IDs to MFL data
    const mflDataMap = new Map();
    mflFranchises.forEach(franchise => {
      mflDataMap.set(franchise.id, {
        icon: franchise.icon || '',
        banner: franchise.logo || '',
      });
    });

    // Update config teams with MFL URLs
    let updated = 0;
    let unchanged = 0;

    for (const team of config.teams) {
      const mflData = mflDataMap.get(team.franchiseId);

      if (!mflData) {
        console.warn(`⚠️  No MFL data found for ${team.name} (${team.franchiseId})`);
        unchanged++;
        continue;
      }

      const oldIcon = team.icon;
      const oldBanner = team.banner;
      const newIcon = toSameOriginAsset(mflData.icon);
      const newBanner = toSameOriginAsset(mflData.banner);

      // Only update if URLs have changed
      if (oldIcon !== newIcon || oldBanner !== newBanner) {
        team.icon = newIcon;
        team.banner = newBanner;
        console.log(`✓ Updated ${team.name}`);
        if (oldIcon !== newIcon) {
          console.log(`  Icon:   ${oldIcon || '(none)'}`);
          console.log(`       → ${newIcon || '(none)'}`);
        }
        if (oldBanner !== newBanner) {
          console.log(`  Banner: ${oldBanner || '(none)'}`);
          console.log(`       → ${newBanner || '(none)'}`);
        }
        console.log('');
        updated++;
      } else {
        unchanged++;
      }
    }

    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    console.log(`\n📊 Summary:`);
    console.log(`   Updated: ${updated} teams`);
    console.log(`   Unchanged: ${unchanged} teams`);
    console.log(`   Config saved to: ${configPath}`);

    if (updated > 0) {
      console.log('\n✅ AFL Fantasy config updated with latest MFL asset URLs!');
    } else {
      console.log('\n✅ All asset URLs are already up to date!');
    }
  } catch (error) {
    console.error('❌ Failed to sync AFL Fantasy asset URLs:', error.message);
    process.exitCode = 1;
  }
};

run();
