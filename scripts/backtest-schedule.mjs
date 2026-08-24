#!/usr/bin/env node
/**
 * Replay the scheduler against every NFL bye calendar we hold, and score each
 * result against the goals.
 *
 * WHY
 *
 * The league does not control the NFL's bye calendar and it is the single
 * input that decides whether a goal is easy, hard, or impossible in a given
 * year. Tuning the optimiser against one season proves nothing: 2026's byes run
 * Weeks 5-14, but 2011-2020's mostly START in Week 4 and are DONE by Week 11-13
 * — an inverted calendar that puts the pressure on completely different weeks.
 * 2017 even carries a Week 1 bye.
 *
 * So this is a robustness harness, not a prediction one. It answers: does the
 * formula hold up across the range of calendars the NFL actually produces, and
 * which goals are the fragile ones?
 *
 * Historical seasons have no ranking-sources file, so those fall back to
 * whole-roster bye exposure (planSchedule handles it). That makes the absolute
 * bye numbers for old seasons pessimistic, but the pass/fail shape of each goal
 * is unaffected — every one of them keys off the CALENDAR, not the roster.
 *
 * Usage:
 *   node scripts/backtest-schedule.mjs                    # every season, both leagues
 *   node scripts/backtest-schedule.mjs --league=theleague
 *   node scripts/backtest-schedule.mjs --from=2019 --iterations=4000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { planSchedule, SCHEDULE_POLICY } from '../src/utils/schedule-plan.mjs';
import { LIGHT_BYE_WEEK_MAX } from '../src/utils/schedule-builder.mjs';
import { goalFactsFromSeason, scoreSeasonGoals } from '../src/utils/schedule-goals.mjs';
import { scheduleConstraints } from '../src/utils/schedule-constraints.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

const byeData = readJson(path.join(ROOT, 'data/nfl/bye-weeks.json'))?.seasons ?? {};
const from = Number(arg('from', 0));
const to = Number(arg('to', 9999));
const iterations = Number(arg('iterations', 6000));
const restarts = Number(arg('restarts', 3));
const onlyLeague = arg('league', null);

/**
 * Calendars the NFL has not produced yet but plausibly will. The league has
 * said the season only ever GROWS, an odd team count would put somebody on a
 * bye every single week, and a second bye per team has been openly discussed
 * alongside an 18-game season. None of these can be backtested against history
 * because history does not contain them, so they are constructed.
 *
 * `--stress` runs them against the most recent league config.
 */
const STRESS = {
  'two byes per team': (byes) => {
    const out = {};
    const teams = Object.keys(byes);
    teams.forEach((t, i) => {
      // Second bye placed a fixed distance from the first so the calendar stays
      // spread rather than piling every team into the same fortnight.
      const first = Number(byes[t]);
      out[t] = [first, ((first + 4 + (i % 3)) % 10) + 5];
    });
    return out;
  },
  'odd team count — a bye EVERY week': (byes, lastWeek) => {
    const out = {};
    // 33 teams: one sits out every week, so no week is ever bye-free.
    Object.keys(byes).forEach((t, i) => {
      out[t] = (i % lastWeek) + 1;
    });
    return out;
  },
  'no byes at all': () => ({}),
};

const slugs = Object.keys(SCHEDULE_POLICY).filter((s) => !onlyLeague || s === onlyLeague);
const seasons = Object.keys(byeData).map(Number).filter((y) => y >= from && y <= to).sort();

/** Short glyph per verdict so a 16-row matrix stays readable. */
const GLYPH = { met: '  ok  ', partial: ' part ', blocked: ' FAIL ', optimised: ' opt  ' };

