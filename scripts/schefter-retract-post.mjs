#!/usr/bin/env node
/**
 * Retract published Schefter posts by id.
 *
 * Exists because a feed post can be WRONG about a real owner's roster, and the
 * only honest remedy is to take it down. The first use was two trade-offer
 * posts that named a team which did not own the player they named — see
 * scripts/lib/redact-trade-offer.mjs and the 2026-09-07 attribution fix.
 *
 * A script rather than a hand edit, for three reasons:
 * - The feeds are cron-written. A hand edit is invisible in review and cannot
 *   be repeated on the next league; this can be re-run and read.
 * - It removes the post from the league's live feed AND its archive, so a
 *   retracted post cannot come back when the archive is next read.
 * - It writes with the same `JSON.stringify(feed, null, 2) + '\n'` the
 *   scanners use, so the diff is the removed rows and nothing else.
 *
 * What it deliberately does NOT touch: Redis reaction/reply/impression keys
 * for the post id, and the scanner's `posted` / exposure state. Orphaned
 * reactions are harmless, and clearing the posted state would let the same
 * offer generate the same wrong post again on the next scan.
 *
 * Usage:
 *   node scripts/schefter-retract-post.mjs --league theleague --id A --id B
 *   node scripts/schefter-retract-post.mjs --league theleague --id A --dry-run
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSchefterLeague } from './lib/schefter-leagues.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function argValues(flag) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === flag && args[i + 1]) out.push(args[i + 1]);
  return out;
}

const leagueSlug = argValues('--league')[0];
const ids = argValues('--id');

if (!leagueSlug || ids.length === 0) {
  console.error('Usage: --league <slug> --id <postId> [--id <postId> …] [--dry-run]');
  process.exit(1);
}

const league = getSchefterLeague(leagueSlug);
const targets = new Set(ids);

/** Feed file plus every archive shard beside it. */
async function filesToScan() {
  const files = [league.feedPath];
  const archiveDir = path.join(path.dirname(league.feedPath), 'schefter-archive');
  try {
    for (const name of await fs.readdir(archiveDir)) {
      if (name.endsWith('.json')) files.push(path.join(archiveDir, name));
    }
  } catch {
    // No archive for this league yet.
  }
  return files;
}

let removedTotal = 0;

for (const file of await filesToScan()) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    continue;
  }
  // Live feeds are objects with a `posts` array; archive shards may be either.
  const isArray = Array.isArray(parsed);
  const posts = isArray ? parsed : parsed.posts;
  if (!Array.isArray(posts)) continue;

  const kept = posts.filter((p) => !targets.has(p?.id));
  const removed = posts.length - kept.length;
  if (removed === 0) continue;

  for (const p of posts) {
    if (targets.has(p?.id)) {
      console.log(`  [retract] ${p.id} — ${String(p.body ?? p.headline ?? '').slice(0, 90)}`);
    }
  }

  removedTotal += removed;
  if (DRY_RUN) {
    console.log(`  [dry-run] would remove ${removed} post(s) from ${file}`);
    continue;
  }
  const next = isArray ? kept : { ...parsed, posts: kept };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`  removed ${removed} post(s) from ${file}`);
}

const missing = [...targets].filter(Boolean);
console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}retracted ${removedTotal} post row(s) for ${missing.length} id(s).`);
if (removedTotal === 0) process.exitCode = 1;
