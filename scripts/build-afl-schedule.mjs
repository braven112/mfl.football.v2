#!/usr/bin/env node
/**
 * Build the AFL's regular season from scratch and print it for MFL's
 * commissioner schedule editor (Commissioner -> Setup -> Schedule -> advanced).
 *
 *   one line per game: `WW,AAAA,HHHH`   week, away franchise, home franchise
 *   pasting OVERWRITES the entire fantasy schedule, so every game is emitted
 *
 * This is the "advanced" path. The League stays on the simple re-timing in
 * scripts/optimize-league-schedule.mjs this season by league decision.
 *
 * Bye fairness is computed from CURRENT ROSTERS, which in August is keepers
 * only (7 per team). That is deliberate: it fixes the part of bye exposure the
 * schedule controls, and owners manage the rest of their roster themselves.
 * It also means re-running this after the draft would produce a different —
 * not obviously better — answer, since rosters churn all season anyway.
 *
 * Usage:
 *   node scripts/build-afl-schedule.mjs
 *   node scripts/build-afl-schedule.mjs --year=2026 --restarts=8 --iterations=20000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  asArray,
  buildCrossConferencePairs,
  byeCountsByWeek,
  byeFreeWeeks,
  divisionFinishRanks,
  divisionGameCeiling,
} from '../src/utils/schedule-rules.mjs';
import { AFL_WEEK_PLAN, searchSeason } from '../src/utils/schedule-builder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'afl-fantasy';
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/** Division pairing alternates; anchored on 2024 = North/East + South/West (12/12 verified). */
const CROSS_CONFERENCE = {
  anchorYear: 2024,
  anchorPairing: [
    ['North', 'East'],
    ['South', 'West'],
  ],
  alternatePairing: [
    ['North', 'West'],
    ['South', 'East'],
  ],
  protectedRivalries: [['Computer Jocks', 'Jewpacabra']],
};

const feedsFor = (year) => path.join(ROOT, LEAGUES[SLUG].dataPath, 'mfl-feeds', String(year));

const leagueShape = (year) => {
  const meta = readJson(path.join(feedsFor(year), 'league.json')).league;
  const divisionName = {};
  const divisionConference = {};
  for (const d of asArray(meta.divisions?.division)) {
    divisionName[d.id] = d.name;
    divisionConference[d.id] = d.conference;
  }
  const franchiseIds = [];
  const name = {};
  const divisionOf = {};
  const conferenceOf = {};
  for (const f of asArray(meta.franchises?.franchise)) {
    franchiseIds.push(f.id);
    name[f.id] = f.name;
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
    conferenceOf[f.id] = divisionConference[String(f.division)] ?? '00';
  }
  return { meta, franchiseIds, name, divisionOf, conferenceOf };
};

/** Players on bye per franchise per week, from the roster as it stands today. */
const byeExposure = (year, franchiseIds, byes) => {
  const feeds = feedsFor(year);
  const teamOf = {};
  for (const p of readJson(path.join(feeds, 'players.json')).players.player) teamOf[p.id] = p.team;
  const table = {};
  for (const id of franchiseIds) table[id] = {};
  for (const f of readJson(path.join(feeds, 'rosters.json')).rosters.franchise) {
    for (const p of asArray(f.player)) {
      const week = byes[teamOf[p.id]];
      if (!week) continue;
      table[f.id][week] = (table[f.id][week] ?? 0) + 1;
    }
  }
  return table;
};

/** Prior-season strength, z-scored on win rate. Used only to BALANCE, never to seed. */
const priorRatings = (year, franchiseIds) => {
  const standings = readJson(path.join(feedsFor(year - 1), 'standings.json')).leagueStandings.franchise;
  const raw = {};
  for (const f of asArray(standings)) {
    const [w, l, t] = String(f.h2hwlt ?? '').split('-').map(Number);
    const games = (w || 0) + (l || 0) + (t || 0);
    raw[f.id] = games ? ((w || 0) + (t || 0) * 0.5) / games : 0.5;
  }
  const values = franchiseIds.map((id) => raw[id] ?? 0.5);
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((n, v) => n + (v - mu) ** 2, 0) / values.length) || 1;
  const rating = {};
  for (const id of franchiseIds) rating[id] = ((raw[id] ?? 0.5) - mu) / sd;
  return rating;
};

