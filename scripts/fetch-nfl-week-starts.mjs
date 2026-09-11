#!/usr/bin/env node
/**
 * Refresh src/data/nfl/week-starts.mjs from MFL's nflSchedule export.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every season-relative date in this repo used to hang off one derived
 * constant: "NFL kickoff is the Thursday after Labor Day", i.e. Labor Day + 3,
 * with week N at kickoff + (N-1)*7. That rule is a good ESTIMATE and a bad
 * FACT. In 2026 alone it is wrong three times:
 *
 *   Week  1  derived Thu Sep 10   actual Wed Sep  9   (Wednesday opener)
 *   Week 12  derived Thu Nov 26   actual Wed Nov 25   (Thanksgiving shift)
 *   Week 18  derived Thu Jan  7   actual Sun Jan 10   (all-Sunday finale)
 *
 * The Week 1 miss is the one owners saw: Roger posted "TODAY: NFL Season
 * Starts" on Thursday Sep 10 2026, a day after the season actually kicked off.
 *
 * So the derivation stays as a FALLBACK (see src/utils/nfl-week-starts.mjs)
 * and the official schedule, when we have it, wins. This script fetches it.
 *
 * SOURCE
 * ------
 * MFL's `nflSchedule` export with `W=ALL` — one request per season, returning
 * `fullNflSchedule.nflSchedule[]`, one entry per week, each with the real
 * kickoff epoch for every matchup. MFL is the right source rather than ESPN
 * because MFL's week numbering IS the fantasy week numbering both leagues
 * score on, so a week boundary taken from here cannot disagree with the
 * scoring period it names.
 *
 * NOTE: like nflByeWeeks, this export must go to api.myfantasyleague.com. The
 * per-league www## hosts answer with an error payload at HTTP 200 — the usual
 * MFL trap. The writer refuses to commit a season that fails validation, so a
 * bad fetch leaves the last good file in place.
 *
 * Future seasons simply 404 until the NFL publishes them (checked 2026-09-10:
 * 2027 is Not Found), which is exactly why the derivation has to remain.
 *
 * Usage:
 *   node scripts/fetch-nfl-week-starts.mjs             # current + next season
 *   node scripts/fetch-nfl-week-starts.mjs 2024 2025   # specific seasons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGULAR_SEASON_WEEKS, derivedWeekStart, ptParts } from '../src/utils/nfl-week-starts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/nfl/week-starts.mjs');
const API = 'https://api.myfantasyleague.com';

/** Widest plausible gap between one week's first game and the next's. */
const MIN_GAP_DAYS = 3;
const MAX_GAP_DAYS = 11;

/**
 * ISO 8601 string for `instant`, expressed in the league clock (Pacific).
 *
 * Pacific rather than UTC on purpose: the calendar DATE is the load-bearing
 * half of this value — "which day does the season start" — and every consumer
 * asks that question in the league's own clock. A UTC instant answers it
 * wrong for every night game (Wed 5:20pm PT is Thursday in UTC), which is
 * precisely the off-by-one this file exists to kill.
 */
