#!/usr/bin/env node
/**
 * Build a rule-compliant regular-season schedule for a league and print it in
 * the format MFL's commissioner schedule editor accepts.
 *
 *   Commissioner → Setup → Schedule → "advanced" (free-form) editor
 *   one line per game: `WW,AAAA,HHHH`  (week, away franchise, home franchise)
 *
 * MFL has NO schedule import API — the full import type list
 * (api_info?STATE=details) is lineup, franchises, calendarEvent, fcfsWaiver,
 * waiverRequest, blindBidWaiverRequest, ir, taxi_squad, tradeBait,
 * tradeProposal, tradeResponse, draftResults, myDraftList, pollVote, keepers,
 * myWatchList, accounting, salaries, playerScoreAdjustment,
 * franchiseScoreAdjustment, survivorPoolPick. `TYPE=schedule` is export-only.
 * So this script's output is meant to be PASTED, and the paste OVERWRITES the
 * entire fantasy schedule — which is why it emits every regular-season game,
 * not a diff.
 *
 * What it changes, and what it deliberately does not:
 *
 *   - Games are re-TIMED, never re-drawn. The season is decomposed into rounds
 *     (see src/utils/schedule-rules.mjs) and rounds are assigned to weeks, so
 *     every matchup, home/away side and opponent count is preserved exactly.
 *   - The one exception is the AFL's Week 1 cross-conference round, which is
 *     rebuilt from the prior season's division finishes because it has been
 *     stale since 2024. That changes opponents by design.
 *
 * Usage:
 *   node scripts/optimize-league-schedule.mjs --league=afl-fantasy
 *   node scripts/optimize-league-schedule.mjs --league=theleague --year=2026
 *   node scripts/optimize-league-schedule.mjs --league=afl-fantasy --out=dir/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  asArray,
  byeCountsByWeek,
  byeFreeWeeks,
  buildCrossConferencePairs,
  chooseDoubleheaderWeeks,
  decomposeSeasonIntoRounds,
  divisionFinishRanks,
  divisionGameCeiling,
  doubleheaderWeeks,
  regularSeasonGames,
} from '../src/utils/schedule-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/**
 * Per-league scheduling policy — the parts that are league rules rather than
 * shared arithmetic. Both leagues' start/end windows come from their
 * constitutions; `keepDivisionFinish` is the deliberate trade in
 * docs/claude/rules/schedule-optimization.md.
 */
const POLICY = {
  theleague: {
    startWindow: [1, 2, 3, 4],
    endWindow: [12, 13, 14],
    doubleheaderCount: 4,
    // Weeks 13 and 14 both carry byes in 2026, so "no division game on a bye"
    // and "the season ends on division games" cannot both hold. The league
    // keeps the rivalry finish: one pure-division round stays in the final
    // week, everything else goes bye-free.
    keepDivisionFinish: true,
    crossConference: null,
  },
  'afl-fantasy': {
    startWindow: [1, 2, 3, 4],
    endWindow: [12, 13, 14],
    doubleheaderCount: 3,
    keepDivisionFinish: false,
    crossConference: {
      week: 1,
      // Division pairing alternates year to year. Anchored on 2024 =
      // North/East + South/West, verified 12/12 against the feeds for
      // 2022 (N/E+S/W), 2023 (N/W+S/E) and 2024 (N/E+S/W).
      anchorYear: 2024,
      anchorPairing: [
        ['North', 'East'],
        ['South', 'West'],
      ],
      alternatePairing: [
        ['North', 'West'],
        ['South', 'East'],
      ],
      // Permanent rivalries that outrank the positional formula.
      // Computer Jocks / Jewpacabra ran off-formula 2015-2020.
      protectedRivalries: [['Computer Jocks', 'Jewpacabra']],
    },
  },
};

const loadLeague = (slug, year) => {
  const league = LEAGUES[slug];
  if (!league) throw new Error(`unknown league slug: ${slug}`);
  const feeds = path.join(ROOT, league.dataPath, 'mfl-feeds', String(year));
  const meta = readJson(path.join(feeds, 'league.json')).league;

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
  return {
    slug,
    year,
    meta,
    feeds,
    franchiseIds,
    name,
    divisionOf,
    conferenceOf,
    lastRegularSeasonWeek: Number(meta.lastRegularSeasonWeek),
    divisionSize: franchiseIds.length / Number(meta.divisions?.count ?? 1),
  };
};

