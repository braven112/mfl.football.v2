/**
 * schefter-archive.mjs — move a schefter feed's long tail into per-year
 * archive files, bounded by SCHEFTER_ACTIVE_MAX.
 *
 * The active feed keeps the newest posts; overflow moves to
 * `<feed dir>/schefter-archive/<calendar-year>.json` (union-by-id,
 * newest-first). The feed gains an `archivedThroughTimestamp` watermark that
 * mergeFeed (merge-schefter-feed.mjs) enforces, so the every-15-minute scan
 * jobs racing this archiver can never resurrect an archived post.
 *
 * Boundary rule that keeps the watermark sound: the watermark must be
 * STRICTLY older than every remaining active post (mergeFeed drops posts at
 * or before it). When posts straddle the cap boundary with identical
 * timestamps, the tied overflow posts are kept active instead of archived.
 * Posts with unparseable timestamps are never archived.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../../src/config/leagues-data.mjs';
import { toEpochMs } from './merge-schefter-feed.mjs';
import { SCHEFTER_ACTIVE_MAX } from './retention-policy.mjs';

const postTimestamp = (p) => p?.timestamp ?? p?.publishedAt ?? p?.date ?? '';

/**
 * Every existing archive year-file, repo-relative — for astro.config.ts's
 * Vercel `includeFiles` (the OG renderer reads them with fs at runtime).
 * @astrojs/vercel includeFiles does NOT accept glob patterns (it realpaths
 * each entry and a literal `*.json` string ENOENTs the whole build — bitten
 * 2026-08-16), so the list is enumerated at config-load time. A brand-new
 * year file lands in a data commit, which redeploys, which re-runs this.
 */
export function schefterArchiveIncludeFiles() {
  const files = [];
  for (const league of ALL_LEAGUES) {
    const feedPath = league.schefterFeedPath ?? path.join(league.dataPath, 'schefter-feed.json');
    const dir = path.join(path.dirname(feedPath), 'schefter-archive');
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/^\d{4}\.json$/.test(f)) files.push(path.join(dir, f));
      }
    } catch {
      // league without an archive yet
    }
  }
  return files.sort();
}

/**
 * Archive `feed` (parsed schefter-feed.json object) down to `max` active
 * posts. Returns { feed, archivedByYear: Map<year, posts[]>, archivedCount }.
 * Pure — no filesystem access; callers persist the results.
 */
export function planArchive(feed, max = SCHEFTER_ACTIVE_MAX) {
  const posts = Array.isArray(feed?.posts) ? [...feed.posts] : [];
  const dated = [];
  const undated = [];
  for (const p of posts) {
    (Number.isFinite(toEpochMs(postTimestamp(p))) ? dated : undated).push(p);
  }
  dated.sort((a, b) => toEpochMs(postTimestamp(b)) - toEpochMs(postTimestamp(a)));

  if (dated.length <= max) {
    return { feed, archivedByYear: new Map(), archivedCount: 0 };
  }

  let boundary = max;
  // Never split identical timestamps across the active/archive boundary —
  // the strict `> watermark` merge filter would drop the active twin.
  while (
    boundary > 0 &&
    toEpochMs(postTimestamp(dated[boundary - 1])) === toEpochMs(postTimestamp(dated[boundary]))
  ) {
    boundary += 1;
    if (boundary >= dated.length) {
      return { feed, archivedByYear: new Map(), archivedCount: 0 };
    }
  }

  const active = dated.slice(0, boundary);
  const overflow = dated.slice(boundary);

  const archivedByYear = new Map();
  for (const p of overflow) {
    const year = new Date(toEpochMs(postTimestamp(p))).getUTCFullYear();
    if (!archivedByYear.has(year)) archivedByYear.set(year, []);
    archivedByYear.get(year).push(p);
  }

  const watermark = postTimestamp(overflow[0]);
  const nextFeed = {
    ...feed,
    archivedThroughTimestamp: watermark,
    posts: [...active, ...undated],
  };
  return { feed: nextFeed, archivedByYear, archivedCount: overflow.length };
}

/**
 * Run the archive for one feed file on disk. Returns a summary. Archive
 * files are union-by-id so re-runs and out-of-order runs are safe.
 */
export function archiveFeedFile(feedPath, { max = SCHEFTER_ACTIVE_MAX, dryRun = false } = {}) {
  const raw = fs.readFileSync(feedPath, 'utf8');
  const feed = JSON.parse(raw);
  const { feed: nextFeed, archivedByYear, archivedCount } = planArchive(feed, max);
  if (archivedCount === 0) {
    return { feedPath, archivedCount: 0, activeCount: feed?.posts?.length ?? 0, files: [] };
  }

  const archiveDir = path.join(path.dirname(feedPath), 'schefter-archive');
  const files = [];
  for (const [year, posts] of archivedByYear) {
    const file = path.join(archiveDir, `${year}.json`);
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // new archive year
    }
    const seen = new Set(existing.map((p) => p?.id).filter(Boolean));
    const merged = [...existing, ...posts.filter((p) => !p?.id || !seen.has(p.id))];
    merged.sort((a, b) => toEpochMs(postTimestamp(b)) - toEpochMs(postTimestamp(a)));
    files.push({ file, added: posts.length, total: merged.length });
    if (!dryRun) {
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    }
  }
  if (!dryRun) {
    fs.writeFileSync(feedPath, JSON.stringify(nextFeed, null, 2) + '\n', 'utf8');
  }
  return {
    feedPath,
    archivedCount,
    activeCount: nextFeed.posts.length,
    watermark: nextFeed.archivedThroughTimestamp,
    files,
  };
}
