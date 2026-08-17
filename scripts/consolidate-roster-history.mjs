#!/usr/bin/env node
/**
 * Consolidate completed seasons' daily roster-history snapshots.
 *
 * Daily ~50 KB snapshots are only interesting day-by-day while a season is
 * live; once it's over, weekly keyframes + the AFL keeper window + the
 * season's first/last snapshot cover every documented consumer (audit in
 * scripts/lib/retention-policy.mjs). This deletes the rest.
 *
 * Season selection needs no league-year math: the NEWEST year directory per
 * league is always left untouched (roster-sync creates the new league
 * year's directory at the Feb-14 rollover, so by the time a season could be
 * consolidated a newer directory already exists — and the newest directory
 * is exactly the one live consumers like Schefter's pre-auction lookup
 * read).
 *
 * Idempotent and cheap — safe to run from the roster-sync workflow. Use
 * --dry-run to preview deletions.
 *
 * Usage: node scripts/consolidate-roster-history.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { shouldRetainSnapshot } from './lib/retention-policy.mjs';

const dryRun = process.argv.includes('--dry-run');

const SNAPSHOT_RE = /^rosters-(\d{4}-\d{2}-\d{2})\.json$/;

let totalDeleted = 0;
let totalBytes = 0;

for (const league of ALL_LEAGUES) {
  const feedsDir = path.join(league.dataPath, 'mfl-feeds');
  let years;
  try {
    years = fs
      .readdirSync(feedsDir)
      .filter((y) => /^\d{4}$/.test(y))
      .sort();
  } catch {
    continue; // league without committed feeds
  }
  const newestYear = years.at(-1);

  for (const year of years) {
    if (year === newestYear) continue; // live season dir — keep everything
    const dir = path.join(feedsDir, year, 'roster-history');
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => SNAPSHOT_RE.test(f)).sort();
    } catch {
      continue;
    }
    if (files.length === 0) continue;

    const dateOf = (f) => SNAPSHOT_RE.exec(f)[1];
    const bounds = { first: dateOf(files[0]), last: dateOf(files.at(-1)) };

    for (const file of files) {
      const date = dateOf(file);
      if (shouldRetainSnapshot(date, bounds)) continue;
      const full = path.join(dir, file);
      const size = fs.statSync(full).size;
      totalDeleted += 1;
      totalBytes += size;
      if (dryRun) {
        console.log(`[dry-run] would delete ${full}`);
      } else {
        fs.unlinkSync(full);
        console.log(`Deleted ${full}`);
      }
    }
  }
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}Consolidated roster history: ${totalDeleted} snapshots, ` +
    `${(totalBytes / 1024 / 1024).toFixed(1)} MB ${dryRun ? 'would be' : ''} reclaimed.`
);
