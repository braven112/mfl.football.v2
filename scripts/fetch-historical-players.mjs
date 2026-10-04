#!/usr/bin/env node
/**
 * Backfill `players.json` for every season directory that has none.
 *
 * The feed sync only ever fetched players for the season it was syncing, and
 * it started doing that in 2011 — so TheLeague's 2007-2010 and the AFL's
 * 2003-2010 directories carry transactions, rosters and draft results whose
 * player ids nothing can name. The franchise trade ledgers rendered those as
 * "Player #6955" (Larry Johnson) while the 2011+ players beside them resolved,
 * and the identity union and draft-results pages had the same hole.
 *
 * MFL still serves the players export for those years. A past season's player
 * list never changes, so this fetches each missing year ONCE and writes it;
 * once committed, every later run finds the file and makes no request. It runs
 * in prebuild ahead of the franchise-history and identity-union steps that
 * read these files, and it never touches a directory that already has one —
 * the current season stays on the sync's own once-a-day cadence.
 *
 * Failures are non-fatal by design: a missing year just keeps rendering ids,
 * exactly as before.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';

/** Season directories under a league's feeds dir that have no players.json. */
export function missingPlayerYears(feedsDir) {
  if (!existsSync(feedsDir)) return [];
  return readdirSync(feedsDir)
    .filter((name) => /^\d{4}$/.test(name))
    .filter((year) => !existsSync(join(feedsDir, year, 'players.json')))
    .sort();
}

async function fetchPlayers(year) {
  // Same URL the feed sync uses for the current season. The players export
  // is league-agnostic (MFL ids are global), so one fetch serves every league.
  const res = await fetch(`${HOST}/${year}/export?TYPE=players&DETAILS=1&JSON=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  // MFL returns errors as HTTP 200, so an empty or error body is a failure,
  // never a players file.
  const list = body?.players?.player;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(body?.error?.$t || 'no players in response');
  }
  return body;
}

async function main() {
  const cache = new Map(); // year → Promise<body>, shared across leagues
  let written = 0;
  let failed = 0;

  for (const league of ALL_LEAGUES) {
    if (!league.dataPath) continue;
    const feedsDir = join(ROOT, league.dataPath, 'mfl-feeds');
    for (const year of missingPlayerYears(feedsDir)) {
      if (!cache.has(year)) cache.set(year, fetchPlayers(year));
      try {
        const body = await cache.get(year);
        writeJsonIfChanged(join(feedsDir, year, 'players.json'), body);
        written++;
        console.log(`[historical-players] ${league.slug} ${year}: ${body.players.player.length} players`);
      } catch (err) {
        failed++;
        console.warn(`[historical-players] ${league.slug} ${year}: skipped (${err.message})`);
      }
    }
  }

  console.log(
    written || failed
      ? `[historical-players] wrote ${written}, skipped ${failed}`
      : '[historical-players] every season already has players.json'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
