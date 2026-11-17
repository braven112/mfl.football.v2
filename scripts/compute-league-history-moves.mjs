#!/usr/bin/env node
/**
 * League History — every roster move on record, for Ask the History's
 * questions about trades, drafts, waiver pickups and auctions ("the most
 * lopsided trade ever", "the best waiver pickup", "the best 3rd-round pick").
 *
 *   node scripts/compute-league-history-moves.mjs --league=theleague
 *   → data/<league>/derived/league-history-moves.json
 *
 * Reads only committed feeds, per league-year directory: transactions.json,
 * draftResults.json, auctionResults.json (TheLeague's salary auction) and
 * players.json. A feed directory is keyed by the LEAGUE year (CLAUDE.md), and
 * a league year's moves are made for the season of the same number: the
 * offseason before it and the season itself.
 *
 * What a move's PLAYER went on to score is not stored here: the engine joins
 * it to league-history-players.json (ask-moves.mjs), so a week that becomes
 * final changes one file, not two.
 *
 * MFL shapes (see docs/claude/rules/schefter.md on transaction parsing):
 * - TRADE: `franchise1_gave_up` / `franchise2_gave_up`, comma lists of player
 *   ids and pick tokens (FP_ / DP_, mfl-pick-tokens.mjs).
 * - FREE_AGENT: `transaction` is "added|dropped" ("16164,|" adds, "|16608,"
 *   drops).
 * - WAIVER: `added` / `dropped` fields.
 * - BBID_WAIVER: `transaction` is "added|bid|dropped".
 *
 * Shape (one row per line, sorted, so a new move is an added line in git):
 *   trades:   [year, date, week, franchiseA, franchiseB, aGaveUp, bGaveUp]
 *   pickups:  [year, date, week, franchise, playerId, how, bid]
 *             how: "waiver" (a claim, blind bid or not) | "free agent"
 *   drafts:   [year, draftUnit, round, pick, overall, franchise, playerId,
 *              date, week, tradedFrom]
 *             tradedFrom: the franchise MFL's own draft comment says the pick
 *             was "traded from" (2018 on): the LAST team to trade it away,
 *             not necessarily its original owner. null is "not stated",
 *             never "not traded".
 *   auctions: [year, franchise, playerId, winningBid, date, week]
 *   drops:    [year, date, week, franchise, playerId]
 *             every release on record (free agent, waiver and blind-bid drops,
 *             commissioner roster loads), so a player's stint with a team has
 *             a dated end (stints.mjs).
 *   adds:     [year, date, week, franchise, playerId, how, bid]
 *             acquisitions that are not pickups, drafts or auction results:
 *             how "auction" (an AUCTION_WON outside auctionResults.json, e.g. an
 *             in-season free-agent auction) | "commissioner" (LOAD_ROSTERS).
 *   players:  id → [name, position], for ids the player-week file may not have
 * `date` is the Pacific calendar day; `week` is the NFL week that was current
 * then (nflWeekFor: 0 before kickoff), so "what he scored after the trade"
 * counts that week on. Both are computed here, once, rather than per request.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { derivedVersion } from './lib/derived-versions.mjs';
import { nflWeekFor, ptParts } from '../src/utils/nfl-week-starts.mjs';

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
const OUT = path.join(DATA, 'derived', 'league-history-moves.json');

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const ids = (s) =>
  String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const isPlayerId = (s) => /^\d+$/.test(s);

const pad = (n) => String(n).padStart(2, '0');
const whenCache = new Map();
/** [Pacific date, NFL week] for a move's timestamp, cached by the hour. */
function when(year, ts) {
  const key = `${year}|${Math.floor(ts / 3600)}`;
  if (!whenCache.has(key)) {
    const instant = new Date(ts * 1000);
    const { year: y, month, day } = ptParts(instant);
    whenCache.set(key, [`${y}-${pad(month)}-${pad(day)}`, nflWeekFor(year, instant)]);
  }
  return whenCache.get(key);
}

/** "Mahomes, Patrick" → "Patrick Mahomes" (compute-league-history-players.mjs). */
function displayName(raw) {
  const s = String(raw ?? '').trim();
  const i = s.indexOf(', ');
  return i > 0 ? `${s.slice(i + 2)} ${s.slice(0, i)}` : s;
}

