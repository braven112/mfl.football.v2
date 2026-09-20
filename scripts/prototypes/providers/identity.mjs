/**
 * PROTOTYPE — the identity boundary. The single place a provider's player id
 * becomes the canonical one.
 *
 * Canonical id is MFL's, deliberately: this repo keys contracts, rankings,
 * watch lists, headshots and the Schefter tagger on it, and DynastyProcess
 * publishes `mfl_id` as the PRIMARY KEY of its crosswalk — so every other
 * platform's id is already a column next to it. Re-keying would be a large
 * migration to buy nothing.
 *
 * This module is the ONLY thing allowed to hold a provider-native id.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CROSSWALK_URL =
  'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv';
const CACHE = '.cache/nflverse/db_playerids.csv';

/** Both NFLverse and DynastyProcess write the literal string `NA` for null. */
export const isBlank = (v) => {
  const s = (v ?? '').trim();
  return s === '' || s.toUpperCase() === 'NA';
};

/** RFC4180. The naive comma-split in scripts/lib/snap-counts.mjs corrupts quoted feeds. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.length === headers.length)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

let table = null;

export async function loadCrosswalk() {
  if (table) return table;
  let text;
  if (existsSync(CACHE)) text = readFileSync(CACHE, 'utf8');
  else {
    const res = await fetch(CROSSWALK_URL);
    if (!res.ok) throw new Error(`crosswalk ${res.status}`);
    text = await res.text();
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, text);
  }
  const rows = parseCsv(text);
  /** provider id -> canonical (mfl) id, one map per provider column */
  const byProvider = { sleeper: new Map(), espn: new Map(), yahoo: new Map(), fleaflicker: new Map() };
  const names = new Map();
  for (const r of rows) {
    const mfl = (r.mfl_id ?? '').trim();
    if (!mfl) continue;
    names.set(mfl, (r.name ?? '').trim() || (r.merge_name ?? '').trim());
    for (const [kind, col] of [['sleeper', 'sleeper_id'], ['espn', 'espn_id'],
                               ['yahoo', 'yahoo_id'], ['fleaflicker', 'fleaflicker_id']]) {
      const v = (r[col] ?? '').trim();
      if (!isBlank(v)) byProvider[kind].set(v, mfl);
    }
  }
  table = { byProvider, names, size: rows.length };
  return table;
}

/**
 * Translate a provider-native id to the canonical one.
 *
 * Returns null on a miss rather than guessing. A NAME-based fallback is
 * deliberately NOT offered here: a wrong id resolves a different person
 * silently, and the caller is better served knowing it has an unmatched
 * player than being handed the wrong one.
 */
export function toCanonical(kind, providerPlayerId) {
  if (kind === 'mfl') return providerPlayerId ? String(providerPlayerId) : null;
  const map = table?.byProvider?.[kind];
  if (!map) return null;
  return map.get(String(providerPlayerId)) ?? null;
}

export const canonicalName = (id) => table?.names?.get(id) ?? null;