/** Rebuild the AFL Week 1 cross-conference round from last season's finishes. */
const buildCrossConferenceRound = (ctx, policy) => {
  const prevYear = ctx.year - 1;
  const prevFeeds = path.join(ROOT, LEAGUES[ctx.slug].dataPath, 'mfl-feeds', String(prevYear));
  const prevMeta = readJson(path.join(prevFeeds, 'league.json')).league;
  const prevDivisionName = {};
  for (const d of asArray(prevMeta.divisions?.division)) prevDivisionName[d.id] = d.name;
  const prevDivisionOf = {};
  for (const f of asArray(prevMeta.franchises?.franchise)) {
    prevDivisionOf[f.id] = prevDivisionName[String(f.division)] ?? String(f.division);
  }
  const standings = readJson(path.join(prevFeeds, 'standings.json')).leagueStandings.franchise;
  const prevRank = divisionFinishRanks(standings, prevDivisionOf);

  const flip = (ctx.year - policy.crossConference.anchorYear) % 2 !== 0;
  const divisionPairing = flip
    ? policy.crossConference.alternatePairing
    : policy.crossConference.anchorPairing;

  const byName = {};
  for (const id of ctx.franchiseIds) byName[ctx.name[id]] = id;
  const protectedPairs = [];
  for (const [a, b] of policy.crossConference.protectedRivalries) {
    if (byName[a] && byName[b]) protectedPairs.push([byName[a], byName[b]]);
    else console.warn(`  ! protected rivalry "${a}" / "${b}" — franchise not found this season, skipping`);
  }

  const pairs = buildCrossConferencePairs({
    prevRank,
    divisionPairing,
    protectedPairs,
    conferenceOf: ctx.conferenceOf,
    franchiseIds: ctx.franchiseIds,
  });
  // American League franchise travels; keeps the side convention the feeds use.
  const games = pairs.map(({ away, home }) =>
    ctx.conferenceOf[away] === '00' ? { away, home } : { away: home, home: away },
  );
  return { games, divisionPairing, flip, prevRank };
};

