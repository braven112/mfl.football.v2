#!/usr/bin/env node
/**
 * Remove fabricated regular-season matchups from the AFL's archived schedules.
 *
 * WHAT WENT WRONG (found 2026-08-13, while recovering 2015 from the
 * authenticated "By Franchise" view):
 *
 * `data/afl-fantasy/mfl-feeds/{2012,2013,2014,2015}/schedule.json` each carry 46
 * regular-season matchups whose SCORES are correct — they agree with
 * weekly-results.json exactly — but whose OPPONENTS are invented. 2015's paste
 * is ground truth for that season, and it refutes 24 of the 46 outright: swapping
 * any one of them in changes a franchise's official W-L-T, which the paste
 * reproduces exactly for all 24 teams. 2012 is impossible on its own terms —
 * franchise 0003 collects 7 wins from a 46-game subset while its official
 * full-season total is 6.
 *
 * The generator's fingerprint is unmistakable:
 *   - all four seasons share byte-identical per-week matchup counts
 *     (8,8,12,6,5,2,2,1,1,1 across weeks 4-13), which four different NFL seasons
 *     cannot do by chance; and
 *   - in every week the matchup count is exactly half the number of franchises
 *     holding a score that week — i.e. everyone with a score was paired off with
 *     someone else who had one, rather than a real schedule partially surviving.
 *
 * This is worse than missing data. A gap is visible and the pages already say so
 * (see describeCoverageGap in src/utils/rivalries.ts); an invented opponent
 * silently wrongs a head-to-head record and looks exactly like real history.
 *
 * The purge is deliberately evidence-gated rather than a hardcoded year list —
 * it re-derives the case each run and refuses to touch a season it cannot make.
 * Postseason weeks are never touched: those verify against three independent
 * sources through the bracket reconstruction, and the corruption is
 * regular-season only.
 *
 * Usage:
 *   node scripts/purge-fabricated-afl-schedule-weeks.mjs --league=afl
 *   node scripts/purge-fabricated-afl-schedule-weeks.mjs --league=afl --write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { bracketKindFromName } from '../src/utils/afl-bracket-kind.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const WRITE = args.includes('--write');

const SLUG = argOf('league', 'afl') === 'afl' ? 'afl-fantasy' : argOf('league', 'afl');
const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${SLUG}`);
  process.exit(1);
}

const FEEDS = path.join(ROOT, league.dataPath, 'mfl-feeds');
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const years = fs
  .readdirSync(FEEDS)
  .filter((y) => /^\d{4}$/.test(y))
  .sort();

/** First postseason week, ignoring the AFL Cup (an in-season knockout). */
function firstPlayoffWeek(brackets) {
  const starts = toArray(brackets?.playoffBrackets?.playoffBracket)
    .filter((b) => bracketKindFromName(b.name, String(b.id)) !== 'cup')
    .map((b) => Number(b.startWeek))
    .filter((n) => Number.isFinite(n) && n > 0);
  return starts.length ? Math.min(...starts) : Infinity;
}

const officialRecord = (f) => {
  const [w, l, t] = String(f?.h2hwlt ?? '').split('-').map(Number);
  if (Number.isFinite(w) && (w || l || t)) return { w: w || 0, l: l || 0, t: t || 0 };
  return { w: Number(f?.h2hw) || 0, l: Number(f?.h2hl) || 0, t: Number(f?.h2ht) || 0 };
};

