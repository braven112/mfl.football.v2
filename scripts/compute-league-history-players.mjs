#!/usr/bin/env node
/**
 * League History — every player's score in every week he sat on a roster, for
 * Ask the History's player questions ("most points by a QB in a playoff
 * game", "most points left on the bench").
 *
 *   node scripts/compute-league-history-players.mjs --league=theleague
 *   → data/<league>/derived/league-history-players.json
 *
 * Reads only committed feeds: each season's weekly-results-raw.json (every
 * rostered player's score, starter or bench, and MFL's shouldStart flag for
 * the optimal lineup) and players.json (name and position). A week counts only
 * once league-history.json has its games, so a week still being played never
 * enters the record (the same gate the team questions use), which is why this
 * runs after compute-league-history.mjs.
 *
 * TheLeague's doubleheader weeks list a lineup once per game; it is one score,
 * so a player-week is kept once.
 *
 * Shape: `players` is id → [name, position] (the latest season's spelling),
 * `weeks` is one row per player-week:
 *   [year, week, franchiseId, playerId, score, flags]
 * flags: 1 = started, 2 = MFL's optimal lineup would have started him.
 * `missingWeeks` is year → the final weeks with no player scores in the feed.
 * One row per line, sorted, so a new week is added lines in git, not a
 * rewritten blob (storage-and-build.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const rawLeague = argOf('league', 'theleague');
const SLUG = rawLeague === 'afl' ? 'afl-fantasy' : rawLeague;
const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${rawLeague}`);
  process.exit(1);
}

const DATA = path.join(ROOT, league.dataPath);
const FEEDS = path.join(DATA, 'mfl-feeds');
const OUT = path.join(DATA, 'derived', 'league-history-players.json');

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const history = readJson(path.join(DATA, 'derived', 'league-history.json'));
if (!history?.games?.length) {
  console.log(`[league-history-players] ${SLUG}: no league-history.json, nothing to build`);
  process.exit(0);
}
// The weeks the team record already holds: final, and in a season it counts.
const finalWeeks = new Set(history.games.map((g) => `${g[0]}|${g[1]}`));

/** "Mahomes, Patrick" → "Patrick Mahomes"; a defense keeps MFL's "Chiefs, Kansas City" order flipped too. */
function displayName(raw) {
  const s = String(raw ?? '').trim();
  const i = s.indexOf(', ');
  return i > 0 ? `${s.slice(i + 2)} ${s.slice(0, i)}` : s;
}

const years = fs.existsSync(FEEDS) ? fs.readdirSync(FEEDS).filter((y) => /^\d{4}$/.test(y)).sort() : [];

const players = new Map();
const rows = [];
for (const year of years) {
  const dir = path.join(FEEDS, year);
  // Oldest first, so the latest season's name and position win.
  for (const p of toArray(readJson(path.join(dir, 'players.json'))?.players?.player)) {
    if (p?.id) players.set(String(p.id), [displayName(p.name), String(p.position ?? '')]);
  }
  const weeks = readJson(path.join(dir, 'weekly-results-raw.json'));
  if (!Array.isArray(weeks)) continue;
  const y = Number(year);
  for (const entry of weeks) {
    const wr = entry?.weeklyResults ?? entry;
    const wk = Number(wr?.week);
    if (!finalWeeks.has(`${y}|${wk}`)) continue;
    const seen = new Set();
    for (const m of toArray(wr.matchup)) {
      for (const fr of toArray(m?.franchise)) {
        for (const p of toArray(fr?.player)) {
          const score = Number(p?.score);
          if (!p?.id || p.score === undefined || p.score === '' || !Number.isFinite(score)) continue;
          const key = `${fr.id}|${p.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const flags = (p.status === 'starter' ? 1 : 0) | (p.shouldStart === '1' ? 2 : 0);
          rows.push([y, wk, String(fr.id), String(p.id), Math.round(score * 100) / 100, flags]);
        }
      }
    }
  }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || cmp(a[2], b[2]) || cmp(a[3], b[3]));
const used = new Set(rows.map((r) => r[3]));

// Weeks the team record has but the player feed does not (the AFL's 2007-2019
// feeds kept only the last weeks), so an answer can say what it could not see.
const withPlayers = new Set(rows.map((r) => `${r[0]}|${r[1]}`));
const missing = {};
for (const key of [...finalWeeks].sort()) {
  if (withPlayers.has(key)) continue;
  const [y, wk] = key.split('|').map(Number);
  (missing[y] ??= []).push(wk);
}
for (const y of Object.keys(missing)) missing[y].sort((a, b) => a - b);
const playerMap = Object.fromEntries(
  [...players.entries()].filter(([id]) => used.has(id)).sort(([a], [b]) => cmp(a, b)),
);

const body = [
  `  "generatedAt": ${JSON.stringify(new Date().toISOString())}`,
  `  "league": ${JSON.stringify(SLUG)}`,
  `  "missingWeeks": ${JSON.stringify(missing)}`,
  `  "players": {\n${Object.entries(playerMap).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n')}\n  }`,
  `  "weeks": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`,
];
const wrote = writeJsonIfChanged(OUT, `{\n${body.join(',\n')}\n}\n`, { ignoreKeys: ['generatedAt'] });
console.log(
  `[league-history-players] ${SLUG}: ${rows.length} player-weeks, ${used.size} players -> ${path.relative(ROOT, OUT)}${wrote ? '' : ' (unchanged)'}`,
);
