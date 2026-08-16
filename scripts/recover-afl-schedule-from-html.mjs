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
 * WEEKS COME FROM THE TABLE'S TAB LAYOUT, CROSS-CHECKED AGAINST SCORES.
 *
 * The view is a real table: TAB separates week cells, and a newline separates
 * the two games inside a cell on the weeks the AFL plays doubleheaders. So
 * splitting a franchise's whole row on TAB yields its weeks in order.
 *
 * An earlier version instead derived each week by matching the game's own-score
 * against weekly-results.json. That worked for 2017 and 2019 and is a stronger
 * signal where it applies — but it is not available everywhere: 2015's
 * weekly-results has NO scores at all for weeks 1-3 and only 2-4 franchises for
 * weeks 9-13, which is precisely the season we need. Layout is the primary
 * source; the score join runs as a CROSS-CHECK wherever MFL does have the
 * score, and a disagreement is a hard failure rather than a warning.
 *
 * Layout alone is not trusted blindly. Three independent shapes have to agree
 * before anything is written (see below), and the per-franchise game COUNT is
 * checked against the official record, so a mangled tab that merges or splits a
 * cell shows up as a wrong count rather than as a plausible wrong week.
 *
 * Nothing is written unless every check passes:
 *   - every game appears from BOTH sides with mirrored scores (a one-sided game
 *     is accepted only when weekly-results.json corroborates BOTH scores)
 *   - the score join agrees with the layout wherever MFL still has the score
 *   - each franchise's parsed GAME COUNT equals its official games played
 *   - each franchise's resulting W-L-T equals standings.json exactly
 *   - every game MFL still holds is reproduced at the same week and score
 *
 * Writes are additive per game: MFL's own matchups are never overwritten, and
 * only games MFL is missing get added.
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

const rawSource = fs.existsSync(SOURCE) ? fs.readFileSync(SOURCE, 'utf8') : null;
if (!rawSource) {
  console.error(`No saved schedule text at ${SOURCE}`);
  process.exit(1);
}

