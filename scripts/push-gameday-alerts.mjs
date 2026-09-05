#!/usr/bin/env node
/**
 * Game-day push alerts: your matchup changed hands, and your matchup is over.
 *
 * Runs inside Roster Sync, which already fires every five minutes with a
 * checkout in hand. It no-ops on every non-game day — the gate comes from the
 * week's NFL schedule on disk rather than a list of weekdays, so Thanksgiving,
 * the Saturday slates of Weeks 16-18 and a Christmas game all work without
 * anyone remembering to add them. On a game day it costs one liveScoring
 * fetch per league per run.
 *
 * The detection is all in scripts/lib/gameday-alerts.mjs — read the header
 * there for what counts as a swing and why. This file is I/O: fetch, load
 * state, send, store state.
 *
 * Never fails the job, for the same reason push-player-news doesn't: Roster
 * Sync's real work is already committed by the time this runs.
 *
 * Usage:
 *   node scripts/push-gameday-alerts.mjs
 *   node scripts/push-gameday-alerts.mjs --dry-run
 *   node scripts/push-gameday-alerts.mjs --league afl-fantasy --week 12
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { sendPushFanout } from './lib/push-fanout.mjs';
import { getCurrentNFLWeek } from './article-utils/week-resolver.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import {
  scheduleGames,
  isGamedayNow,
  mainSlateFinal,
  parseLivePairings,
  detectGamedayAlerts,
  buildGamedayNotifications,
} from './lib/gameday-alerts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? null : process.argv[idx + 1];
}

function leaguesToScan() {
  const slug = argValue('--league');
  if (!slug) return ALL_LEAGUES.filter((l) => l.features?.liveScoring);
  const league = getLeagueBySlug(slug);
  if (!league) throw new Error(`Unknown league: ${slug}`);
  return [league];
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * League-scoped AND week-scoped. The week scope is what makes the
 * once-per-matchup-per-week caps mean "per week" rather than "ever", and the
 * league scope is not decoration — both leagues have a franchise 0001.
 */
const stateKey = (league, year, week) => `gameday:${league.navSlug}:${year}-w${week}`;

/** Expire a week's state well after the week is over, so nothing accumulates. */
const STATE_TTL_SECONDS = 14 * 24 * 60 * 60;

async function teamNamesFor(league) {
  const config = await readJson(path.join(root, league.configPath));
  const names = new Map();
  for (const t of config?.teams ?? []) {
    if (t?.franchiseId) names.set(String(t.franchiseId), t.nameShort || t.name);
  }
  return names;
}

async function scanLeague(league, redis, { feedYear, seasonYear, week, now }) {
  const feeds = path.join(root, league.dataPath, 'mfl-feeds', String(feedYear));
  const games = scheduleGames(await readJson(path.join(feeds, 'nflSchedule.json')));

  if (!isGamedayNow(games, now)) return;

  const url =
    `https://${league.mflHost}/${seasonYear}/export`
    + `?TYPE=liveScoring&L=${league.id}&W=${week}&JSON=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
  });
  // MFL answers errors with HTTP 200 and an `error` key, so `res.ok` alone is
  // not "the call worked" — check both, the same way the lineup pages must.
  if (!res.ok) {
    console.warn(`  [${league.slug}] liveScoring HTTP ${res.status} — skipping.`);
    return;
  }
  const payload = await res.json();
  if (payload?.error) {
    console.warn(`  [${league.slug}] liveScoring error: ${payload.error}`);
    return;
  }

  const pairings = parseLivePairings(payload);
  if (pairings.length === 0) return;

  const key = stateKey(league, seasonYear, week);
  const stored = await redisCommand(redis, ['HGETALL', key]);
  // Upstash returns a flat [field, value, …] array for HGETALL.
  const state = {};
  if (Array.isArray(stored)) {
    for (let i = 0; i < stored.length; i += 2) state[stored[i]] = stored[i + 1];
  } else if (stored && typeof stored === 'object') {
    Object.assign(state, stored);
  }

  const { alerts, nextState, removed } = detectGamedayAlerts({
    pairings,
    state,
    swingsAllowed: mainSlateFinal(games),
  });

  if (alerts.length > 0) {
    const teamNames = await teamNamesFor(league);
    const byCategory = { final: [], swing: [] };
    for (const alert of alerts) byCategory[alert.kind].push(alert);

    for (const [kind, category] of [
      ['swing', 'scoring-swing'],
      ['final', 'scoring-final'],
    ]) {
      if (byCategory[kind].length === 0) continue;
      const notifications = buildGamedayNotifications({
        alerts: byCategory[kind],
        teamNames,
        week,
      });
      for (const n of notifications) {
        console.log(`  [${league.slug}] ${n.franchiseId}: ${n.title} — ${n.body}`);
      }
      await sendPushFanout({ league, dryRun: DRY_RUN, category, notifications });
    }
  }

  if (DRY_RUN) return;

  // State advances even when nothing was sent: the leader is recorded on every
  // poll so the first poll after the main slate has something to compare to.
  const fields = Object.entries(nextState).flat();
  if (fields.length > 0) {
    await redisCommand(redis, ['HSET', key, ...fields]);
    await redisCommand(redis, ['EXPIRE', key, String(STATE_TTL_SECONDS)]);
  }
  // HSET cannot remove, so a leader cleared by a tie needs its own delete.
  if (removed.length > 0) await redisCommand(redis, ['HDEL', key, ...removed]);
}

async function main() {
  const redis = getRedisConfig();
  if (!redis) {
    console.warn('[gameday] No Redis credentials — cannot track state, skipping.');
    return;
  }

  const now = new Date();
  // Two clocks, deliberately. The feeds on disk are written by
  // fetch-mfl-feeds.mjs under the LEAGUE year, so that is the only year that
  // finds them; MFL's live scoring is results-shaped, so it is asked for under
  // the SEASON year. In season the two agree, which is exactly why picking the
  // wrong one here would go unnoticed until February.
  const { currentLeagueYear, currentSeasonYear } = getCurrentYears(now);
  const week = Number(argValue('--week')) || getCurrentNFLWeek(currentSeasonYear, now);
  if (!week) return;

  for (const league of leaguesToScan()) {
    try {
      await scanLeague(league, redis, {
        feedYear: currentLeagueYear,
        seasonYear: currentSeasonYear,
        week,
        now,
      });
    } catch (err) {
      console.warn(`[gameday] ${league.slug} failed: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.warn(`[gameday] Fatal: ${err.message}`);
});
