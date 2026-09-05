#!/usr/bin/env node
/**
 * Push "News on a watched player" — the watch-list-news category.
 *
 * Runs after each Schefter scan. Every feed post newer than the league's
 * watermark that carries `playerIds` (stamped by the transaction lanes, or by
 * scripts/schefter-tag-players.mjs from prose) is matched against every
 * franchise's My Watch List mirror (src/utils/watch-list-keys.mjs — the only
 * server-side view of an MFL watch list, since MFL will not hand it to a
 * cron). One push per matching post per watching owner; the tag collapses a
 * re-send of the same post.
 *
 * WATCHED players only, not the owner's roster: injuries and status changes
 * for rostered players already go out under `player-news`
 * (scripts/push-player-news.mjs), and doubling those up is how push
 * permission gets revoked. The Schefter page itself DOES highlight roster
 * news — that is a filter, not a buzz.
 *
 * Never fails the job: the scan and tag that ran before this already did
 * their work.
 *
 * Usage:
 *   node scripts/push-watch-list-news.mjs [--league afl] [--dry-run]
 */

import { promises as fs } from 'node:fs';
import { SCHEFTER_LEAGUES, getSchefterLeague } from './lib/schefter-leagues.mjs';
import { leagueYearFor } from './lib/schefter-league-year.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { sendPushFanout } from './lib/push-fanout.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { watchListKey, mirrorPlayerIds } from '../src/utils/watch-list-keys.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const leagueArg = (() => {
  const i = args.indexOf('--league');
  return i >= 0 ? args[i + 1] : null;
})();

/** A run that finds more new posts than this is a broken watermark, not news. */
const SANITY_LIMIT = 40;

const CATEGORY = 'watch-list-news';

