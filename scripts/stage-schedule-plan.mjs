#!/usr/bin/env node
/**
 * Stage generated schedule plans as MFL-feed-shaped files so the annual audit
 * can be run against a CANDIDATE schedule before it is pasted.
 *
 * Pasting into MFL's commissioner editor overwrites the entire fantasy
 * schedule and there is no undo, so "does this plan actually pass every rule"
 * is a question worth answering first — and answering it with the same test
 * that guards the live schedule, not a second implementation that could agree
 * with the planner for the wrong reason.
 *
 *   node scripts/stage-schedule-plan.mjs
 *   SCHEDULE_AUDIT_ROOT=$(node scripts/stage-schedule-plan.mjs --print-root) \
 *     pnpm vitest run tests/schedule-optimization.test.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(os.tmpdir(), 'mfl-schedule-plan-audit');
const quiet = process.argv.includes('--print-root');
const log = (...a) => {
  if (!quiet) console.log(...a);
};

fs.rmSync(STAGE, { recursive: true, force: true });

for (const [slug, league] of Object.entries(LEAGUES)) {
  const planDir = path.join(ROOT, league.dataPath, 'schedule-plan');
  if (!fs.existsSync(planDir)) continue;
  for (const file of fs.readdirSync(planDir).filter((f) => f.endsWith('-schedule.json'))) {
    const year = file.slice(0, 4);
    const plan = JSON.parse(fs.readFileSync(path.join(planDir, file), 'utf8'));
    const src = path.join(ROOT, league.dataPath, 'mfl-feeds');
    const dst = path.join(STAGE, league.dataPath, 'mfl-feeds');

    // Carry the real league + standings feeds through untouched; only the
    // schedule is replaced. The prior season comes along because the
    // cross-conference check reads its division finishes.
    for (const y of [String(Number(year) - 1), year]) {
      if (!fs.existsSync(path.join(src, y))) continue;
      fs.mkdirSync(path.join(dst, y), { recursive: true });
      for (const feed of ['league.json', 'standings.json']) {
        const from = path.join(src, y, feed);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dst, y, feed));
      }
    }
    const weeklySchedule = Object.keys(plan.weeks)
      .map(Number)
      .sort((a, b) => a - b)
      .map((w) => ({
        week: String(w),
        matchup: plan.weeks[w].map((g) => ({
          franchise: [
            { id: g.away, isHome: '0' },
            { id: g.home, isHome: '1' },
          ],
        })),
      }));
    fs.writeFileSync(
      path.join(dst, year, 'schedule.json'),
      JSON.stringify({ schedule: { weeklySchedule } }, null, 2),
    );
    log(`staged ${slug} ${year} (${weeklySchedule.length} weeks)`);
  }
}

if (quiet) process.stdout.write(STAGE);
else log(`\nSCHEDULE_AUDIT_ROOT=${STAGE}`);
