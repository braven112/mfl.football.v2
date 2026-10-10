/**
 * Schefter post lookup by id, across every Schefter league's active feed and
 * its season archives.
 *
 * Split out of `schefter-og.ts` so a caller that only needs a post (the Owner
 * Activity page naming an article a visitor opened) does not pull in the OG
 * renderer's satori/resvg stack. Same fs reads, same caches, same contract:
 * the feed JSON is the id allowlist, and an unknown id is null.
 */

import { closeSync, fstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { SchefterFeed, SchefterPost } from '../types/schefter';
import { ALL_LEAGUES, getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';

/** A league running the Schefter feed. */
export type SchefterLeague = CanonicalLeagueSlug;

export const SCHEFTER_LEAGUES: readonly SchefterLeague[] = ALL_LEAGUES.filter((l) => l.features.schefterFeed).map(
  (l) => l.slug,
);

// ── Feed lookup ──────────────────────────────────────────────────────────

/** The registry's `schefterFeedPath` for a Schefter league. */
function feedPathFor(league: SchefterLeague): string {
  return (getLeagueBySlug(league) as { schefterFeedPath?: string } | null)?.schefterFeedPath ?? '';
}

interface FeedCacheEntry {
  mtimeMs: number;
  byId: Map<string, SchefterPost>;
}

// Feeds are rewritten by cron scans while the server runs — read with fs
// (never `import`) and re-parse only when the file mtime moves.
const feedCache = new Map<SchefterLeague, FeedCacheEntry>();

function getFeedIndex(league: SchefterLeague): Map<string, SchefterPost> {
  const filePath = join(process.cwd(), feedPathFor(league));
  const cached = feedCache.get(league);
  // One open handle for both the mtime check and the read, so the bytes parsed
  // are the bytes whose mtime was checked (CodeQL js/file-system-race).
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return new Map();
  }
  try {
    const mtimeMs = fstatSync(fd).mtimeMs;
    if (cached && cached.mtimeMs === mtimeMs) return cached.byId;

    const byId = new Map<string, SchefterPost>();
    try {
      const feed = JSON.parse(readFileSync(fd, 'utf-8')) as SchefterFeed;
      for (const post of feed.posts ?? []) byId.set(post.id, post);
    } catch {
      // A cron job may be rewriting the file mid-read — serve the last good
      // index rather than 404ing every known post until the next clean read.
      return cached ? cached.byId : new Map();
    }
    feedCache.set(league, { mtimeMs, byId });
    return byId;
  } finally {
    closeSync(fd);
  }
}

// ── Archive fallback ─────────────────────────────────────────────────────
// Posts older than the active window live in `schefter-archive/<year>.json`
// next to each feed (scripts/lib/schefter-archive.mjs). Old GroupMe/social
// links keep requesting their OG images long after the post rotates out, so
// a miss on the active feed falls through to the archives. Loaded lazily and
// cached per league — archives are frozen between weekly archive runs, and
// every archive commit redeploys, so no mtime tracking is needed.

const archiveCache = new Map<SchefterLeague, Map<string, SchefterPost>>();

function getArchiveIndex(league: SchefterLeague): Map<string, SchefterPost> {
  const cached = archiveCache.get(league);
  if (cached) return cached;
  const byId = new Map<string, SchefterPost>();
  const dir = join(process.cwd(), dirname(feedPathFor(league)), 'schefter-archive');
  try {
    const files = readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f));
    for (const file of files) {
      try {
        const posts = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as SchefterPost[];
        for (const post of posts ?? []) {
          if (post?.id && !byId.has(post.id)) byId.set(post.id, post);
        }
      } catch {
        // Skip an unreadable year file rather than losing the whole index.
      }
    }
  } catch {
    // No archive directory yet — empty index.
  }
  archiveCache.set(league, byId);
  return byId;
}

/** Look a post up by id across both leagues' feeds. ESPN wire posts are
 *  mirrored into BOTH feeds with the same id, so the caller's league (from
 *  the ?league= hint on the image URL) is checked first — otherwise a
 *  shared wire post linked from the AFL page would render TheLeague
 *  branding. Falls back to the season archives for posts older than the
 *  active window. Returns null for unknown ids so the endpoint can 404
 *  instead of rendering arbitrary requests. */
export function findSchefterPost(
  postId: string,
  preferredLeague: SchefterLeague = 'theleague'
): { post: SchefterPost; league: SchefterLeague } | null {
  const order: SchefterLeague[] = [preferredLeague, ...SCHEFTER_LEAGUES.filter((l) => l !== preferredLeague)];
  for (const league of order) {
    const post = getFeedIndex(league).get(postId);
    if (post) return { post, league };
  }
  for (const league of order) {
    const post = getArchiveIndex(league).get(postId);
    if (post) return { post, league };
  }
  return null;
}
