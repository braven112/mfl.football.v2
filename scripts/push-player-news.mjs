#!/usr/bin/env node
/**
 * Push injury and status changes to the owners who hold the players.
 *
 * Runs inside Roster Sync, immediately after the MFL feeds are refreshed —
 * that job already fetches `injuries` every five minutes for every league, so
 * this is a diff of data we have rather than a new poll of MFL.
 *
 * Sends nothing on its first run against a league: with no snapshot to compare
 * to, every rostered injury in the league reads as brand new, and the alert
 * would open with a hundred stale notifications. The first run seeds the
 * snapshot and stays quiet.
 *
 * Never fails the job. Roster Sync's real work (the feed write, the commit) is
 * already done by the time this runs, and a push outage must not turn a
 * successful sync into a red X.
 *
 * Usage:
 *   node scripts/push-player-news.mjs
 *   node scripts/push-player-news.mjs --dry-run       # diff + print, never sends
 *   node scripts/push-player-news.mjs --league afl-fantasy
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { sendPushFanout } from './lib/push-fanout.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import {
  rosterIndex,
  rosteredInjuryMap,
  diffPlayerNews,
  isFirstRun,
  buildPlayerNewsNotifications,
} from './lib/player-news-diff.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * How many alerts one league may send in a single run.
 *
 * A backstop, not a feature. The normal diff is a handful of players; a number
 * this size means something upstream changed shape — MFL renaming a status,
 * the roster feed arriving empty — and the right response to "everything
 * changed at once" is to say nothing and let a human look, not to buzz every
 * owner sixteen times.
 */
const SANITY_LIMIT = 40;

function leaguesToScan() {
  const idx = process.argv.indexOf('--league');
  if (idx === -1) return ALL_LEAGUES;
  const league = getLeagueBySlug(process.argv[idx + 1]);
  if (!league) throw new Error(`Unknown league: ${process.argv[idx + 1]}`);
  return [league];
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Snapshot key. League-scoped: both leagues have a franchise 0001. */
const snapshotKey = (league, year) => `player-news:${league.navSlug}:${year}`;

async function scanLeague(league, redis) {
  // The LEAGUE year, not the season year: fetch-mfl-feeds.mjs writes these
  // directories under the league clock, and the two diverge for the fortnight
  // between Feb 1 and Feb 14 — long enough for a wrong-clock read to look like
  // "no injuries this week" rather than like a bug.
  const { currentLeagueYear: year } = getCurrentYears();
  const feeds = path.join(root, league.dataPath, 'mfl-feeds', String(year));

  const [rostersJson, injuriesJson, playersJson] = await Promise.all([
    readJson(path.join(feeds, 'rosters.json')),
    readJson(path.join(feeds, 'injuries.json')),
    readJson(path.join(feeds, 'players.json')),
  ]);

  if (!rostersJson || !injuriesJson) {
    console.log(`  [${league.slug}] no roster/injury feed for ${year} — skipping.`);
    return;
  }

  const index = rosterIndex(rostersJson);
  if (index.size === 0) {
    // An empty roster index would diff every previously-injured player to
    // "no longer owned" and silently drop them, quietly desyncing the
    // snapshot. Bail instead — a league with no rostered players is a broken
    // feed, not a real state.
    console.log(`  [${league.slug}] roster feed has no players — skipping.`);
    return;
  }

  const current = rosteredInjuryMap(injuriesJson, index);
  const key = snapshotKey(league, year);

  const stored = redis ? await redisCommand(redis, ['GET', key]) : null;
  const previous = stored ? JSON.parse(stored) : null;

  if (isFirstRun(previous)) {
    console.log(
      `  [${league.slug}] first run — seeding ${Object.keys(current).length} statuses, sending nothing.`,
    );
    if (redis && !DRY_RUN) await redisCommand(redis, ['SET', key, JSON.stringify(current)]);
    return;
  }

  const changes = diffPlayerNews({ previous, current, index });
  if (changes.length === 0) return;

  if (changes.length > SANITY_LIMIT) {
    console.warn(
      `  [${league.slug}] ${changes.length} status changes at once (limit ${SANITY_LIMIT}) — `
        + 'sending nothing and re-seeding. Check the injuries feed.',
    );
    if (redis && !DRY_RUN) await redisCommand(redis, ['SET', key, JSON.stringify(current)]);
    return;
  }

  const byId = new Map();
  const rawPlayers = playersJson?.players?.player;
  for (const p of Array.isArray(rawPlayers) ? rawPlayers : rawPlayers ? [rawPlayers] : []) {
    if (p?.id) byId.set(String(p.id), p);
  }

  const notifications = buildPlayerNewsNotifications({
    changes,
    playerLookup: (id) => byId.get(id),
  });

  for (const n of notifications) {
    console.log(`  [${league.slug}] ${n.franchiseId}: ${n.title} — ${n.body}`);
  }

  await sendPushFanout({
    league,
    dryRun: DRY_RUN,
    category: 'player-news',
    notifications,
  });

  // The snapshot advances only after the send is attempted, so a crash between
  // the two re-sends rather than silently swallowing the change. A duplicate
  // notification collapses onto the same per-player tag; a dropped one is gone.
  if (redis && !DRY_RUN) await redisCommand(redis, ['SET', key, JSON.stringify(current)]);
}

async function main() {
  const config = getRedisConfig();
  if (!config) {
    console.warn('[player-news] No Redis credentials — cannot diff, skipping.');
    return;
  }

  for (const league of leaguesToScan()) {
    try {
      await scanLeague(league, config);
    } catch (err) {
      console.warn(`[player-news] ${league.slug} failed: ${err.message}`);
    }
  }
}

main().catch((err) => {
  // Deliberately exit 0: see the header. Nothing downstream of this depends on
  // it, and failing the run would mask the sync that already succeeded.
  console.warn(`[player-news] Fatal: ${err.message}`);
});
