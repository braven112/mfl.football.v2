#!/usr/bin/env node
/**
 * One-off: re-send an already-published trade-speculation post to GroupMe.
 *
 * Why this exists: for a window, the trade-speculation workflow never passed
 * GROUPME_SCHEFTER_BOT_ID to the scanner, so those posts landed on the feed
 * but the best-effort GroupMe leg bailed with reason 'no-bot-id'. The workflow
 * is fixed prospectively; this lets us retroactively buzz a specific post that
 * missed its chat delivery.
 *
 * It reuses the exact same delivery path as the scanner
 * (scripts/lib/speculation-groupme.mjs) so the message bytes — body + CTA +
 * deep link — are identical to what a live run would have sent.
 *
 * Usage:
 *   GROUPME_SCHEFTER_BOT_ID=xxxx node scripts/resend-speculation-groupme.mjs <postId>
 *   GROUPME_SCHEFTER_BOT_ID=xxxx node scripts/resend-speculation-groupme.mjs <postId> --dry-run
 *
 * Env:
 *   GROUPME_SCHEFTER_BOT_ID   required for a live send (absent = helper skips)
 *   SCHEFTER_PUBLIC_BASE_URL  optional; deep-link origin (default theleague.us)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { postSpeculationToGroupMe } from './lib/speculation-groupme.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FEED_PATH = path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json');
const PUBLIC_BASE_URL = (process.env.SCHEFTER_PUBLIC_BASE_URL || 'https://theleague.us').replace(/\/+$/, '');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const postId = args.find((a) => !a.startsWith('--'));

if (!postId) {
  console.error('Usage: node scripts/resend-speculation-groupme.mjs <postId> [--dry-run]');
  process.exit(1);
}

const feed = JSON.parse(await fs.readFile(FEED_PATH, 'utf8'));
const post = (feed.posts ?? []).find((p) => p.id === postId);

if (!post) {
  console.error(`No post with id "${postId}" found in ${FEED_PATH}`);
  process.exit(1);
}
if (post.transactionSubType !== 'trade_speculation') {
  console.error(
    `Post "${postId}" is not a trade_speculation post (transactionSubType=${post.transactionSubType}). Refusing.`,
  );
  process.exit(1);
}

console.log(`Resending post ${postId} to GroupMe${DRY_RUN ? ' [DRY RUN]' : ''}…`);
const result = await postSpeculationToGroupMe({
  post,
  publicBaseUrl: PUBLIC_BASE_URL,
  dryRun: DRY_RUN,
  log: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
});
console.log('Result:', result?.posted ? 'POSTED' : `not posted (${result?.reason})`);
process.exit(result?.posted || DRY_RUN ? 0 : 1);