/** Everything the evidence tests need, per season. */
const seasons = [];
for (const year of years) {
  const dir = path.join(FEEDS, year);
  const schedule = readJson(path.join(dir, 'schedule.json'));
  const standings = readJson(path.join(dir, 'standings.json'));
  const weekly = readJson(path.join(dir, 'weekly-results.json'));
  if (!schedule || !standings) continue;

  const cutoff = firstPlayoffWeek(readJson(path.join(dir, 'playoff-brackets.json')));
  const scoredPerWeek = new Map(
    toArray(weekly?.weeks).map((w) => [Number(w.week), Object.keys(w.scores ?? {}).length])
  );

  const weeks = [];
  const derived = new Map();
  const bump = (id, k) => {
    if (!derived.has(id)) derived.set(id, { w: 0, l: 0, t: 0 });
    derived.get(id)[k]++;
  };
  for (const wk of toArray(schedule.schedule?.weeklySchedule)) {
    const n = Number(wk.week);
    if (!(n < cutoff)) continue;
    const pairs = toArray(wk.matchup).filter((m) => toArray(m.franchise).length === 2);
    weeks.push({ week: n, matchups: pairs.length, scored: scoredPerWeek.get(n) ?? 0 });
    for (const m of pairs) {
      const [a, b] = toArray(m.franchise);
      const sa = Number(a.score);
      const sb = Number(b.score);
      if (sa > sb) { bump(a.id, 'w'); bump(b.id, 'l'); }
      else if (sa < sb) { bump(a.id, 'l'); bump(b.id, 'w'); }
      else { bump(a.id, 't'); bump(b.id, 't'); }
    }
  }

  const franchises = toArray(standings.leagueStandings?.franchise);
  const stored = weeks.reduce((a, w) => a + w.matchups, 0);
  const officialGames =
    franchises.reduce((a, f) => {
      const r = officialRecord(f);
      return a + r.w + r.l + r.t;
    }, 0) / 2;

  // Does the stored regular season simply ARE the true schedule?
  let reconciles = franchises.length > 0 && officialGames > 0;
  const impossible = [];
  for (const f of franchises) {
    const want = officialRecord(f);
    const got = derived.get(f.id) ?? { w: 0, l: 0, t: 0 };
    if (got.w !== want.w || got.l !== want.l || got.t !== want.t) reconciles = false;
    // A subset of a season can never out-count the season itself.
    if (got.w > want.w) impossible.push(`${f.id}: ${got.w} wins stored, official season total ${want.w}`);
    if (got.l > want.l) impossible.push(`${f.id}: ${got.l} losses stored, official season total ${want.l}`);
  }

  const populated = weeks.filter((w) => w.matchups > 0);
  const pairedByAvailability =
    populated.length > 0 && populated.every((w) => w.matchups * 2 === w.scored);

  seasons.push({
    year,
    dir,
    schedule,
    weeks,
    stored,
    officialGames,
    reconciles,
    impossible,
    pairedByAvailability,
    shape: populated.map((w) => `${w.week}:${w.matchups}`).join(','),
    cutoff,
  });
}

// A real schedule's per-week shape is specific to its season. A generator's is
// not — so a shape shared by two or more seasons is itself evidence.
const shapeCounts = new Map();
for (const s of seasons) {
  if (!s.shape) continue;
  shapeCounts.set(s.shape, (shapeCounts.get(s.shape) ?? 0) + 1);
}

const condemned = [];
for (const s of seasons) {
  if (s.stored === 0) continue;
  // Never touch a season whose stored regular season IS the real one.
  if (s.reconciles) continue;
  // Only partial seasons are candidates; a full-length one that merely fails to
  // reconcile is a different problem and deserves a human.
  if (s.stored >= s.officialGames) continue;
  if (!s.pairedByAvailability) continue;
  const sharedShape = (shapeCounts.get(s.shape) ?? 0) > 1;
  if (!s.impossible.length && !sharedShape) continue;
  s.reasons = [
    `${s.stored} of ${s.officialGames} regular-season games stored, and they do not reconcile with the official records`,
    'every populated week pairs exactly the franchises that hold a score that week',
    ...(s.impossible.length
      ? [`impossible on its own terms — ${s.impossible[0]}`]
      : []),
    ...(sharedShape
      ? [`per-week shape is shared with ${shapeCounts.get(s.shape) - 1} other season(s), which a real schedule cannot be`]
      : []),
  ];
  condemned.push(s);
}

console.log(`Checked ${seasons.length} ${SLUG} season(s).\n`);
for (const s of seasons.filter((x) => x.stored > 0 && x.reconciles)) {
  console.log(`${s.year}: ${s.stored} regular-season games, reconciles with the official records — keeping.`);
}
console.log('');
if (condemned.length === 0) {
  console.log('No season carries fabricated regular-season matchups. Nothing to do.');
  process.exit(0);
}

let removed = 0;
for (const s of condemned) {
  console.log(`${s.year}: FABRICATED regular season — removing ${s.stored} matchup(s) from weeks < ${s.cutoff}`);
  for (const r of s.reasons) console.log(`   • ${r}`);
  removed += s.stored;

  if (!WRITE) continue;
  for (const wk of toArray(s.schedule.schedule?.weeklySchedule)) {
    if (!(Number(wk.week) < s.cutoff)) continue;
    // Keep the week element so the feed still describes the season's length —
    // the coverage report distinguishes "week exists, no games" from "no week".
    wk.matchup = [];
  }
  fs.writeFileSync(
    path.join(s.dir, 'schedule.json'),
    JSON.stringify(s.schedule, null, 2)
  );
}

console.log(
  `\n${WRITE ? 'Removed' : 'Would remove'} ${removed} fabricated matchup(s) across ` +
    `${condemned.length} season(s): ${condemned.map((s) => s.year).join(', ')}.`
);
if (!WRITE) console.log('(dry run — pass --write to apply)');