const history = readJson(path.join(DATA, 'derived', 'league-history.json'));
const seasons = new Set((history?.seasons ?? []).map((s) => s.y));
if (!seasons.size) {
  console.log(`[league-history-moves] ${SLUG}: no league-history.json, nothing to build`);
  process.exit(0);
}

const years = fs.existsSync(FEEDS) ? fs.readdirSync(FEEDS).filter((y) => /^\d{4}$/.test(y) && seasons.has(Number(y))).sort() : [];

/**
 * A franchise named in a draft comment ("[Pick traded from Pacific
 * Pigskins.]"), resolved by the names that league year's own league.json
 * used, then by the names league-history.json records for that season and its
 * neighbours (a team renamed between the trade and the draft). null when no
 * name matches: unresolved stays unresolved.
 */
const historyNames = new Map();
for (const s of history?.seasons ?? []) {
  for (const [f, t] of Object.entries(s.teams ?? {})) {
    const key = String(t?.n ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!historyNames.has(key)) historyNames.set(key, []);
    historyNames.get(key).push([s.y, f]);
  }
}
function franchiseNamed(name, y, leagueNames) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  if (leagueNames.has(key)) return leagueNames.get(key);
  const hits = (historyNames.get(key) ?? []).slice().sort((a, b) => Math.abs(a[0] - y) - Math.abs(b[0] - y));
  return hits[0]?.[1] ?? null;
}
const TRADED_FROM = /\[Pick traded from (.+?)\.\]/;

const players = new Map();
const trades = [];
const pickups = [];
const drafts = [];
const auctions = [];
const drops = [];
const adds = [];
for (const year of years) {
  const dir = path.join(FEEDS, year);
  const y = Number(year);
  const leagueNames = new Map(
    toArray(readJson(path.join(dir, 'league.json'))?.league?.franchises?.franchise)
      .filter((f) => f?.id && f?.name)
      .map((f) => [String(f.name).trim().toLowerCase(), String(f.id)]),
  );
  const auctionWins = [];
  for (const p of toArray(readJson(path.join(dir, 'players.json'))?.players?.player)) {
    if (p?.id) players.set(String(p.id), [displayName(p.name), String(p.position ?? '')]);
  }

  for (const tx of toArray(readJson(path.join(dir, 'transactions.json'))?.transactions?.transaction)) {
    const ts = Number(tx?.timestamp);
    const f = String(tx?.franchise ?? '');
    if (!Number.isFinite(ts) || !f) continue;
    if (tx.type === 'TRADE') {
      if (!tx.franchise2) continue;
      trades.push([y, ...when(y, ts), f, String(tx.franchise2), ids(tx.franchise1_gave_up).join(','), ids(tx.franchise2_gave_up).join(',')]);
    } else if (tx.type === 'FREE_AGENT') {
      const [added, dropped] = String(tx.transaction ?? '').split('|');
      for (const pid of ids(added).filter(isPlayerId)) pickups.push([y, ...when(y, ts), f, pid, 'free agent', null]);
      for (const pid of ids(dropped).filter(isPlayerId)) drops.push([y, ...when(y, ts), f, pid]);
    } else if (tx.type === 'WAIVER') {
      for (const pid of ids(tx.added).filter(isPlayerId)) pickups.push([y, ...when(y, ts), f, pid, 'waiver', null]);
      for (const pid of ids(tx.dropped).filter(isPlayerId)) drops.push([y, ...when(y, ts), f, pid]);
    } else if (tx.type === 'BBID_WAIVER') {
      const [added, bid, dropped] = String(tx.transaction ?? '').split('|');
      const amount = Number(bid);
      for (const pid of ids(added).filter(isPlayerId)) pickups.push([y, ...when(y, ts), f, pid, 'waiver', Number.isFinite(amount) ? amount : null]);
      for (const pid of ids(dropped).filter(isPlayerId)) drops.push([y, ...when(y, ts), f, pid]);
    } else if (tx.type === 'LOAD_ROSTERS') {
      const [added, dropped] = String(tx.transaction ?? '').split('|');
      for (const pid of ids(added).filter(isPlayerId)) adds.push([y, ...when(y, ts), f, pid, 'commissioner', null]);
      for (const pid of ids(dropped).filter(isPlayerId)) drops.push([y, ...when(y, ts), f, pid]);
    } else if (tx.type === 'AUCTION_WON') {
      const [pid, bid] = String(tx.transaction ?? '').split('|');
      const amount = Number(bid);
      if (isPlayerId(pid)) auctionWins.push([y, ...when(y, ts), f, pid, 'auction', Number.isFinite(amount) ? amount : null]);
    }
  }

  for (const unit of toArray(readJson(path.join(dir, 'draftResults.json'))?.draftResults?.draftUnit)) {
    const picks = toArray(unit?.draftPick)
      .filter((p) => p?.player && p?.franchise)
      .map((p) => ({
        round: Number(p.round),
        pick: Number(p.pick),
        f: String(p.franchise),
        pid: String(p.player),
        ts: Number(p.timestamp),
        from: TRADED_FROM.exec(String(p.comments ?? ''))?.[1] ?? null,
      }))
      .filter((p) => Number.isFinite(p.round) && Number.isFinite(p.pick))
      .sort((a, b) => a.round - b.round || a.pick - b.pick);
    // Overall number counts the picks actually made: rounds are not uniform
    // (TheLeague's run 16/17/18), so round × size would be wrong.
    picks.forEach((p, i) => {
      const at = p.ts > 0 ? when(y, p.ts) : [null, null];
      const from = p.from ? franchiseNamed(p.from, y, leagueNames) : null;
      drafts.push([y, String(unit.unit ?? ''), p.round, p.pick, i + 1, p.f, p.pid, ...at, from]);
    });
  }

  const won = new Set();
  for (const unit of toArray(readJson(path.join(dir, 'auctionResults.json'))?.auctionResults?.auctionUnit)) {
    for (const a of toArray(unit?.auction)) {
      const bid = Number(a?.winningBid);
      if (!a?.player || !a?.franchise || !Number.isFinite(bid)) continue;
      const ts = Number(a.lastBidTime);
      auctions.push([y, String(a.franchise), String(a.player), bid, ...(ts > 0 ? when(y, ts) : [null, null])]);
      won.add(`${a.franchise}|${a.player}`);
    }
  }
  // An AUCTION_WON the auction results do not list (a free-agent auction run
  // outside the main one) is still how the team got him.
  for (const a of auctionWins) if (!won.has(`${a[3]}|${a[4]}`)) adds.push(a);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byAll = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    const d = typeof a[i] === 'number' && typeof b[i] === 'number' ? a[i] - b[i] : cmp(String(a[i] ?? ''), String(b[i] ?? ''));
    if (d) return d;
  }
  return 0;
};
for (const list of [trades, pickups, drafts, auctions, drops, adds]) list.sort(byAll);

