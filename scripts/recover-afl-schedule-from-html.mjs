#!/usr/bin/env node
/**
 * Recover regular-season head-to-head pairings from MFL's "By Franchise"
 * schedule view, which renders them for a logged-in league member even when
 * the export API does not.
 *
 * Background: MFL's `TYPE=schedule` export returns the AFL's archived
 * regular-season weeks with the matchups stripped — see
 * docs/claude/insights/domains/mfl-api.md. Anonymous HTML requests are no
 * better (the site answers as `Guest`). But an authenticated commissioner view
 * of Fantasy Schedule → "By Franchise" prints every game, so that page's text,
 * saved under data/<league>/schedule-recovery/<year>.txt, is the source here.
 *
 * Input format, one row per franchise, one cell per week, cells holding one or
 * TWO games (the AFL plays doubleheaders in some weeks):
 *
 *   Smokane FC   W @CSKA (153.96-105.19)
 *   W TITS (153.96-144.34)   W MINT (182.72-97.34)   ...
 *
 * `W`/`L`/`T` is the result, `@` marks an away game, the abbreviation is the
 * OPPONENT, and the parenthesised pair is (our score - their score).
 *
 * WEEK NUMBERS ARE NOT PARSED FROM LAYOUT. The pasted text has no reliable
 * cell boundaries, so each game's week is recovered by matching its own-score
 * against that franchise's per-week score in the committed
 * weekly-results.json. That is a join against data MFL already gave us, which
 * makes the week assignment evidence rather than a guess — and it means a
 * mis-parsed score cannot silently land in the wrong week; it fails to match
 * at all.
 *
 * Nothing is written unless every check passes:
 *   - every game appears from BOTH sides with mirrored scores
 *   - every game's week resolves unambiguously from the score join
 *   - each franchise's resulting W-L-T equals standings.json exactly
 *   - existing (postseason) weeks are never overwritten
 *
 * Usage:
 *   node scripts/recover-afl-schedule-from-html.mjs --league=afl --year=2019
 *   node scripts/recover-afl-schedule-from-html.mjs --league=afl --year=2019 --write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const WRITE = args.includes('--write');

const SLUG = argOf('league', 'afl') === 'afl' ? 'afl-fantasy' : argOf('league', 'afl');
const YEAR = String(argOf('year', ''));
if (!YEAR) {
  console.error('--year is required');
  process.exit(1);
}

const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${SLUG}`);
  process.exit(1);
}

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const YEAR_DIR = path.join(ROOT, league.dataPath, 'mfl-feeds', YEAR);
const SOURCE = path.join(ROOT, league.dataPath, 'schedule-recovery', `${YEAR}.txt`);
const SCHEDULE_PATH = path.join(YEAR_DIR, 'schedule.json');

const raw = fs.existsSync(SOURCE) ? fs.readFileSync(SOURCE, 'utf8') : null;
if (!raw) {
  console.error(`No saved schedule text at ${SOURCE}`);
  process.exit(1);
}

const leagueJson = readJson(path.join(YEAR_DIR, 'league.json'));
const franchises = toArray(leagueJson?.league?.franchises?.franchise);
if (franchises.length === 0) {
  console.error(`No league.json franchises for ${YEAR}`);
  process.exit(1);
}

const idByAbbrev = new Map();
const idByName = new Map();
for (const f of franchises) {
  if (f.abbrev) idByAbbrev.set(String(f.abbrev).trim().toUpperCase(), f.id);
  if (f.name) idByName.set(String(f.name).trim(), f.id);
}

// --- Per-franchise, per-week scores from the committed feed. This is what
// turns a parsed game into a dated one. ---
const weekly = readJson(path.join(YEAR_DIR, 'weekly-results.json'));
const scoreToWeeks = new Map(); // franchiseId -> Map(scoreString -> [weeks])
for (const wk of toArray(weekly?.weeks)) {
  const week = Number(wk.week);
  for (const [fid, score] of Object.entries(wk.scores ?? {})) {
    const key = Number(score).toFixed(2);
    if (!scoreToWeeks.has(fid)) scoreToWeeks.set(fid, new Map());
    const m = scoreToWeeks.get(fid);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(week);
  }
}

// --- Parse ---
// Rows start with a franchise name; games are matched anywhere in the row, in
// document order. Layout is deliberately ignored (see header).
const GAME_RE = /\b([WLT])\s+(@?)([A-Z0-9]+)\s*\(\s*([\d.]+)\s*-\s*([\d.]+)\s*\)/g;

// Longest name first: one franchise name can be a prefix of another ("Balls
// Deep" / "Balls Deep II"), and a shortest-match would silently file the
// longer team's whole season under the shorter one.
const namesByLength = [...idByName.keys()].sort((a, b) => b.length - a.length);

const lines = raw.split('\n');
const rowsByFranchise = new Map();
let current = null;
for (const line of lines) {
  const nameMatch = namesByLength.find((n) => line.startsWith(n));
  if (nameMatch) {
    current = idByName.get(nameMatch);
    if (!rowsByFranchise.has(current)) rowsByFranchise.set(current, []);
    rowsByFranchise.get(current).push(line.slice(nameMatch.length));
    continue;
  }
  if (current) rowsByFranchise.get(current).push(line);
}

const problems = [];
const parsedGames = []; // { week, home, away, homeScore, awayScore, from }

for (const [fid, rowLines] of rowsByFranchise) {
  const text = rowLines.join(' ');
  const seenScores = new Map(); // score -> how many times used, for doubleheaders
  let m;
  GAME_RE.lastIndex = 0;
  while ((m = GAME_RE.exec(text))) {
    const [, , atSign, oppAbbrev, ownStr, oppStr] = m;
    const oppId = idByAbbrev.get(oppAbbrev.toUpperCase());
    if (!oppId) {
      problems.push(`${fid}: unknown opponent abbreviation "${oppAbbrev}"`);
      continue;
    }
    const ownScore = Number(ownStr);
    const oppScore = Number(oppStr);

    // Resolve the week by score join. Doubleheaders share an own-score, so a
    // score mapping to one week can legitimately be used twice.
    const candidates = scoreToWeeks.get(fid)?.get(ownScore.toFixed(2)) ?? [];
    if (candidates.length === 0) {
      problems.push(
        `${fid}: scored ${ownScore} vs ${oppAbbrev}, but no week in weekly-results.json has that score`
      );
      continue;
    }
    let week;
    if (candidates.length === 1) {
      week = candidates[0];
    } else {
      // Ambiguous own-score: disambiguate by the opponent's score that week.
      const viable = candidates.filter((w) => {
        const oppWeekScore = toArray(weekly?.weeks).find((x) => Number(x.week) === w)?.scores?.[oppId];
        return oppWeekScore != null && Number(oppWeekScore).toFixed(2) === oppScore.toFixed(2);
      });
      if (viable.length !== 1) {
        problems.push(
          `${fid}: score ${ownScore} vs ${oppAbbrev} matches ${candidates.length} weeks and the opponent score does not disambiguate`
        );
        continue;
      }
      week = viable[0];
    }

    const useKey = `${week}:${ownScore.toFixed(2)}`;
    seenScores.set(useKey, (seenScores.get(useKey) ?? 0) + 1);

    const isAway = atSign === '@';
    parsedGames.push({
      week,
      home: isAway ? oppId : fid,
      away: isAway ? fid : oppId,
      homeScore: isAway ? oppScore : ownScore,
      awayScore: isAway ? ownScore : oppScore,
      from: fid,
    });
  }
}

// --- Reconcile the two sides of every game ---
const byKey = new Map();
for (const g of parsedGames) {
  const key = `${g.week}:${[g.home, g.away].sort().join(':')}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(g);
}

/** That franchise's score in that week, per MFL's own weekly results. */
const officialScore = (fid, week) => {
  const s = toArray(weekly?.weeks).find((x) => Number(x.week) === week)?.scores?.[fid];
  return s == null ? null : Number(s).toFixed(2);
};