/** Watermark key — the newest post timestamp already handled, per league. */
const watermarkKey = (league) => `watchlist-news:${league.navSlug}:last`;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function stripHtml(text) {
  return String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Last, First" → "First Last". */
function displayName(mflName) {
  const parts = String(mflName ?? '').split(', ');
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(mflName ?? '');
}

/** Franchise ids for the league year, from the committed rosters export. */
function franchiseIdsFrom(rostersJson) {
  const f = rostersJson?.rosters?.franchise;
  const list = Array.isArray(f) ? f : f ? [f] : [];
  return list.map((x) => String(x?.id ?? '')).filter(Boolean);
}

/**
 * Build one notification per (post, watching franchise).
 * Exported for the unit test; pure.
 */
export function buildWatchListNotifications({ posts, watchersByFranchise, playerName }) {
  const out = [];
  for (const post of posts) {
    const ids = Array.isArray(post.playerIds) ? post.playerIds.map(String) : [];
    if (ids.length === 0) continue;
    const headline = stripHtml(post.headline) || stripHtml(post.body).slice(0, 120);
    if (!headline) continue;
    for (const [franchiseId, watched] of watchersByFranchise) {
      const hits = ids.filter((id) => watched.has(id));
      if (hits.length === 0) continue;
      const names = hits.map((id) => playerName(id)).filter(Boolean);
      const who = names.length ? names.join(', ') : 'a player you watch';
      out.push({
        franchiseId,
        title: `Watch list: ${who}`,
        body: headline.length > 140 ? `${headline.slice(0, 137)}…` : headline,
        url: `/news?post=${encodeURIComponent(post.id)}`,
        tag: `watch-${post.id}`,
      });
    }
  }
  return out;
}

async function scanLeague(league, redis) {
  const feed = await readJson(league.feedPath);
  const posts = Array.isArray(feed?.posts) ? feed.posts : [];
  if (posts.length === 0) {
    console.log(`  [${league.slug}] empty feed — nothing to do.`);
    return;
  }

  const key = watermarkKey(league);
  const stored = await redisCommand(redis, ['GET', key]);
  const watermark = stored ? Date.parse(String(stored).replace(/^"|"$/g, '')) : NaN;
  const newest = posts.reduce((max, p) => Math.max(max, Date.parse(p.timestamp) || 0), 0);
  const newestIso = new Date(newest).toISOString();

  if (!Number.isFinite(watermark)) {
    // First run: seed to "now" and send nothing, or every owner gets a push
    // per historical post the moment the category goes live.
    console.log(`  [${league.slug}] first run — seeding watermark at ${newestIso}, sending nothing.`);
    if (!DRY_RUN) await redisCommand(redis, ['SET', key, newestIso]);
    return;
  }

  const fresh = posts
    .filter((p) => (Date.parse(p.timestamp) || 0) > watermark && p.type !== 'groupme')
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (fresh.length === 0) return;
  if (fresh.length > SANITY_LIMIT) {
    console.warn(
      `  [${league.slug}] ${fresh.length} new posts at once (limit ${SANITY_LIMIT}) — sending nothing and re-seeding.`,
    );
    if (!DRY_RUN) await redisCommand(redis, ['SET', key, newestIso]);
    return;
  }

  const year = leagueYearFor(league);
  const [rostersJson, playersJson] = await Promise.all([
    readJson(league.feedFilePath(year, 'rosters.json')),
    readJson(league.playersPath(year)),
  ]);
  const franchiseIds = franchiseIdsFrom(rostersJson);
  if (franchiseIds.length === 0) {
    console.log(`  [${league.slug}] no rosters export for ${year} — cannot enumerate franchises; skipping.`);
    return;
  }

  // The mirrors, in one round trip. A franchise that has never used the
  // feature has no key and simply never matches.
  const registry = getLeagueBySlug(league.registrySlug);
  const keys = franchiseIds.map((fid) => watchListKey(registry.slug, fid));
  const raw = await redisCommand(redis, ['MGET', ...keys]);
  const watchersByFranchise = new Map();
  (Array.isArray(raw) ? raw : []).forEach((value, i) => {
    if (!value) return;
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch { return; }
    }
    const ids = mirrorPlayerIds(parsed);
    if (ids.length) watchersByFranchise.set(franchiseIds[i], new Set(ids));
  });

  const byId = new Map();
  const rows = playersJson?.players?.player;
  for (const p of Array.isArray(rows) ? rows : rows ? [rows] : []) {
    if (p?.id) byId.set(String(p.id), p);
  }

  const notifications = buildWatchListNotifications({
    posts: fresh,
    watchersByFranchise,
    playerName: (id) => displayName(byId.get(id)?.name),
  });

  console.log(
    `  [${league.slug}] ${fresh.length} new post(s), ${watchersByFranchise.size} owner(s) with a list, ${notifications.length} push(es).`,
  );
  for (const n of notifications) console.log(`    ${n.franchiseId}: ${n.title} — ${n.body}`);

  await sendPushFanout({ league: registry, dryRun: DRY_RUN, category: CATEGORY, notifications });

  // Advance only after the send is attempted — a crash between the two
  // re-sends (same tag, collapses) rather than dropping a post on the floor.
  if (!DRY_RUN) await redisCommand(redis, ['SET', key, newestIso]);
}

async function main() {
  const redis = getRedisConfig();
  if (!redis) {
    console.warn('[watch-list-news] No Redis credentials — no watch lists to read, skipping.');
    return;
  }
  const leagues = leagueArg ? [getSchefterLeague(leagueArg)] : SCHEFTER_LEAGUES;
  console.log(`[watch-list-news] ${DRY_RUN ? 'dry run — ' : ''}${leagues.length} league(s)`);
  for (const league of leagues) {
    try {
      await scanLeague(league, redis);
    } catch (err) {
      console.warn(`[watch-list-news] ${league.slug} failed: ${err?.message ?? err}`);
    }
  }
}

// Only run as a script, not when imported by the unit test.
if (process.argv[1] && /push-watch-list-news\.mjs$/.test(process.argv[1])) {
  main().catch((err) => {
    console.warn(`[watch-list-news] Fatal: ${err?.message ?? err}`);
  });
}
