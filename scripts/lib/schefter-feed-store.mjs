/**
 * The Schefter feed's home is Redis; git keeps a daily snapshot.
 *
 * Until Oct 2026 every feed write was a commit to `main`, and every commit to
 * `main` is a production build: the scan, rumor, article and lineup lanes made
 * about half of all bot commits. Now each league's feed lives under one Redis
 * key, the site reads it per request (src/utils/schefter-feed-source.ts), and
 * the committed file is a once-a-day backup plus the fallback the site renders
 * when Redis is unreachable.
 *
 * Writers do not change. A job still checks the repo out, runs `pull` to bring
 * every feed file up to Redis's copy, lets its scripts edit the files as they
 * always have, and ends in scripts/commit-feed-and-push.mjs, which hands each
 * changed feed to `mergeFeedIntoRedis` instead of committing it. The merge is
 * the same `mergeFeed` the git path used (union posts by id, watermarks take
 * the max, retraction tombstones and the archive watermark win), so two jobs
 * writing at once lose nothing — and a lock makes the read-merge-write atomic.
 *
 * Dependency-free on purpose (raw REST via ./redis.mjs): it runs in workflows
 * that may not install node_modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRedisConfig, redisCommand } from './redis.mjs';
import { mergeFeed } from './merge-schefter-feed.mjs';
import { ALL_LEAGUES, LEAGUES } from '../../src/config/leagues-data.mjs';
import { schefterFeedKey, schefterKey } from './schefter-keys.mjs';

const navSlugOf = (slug) => {
  const league = Object.values(LEAGUES).find((l) => l.slug === slug);
  if (!league) throw new Error(`schefter feed store: unknown league "${slug}"`);
  return league.navSlug;
};

/** Redis key for a league's live feed (league-scoped through schefterKey like every Schefter key). */
export const feedKey = (slug) => schefterFeedKey(navSlugOf(slug));
const lockKey = (slug) => schefterKey(navSlugOf(slug), 'feed:lock');

const LOCK_TTL_SECONDS = 30;
const LOCK_ATTEMPTS = 20;

/** Every registry league that runs the feed, with its committed file path. */
export function feedLeagues(leagues = ALL_LEAGUES) {
  return leagues
    .filter((l) => l.features?.schefterFeed && l.schefterFeedPath)
    .map((l) => ({ slug: l.slug, feedPath: l.schefterFeedPath }));
}

/** The league that owns a committed feed path, or null. */
export function leagueForFeedPath(feedPath, leagues = ALL_LEAGUES) {
  const norm = feedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return feedLeagues(leagues).find((l) => l.feedPath === norm) ?? null;
}

/** Redis config, or null when this environment has none (the git path then stands). */
export function feedStoreConfig() {
  return getRedisConfig();
}

const parse = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** The league's feed as Redis holds it, or null when the key is empty. */
export async function readFeedFromRedis(redis, slug, command = redisCommand) {
  return parse(await command(redis, ['GET', feedKey(slug)]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withLock(redis, slug, fn, command) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < LOCK_ATTEMPTS; i += 1) {
    const ok = await command(redis, ['SET', lockKey(slug), token, 'NX', 'EX', String(LOCK_TTL_SECONDS)]);
    if (ok === 'OK') {
      try {
        return await fn();
      } finally {
        // Release only our own lock: one that expired mid-write may now be someone else's.
        await command(redis, [
          'EVAL',
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          '1',
          lockKey(slug),
          token,
        ]).catch(() => {});
      }
    }
    await sleep(500 + Math.floor(Math.random() * 500));
  }
  throw new Error(`schefter feed lock for ${slug} still held after ${LOCK_ATTEMPTS} attempts`);
}

/**
 * Merge `ours` into the league's Redis feed under a lock. Returns
 * `{ written, feed }`: `written` is false when Redis already held everything
 * ours carries, so an unchanged run writes nothing.
 */
export async function mergeFeedIntoRedis(redis, slug, ours, command = redisCommand) {
  return withLock(
    redis,
    slug,
    async () => {
      const current = await readFeedFromRedis(redis, slug, command);
      const merged = current ? mergeFeed(current, ours) : ours;
      if (current && JSON.stringify(merged) === JSON.stringify(current)) {
        return { written: false, feed: current };
      }
      await command(redis, ['SET', feedKey(slug), JSON.stringify(merged)]);
      return { written: true, feed: merged };
    },
    command,
  );
}

/**
 * Bring a committed feed file up to Redis's copy. Redis is `ours` in the merge
 * (it is the live feed), and the file is `theirs`, so anything that reached
 * only git — a writer that ran without Redis credentials — is kept too.
 * Returns true when the file changed.
 */
export async function pullFeedFile(redis, slug, absPath, command = redisCommand) {
  const live = await readFeedFromRedis(redis, slug, command);
  if (!live) return false;
  const before = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  let local = null;
  try {
    local = before ? JSON.parse(before) : null;
  } catch {
    local = null;
  }
  const merged = local ? mergeFeed(local, live) : live;
  const after = JSON.stringify(merged, null, 2) + '\n';
  if (after === before) return false;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, after);
  return true;
}
