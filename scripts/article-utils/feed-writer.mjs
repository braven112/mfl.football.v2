/**
 * Feed writer — dedup check + append article posts to the Schefter feed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Every post id in the season archive shards beside a feed
 * (`<feed dir>/schefter-archive/*.json`, written by scripts/lib/schefter-archive.mjs).
 * Shards may be a bare array or `{ posts }`.
 */
async function archivedIds(feedPath) {
  const ids = new Set();
  const dir = path.join(path.dirname(feedPath), 'schefter-archive');
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return ids; // no archive for this league yet
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      const posts = Array.isArray(parsed) ? parsed : parsed?.posts;
      for (const p of Array.isArray(posts) ? posts : []) if (p?.id) ids.add(p.id);
    } catch {
      // unreadable shard — ignore
    }
  }
  return ids;
}

/**
 * Check if an article with this ID was already published — in the live feed OR
 * the season archive. Called BEFORE the AI call to avoid wasting API credits.
 *
 * The archive matters: the weekly archiver moves the feed's long tail out, and a
 * once-per-season id (schedule-release, draft-grades, …) checked against the
 * live feed alone reads as "never posted" the moment it rotates. That is how the
 * 2026 schedule-release column was re-posted to GroupMe on Sept 15, three weeks
 * after the real one.
 */
export async function isDuplicate(feedPath, articleId) {
  const feed = JSON.parse(await fs.readFile(feedPath, 'utf8'));
  if (feed.posts.some(p => p.id === articleId)) return true;
  return (await archivedIds(feedPath)).has(articleId);
}

/**
 * Prepend a new post to the feed (newest first, matching scan pattern).
 * Returns true if written, false if duplicate (belt + suspenders).
 */
export async function appendToFeed(feedPath, post) {
  const feed = JSON.parse(await fs.readFile(feedPath, 'utf8'));

  if (feed.posts.some(p => p.id === post.id)) {
    console.log(`  [skip] Post ${post.id} already exists in feed`);
    return false;
  }

  feed.posts = [post, ...feed.posts];
  feed.lastScanTimestamp = new Date().toISOString();

  await fs.writeFile(feedPath, JSON.stringify(feed, null, 2) + '\n');
  return true;
}
