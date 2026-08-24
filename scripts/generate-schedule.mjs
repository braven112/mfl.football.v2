#!/usr/bin/env node
/**
 * CLI front end for the schedule planner. Same module the admin page calls
 * (src/utils/schedule-plan.mjs), so the two cannot give different answers.
 *
 * MFL has no schedule write API, so this only ever PRINTS. Applying a schedule
 * means pasting into Commissioner -> Setup -> Schedule -> the advanced editor,
 * which overwrites the entire fantasy schedule with no undo. Verify first:
 *
 *   node scripts/generate-schedule.mjs --league=afl-fantasy
 *   node scripts/generate-schedule.mjs --league=theleague
 *   SCHEDULE_AUDIT_ROOT=$(node scripts/stage-schedule-plan.mjs --print-root) \
 *     pnpm vitest run tests/schedule-optimization.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';
import { planSchedule, SCHEDULE_POLICY } from '../src/utils/schedule-plan.mjs';
import { blockingFailures, goalFactsFromSeason, scoreSeasonGoals } from '../src/utils/schedule-goals.mjs';
import { LIGHT_BYE_WEEK_MAX } from '../src/utils/schedule-builder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => {
  try {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch {
    return null;
  }
};
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const slug = arg('league', 'afl-fantasy');
const league = LEAGUES[slug];
if (!league || !SCHEDULE_POLICY[slug]) {
  console.error(`no scheduling policy for league: ${slug}`);
  process.exit(1);
}
const year = Number(arg('year', new Date().getUTCFullYear()));
const outDir = arg('out', path.join(ROOT, league.dataPath, 'schedule-plan'));
const suffix = arg('mode') ? `-${arg('mode')}` : '';

const byes = readJson(path.join(ROOT, 'data/nfl/bye-weeks.json'))?.seasons?.[String(year)];
if (!byes) {
  console.error(`no NFL bye weeks stored for ${year} — run: node scripts/fetch-nfl-bye-weeks.mjs ${year}`);
  process.exit(1);
}

// Player values for the projected-starter bye model. League-independent, so it
// is read from the shared path rather than through readFeed (which is scoped to
// one league's mfl-feeds directory).
const rankingSources = readJson(path.join(ROOT, 'data', 'ranking-sources', `${year}.json`));
if (!rankingSources) {
  console.warn(
    `no data/ranking-sources/${year}.json — falling back to whole-roster bye counts. ` +
      `Run: node scripts/fetch-ranking-sources.mjs`,
  );
}

const plan = planSchedule({
  slug,
  year,
  byes,
  rankingSources,
  readFeed: (y, feed) => readJson(path.join(ROOT, league.dataPath, 'mfl-feeds', String(y), `${feed}.json`)),
  search: { restarts: Number(arg('restarts', 8)), iterations: Number(arg('iterations', 15000)) },
  // --mode=constructive forces the full rebuild on a league whose policy is
  // `simple`, so the two can be compared without editing the policy.
  mode: arg('mode', undefined),
});

console.log(`\n=== ${plan.leagueName} ${year} (${plan.mode}) ===`);
console.log(`bye-free weeks:        ${plan.byeFreeWeeks.join(', ')}`);
console.log(
  `doubleheaders:         ${plan.currentDoubleheaderWeeks.join(', ') || '—'} -> ${plan.doubleheaderWeeks.join(', ')}`,
);
if (plan.changedWeeks) {
  console.log(`weeks changed:         ${plan.changedWeeks.length ? plan.changedWeeks.join(', ') : 'none'}`);
}
if (plan.crossConference) {
  const changedPairs = plan.crossConference.pairs.filter((p) => p.protectedRivalry).length;
  console.log(
    `cross-conference:      ${plan.crossConference.divisionPairing.map((p) => p.join('/')).join(' + ')}` +
      `${changedPairs ? `, ${changedPairs} protected rivalry` : ''}`,
  );
}

console.log('\nweek  byes  games  div');
for (const w of plan.plan.byWeek) {
  console.log(
    `  ${String(w.week).padStart(2)}  ${String(w.nflByes || 0).padStart(4)}  ${String(w.games).padStart(5)}  ` +
      `${String(w.divisionGames || 0).padStart(3)}  ${w.doubleheader ? 'DOUBLEHEADER' : ''}`,
  );
}

const c = plan.currentPlan;
const row = (label, now, next) => console.log(`  ${label.padEnd(32)} ${String(now).padStart(8)} -> ${String(next)}`);
console.log('\n                                       now      new');
row('division games bye-free', c?.byeFreeDivisionGames ?? '—', `${plan.plan.byeFreeDivisionGames} (ceiling ${plan.divisionGameCeiling.ceiling})`);
row('season net bye spread', c?.netByeSpread ?? '—', plan.plan.netByeSpread);
row('mean bye differential/game', (c?.meanByeDifferential ?? 0).toFixed(2), plan.plan.meanByeDifferential.toFixed(2));
row('minimum rematch gap', c?.minRematchGap ?? '—', plan.plan.minRematchGap ?? '—');
row('home games min-max', c ? `${c.homeGames.min}-${c.homeGames.max}` : '—', `${plan.plan.homeGames.min}-${plan.plan.homeGames.max}`);

if (plan.problems.length) {
  console.error(`\nDO NOT PASTE — ${plan.problems.length} rule violation(s):`);
  for (const p of plan.problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\npasses every structural check');
}

// The goal scorecard, HERE, not just at lock time.
//
// The NFL publishes its schedule in mid-May and The League reveals on June 1 —
// that fortnight is the entire window for noticing a bad draw and fixing it,
// and it only exists if someone is told. The daily cron draws the plan the day
// the bye calendar lands and then says nothing until the lock fires on release
// day, which would turn the buffer into a countdown. So the same gate the lock
// applies runs now, and a plan that would be refused on June 1 fails the draw
// in mid-May instead.
const scored = scoreSeasonGoals(
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
const GLYPH = { met: 'ok  ', partial: 'part', blocked: 'FAIL', optimised: 'opt ' };
console.log('\ngoals');
for (const g of scored.goals) {
  console.log(`  ${String(g.rank).padStart(2)}. [${GLYPH[g.status] ?? g.status}] ${g.key}: ${g.detail}`);
}
for (const n of scored.notYetAdopted) {
  console.log(`   -. [n/a ] ${n.key} — adopted for ${n.since}, after this season`);
}

const blocking = blockingFailures(scored.goals);
if (blocking.length) {
  console.error(
    `\nTHIS PLAN WOULD BE REFUSED AT LOCK TIME — ${blocking.length} goal(s) it could have met:`,
  );
  for (const g of blocking) console.error(`  ${g.rank}. ${g.key}: ${g.detail}`);
  console.error('\nRedraw with a different --seed, or fix the goal that is failing.');
  process.exitCode = 1;
}

fs.mkdirSync(outDir, { recursive: true });
const txt = path.join(outDir, `${year}-schedule${suffix}.txt`);
fs.writeFileSync(txt, `${plan.text}\n`);
const { weeks, ...serialisable } = plan;
fs.writeFileSync(
  path.join(outDir, `${year}-schedule${suffix}.json`),
  `${JSON.stringify({ ...serialisable, weeks: Object.fromEntries([...weeks.entries()].sort((a, b) => a[0] - b[0])) }, null, 2)}\n`,
);
console.log(`\nwrote ${path.relative(ROOT, txt)} (${plan.text.split('\n').length} games — paste into MFL)`);