const used = new Set([
  ...trades.flatMap((t) => [...t[5].split(','), ...t[6].split(',')].filter(isPlayerId)),
  ...pickups.map((p) => p[4]),
  ...drafts.map((d) => d[6]),
  ...auctions.map((a) => a[2]),
  ...adds.map((a) => a[4]),
]);
const playerMap = Object.fromEntries([...players.entries()].filter(([id]) => used.has(id)).sort(([a], [b]) => cmp(a, b)));

const lines = (rows) => (rows.length ? `[\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]` : '[]');
const body = [
  `  "generatedAt": ${JSON.stringify(new Date().toISOString())}`,
  `  "league": ${JSON.stringify(SLUG)}`,
  `  "version": ${derivedVersion('league-history-moves.json')}`,
  `  "players": {\n${Object.entries(playerMap).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n')}\n  }`,
  `  "trades": ${lines(trades)}`,
  `  "pickups": ${lines(pickups)}`,
  `  "drafts": ${lines(drafts)}`,
  `  "auctions": ${lines(auctions)}`,
  `  "drops": ${lines(drops)}`,
  `  "adds": ${lines(adds)}`,
];
const wrote = writeJsonIfChanged(OUT, `{\n${body.join(',\n')}\n}\n`, { ignoreKeys: ['generatedAt'] });
console.log(
  `[league-history-moves] ${SLUG}: ${trades.length} trades, ${pickups.length} pickups, ${drafts.length} draft picks, ${auctions.length} auction wins, ${drops.length} drops, ${adds.length} other adds -> ${path.relative(ROOT, OUT)}${wrote ? '' : ' (unchanged)'}`,
);
