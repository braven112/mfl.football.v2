#!/usr/bin/env node
/**
 * Archive both leagues' schefter feeds down to the active window.
 *
 * Weekly (schefter-archive.yml). The heavy lifting — the cap, the
 * per-year archive files, and the merge-safe `archivedThroughTimestamp`
 * watermark — lives in scripts/lib/schefter-archive.mjs; the concurrent
 * scan jobs can't resurrect archived posts because mergeFeed
 * (merge-schefter-feed.mjs) enforces the watermark on every union.
 *
 * Usage: node scripts/archive-schefter-feed.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { archiveFeedFile } from './lib/schefter-archive.mjs';

const dryRun = process.argv.includes('--dry-run');

for (const league of ALL_LEAGUES) {
  const feedPath = league.schefterFeedPath ?? path.join(league.dataPath, 'schefter-feed.json');
  if (!fs.existsSync(feedPath)) continue;
  const result = archiveFeedFile(feedPath, { dryRun });
  if (result.archivedCount === 0) {
    console.log(`[${league.slug}] feed within the active window (${result.activeCount} posts); nothing to archive.`);
    continue;
  }
  console.log(
    `[${league.slug}] ${dryRun ? '[dry-run] would archive' : 'archived'} ${result.archivedCount} posts ` +
      `(${result.activeCount} remain active; watermark ${result.watermark}):`
  );
  for (const f of result.files) {
    console.log(`  ${f.file} (+${f.added}, ${f.total} total)`);
  }
}
