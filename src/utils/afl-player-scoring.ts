/**
 * AFL player-scoring helpers.
 *
 * Surfaces per-player weekly scoring data for the Coach-mode columns on
 * the AFL roster page. Mirrors how TheLeague's roster page computes
 * Avg / Projected, but reads the AFL feeds (data/afl-fantasy/mfl-feeds/...).
 *
 * The committed snapshots vary in coverage: most seasons only have the
 * latest week of scores plus a (sometimes empty) projection. Helpers
 * here are defensive — every getter returns null when data is missing,
 * so the caller can render an em dash.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ScoreEntry {
  id: string;
  week: string;
  score: string;
}

interface PlayerScoresFile {
  playerScores?: { week?: string; playerScore?: ScoreEntry | ScoreEntry[] };
}

interface ProjectedScoresFile {
  projectedScores?: { week?: string; playerScore?: ScoreEntry | ScoreEntry[] };
}

export interface PlayerScoreAggregate {
  /** Most recent week's score for this player, if available. */
  lastScore: number | null;
  /** Week number that lastScore came from. */
  lastWeek: number | null;
  /** Mean of every recorded weekly score (null when no entries). */
  average: number | null;
  /** Number of weeks the average is computed across. */
  sampleSize: number;
}

const playerScoresCache = new Map<string, Map<string, ScoreEntry[]>>();
const projectionsCache = new Map<string, Map<string, number>>();

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function ensureArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Load every available playerScores.json for the given AFL season and
 * fold them into a {playerId → score entries} map. Cached per year.
 */
export function loadAflPlayerScores(year: number): Map<string, ScoreEntry[]> {
  const cacheKey = String(year);
  const hit = playerScoresCache.get(cacheKey);
  if (hit) return hit;

  const path = resolve(
    process.cwd(),
    `data/afl-fantasy/mfl-feeds/${year}/playerScores.json`
  );
  const file = readJson<PlayerScoresFile>(path);
  const entries = ensureArray(file?.playerScores?.playerScore);

  const map = new Map<string, ScoreEntry[]>();
  for (const entry of entries) {
    if (!entry?.id || !entry?.week) continue;
    const list = map.get(entry.id) ?? [];
    list.push(entry);
    map.set(entry.id, list);
  }
  // Newest-first within each player's list so the "last week" pull is O(1)
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.week) - Number(a.week));
  }
  playerScoresCache.set(cacheKey, map);
  return map;
}

/**
 * Load the projectedScores.json snapshot for the given AFL season as a
 * {playerId → projected points} map. Cached per year.
 */
export function loadAflProjections(year: number): Map<string, number> {
  const cacheKey = String(year);
  const hit = projectionsCache.get(cacheKey);
  if (hit) return hit;

  const path = resolve(
    process.cwd(),
    `data/afl-fantasy/mfl-feeds/${year}/projectedScores.json`
  );
  const file = readJson<ProjectedScoresFile>(path);
  const entries = ensureArray(file?.projectedScores?.playerScore);
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry?.id) continue;
    const n = parseFloat(entry.score);
    if (Number.isFinite(n) && n > 0) {
      map.set(entry.id, n);
    }
  }
  projectionsCache.set(cacheKey, map);
  return map;
}

/**
 * Compute the per-player aggregate (last score, week, average) from a
 * pre-loaded scoreboard map. Returns nulls when no entries exist.
 */
export function aggregateScores(
  scoresByPlayer: Map<string, ScoreEntry[]>,
  playerId: string
): PlayerScoreAggregate {
  const entries = scoresByPlayer.get(playerId);
  if (!entries || entries.length === 0) {
    return { lastScore: null, lastWeek: null, average: null, sampleSize: 0 };
  }
  let total = 0;
  let count = 0;
  for (const e of entries) {
    const n = parseFloat(e.score);
    if (Number.isFinite(n)) {
      total += n;
      count += 1;
    }
  }
  const first = entries[0]; // already newest-first
  const last = parseFloat(first.score);
  return {
    lastScore: Number.isFinite(last) ? last : null,
    lastWeek: first.week ? parseInt(first.week, 10) : null,
    average: count > 0 ? total / count : null,
    sampleSize: count,
  };
}
