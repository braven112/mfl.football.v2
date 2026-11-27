/**
 * Shared data loading and formatting utilities for Schefter articles.
 * Extracted from schefter-article.mjs and schefter-scan.mjs.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../../src/config/leagues-data.mjs';

/** Load and parse a JSON file. */
export function loadJSON(filePath) {
  return fs.readFile(filePath, 'utf8').then(JSON.parse);
}

/** Like loadJSON but resolves null on missing/unparseable files. */
export async function tryLoadJSON(filePath) {
  try { return await loadJSON(filePath); } catch { return null; }
}

/**
 * Build a schedule.json-shaped object from weekly-results-raw (per-week
 * matchup arrays with scores). Fallback for past seasons whose schedule.json
 * was never fetched — played pairings are identical, and a past season has
 * no future weeks for the raw data to miss.
 */
export function scheduleFromRawResults(weeklyResultsRaw) {
  if (!Array.isArray(weeklyResultsRaw)) return null;
  const weeklySchedule = weeklyResultsRaw
    .map(w => w?.weeklyResults)
    .filter(w => w?.week && Array.isArray(w.matchup))
    .map(w => ({
      week: String(w.week),
      matchup: w.matchup
        .filter(m => (m.franchise || []).length === 2)
        .map(m => ({ franchise: m.franchise.map(f => ({ id: f.id, isHome: f.isHome ?? '0' })) })),
    }));
  if (weeklySchedule.length === 0) return null;
  return { schedule: { weeklySchedule } };
}

/** MFL names are "Last, First" — flip to "First Last". */
export function flipName(mflName) {
  if (!mflName) return 'Unknown';
  const parts = mflName.split(', ');
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : mflName;
}

/** Normalize MFL position strings to canonical form. */
export function normalizePosition(pos) {
  if (!pos) return '??';
  const upper = pos.toUpperCase();
  if (upper === 'DEF') return 'Def';
  if (['TMQB', 'TMRB', 'TMWR', 'TMTE', 'TMPK'].includes(upper)) return upper.slice(2);
  return pos;
}

/** Format raw salary number to display string ($2.5M, $425K, etc). */
export function formatSalary(raw) {
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : n % 100_000 === 0 ? 2 : 3)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

/** Format MFL defense name: "Bills, Buffalo" → "the Buffalo Bills defense" */
export function formatDefName(name) {
  const parts = name.split(', ');
  if (parts.length === 2) return `the ${parts[1]} ${parts[0]} defense`;
  return `the ${name} defense`;
}

function leagueRegistry(league = 'theleague') {
  const reg = LEAGUES[league];
  if (!reg) throw new Error(`Unknown league: ${league} (expected ${Object.keys(LEAGUES).join(' | ')})`);
  return reg;
}

/**
 * The league's transactions, read LIVE from MFL.
 *
 * The committed `mfl-feeds/<year>/transactions.json` is not a current copy:
 * the roster sync publishes through the live league-data pointer and holds
 * changed store files out of its commit (docs/claude/rules/storage-and-build.md
 * § "The roster sync publishes through the pointer"). On 2026-11-25 the git
 * copy's newest row was six days old, so the Wednesday waiver column read a
 * week with no waiver run in it and published "Zero claims, zero dollars"
 * three hours after the scanner had posted a $725K claim from the same run.
 *
 * MFL answers errors as HTTP 200, so a body without `transactions` is a
 * failure, not an empty league. Throws; the caller decides the fallback.
 * @param {string} league registry slug
 * @param {number} year league year of the feed directory being read
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function fetchLiveTransactions(league, year, { fetchImpl = fetch } = {}) {
  const reg = leagueRegistry(league);
  const url = `https://${reg.mflHost}/${year}/export?TYPE=transactions&L=${reg.id}&JSON=1`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`MFL transactions export returned ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== 'object' || !body.transactions) {
    throw new Error(`MFL transactions export carried no transactions: ${JSON.stringify(body).slice(0, 200)}`);
  }
  const rows = body.transactions.transaction ?? [];
  return { transactions: { transaction: Array.isArray(rows) ? rows : [rows] } };
}

/**
 * Resolve the main repo data directory (handles worktree paths).
 * When running from .claude/worktrees/*, we read from main repo data/.
 */
export function resolveDataDir(projectRoot, year = 2026, league = 'theleague') {
  const mainRepo = projectRoot.includes('.claude/worktrees/')
    ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
    : projectRoot;
  return path.join(mainRepo, leagueRegistry(league).dataPath, 'mfl-feeds', String(year));
}

/** Resolve path relative to the main repo (not worktree). */
export function resolveMainRepo(projectRoot) {
  return projectRoot.includes('.claude/worktrees/')
    ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
    : projectRoot;
}

/**
 * Load player master data → Map<id, {name, position, team}>
 * Names are already flipped to "First Last" format.
 */
export async function loadPlayers(dataDir) {
  const raw = await loadJSON(path.join(dataDir, 'players.json'));
  const map = new Map();
  for (const p of raw.players.player) {
    if (!p.id) continue;
    const pos = normalizePosition(p.position);
    const isDef = pos === 'Def';
    map.set(p.id, {
      name: isDef ? formatDefName(p.name) : flipName(p.name),
      rawName: p.name,
      position: pos,
      team: p.team || '??',
      isDef,
    });
  }
  return map;
}

/**
 * Load team config → Map<franchiseId, {name, abbrev, color, division}>
 * Config location comes from the registry's configPath.
 */
export async function loadTeams(projectRoot, league = 'theleague') {
  const configPath = path.join(projectRoot, ...leagueRegistry(league).configPath.split('/'));
  const config = await loadJSON(configPath);
  const map = new Map();
  for (const t of config.teams) {
    map.set(t.franchiseId, {
      name: t.name,
      abbrev: t.abbrev,
      color: t.color,
      division: t.division,
    });
  }
  return map;
}

/**
 * Load league config (franchises, schedule, salary cap).
 */
export async function loadLeague(dataDir) {
  return loadJSON(path.join(dataDir, 'league.json'));
}

/**
 * Schefter feed path for a league (default TheLeague). The two feed
 * locations differ deliberately (TheLeague's feed is a build-time src/data
 * import; AFL's lives under its dataPath) — the registry's schefterFeedPath
 * is the single source of truth.
 */
export function getFeedPath(projectRoot, league = 'theleague') {
  return path.join(projectRoot, ...leagueRegistry(league).schefterFeedPath.split('/'));
}

/** Format a player for display — DEF-aware. */
export function formatPlayerDisplay(player) {
  if (!player) return 'Unknown Player';
  if (player.isDef || player.position === 'Def') return player.name;
  return `${player.position} ${player.name}`;
}