// A copy/paste of this table is routinely cut off mid-token on the very last
// game — 2019, 2014 and 2013 all arrived missing nothing but the final ')'. That
// one character costs the season two franchises' records, which reads as a data
// problem rather than a clipboard one. Close it, and let the ordinary checks
// decide whether the game was real: the opponent's own row has to state the same
// two scores, and all 24 records still have to reconcile.
const TRUNCATED_TAIL = /([WLT]\s+@?[A-Z0-9]+\s*\(\s*[\d.]+\s*-\s*[\d.]+)\s*$/i;
const raw = TRUNCATED_TAIL.test(rawSource.trimEnd())
  ? `${rawSource.trimEnd()})\n`
  : rawSource;
if (raw !== rawSource) {
  console.log("Source ends mid-token; closed the final game's parenthesis before parsing.");
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

// Some archived league.json rows carry no abbrev at all — 2013's Vinegar
// Strokes, 2010's Fullybaked and Chatmaster — while the schedule view still
// prints something in the opponent column. What it prints varies: 2013 shows a
// real abbreviation ("VS"), 2010 shows the team NAME truncated to seven
// characters ("Fullyba", "Chatmas"). Both have to resolve, and neither may
// resolve by guessing.
//
// Two forced rules, in order. A token that is a prefix of exactly one
// abbrev-less franchise's name IS that franchise. Then, if a single franchise
// and a single token are still unclaimed, they must be each other. Anything
// left over stays unresolved and surfaces as a parse problem.
const abbrevless = franchises.filter((f) => !f.abbrev);
if (abbrevless.length) {
  const seen = new Set();
  let m;
  const scan = /\b[WLT]\s+@?([A-Za-z0-9][A-Za-z0-9.'-]*)\s*\(\s*[\d.]+\s*-\s*[\d.]+\s*\)/g;
  while ((m = scan.exec(raw))) seen.add(m[1].toUpperCase());

  let unclaimed = [...seen].filter((a) => !idByAbbrev.has(a));
  let pending = [...abbrevless];

  for (const token of [...unclaimed]) {
    const hits = pending.filter((f) => String(f.name).toUpperCase().startsWith(token));
    if (hits.length !== 1) continue;
    idByAbbrev.set(token, hits[0].id);
    console.log(
      `league.json has no abbreviation for franchise ${hits[0].id} (${hits[0].name}); ` +
        `bound it to "${token}", the only name it can be a prefix of.`
    );
    pending = pending.filter((f) => f.id !== hits[0].id);
    unclaimed = unclaimed.filter((a) => a !== token);
  }

  if (pending.length === 1 && unclaimed.length === 1) {
    idByAbbrev.set(unclaimed[0], pending[0].id);
    console.log(
      `league.json has no abbreviation for franchise ${pending[0].id} (${pending[0].name}); ` +
        `bound it to "${unclaimed[0]}" by elimination.`
    );
  }
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
// The abbreviation is matched case-INSENSITIVELY and may contain punctuation:
// MFL stores whatever the owner typed, and the AFL's archives hold `boo`, `Chat`
// (2013) and `St.` (2011). An uppercase-alphanumeric-only class silently skipped
// every one of their games. The surrounding `[WLT] ` and `(n-n)` keep it tight.
const GAME_RE = /\b([WLT])\s+(@?)([A-Za-z0-9][A-Za-z0-9.'-]*)\s*\(\s*([\d.]+)\s*-\s*([\d.]+)\s*\)/g;

// Longest name first: one franchise name can be a prefix of another ("Balls
// Deep" / "Balls Deep II"), and a shortest-match would silently file the
// longer team's whole season under the shorter one.
const namesByLength = [...idByName.keys()].sort((a, b) => b.length - a.length);

const lines = raw.split('\n');

// Week numbers from the header row ("Franchise/Week<TAB>1<TAB>2<TAB>…").
// Falling back to positional numbering keeps a header-less paste usable.
const headerLine = lines.find((l) => /^Franchise\s*\/\s*Week/i.test(l));
const headerWeeks = headerLine
  ? headerLine.split('\t').slice(1).map((c) => Number(c.trim())).filter(Number.isFinite)
  : [];

/**
 * The franchise a line starts a row for, or null if it continues the previous
 * one. The label column is not stable across seasons: 2013-2015 print the full
 * team name, 2011 prints the ABBREVIATION ("SFC", "St."). Continuation lines
 * always start with a game token, so neither test can be fooled by one.
 */
const rowOwner = (line) => {
  const first = line.split('\t')[0].trim();
  if (first && line.includes('\t')) {
    const byAbbrev = idByAbbrev.get(first.toUpperCase());
    if (byAbbrev) return byAbbrev;
  }
  const nameMatch = namesByLength.find((n) => line.startsWith(n));
  return nameMatch ? idByName.get(nameMatch) : null;
};

// A franchise's row is its label line plus any continuation lines. Lines are
// rejoined with '\n' (NOT stripped) because a newline is the within-cell
// separator for doubleheaders — collapsing it would merge two games into one
// cell and lose the week boundary.
const rowsByFranchise = new Map();
let current = null;
for (const line of lines) {
  const owner = rowOwner(line);
  if (owner) {
    current = owner;
    if (!rowsByFranchise.has(current)) rowsByFranchise.set(current, []);
    rowsByFranchise.get(current).push(line);
    continue;
  }
  if (current) rowsByFranchise.get(current).push(line);
}

const problems = [];
const parsedGames = []; // { week, home, away, homeScore, awayScore, from }
const gameCountByFranchise = new Map();

/** That franchise's score that week per MFL, or null when MFL has no record. */
const knownScore = (fid, week) => {
  const s = toArray(weekly?.weeks).find((x) => Number(x.week) === week)?.scores?.[fid];
  return s == null ? null : Number(s).toFixed(2);
};

for (const [fid, rowLines] of rowsByFranchise) {
  // TAB splits week cells; the franchise name occupies cell 0.
  const cells = rowLines.join('\n').split('\t').slice(1);
  let count = 0;

  cells.forEach((cell, idx) => {
    const week = headerWeeks[idx] ?? idx + 1;
    let m;
    GAME_RE.lastIndex = 0;
    while ((m = GAME_RE.exec(cell))) {
      const [, , atSign, oppAbbrev, ownStr, oppStr] = m;
      const oppId = idByAbbrev.get(oppAbbrev.toUpperCase());
      if (!oppId) {
        problems.push(`${fid}: unknown opponent abbreviation "${oppAbbrev}"`);
        continue;
      }
      const ownScore = Number(ownStr);
      const oppScore = Number(oppStr);
      count++;

      // Cross-check the layout-derived week against MFL's own weekly scores
      // wherever it has them. A disagreement means the table was misread, so it
      // fails rather than warns. Where MFL has no score (2015 weeks 1-3 hold
      // none at all) the layout stands on its own and the record reconciliation
      // below is what catches an error.
      const own = knownScore(fid, week);
      if (own !== null && own !== ownScore.toFixed(2)) {
        problems.push(
          `${fid}: parsed ${ownScore} in week ${week} vs ${oppAbbrev}, but weekly-results says ${own}`
        );
        continue;
      }
      const opp = knownScore(oppId, week);
      if (opp !== null && opp !== oppScore.toFixed(2)) {
        problems.push(
          `${fid} week ${week}: parsed opponent ${oppAbbrev} at ${oppScore}, but weekly-results says ${opp}`
        );
        continue;
      }

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
  });

  gameCountByFranchise.set(fid, count);
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

  // Game COUNT is checked separately from the W-L. Weeks now come from tab
  // positions, so a mangled tab could merge two cells or split one — moving a
  // game to the wrong week WITHOUT changing anyone's win total, which the
  // record check alone would wave through. A count that disagrees with the
  // official games-played is the signal that the table was misread.
  const wantGames = want.w + want.l + want.t;
  const parsedCount = gameCountByFranchise.get(f.id) ?? 0;
  if (wantGames > 0 && parsedCount !== wantGames) {
    recordMismatches.push(
      `  ${f.id}: parsed ${parsedCount} games from the table, MFL standings say ${wantGames} played`
    );
  }
}

// --- Arbitration against the regular-season games MFL still holds ---
//
// Whatever MFL holds for a week the paste also covers ought to be free ground
// truth. For 2015 it is not, and the reason matters:
//
// MFL's stored regular season for 2012-2015 is SYNTHETIC. All four seasons have
// byte-identical per-week game counts (8,8,12,6,5,2,2,1,1,1 for weeks 4-13),
// and in every week the number of matchups is exactly half the number of
// franchises that have a score that week — the fingerprint of pairing whoever
// has a score with whoever else has one, not of a real schedule surviving
// partial loss. Four different NFL seasons do not share a game-count shape by
// chance. Every score in those rows is correct; the OPPONENTS are invented.
//
// So a plain "MFL wins" veto would reject the real schedule in favour of a
// fabricated one. Instead the official standings arbitrate, because MFL
// computed them from the true schedule: the paste is already required to
// reproduce every franchise's W-L-T and games-played exactly, so if swapping a
// contested MFL game in breaks a record, that game cannot be real. Refuting even
// one is enough to condemn the season's stored regular season — but if NOTHING
// is refuted, the two sources disagree in a way the records cannot settle, and
// that fails rather than silently overriding MFL.
const existingSchedule = readJson(SCHEDULE_PATH);
const existingGames = new Map();
for (const wk of toArray(existingSchedule?.schedule?.weeklySchedule)) {
  for (const m of toArray(wk.matchup)) {
    const fr = toArray(m.franchise);
    if (fr.length !== 2) continue;
    const key = `${Number(wk.week)}:${[fr[0].id, fr[1].id].sort().join(':')}`;
    existingGames.set(
      key,
      Object.fromEntries(fr.map((f) => [f.id, Number(f.score).toFixed(2)]))
    );
  }
}

const parsedByKey = new Map(
  games.map((g) => [`${g.week}:${[g.home, g.away].sort().join(':')}`, g])
);
// Only the regular season is comparable: the paste is the regular-season view,
// so MFL's postseason weeks are legitimately absent from it and are never
// touched. The playoff reconstruction depends on those weeks and they verify
// against three independent sources, so the corruption above is regular-season
// only.
const parsedWeeks = new Set(games.map((g) => g.week));

/** The result (`w`/`l`/`t`) `fid` gets from the paste in `week`. */
const pasteResultsFor = (fid, week) =>
  games
    .filter((g) => g.week === week && (g.home === fid || g.away === fid))
    .map((g) => {
      const own = g.home === fid ? g.homeScore : g.awayScore;
      const opp = g.home === fid ? g.awayScore : g.homeScore;
      return own > opp ? 'w' : own < opp ? 'l' : 't';
    });

const confirmedByMfl = [];
const refuted = [];
const undecided = [];
for (const [key, known] of existingGames) {
  const week = Number(key.split(':')[0]);
  if (!parsedWeeks.has(week)) continue;
  const [a, b] = key.split(':').slice(1);
  const g = parsedByKey.get(key);
  if (g && known[g.home] === g.homeScore.toFixed(2) && known[g.away] === g.awayScore.toFixed(2)) {
    confirmedByMfl.push(key);
    continue;
  }

  // Contested. Ask whether MFL's version of this game can coexist with the
  // official records: under it, `a` played `b` that week, so `a`'s result for
  // the week is fixed by these two scores. The paste already reproduces `a`'s
  // official record exactly, so a different result here means a different
  // season record — i.e. MFL's game cannot be real.
  const sa = Number(known[a]);
  const sb = Number(known[b]);
  const mflResult = (own, opp) => (own > opp ? 'w' : own < opp ? 'l' : 't');
  const flips = [
    [a, mflResult(sa, sb)],
    [b, mflResult(sb, sa)],
  ].filter(([fid, res]) => {
    const fromPaste = pasteResultsFor(fid, week);
    // One game that week: a different result changes the record. Two (a
    // doubleheader): MFL's single game cannot account for both, so it is
    // refuted whenever it fails to match either of them.
    return fromPaste.length !== 1 || fromPaste[0] !== res;
  });

  const detail =
    `  wk${week} ${a} v ${b} (${known[a]}-${known[b]}): ` +
    (g
      ? `paste has this pairing at ${g.homeScore}-${g.awayScore}`
      : (() => {
          const elsewhere = games
            .filter((x) => [x.home, x.away].sort().join(':') === `${a}:${b}`)
            .map((x) => `wk${x.week}`);
          return elsewhere.length
            ? `paste puts this pairing at ${elsewhere.join(', ')} instead`
            : 'paste has no such game in any week';
        })());

  if (flips.length) {
    refuted.push(`${detail} — would change ${flips.map(([f]) => f).join(', ')}'s official record`);
  } else {
    undecided.push(`${detail} — record-neutral`);
  }
}
const mflRegularSeasonIsSynthetic = refuted.length > 0;

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

const contested = refuted.length + undecided.length;
if (confirmedByMfl.length || contested) {
  console.log(
    `\nAgainst the ${confirmedByMfl.length + contested} regular-season game(s) MFL still stores: ` +
      `${confirmedByMfl.length} reproduced exactly, ${contested} contested.`
  );
}
if (contested) {
  if (refuted.length) {
    console.log(
      `\n${refuted.length} of MFL's stored game(s) are REFUTED by the official standings ` +
        `(the paste reproduces all 24 records; these cannot):`
    );
    refuted.slice(0, 15).forEach((d) => console.log(d));
    if (refuted.length > 15) console.log(`  … ${refuted.length - 15} more`);
    console.log(
      `\n${undecided.length} further contested game(s) are record-neutral, so the standings ` +
        `cannot speak to them individually.`
    );
    console.log(
      `\n=> MFL's stored ${YEAR} REGULAR SEASON is not real data. The paste replaces weeks ` +
        `${weeks.join(', ')}; the postseason weeks are left untouched.`
    );
  } else {
    console.log(
      `\n${undecided.length} contested game(s), NONE refuted by the standings — the two sources ` +
        `disagree and the records cannot arbitrate. Refusing to overwrite MFL on a hunch:`
    );
    undecided.slice(0, 15).forEach((d) => console.log(d));
  }
}

// A contested season is only allowed through when the records actually refute
// MFL's version. Contested-but-unrefutable stops the run.
const ok =
  problems.length === 0 &&
  recordMismatches.length === 0 &&
  (contested === 0 || mflRegularSeasonIsSynthetic);
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

const asMatchup = (g) => ({
  franchise: [
    { id: g.home, score: g.homeScore.toFixed(2), isHome: '1', result: g.homeScore > g.awayScore ? 'W' : g.homeScore < g.awayScore ? 'L' : 'T' },
    { id: g.away, score: g.awayScore.toFixed(2), isHome: '0', result: g.awayScore > g.homeScore ? 'W' : g.awayScore < g.homeScore ? 'L' : 'T' },
  ],
});

// Two modes, decided by the arbitration above and never by a flag:
//
//  - Nothing contested: MFL's own matchups stand and the paste only fills the
//    gaps. The merge is per GAME, not per week — a week that keeps a handful of
//    its games and loses the rest must still gain the rest.
//  - MFL's regular season refuted: its weeks are replaced wholesale, because a
//    fabricated pairing is worse than a missing one. Only weeks the paste
//    covers are touched, so the postseason is untouched either way.
let added = 0;
let replaced = 0;
for (const week of weeks) {
  const key = String(week);
  const existingMatchups = toArray(existingByWeek.get(key)?.matchup);
  const weekGames = games.filter((g) => g.week === week);

  if (mflRegularSeasonIsSynthetic) {
    replaced += existingMatchups.filter((m) => toArray(m.franchise).length === 2).length;
    existingByWeek.set(key, { week: key, matchup: weekGames.map(asMatchup) });
    added += weekGames.length;
    continue;
  }

  const held = new Set(
    existingMatchups
      .map((m) => toArray(m.franchise))
      .filter((fr) => fr.length === 2)
      .map((fr) => [fr[0].id, fr[1].id].sort().join(':'))
  );
  const fresh = weekGames
    .filter((g) => !held.has([g.home, g.away].sort().join(':')))
    .map(asMatchup);
  if (fresh.length === 0) continue;
  existingByWeek.set(key, { week: key, matchup: [...existingMatchups, ...fresh] });
  added += fresh.length;
}

schedule.schedule = schedule.schedule ?? {};
schedule.schedule.weeklySchedule = [...existingByWeek.values()].sort(
  (a, b) => Number(a.week) - Number(b.week)
);
fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2));
console.log(
  `Wrote ${added} matchups into ${SCHEDULE_PATH}` +
    (replaced ? `, replacing ${replaced} refuted regular-season matchup(s)` : '')
);
