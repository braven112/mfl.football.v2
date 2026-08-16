#!/usr/bin/env node
/**
 * Precompute the all-years player identity union.
 *
 * `getGlobalPlayerMap()` needs one thing: given an MFL player id from any
 * season, what is that player's name/position/team/espn id. MFL ids are global
 * and stable, so the answer is a single ~8k-row table — but it used to be
 * derived at RUNTIME by reading every season's `players.json` off disk and
 * unioning them. That is 23.5 MB of I/O per cold start to produce ~1 MB of
 * answer, and because the scan was a `readdirSync` on a `process.cwd()` path,
 * Vercel's file tracer could not tell which files were needed and copied the
 * whole `data/` tree into the serverless function (165 MB of a 262 MB bundle,
 * against a 250 MB limit).
 *
 * Past seasons are immutable — 2011's player list will never change again — so
 * the union is a build artifact, not a request-time computation. This writes it
 * once; the current season's feed still refreshes on its normal sync cadence
 * and later years overwrite earlier ones, so a player's row always reflects the
 * freshest season he appears in.
 *
 * Fields are limited to what `toIdentity()` in src/utils/player-map.ts consumes.
 * Everything else in the feed (draft round/pick, salary, status, ...) is
 * per-season data that a cross-season identity lookup has no business carrying.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Mirrors FANTASY_POSITIONS in src/utils/player-map.ts. */
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'Def']);

/** Only the fields toIdentity() reads. */
const KEPT_FIELDS = ['id', 'name', 'position', 'team', 'espn_id', 'draft_year'];

function buildUnion(feedsDir) {
  let years = [];
  try {
    years = readdirSync(feedsDir)
      .filter((name) => /^\d{4}$/.test(name))
      .map(Number)
      .sort((a, b) => a - b); // ascending → later years overwrite earlier
  } catch {
    return { years: [], players: [] };
  }

  const merged = new Map();
  const seenYears = [];

  for (const year of years) {
    const filePath = join(feedsDir, String(year), 'players.json');
    if (!existsSync(filePath)) continue;

    let players;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      players = raw?.players?.player;
    } catch {
      continue; // malformed feed — skip the year rather than fail the build
    }
    if (!players) continue;

    seenYears.push(year);
    for (const p of Array.isArray(players) ? players : [players]) {
      if (!p?.id || !FANTASY_POSITIONS.has(p.position || '')) continue;
      const row = {};
      for (const f of KEPT_FIELDS) if (p[f] != null && p[f] !== '') row[f] = p[f];
      merged.set(p.id, row);
    }
  }

  // Sort by id so the artifact is stable across runs — an unordered rebuild
  // would churn the diff on every feed sync for no content change.
  const players = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { years: seenYears, players };
}

const league = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1] || 'theleague';
const feedsDir = join(ROOT, 'data', league, 'mfl-feeds');
const outPath = join(ROOT, 'data', league, 'derived', 'player-identity-union.json');

const { years, players } = buildUnion(feedsDir);

if (!players.length) {
  console.error(`[player-identity-union] no players found under ${feedsDir} — refusing to write an empty artifact`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
// Compact, not pretty-printed: this is machine-read only, and it ships inside
// the serverless function where every byte counts against the size limit.
writeFileSync(outPath, JSON.stringify({ league, years, players }));

const bytes = readFileSync(outPath).length;
console.log(
  `[player-identity-union] ${players.length} players from ${years.length} seasons ` +
    `(${years[0]}–${years[years.length - 1]}) → ${(bytes / 1048576).toFixed(2)} MB`
);
