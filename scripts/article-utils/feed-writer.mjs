/**
 * Feed writer — dedup check + append article posts to the Schefter feed.
 */

import { promises as fs } from 'node:fs';

/**
 * Check if an article with this ID already exists in the feed.
 * Called BEFORE the AI call to avoid wasting API credits.
 */
export async function isDuplicate(feedPath, articleId) {
  const feed = JSON.parse(await fs.readFile(feedPath, 'utf8'));
  return feed.posts.some(p => p.id === articleId);
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
