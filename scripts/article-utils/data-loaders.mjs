/**
 * Shared data loading and formatting utilities for Scheftner articles.
 * Extracted from scheftner-article.mjs and scheftner-scan.mjs.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Load and parse a JSON file. */
export function loadJSON(filePath) {
  return fs.readFile(filePath, 'utf8').then(JSON.parse);
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

/**
 * Resolve the main repo data directory (handles worktree paths).
 * When running from .claude/worktrees/*, we read from main repo data/.
 */
export function resolveDataDir(projectRoot, year = 2026) {
  const mainRepo = projectRoot.includes('.claude/worktrees/')
    ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
    : projectRoot;
  return path.join(mainRepo, 'data', 'theleague', 'mfl-feeds', String(year));
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
 */
export async function loadTeams(projectRoot) {
  const configPath = path.join(projectRoot, 'src', 'data', 'theleague.config.json');
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

/** Feed path for TheLeague. */
export function getFeedPath(projectRoot) {
  return path.join(projectRoot, 'src', 'data', 'theleague', 'scheftner-feed.json');
}

/** Format a player for display — DEF-aware. */
export function formatPlayerDisplay(player) {
  if (!player) return 'Unknown Player';
  if (player.isDef || player.position === 'Def') return player.name;
  return `${player.position} ${player.name}`;
}