const toPacificIso = (instant) => {
  const { year, month, day, hour, minute, second, offset } = ptParts(instant);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:${p(second)}${offset}`;
};

const fetchSeason = async (year) => {
  const res = await fetch(`${API}/${year}/export?TYPE=nflSchedule&W=ALL&JSON=1`, {
    headers: { 'User-Agent': 'mfl.football NFL week starts' },
  });
  if (res.status === 404) return null; // schedule not published yet
  if (!res.ok) throw new Error(`${year}: HTTP ${res.status}`);

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null; // MFL serves an HTML 404 body for unpublished seasons
  }
  if (json?.error) throw new Error(`${year}: MFL error — ${json.error?.$t ?? json.error}`);

  const weeks = json?.fullNflSchedule?.nflSchedule;
  if (!Array.isArray(weeks) || weeks.length === 0) return null;

  const starts = {};
  for (const entry of weeks) {
    const week = Number(entry?.week);
    if (!Number.isInteger(week) || week < 1 || week > REGULAR_SEASON_WEEKS) continue;
    const kickoffs = (entry.matchup ?? [])
      .map((m) => Number(m?.kickoff))
      .filter((k) => Number.isFinite(k) && k > 0);
    // Playoff weeks come back with no matchups at all until January; a
    // regular-season week that does is a broken payload, not an empty one.
    if (!kickoffs.length) continue;
    starts[week] = new Date(Math.min(...kickoffs) * 1000);
  }
  return starts;
};

/**
 * Reject a season we should not commit. Returning a reason (rather than
 * throwing) lets one bad season leave the others — and the previous file —
 * intact.
 */
const validate = (year, starts) => {
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
    if (!starts[week]) return `week ${week} missing a kickoff`;
  }
  for (let week = 2; week <= REGULAR_SEASON_WEEKS; week += 1) {
    const gap = (starts[week] - starts[week - 1]) / 86_400_000;
    if (gap < MIN_GAP_DAYS || gap > MAX_GAP_DAYS) {
      return `week ${week} starts ${gap.toFixed(1)}d after week ${week - 1}`;
    }
  }
  return null;
};

const readExisting = async () => {
  if (!fs.existsSync(OUT)) return {};
  const { NFL_WEEK_STARTS } = await import(`${OUT}?t=${Date.now()}`);
  // Structured-clone so the frozen literal below can be rebuilt freely.
  return JSON.parse(JSON.stringify(NFL_WEEK_STARTS ?? {}));
};

const render = (seasons) => {
  const years = Object.keys(seasons)
    .map(Number)
    .sort((a, b) => a - b);
  const body = years
    .map((year) => {
      const weeks = seasons[year];
      const rows = Object.keys(weeks)
        .map(Number)
        .sort((a, b) => a - b)
        .map((week) => `    ${week}: '${weeks[week]}',`)
        .join('\n');
      return `  ${year}: {\n${rows}\n  },`;
    })
    .join('\n');

  return `/**
 * First kickoff of each NFL week, as published by MFL — GENERATED FILE.
 *
 * Regenerate with \`node scripts/fetch-nfl-week-starts.mjs\`; do not hand-edit.
 * Read it through src/utils/nfl-week-starts.mjs, never directly: that module
 * falls back to the Labor-Day derivation for seasons absent here (the NFL does
 * not publish next year's schedule until spring), and nothing else should have
 * to know which of the two it got.
 *
 * Values are ISO 8601 in the league clock (Pacific). The DATE half is the one
 * most callers want — a Wednesday opener is Thursday in UTC, and that
 * off-by-one is the bug this file exists to prevent.
 *
 * A .mjs module rather than JSON so plain node scripts, Vite and the browser
 * all import it the same way, with no fs access and no import attributes —
 * same reasoning as src/data/theleague/throwback-weeks.mjs.
 */

/** @type {Record<number, Record<number, string>>} */
export const NFL_WEEK_STARTS = {
${body}
};
`;
};

const main = async () => {
  const args = process.argv.slice(2).map(Number).filter(Number.isInteger);
  const thisYear = new Date().getFullYear();
  const targets = args.length ? args : [thisYear, thisYear + 1];

  const seasons = await readExisting();
  let changed = false;

  for (const year of targets) {
    let starts;
    try {
      starts = await fetchSeason(year);
    } catch (err) {
      console.error(`  ${year}: ${err.message} — keeping previous data`);
      continue;
    }
    if (!starts) {
      console.log(`  ${year}: schedule not published yet — falling back to the Labor Day derivation`);
      continue;
    }

    const reason = validate(year, starts);
    if (reason) {
      console.error(`  ${year}: rejected — ${reason}. Keeping previous data.`);
      continue;
    }

    const rendered = {};
    const drift = [];
    for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
      rendered[week] = toPacificIso(starts[week]);
      const derived = derivedWeekStart(year, week);
      const actual = rendered[week].slice(0, 10);
      const guess = `${derived.getFullYear()}-${String(derived.getMonth() + 1).padStart(2, '0')}-${String(derived.getDate()).padStart(2, '0')}`;
      if (guess !== actual) drift.push(`week ${week}: derived ${guess}, actual ${actual}`);
    }

    if (JSON.stringify(seasons[year]) !== JSON.stringify(rendered)) changed = true;
    seasons[year] = rendered;

    console.log(`  ${year}: ${REGULAR_SEASON_WEEKS} weeks — week 1 opens ${rendered[1].slice(0, 10)}`);
    // The whole point of the file: say out loud where the old rule was wrong.
    for (const line of drift) console.log(`      drift — ${line}`);
    if (!drift.length) console.log('      (Labor Day derivation matches every week this season)');
  }

  if (!Object.keys(seasons).length) {
    console.error('No seasons resolved and no existing file — refusing to write.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(seasons));
  console.log(changed ? `Wrote ${path.relative(ROOT, OUT)}` : `${path.relative(ROOT, OUT)} unchanged`);
};

await main();