const main = () => {
  const year = Number(arg('year', 2026));
  const restarts = Number(arg('restarts', 8));
  const iterations = Number(arg('iterations', 15000));
  const outDir = arg('out', path.join(ROOT, 'data', SLUG, 'schedule-plan'));

  const shape = leagueShape(year);
  const { franchiseIds, name, divisionOf, conferenceOf } = shape;
  const lastWeek = Number(shape.meta.lastRegularSeasonWeek);

  const byes = readJson(path.join(ROOT, 'data/nfl/bye-weeks.json')).seasons[String(year)];
  if (!byes) throw new Error(`no NFL bye weeks stored for ${year}`);
  const byeCounts = byeCountsByWeek(byes);
  const clean = byeFreeWeeks(byes, lastWeek);

  // --- cross-conference round -------------------------------------------
  const prevYear = year - 1;
  const prevMeta = readJson(path.join(feedsFor(prevYear), 'league.json')).league;
  const prevDivisionName = {};
  for (const d of asArray(prevMeta.divisions?.division)) prevDivisionName[d.id] = d.name;
  const prevDivisionOf = {};
  for (const f of asArray(prevMeta.franchises?.franchise)) {
    prevDivisionOf[f.id] = prevDivisionName[String(f.division)] ?? String(f.division);
  }
  const prevRank = divisionFinishRanks(
    readJson(path.join(feedsFor(prevYear), 'standings.json')).leagueStandings.franchise,
    prevDivisionOf,
  );
  const byName = {};
  for (const id of franchiseIds) byName[name[id]] = id;
  const protectedPairs = CROSS_CONFERENCE.protectedRivalries
    .filter(([a, b]) => byName[a] && byName[b])
    .map(([a, b]) => [byName[a], byName[b]]);
  const flip = (year - CROSS_CONFERENCE.anchorYear) % 2 !== 0;
  const divisionPairing = flip ? CROSS_CONFERENCE.alternatePairing : CROSS_CONFERENCE.anchorPairing;
  const crossPairs = buildCrossConferencePairs({
    prevRank,
    divisionPairing,
    protectedPairs,
    conferenceOf,
    franchiseIds,
  });
  const crossRound = crossPairs.map(({ away, home }) =>
    conferenceOf[away] === '00' ? { away, home } : { away: home, home: away },
  );

  // --- search context -----------------------------------------------------
  const divisions = {};
  for (const id of franchiseIds) (divisions[divisionOf[id]] ??= []).push(id);
  const conferences = {};
  for (const [division, teams] of Object.entries(divisions)) {
    const conf = conferenceOf[teams[0]];
    (conferences[conf] ??= []).push(teams);
  }
  for (const conf of Object.keys(conferences)) {
    if (conferences[conf].length !== 2) throw new Error(`conference ${conf} does not have exactly two divisions`);
  }

  const exposure = byeExposure(year, franchiseIds, byes);
  const ctx = {
    divisions,
    conferences,
    crossRound,
    weekPlan: AFL_WEEK_PLAN,
    franchiseIds,
    gamesPerTeam: 17,
    doubleheaderWeeks: AFL_WEEK_PLAN.filter((w) => w.slots.length > 1).map((w) => w.week),
    lateWeeks: [12, 13, 14],
    rating: priorRatings(year, franchiseIds),
    byesFor: (id, week) => exposure[id]?.[week] ?? 0,
  };

  console.log(`\n=== ${shape.meta.name} ${year} — constructive build ===`);
  console.log(`bye-free weeks: ${clean.join(', ')}`);
  console.log(`doubleheaders:  ${ctx.doubleheaderWeeks.join(', ')}`);
  console.log(
    `cross-conference: ${flip ? 'alternate' : 'anchor'} pairing ${divisionPairing.map((p) => p.join('/')).join(' + ')}` +
      `${protectedPairs.length ? `, ${protectedPairs.length} protected rivalry` : ''}`,
  );
  console.log(`searching (${restarts} restarts x ${iterations} iterations)...`);

  const best = searchSeason(ctx, { restarts, iterations });
  const weeks = best.weeks;

  // --- verify + report ----------------------------------------------------
  const isDivision = (g) => divisionOf[g.away] === divisionOf[g.home];
  const cleanSet = new Set(clean);
  let byeFreeDivision = 0;
  console.log('\nweek  byes  games  div  type');
  for (const { week, slots } of AFL_WEEK_PLAN) {
    const games = weeks.get(week) ?? [];
    const div = games.filter(isDivision).length;
    if (cleanSet.has(week)) byeFreeDivision += div;
    const kinds = [...new Set(slots.map((s) => s.kind))].join('+');
    console.log(
      `  ${String(week).padStart(2)}  ${String(byeCounts[week] ?? 0).padStart(4)}  ${String(games.length).padStart(5)}  ${String(div).padStart(3)}  ${kinds}${slots.length > 1 ? ' (DH)' : ''}`,
    );
  }
  const ceiling = divisionGameCeiling({
    teamCount: franchiseIds.length,
    divisionSize: franchiseIds.length / Object.keys(divisions).length,
    byeFree: clean,
    doubleheaders: ctx.doubleheaderWeeks,
    reservedSlotsPerTeam: 1,
  });
  console.log(
    `\ndivision games bye-free: ${byeFreeDivision} of ${ceiling.total} (ceiling ${ceiling.ceiling}; ` +
      `${ceiling.forcedOntoByeWeeks} forced onto bye weeks by the format)`,
  );
  console.log('\nfairness score (lower is better):');
  for (const [k, v] of Object.entries(best.score.terms)) console.log(`  ${k.padEnd(22)} ${v.toFixed(3)}`);
  console.log(`  ${'TOTAL'.padEnd(22)} ${best.score.total.toFixed(3)}  (restart ${best.restart})`);

  // --- emit ---------------------------------------------------------------
  const lines = [];
  for (const { week } of AFL_WEEK_PLAN) {
    for (const g of weeks.get(week) ?? []) lines.push(`${String(week).padStart(2, '0')},${g.away},${g.home}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const txt = path.join(outDir, `${year}-schedule.txt`);
  fs.writeFileSync(txt, `${lines.join('\n')}\n`);
  fs.writeFileSync(
    path.join(outDir, `${year}-schedule.json`),
    `${JSON.stringify(
      {
        league: shape.meta.name,
        year,
        generatedFrom: 'scripts/build-afl-schedule.mjs',
        doubleheaderWeeks: ctx.doubleheaderWeeks,
        byeFreeWeeks: clean,
        divisionGamesByeFree: byeFreeDivision,
        divisionGameCeiling: ceiling,
        crossConference: {
          divisionPairing,
          protectedRivalries: protectedPairs.map(([a, b]) => [name[a], name[b]]),
          pairs: crossPairs.map((p) => ({ away: name[p.away], home: name[p.home], protected: p.protectedRivalry })),
        },
        fairness: best.score,
        weeks: Object.fromEntries([...weeks.entries()].sort((a, b) => a[0] - b[0])),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${path.relative(ROOT, txt)} (${lines.length} games — paste into MFL)`);
};

main();