const runLeague = (slug) => {
  const registry = LEAGUES[slug];
  const readFeedFor = (year) => (y, feed) =>
    readJson(path.join(ROOT, registry.dataPath, 'mfl-feeds', String(y), `${feed}.json`));

  const rows = [];
  for (const year of seasons) {
    const read = readFeedFor(year);
    // A season needs its own league config and the PRIOR year's standings (the
    // cross-conference round is seeded from last season's division finishes).
    if (!read(year, 'league')) { rows.push({ year, skip: 'no league feed' }); continue; }
    if (!read(year, 'rosters')) { rows.push({ year, skip: 'no rosters feed' }); continue; }

    try {
      const plan = planSchedule({
        slug,
        year,
        byes: byeData[String(year)],
        readFeed: read,
        rankingSources: readJson(path.join(ROOT, 'data', 'ranking-sources', `${year}.json`)),
        search: { restarts, iterations },
      });
      const { goals } = scoreSeasonGoals(
        goalFactsFromSeason({
          season: year,
          crossConference: Boolean(SCHEDULE_POLICY[slug]?.crossConference),
          lastWeek: plan.lastWeek,
          described: plan.plan,
          ceiling: plan.divisionGameCeiling,
          doubleheaders: plan.doubleheaderWeeks,
          lightByeWeekMax: LIGHT_BYE_WEEK_MAX,
          problems: plan.problems,
        }),
      );
      rows.push({ year, goals, plan });
    } catch (err) {
      rows.push({ year, error: err.message });
    }
  }

  // Column order is the goal order, so the matrix reads as the priority list.
  const keys = scheduleConstraints({}).map((c) => c.key);
  const header = keys.map((k) => k.slice(0, 6).padStart(6)).join('|');
  console.log(`\n${'='.repeat(12 + header.length)}`);
  console.log(`${registry.name ?? slug} — ${rows.length} seasons`);
  console.log(`${'='.repeat(12 + header.length)}`);
  console.log(`year  dh  |${header}|`);

  const tally = {};
  for (const r of rows) {
    if (r.skip) { console.log(`${r.year}  --   ${r.skip}`); continue; }
    if (r.error) { console.log(`${r.year}  --   THREW: ${r.error}`); (tally.threw ??= []).push(r.year); continue; }
    const byKey = new Map(r.goals.map((g) => [g.key, g]));
    const cells = keys.map((k) => (byKey.has(k) ? GLYPH[byKey.get(k).status] ?? '  ?   ' : '  --  ')).join('|');
    console.log(`${r.year} ${String(r.plan.doubleheaderWeeks.join(',')).padEnd(11)}|${cells}|`);
    for (const g of r.goals) {
      (tally[g.key] ??= { met: 0, partial: 0, blocked: 0, optimised: 0 })[g.status] += 1;
    }
  }

  console.log('\n  goal                        met  partial  FAILED  optimised');
  for (const k of keys) {
    const t = tally[k];
    if (!t) continue;
    console.log(`  ${k.padEnd(28)}${String(t.met).padStart(3)}  ${String(t.partial).padStart(7)}  ` +
      `${String(t.blocked).padStart(6)}  ${String(t.optimised).padStart(9)}`);
  }
  if (tally.threw) console.log(`\n  SEASONS THAT COULD NOT BE PLANNED AT ALL: ${tally.threw.join(', ')}`);

  // Every detail for the seasons that went wrong — the point of the exercise.
  for (const r of rows) {
    if (r.skip || r.error) continue;
    const bad = r.goals.filter((g) => g.status === 'blocked' || g.status === 'partial');
    if (!bad.length) continue;
    console.log(`\n  ${r.year}:`);
    for (const g of bad) console.log(`    [${g.status}] ${g.key}: ${g.detail}`);
  }

  // Calendars the NFL has not produced yet. A THROW here is the finding —
  // it means a plausible future breaks the planner outright.
  if (process.argv.includes('--stress')) {
    const year = seasons.at(-1);
    const read = readFeedFor(year);
    if (!read(year, 'league')) return;
    const lastWeek = Number(read(year, 'league').league.lastRegularSeasonWeek);
    console.log(`\n  --- stress: hypothetical calendars against the ${year} league config ---`);
    for (const [name, build] of Object.entries(STRESS)) {
      const byes = build(byeData[String(year)], lastWeek);
      try {
        const plan = planSchedule({
          slug, year, byes, readFeed: read,
          rankingSources: readJson(path.join(ROOT, 'data', 'ranking-sources', `${year}.json`)),
          search: { restarts: 1, iterations: 1500 },
        });
        const { goals } = scoreSeasonGoals(
          goalFactsFromSeason({
            season: year,
            crossConference: Boolean(SCHEDULE_POLICY[slug]?.crossConference),
            lastWeek: plan.lastWeek,
            described: plan.plan,
            ceiling: plan.divisionGameCeiling,
            doubleheaders: plan.doubleheaderWeeks,
            lightByeWeekMax: LIGHT_BYE_WEEK_MAX,
            problems: plan.problems,
          }),
        );
        const failed = goals.filter((g) => g.status === 'blocked').map((g) => g.key);
        console.log(`    ${name.padEnd(34)} planned. DH ${JSON.stringify(plan.doubleheaderWeeks)}` +
          `${failed.length ? ` | goals failed: ${failed.join(', ')}` : ' | every goal met or partial'}`);
      } catch (err) {
        console.log(`    ${name.padEnd(34)} THREW: ${err.message}`);
      }
    }
  }
};
for (const slug of slugs) runLeague(slug);