const games = [];
const corroborated = [];
for (const [key, sides] of byKey) {
  const [a, b] = sides;
  if (sides.length !== 2) {
    // Normally every game appears twice — once from each franchise's row — and
    // the two must agree. A single side usually means the paste was truncated
    // mid-token (the 2019 source lost its final closing paren that way), which
    // should not cost an otherwise clean 204-game season.
    //
    // Accept a lone side only when MFL's own weekly-results.json independently
    // confirms BOTH franchises' scores for that week. That is corroboration
    // from a different feed rather than trust in the parse.
    if (sides.length === 1) {
      const g = sides[0];
      const homeOk = officialScore(g.home, g.week) === g.homeScore.toFixed(2);
      const awayOk = officialScore(g.away, g.week) === g.awayScore.toFixed(2);
      if (homeOk && awayOk) {
        games.push({ week: g.week, home: g.home, away: g.away, homeScore: g.homeScore, awayScore: g.awayScore });
        corroborated.push(key);
        continue;
      }
    }
    problems.push(
      `${key}: seen from ${sides.length} side(s), expected 2, and weekly-results.json does not corroborate both scores`
    );
    continue;
  }
  const mirrored =
    a.home === b.home &&
    a.away === b.away &&
    a.homeScore.toFixed(2) === b.homeScore.toFixed(2) &&
    a.awayScore.toFixed(2) === b.awayScore.toFixed(2);
  if (!mirrored) {
    problems.push(`${key}: the two sides disagree (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
    continue;
  }
  games.push({ week: a.week, home: a.home, away: a.away, homeScore: a.homeScore, awayScore: a.awayScore });
}

// --- Verify against standings ---
const standings = readJson(path.join(YEAR_DIR, 'standings.json'));
const parseRec = (f) => {
  const [w, l, t] = String(f?.h2hwlt ?? '').split('-').map(Number);
  if (Number.isFinite(w) && (w || l || t)) return { w: w || 0, l: l || 0, t: t || 0 };
  return { w: Number(f?.h2hw) || 0, l: Number(f?.h2hl) || 0, t: Number(f?.h2ht) || 0 };
};

const derived = new Map();
const bump = (fid, key) => {
  if (!derived.has(fid)) derived.set(fid, { w: 0, l: 0, t: 0 });
  derived.get(fid)[key]++;
};
for (const g of games) {
  if (g.homeScore > g.awayScore) { bump(g.home, 'w'); bump(g.away, 'l'); }
  else if (g.homeScore < g.awayScore) { bump(g.home, 'l'); bump(g.away, 'w'); }
  else { bump(g.home, 't'); bump(g.away, 't'); }
}

const recordMismatches = [];
for (const f of toArray(standings?.leagueStandings?.franchise)) {
  const want = parseRec(f);
  const got = derived.get(f.id) ?? { w: 0, l: 0, t: 0 };
  if (want.w !== got.w || want.l !== got.l || want.t !== got.t) {
    recordMismatches.push(
      `  ${f.id}: parsed ${got.w}-${got.l}-${got.t}, MFL standings say ${want.w}-${want.l}-${want.t}`
    );
  }
}

// --- Report ---
const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
console.log(`Recovered ${games.length} games for ${SLUG} ${YEAR} across weeks ${weeks.join(', ')}`);
if (corroborated.length) {
  console.log(
    `${corroborated.length} game(s) appeared from one side only and were accepted on ` +
    `weekly-results corroboration: ${corroborated.join(', ')}`
  );
}
if (problems.length) {
  console.log(`\n${problems.length} parse problem(s):`);
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  if (problems.length > 20) console.log(`  … ${problems.length - 20} more`);
}
if (recordMismatches.length) {
  console.log(`\n${recordMismatches.length} franchise record mismatch(es):`);
  recordMismatches.forEach((m) => console.log(m));
} else {
  console.log('Every franchise W-L-T matches MFL standings exactly.');
}

const ok = problems.length === 0 && recordMismatches.length === 0;
console.log(`\nVerdict: ${ok ? 'VERIFIED' : 'FAILED — nothing will be written'}`);
if (!ok) process.exit(1);
if (!WRITE) {
  console.log('(dry run — pass --write to merge into schedule.json)');
  process.exit(0);
}

// --- Merge, never overwriting a week MFL already gave us ---
const schedule = readJson(SCHEDULE_PATH) ?? { schedule: { weeklySchedule: [] } };
const existing = toArray(schedule.schedule?.weeklySchedule);
const existingByWeek = new Map(existing.map((wk) => [String(wk.week), wk]));

let added = 0;
for (const week of weeks) {
  const key = String(week);
  const already = toArray(existingByWeek.get(key)?.matchup).filter(
    (m) => toArray(m.franchise).length >= 2
  );
  if (already.length > 0) continue; // MFL's own data wins, always
  const matchup = games
    .filter((g) => g.week === week)
    .map((g) => ({
      franchise: [
        { id: g.home, score: g.homeScore.toFixed(2), isHome: '1', result: g.homeScore > g.awayScore ? 'W' : g.homeScore < g.awayScore ? 'L' : 'T' },
        { id: g.away, score: g.awayScore.toFixed(2), isHome: '0', result: g.awayScore > g.homeScore ? 'W' : g.awayScore < g.homeScore ? 'L' : 'T' },
      ],
    }));
  existingByWeek.set(key, { week: key, matchup });
  added += matchup.length;
}

schedule.schedule = schedule.schedule ?? {};
schedule.schedule.weeklySchedule = [...existingByWeek.values()].sort(
  (a, b) => Number(a.week) - Number(b.week)
);
fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2));
console.log(`Wrote ${added} matchups into ${SCHEDULE_PATH}`);
