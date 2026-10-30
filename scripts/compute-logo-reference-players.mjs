#!/usr/bin/env node
/**
 * The NFL players a team logo name is likely to joke about, for the logo
 * prompt builder (src/utils/team-logo-references.ts).
 *
 * Fantasy team names are puns on real players ("Mahomes Alone", "Bijan
 * Mustard"). The builder spots one and asks the AI to hint at that player as
 * strongly as it can without drawing their face (Brandon, 2026-10-30). It runs
 * in the browser as the owner types, so it needs a short list, not the
 * 2,700-row MFL feed: the players every built-in ranking source rates in its
 * top 250, named from the default league's players.json. MFL player ids are
 * global, so one league's feed names them all.
 *
 * Writes src/data/team-logo-reference-players.json only when its rows change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { DEFAULT_LEAGUE_SLUG, getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', ROOT, '');
for (const [k, v] of Object.entries(fileEnv)) process.env[k] ??= v;

const OUTPUT_PATH = path.join(ROOT, 'src/data/team-logo-reference-players.json');
const TOP_N = 250;
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK']);

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};

/** The newest ranking-sources file that has any ranked players. */
function rankedIds() {
  const dir = path.join(ROOT, 'data/ranking-sources');
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort().reverse();
  for (const f of files) {
    const sources = readJson(path.join(dir, f))?.sources ?? [];
    const ids = new Set();
    for (const s of sources) for (const p of (s.players ?? []).slice(0, TOP_N)) ids.add(String(p.id));
    if (ids.size) return ids;
  }
  return new Set();
}

/** The default league's newest players.json, walking back from the league year. */
function playersFeed() {
  const league = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
  const { currentLeagueYear } = getCurrentYears();
  for (let year = currentLeagueYear; year >= currentLeagueYear - 2; year -= 1) {
    const rows = readJson(path.join(ROOT, league.dataPath, 'mfl-feeds', String(year), 'players.json'))?.players?.player;
    if (Array.isArray(rows) && rows.length) return rows;
  }
  return [];
}

const ids = rankedIds();
const rows = playersFeed()
  .filter((p) => ids.has(String(p.id)) && POSITIONS.has(p.position))
  .map((p) => {
    const [last, first] = String(p.name).split(',').map((s) => s.trim());
    return { name: first ? `${first} ${last}` : last, position: p.position, team: p.team };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (!rows.length) {
  console.warn('[compute-logo-reference-players] no players found; leaving the file as it is');
  process.exit(0);
}
const wrote = writeJsonIfChanged(OUTPUT_PATH, { players: rows });
console.log(`[compute-logo-reference-players] ${rows.length} players${wrote ? '' : ' (unchanged)'}`);