const main = () => {
  const slug = arg('league', 'afl-fantasy');
  const year = Number(arg('year', new Date().getUTCFullYear()));
  const outDir = arg('out', path.join(ROOT, 'data', slug, 'schedule-plan'));

  const policy = POLICY[slug];
  if (!policy) throw new Error(`no scheduling policy for league: ${slug}`);
  const ctx = loadLeague(slug, year);

  const byes = readJson(path.join(ROOT, 'data/nfl/bye-weeks.json')).seasons[String(year)];
  if (!byes) throw new Error(`no NFL bye weeks stored for ${year} — run scripts/fetch-nfl-bye-weeks.mjs`);
  const byeCounts = byeCountsByWeek(byes);
  const clean = byeFreeWeeks(byes, ctx.lastRegularSeasonWeek);

  const current = regularSeasonGames(
    readJson(path.join(ctx.feeds, 'schedule.json')).schedule.weeklySchedule,
    ctx.lastRegularSeasonWeek,
  );

  console.log(`\n=== ${ctx.meta.name} ${year} ===`);
  console.log(`regular season: weeks 1-${ctx.lastRegularSeasonWeek}`);
  console.log(`bye-free weeks: ${clean.join(', ')}`);
  console.log(`current doubleheaders: ${doubleheaderWeeks(current).join(', ')}`);

  const dh = chooseDoubleheaderWeeks({
    count: policy.doubleheaderCount,
    byeFree: clean,
    startWindow: policy.startWindow,
    endWindow: policy.endWindow,
  });
  console.log(`planned doubleheaders: ${dh.join(', ')}`);

  let rounds = decomposeSeasonIntoRounds(current, ctx);

  // --- AFL only: replace the stale cross-conference round -----------------
  let crossConf = null;
  if (policy.crossConference) {
    crossConf = buildCrossConferenceRound(ctx, policy);
    const idx = rounds.findIndex((r) => r.crossConferenceGames === r.games.length);
    if (idx === -1) throw new Error('could not isolate the cross-conference round in the current schedule');
    const changed = rounds[idx].games.filter((g) => {
      const k = [g.away, g.home].sort().join('-');
      return !crossConf.games.some((n) => [n.away, n.home].sort().join('-') === k);
    }).length;
    rounds[idx] = {
      ...rounds[idx],
      games: crossConf.games,
      divisionGames: 0,
      crossConferenceGames: crossConf.games.length,
      isCrossConference: true,
    };
    console.log(
      `cross-conference round rebuilt (${crossConf.flip ? 'alternate' : 'anchor'} pairing ` +
        `${crossConf.divisionPairing.map((p) => p.join('/')).join(' + ')}): ${changed} of ${crossConf.games.length} pairings changed`,
    );
  }

  // --- assign rounds to weeks --------------------------------------------
  const dhSet = new Set(dh);
  const slots = [];
  for (let w = 1; w <= ctx.lastRegularSeasonWeek; w += 1) {
    const n = dhSet.has(w) ? 2 : 1;
    for (let i = 0; i < n; i += 1) slots.push(w);
  }
  if (slots.length !== rounds.length) {
    throw new Error(`${slots.length} week slots but ${rounds.length} rounds — doubleheader count is wrong`);
  }

  const assignment = new Map(); // week -> rounds[]
  const place = (week, round) => {
    if (!assignment.has(week)) assignment.set(week, []);
    assignment.get(week).push(round);
  };
  const remainingSlots = [...slots];
  const takeSlot = (week) => {
    const i = remainingSlots.indexOf(week);
    if (i === -1) throw new Error(`no free slot left in week ${week}`);
    remainingSlots.splice(i, 1);
  };

  const pending = [...rounds];
  const claim = (predicate, label) => {
    const i = pending.findIndex(predicate);
    if (i === -1) throw new Error(`no round available for ${label}`);
    return pending.splice(i, 1)[0];
  };

  // Reserved placements first — these are rules, not preferences.
  if (policy.crossConference) {
    place(policy.crossConference.week, claim((r) => r.isCrossConference, 'the cross-conference round'));
    takeSlot(policy.crossConference.week);
  }
  if (policy.keepDivisionFinish) {
    const finalWeek = ctx.lastRegularSeasonWeek;
    place(finalWeek, claim((r) => r.divisionGames === r.games.length, 'a pure-division final week'));
    takeSlot(finalWeek);
  }

  // Then: richest division rounds into the cleanest weeks. Bye-free weeks
  // first; after that, lightest bye week first, so any division games that
  // could not be placed cleanly land where the fewest NFL teams are out.
  const cleanSet = new Set(clean);
  remainingSlots.sort((a, b) => {
    const ca = cleanSet.has(a) ? 0 : 1;
    const cb = cleanSet.has(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    if (ca === 1 && byeCounts[a] !== byeCounts[b]) return (byeCounts[a] ?? 0) - (byeCounts[b] ?? 0);
    return a - b;
  });
  pending.sort((a, b) => b.divisionGames - a.divisionGames);
  remainingSlots.forEach((week, i) => place(week, pending[i]));

  // --- report -------------------------------------------------------------
  const planned = new Map();
  for (const [week, rs] of assignment) planned.set(week, rs.flatMap((r) => r.games));

  const isDivision = (g) => ctx.divisionOf[g.away] === ctx.divisionOf[g.home];
  const divIn = (map, weeks) => {
    const s = new Set(weeks);
    let n = 0;
    for (const [w, games] of map) if (s.has(w)) n += games.filter(isDivision).length;
    return n;
  };
  const ceiling = divisionGameCeiling({
    teamCount: ctx.franchiseIds.length,
    divisionSize: ctx.divisionSize,
    byeFree: clean,
    doubleheaders: dh,
    reservedSlotsPerTeam: policy.crossConference ? 1 : 0,
  });

  console.log('\nweek  byes  games  div  ');
  for (let w = 1; w <= ctx.lastRegularSeasonWeek; w += 1) {
    const g = planned.get(w) ?? [];
    console.log(
      `  ${String(w).padStart(2)}  ${String(byeCounts[w] ?? 0).padStart(4)}  ${String(g.length).padStart(5)}  ${String(g.filter(isDivision).length).padStart(3)}  ${dhSet.has(w) ? 'DOUBLEHEADER' : ''}${cleanSet.has(w) ? '' : ''}`,
    );
  }
  console.log(
    `\ndivision games bye-free: ${divIn(current, clean)} → ${divIn(planned, clean)} ` +
      `(ceiling ${ceiling.ceiling} of ${ceiling.total}; ${ceiling.forcedOntoByeWeeks} forced onto bye weeks by the format)`,
  );

  // --- emit ---------------------------------------------------------------
  const lines = [];
  for (let w = 1; w <= ctx.lastRegularSeasonWeek; w += 1) {
    for (const g of planned.get(w) ?? []) {
      lines.push(`${String(w).padStart(2, '0')},${g.away},${g.home}`);
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const txt = path.join(outDir, `${year}-schedule.txt`);
  fs.writeFileSync(txt, `${lines.join('\n')}\n`);

  const json = path.join(outDir, `${year}-schedule.json`);
  fs.writeFileSync(
    json,
    `${JSON.stringify(
      {
        league: ctx.meta.name,
        year,
        generatedFrom: 'scripts/optimize-league-schedule.mjs',
        doubleheaderWeeks: dh,
        byeFreeWeeks: clean,
        divisionGamesByeFree: divIn(planned, clean),
        divisionGameCeiling: ceiling,
        weeks: Object.fromEntries(
          [...planned.keys()].sort((a, b) => a - b).map((w) => [w, planned.get(w)]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${path.relative(ROOT, txt)} (${lines.length} games — paste into MFL)`);
  console.log(`wrote ${path.relative(ROOT, json)}`);
};

main();
