/**
 * Feed writer — dedup check + append article posts to the Schefter feed.
 *
 * ONE published-id check, shared by both exports. `isDuplicate` is the cheap
 * pre-flight (called before the AI spend); `appendToFeed` is the belt +
 * suspenders at write time. They must agree, because two of the three callers
 * — schefter-announce.mjs and lib/schefter-assistant-post.mjs — never call
 * `isDuplicate` at all and rely on the write-time check alone.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Memoized per feed path, for the life of the process. The archive is written
 * by a SEPARATE weekly job (scripts/archive-schefter-feed.mjs), so it cannot
 * change under a running script — and the assistant lane appends in a
 * sequential loop of up to one post per franchise, which would otherwise
 * re-parse a ~1 MB shard 24 times.
 *
 * A rejection is cached too, on purpose: an unreadable shard must keep failing
 * closed for the rest of the run rather than succeed on a retry.
 */
const archiveCache = new Map();

/**
 * Every post id in the season archive shards beside a feed
 * (`<feed dir>/schefter-archive/*.json`, written by scripts/lib/schefter-archive.mjs).
 * Shards may be a bare array or `{ posts }`.
 */
async function readArchivedIds(feedPath) {
  const ids = new Set();
  const dir = path.join(path.dirname(feedPath), 'schefter-archive');
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    // ENOENT is the ONLY benign case: this league genuinely has no archive
    // yet, so there are no archived ids. Every other code (EACCES, EIO,
    // EMFILE, ENOTDIR) means the archive exists but could not be listed, and
    // returning an empty set there reads every archived id as "never posted"
    // — the exact repost this check exists to stop. Same fail-closed rule the
    // shard parse below follows; leaving it out here was the half of it.
    if (err?.code !== 'ENOENT') throw err;
    return ids;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    // No catch: an unreadable shard must FAIL CLOSED. Ignoring it would read
    // its ids as "never posted" and re-publish exactly what this check exists
    // to stop — a failed run is the safer outcome.
    const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    const posts = Array.isArray(parsed) ? parsed : parsed?.posts;
    for (const p of Array.isArray(posts) ? posts : []) if (p?.id) ids.add(p.id);
  }
  return ids;
}

function archivedIds(feedPath) {
  let pending = archiveCache.get(feedPath);
  if (!pending) {
    pending = readArchivedIds(feedPath);
    archiveCache.set(feedPath, pending);
  }
  return pending;
}

/** Test seam — the cache is process-lifetime and would leak across cases. */
export function _resetArchiveCache() {
  archiveCache.clear();
}

/**
 * Has this id ever been published to this league — live feed OR season archive?
 *
 * The archive half is the load-bearing one. The weekly archiver moves the
 * feed's long tail out, so an id checked against the live feed alone reads as
 * "never posted" the moment it rotates. That is how the 2026 schedule-release
 * column was re-posted to GroupMe on Sept 15, three weeks after the real one.
 *
 * EVERY id this module sees must therefore be unique for as long as it must
 * not repeat — `sf_<year>_…` for a season, `assist_…_<year>_w<week>` for a
 * week of one season. A season-less id would be permanently suppressed by this
 * check the first time it archived, which is why assistantPostId carries a year.
 *
 * A RETRACTED id counts as published, and that is the point of the tombstone.
 * A full retraction removes the row from the live feed AND every archive shard,
 * so without this branch the id reads as never posted: the next run regenerates
 * the article, `appendToFeed` reports a write, the caller buzzes GroupMe with a
 * deep link — and then `mergeFeed` filters the post out again at push time on
 * the same tombstone. The chat gets a link to a post that will never exist.
 */
async function isPublished(feedPath, id, feed) {
  if (Array.isArray(feed.retractedIds) && feed.retractedIds.includes(id)) return true;
  if (feed.posts.some(p => p.id === id)) return true;
  return (await archivedIds(feedPath)).has(id);
}

/**
 * Check if an article with this ID was already published — in the live feed OR
 * the season archive. Called BEFORE the AI call to avoid wasting API credits.
 */
export async function isDuplicate(feedPath, articleId) {
  const feed = JSON.parse(await fs.readFile(feedPath, 'utf8'));
  return isPublished(feedPath, articleId, feed);
}

/**
 * Prepend a new post to the feed (newest first, matching scan pattern).
 * Returns true if written, false if already published (belt + suspenders).
 *
 * Callers gate their GroupMe send on this return value to guarantee no
 * double-ping (schefter-announce.mjs, schefter-weekly-articles.mjs step 11).
 * That guarantee is only as good as the archive half of the check: before it,
 * a re-run after rotation both re-wrote the post and re-buzzed the chat.
 */
export async function appendToFeed(feedPath, post) {
  const feed = JSON.parse(await fs.readFile(feedPath, 'utf8'));

  if (await isPublished(feedPath, post.id, feed)) {
    console.log(`  [skip] Post ${post.id} already published (feed or archive)`);
    return false;
  }

  feed.posts = [post, ...feed.posts];
  feed.lastScanTimestamp = new Date().toISOString();

  await fs.writeFile(feedPath, JSON.stringify(feed, null, 2) + '\n');
  return true;
}
