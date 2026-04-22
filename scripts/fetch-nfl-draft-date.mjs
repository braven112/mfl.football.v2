#!/usr/bin/env node
/**
 * Fetch NFL Draft dates from ESPN's core API.
 *
 * Writes the resolved "YYYY-MM-DD" date for each target year into
 * src/data/theleague/nfl-draft-dates-fetched.json. That file is merged
 * with the hand-maintained fallbacks in league-year-config.ts — a fetched
 * date wins when present, so the hardcoded values act purely as offline
 * fallbacks.
 *
 * This script is safe to run on every build (prebuild): if ESPN is down or
 * returns an unexpected shape, the JSON is left untouched and we fall back
 * to the existing dates. Exits 0 on any outcome so build is never blocked.
 *
 * Primary endpoint:
 *   https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/draft/rounds/1
 *   → expected shape includes a startDate / date ISO string for round 1
 *     (which is the Thursday NFL Draft opening night).
 *
 * Fallback endpoint:
 *   https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/draft
 *   → scan for any ISO date field and pick the earliest one.
 *
 * Usage:
 *   node scripts/fetch-nfl-draft-date.mjs              # fetch current + next league year
 *   node scripts/fetch-nfl-draft-date.mjs --year 2026  # fetch one specific year
 *   node scripts/fetch-nfl-draft-date.mjs --dry-run    # print result without writing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const OUTPUT = path.join(root, 'src/data/theleague/nfl-draft-dates-fetched.json');

// ── Year calculation (mirrors league-year.ts logic) ─────────────────────────

function getLaborDay(yr) {
  const sept1 = new Date(yr, 8, 1);
  const dow = sept1.getDay();
  const offset = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return new Date(yr, 8, 1 + offset);
}

function getCurrentLeagueYear() {
  const now = new Date();
  const calendarYear = now.getFullYear();
  const laborDay = getLaborDay(calendarYear);
  const baseYear = now >= laborDay ? calendarYear : calendarYear - 1;
  const febCutoff = new Date(calendarYear, 1, 14, 16, 45, 0, 0);
  return now >= febCutoff ? baseYear + 1 : baseYear;
}

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const yearFlagIdx = args.indexOf('--year');
const dryRun = args.includes('--dry-run');

const targetYears = yearFlagIdx !== -1
  ? [Number(args[yearFlagIdx + 1])].filter(Number.isFinite)
  : (() => {
      const cur = getCurrentLeagueYear();
      return [cur, cur + 1];
    })();

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJson(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Recursively collect any string values that parse as ISO dates */
function collectIsoDates(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    // Accept YYYY-MM-DD or full ISO 8601 with time
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.-]+Z?)?$/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) out.push({ iso: value, date: d });
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectIsoDates(v, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectIsoDates(v, out);
  }
  return out;
}

/** Convert a Date (UTC-ish from ESPN) to a YYYY-MM-DD string in US/Eastern */
function toEasternDateString(date) {
  // ESPN publishes times in UTC; the NFL Draft is in the US and the calendar
  // date that matters is the Eastern Time calendar day.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function fetchDraftDateForYear(year) {
  const urls = [
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft/rounds/1`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft`,
  ];

  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      // Prefer a top-level known field name; otherwise scan all ISO dates.
      const preferred = json.startDate ?? json.date ?? json.scheduled ?? null;
      if (preferred && typeof preferred === 'string') {
        const d = new Date(preferred);
        if (!Number.isNaN(d.getTime())) {
          return { date: toEasternDateString(d), source: url, iso: preferred };
        }
      }
      const all = collectIsoDates(json).sort((a, b) => a.date - b.date);
      if (all.length > 0) {
        return { date: toEasternDateString(all[0].date), source: url, iso: all[0].iso };
      }
      console.warn(`  ⚠ ${year}: no ISO date found at ${url}`);
    } catch (err) {
      console.warn(`  ⚠ ${year}: ${url} failed — ${err.message}`);
    }
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

function loadExisting() {
  try {
    const raw = fs.readFileSync(OUTPUT, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { dates: {} };
  }
}

async function main() {
  const existing = loadExisting();
  const dates = { ...(existing.dates ?? {}) };
  let anyUpdate = false;

  console.log(`[fetch-nfl-draft-date] target years: ${targetYears.join(', ')}`);

  for (const year of targetYears) {
    const result = await fetchDraftDateForYear(year);
    if (!result) {
      console.warn(`  ✗ ${year}: no date resolved — keeping existing value (${dates[year] ?? 'none'})`);
      continue;
    }
    const prev = dates[year];
    if (prev !== result.date) {
      dates[year] = result.date;
      anyUpdate = true;
      console.log(`  ✓ ${year}: ${prev ?? 'new'} → ${result.date} (from ${result.iso})`);
    } else {
      console.log(`  = ${year}: ${result.date} (unchanged)`);
    }
  }

  const out = {
    _comment: 'Auto-generated by scripts/fetch-nfl-draft-date.mjs. Do not edit by hand — hand-maintained fallbacks live in league-year-config.ts. Dates are ISO \'YYYY-MM-DD\' in US/Eastern (the draft\'s host timezone). Missing years fall back to the hardcoded defaults.',
    _source: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/draft/rounds/1',
    _fetchedAt: new Date().toISOString(),
    dates,
  };

  if (dryRun) {
    console.log('[fetch-nfl-draft-date] --dry-run, not writing. Would write:');
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (!anyUpdate && existing._fetchedAt) {
    // Still bump the timestamp so CI logs show the run happened
    out._fetchedAt = new Date().toISOString();
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`[fetch-nfl-draft-date] wrote ${path.relative(root, OUTPUT)}`);
}

main().catch((err) => {
  console.error('[fetch-nfl-draft-date] fatal:', err);
  // Exit 0 so prebuild is not blocked by a network hiccup.
  process.exit(0);
});
