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
 * - It records each id in the feed's `retractedIds` TOMBSTONE list. Removing
 *   the row is not enough on its own: `mergeFeed` unions our posts with
 *   origin's on every push, so a scan job that checked out BEFORE the
 *   retraction landed pushes the post straight back. (`archivedThroughTimestamp`
 *   only shields posts old enough to have been archived — a just-published
 *   post that needs taking down is never one of them.) The tombstone is
 *   unioned by mergeFeed, so it survives that same race.
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
 *   node scripts/schefter-retract-post.mjs --league theleague --id A --feed-only
 *
 * `--feed-only` leaves the archive alone. Use it to remove a DUPLICATE that
 * re-published under an id whose original already rotated into the archive —
 * the original stays, and the dedup keeps reading it there. The tombstone is
 * still written: it bars the id from the LIVE feed, which is exactly right
 * here, and the archived original is not something mergeFeed touches.
 *
 * A tombstone is permanent. Putting a retracted id back means deleting its
 * entry from `retractedIds` by hand — deliberate friction.
 *
 * KNOWN GAP — the ARCHIVE leg is not race-protected, only the live feed is.
 * `mergeByPath` (lib/merge-schefter-feed.mjs) reconciles schefter-feed.json and
 * post-history.json; every other path, archive shards included, is taken from
 * our checkout VERBATIM. So a weekly archive job that checked out before a
 * retraction and commits after it writes its shard back with the post still in
 * it, and `/news/<id>` and the OG renderer both fall back to archive shards.
 * The live feed stays clean — `retractedIds` covers that — but the post can
 * still resolve from the archive. After retracting anything, check that no
 * archive run raced you and re-run if one did. Tracked in
 * docs/claude/followups/2026-09-16-retraction-archive-shard-race.md.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSchefterLeague } from './lib/schefter-leagues.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FEED_ONLY = args.includes('--feed-only');

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
  if (FEED_ONLY) return files;
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
let tombstonedTotal = 0;

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

  // The tombstone goes on the LIVE feed only — it is the file mergeFeed
  // reconciles, and archive shards have no object to carry it. Written even
  // when this run removed nothing: a re-run after a concurrent job already
  // resurrected-and-lost the row must still leave the bar in place.
  const isLiveFeed = file === league.feedPath;
  const existingTombstones = isLiveFeed && Array.isArray(parsed.retractedIds) ? parsed.retractedIds : [];
  const nextTombstones = [...new Set([...existingTombstones, ...targets])].sort();
  const tombstonesAdded = isLiveFeed ? nextTombstones.length - existingTombstones.length : 0;

  if (removed === 0 && tombstonesAdded === 0) continue;

  for (const p of posts) {
    if (targets.has(p?.id)) {
      console.log(`  [retract] ${p.id} — ${String(p.body ?? p.headline ?? '').slice(0, 90)}`);
    }
  }

  removedTotal += removed;
  tombstonedTotal += tombstonesAdded;
  if (DRY_RUN) {
    console.log(`  [dry-run] would remove ${removed} post(s) from ${file}`);
    if (tombstonesAdded) console.log(`  [dry-run] would tombstone ${tombstonesAdded} id(s) in ${file}`);
    continue;
  }
  const next = isArray
    ? kept
    : { ...parsed, posts: kept, ...(isLiveFeed ? { retractedIds: nextTombstones } : {}) };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`  removed ${removed} post(s) from ${file}`);
  if (tombstonesAdded) console.log(`  tombstoned ${tombstonesAdded} id(s) in ${file}`);
}

const missing = [...targets].filter(Boolean);
console.log(
  `\n${DRY_RUN ? '[dry-run] ' : ''}retracted ${removedTotal} post row(s) ` +
    `and wrote ${tombstonedTotal} tombstone(s) for ${missing.length} id(s).`
);
// Writing ONLY a tombstone is a success, not a no-op. The row may already be
// absent from this checkout while a stale cron still carries it — which is
// precisely the race the tombstone exists for. Exiting 1 there would make a
// `node … && git commit` wrapper skip committing the bar that was the whole
// point of the run. Failure means nothing happened at all.
if (removedTotal === 0 && tombstonedTotal === 0) process.exitCode = 1;
