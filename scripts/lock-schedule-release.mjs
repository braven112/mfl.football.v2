#!/usr/bin/env node
/**
 * Schedule Release Day — the cron that locks the reveal.
 *
 * Generates the season's schedule, validates it, and COMMITS it as
 * data/<league>/schedule-release/<year>.json. That commit is the lock: the
 * reveal page reads it, Schefter's column reads it, and a second run refuses
 * to overwrite it. One schedule, one file, one truth.
 *
 * It used to POST to a token-guarded endpoint so the lock could be an atomic
 * Redis SET NX. That bought nothing and cost two things: this repo is PUBLIC,
 * so the shared secret could not live in it and became something to provision
 * and rotate for an event that fires once a year; and two stores meant two
 * answers, with the page and the article able to disagree about what the
 * schedule was. A git commit cannot be evicted, is reviewable in a diff, and
 * there is exactly one of it.
 *
 * Self-guarding: safe to run daily, year-round. It refuses before the league's
 * release date, refuses before the NFL bye calendar for the season has landed,
 * and refuses if the season is already revealed. Every other day of the year it
 * is a no-op that exits 0.
 *
 * If a plan already exists at data/<league>/schedule-plan/<year>-schedule.json
 * it is used as-is rather than regenerated — regenerating would draw a
 * DIFFERENT valid schedule, and if that plan has already been pasted into MFL
 * the reveal would not match the season being played.
 *
 * Usage:
 *   node scripts/lock-schedule-release.mjs                  # every league
 *   node scripts/lock-schedule-release.mjs --league=theleague
 *   node scripts/lock-schedule-release.mjs --dry-run
 *   node scripts/lock-schedule-release.mjs --force          # ignore the date guard
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES, SHARED_APP_ORIGIN } from '../src/config/leagues-data.mjs';
import { marqueeMatchups, priorWinRates, releaseIsReady, scheduleReleaseDate } from '../src/utils/schedule-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dryRun = process.argv.includes('--dry-run');

const force = process.argv.includes('--force');
const year = Number(arg('year', new Date().getUTCFullYear()));
const only = arg('league', null);
const slugs = only ? [only] : Object.keys(LEAGUES).filter((sl) => scheduleReleaseDate(sl, year));

if (!slugs.length) {
  console.log('No league has a schedule-release date configured. Nothing to do.');
  process.exit(0);
}

const byes = (() => {
  try {
    const f = path.join(ROOT, 'data/nfl/bye-weeks.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).seasons?.[String(year)] ?? null : null;
  } catch {
    return null;
  }
})();

/** Archive path. Keyed by season, so last year's reveal is never overwritten. */
const archivePath = (slug, y) => path.join(ROOT, LEAGUES[slug].dataPath, 'schedule-release', `${y}.json`);

let locked = 0;
let failed = 0;

for (const slug of slugs) {
  const league = LEAGUES[slug];
  const date = scheduleReleaseDate(slug, year);
  if (!league || !date) {
    console.log(`  [skip] ${slug}: no release date configured`);
    continue;
  }
  console.log(`\n${league.name} ${year} — release ${date.toISOString().slice(0, 10)}`);

  const file = archivePath(slug, year);
  if (fs.existsSync(file)) {
    console.log(`  [skip] already revealed — ${path.relative(ROOT, file)}`);
    continue;
  }

  // The date and bye-calendar guards. --force is for a rehearsal, and says so.
  const ready = releaseIsReady(slug, year, new Date(), byes);
  if (!ready.ready) {
    if (!force) {
      console.log(`  [skip] ${ready.reason}`);
      continue;
    }
    console.log(`  [force] ignoring guard: ${ready.reason}`);
  }

  try {
    const record = await releaseFromPlan(slug, year);
    if (dryRun) {
      console.log(`  [dry run] would reveal ${record.summary.games} games, doubleheaders ${record.doubleheaderWeeks.join(', ')}`);
      for (const m of record.marquee) console.log(`     Week ${String(m.week).padStart(2)}  ${m.awayName} @ ${m.homeName}`);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`  [revealed] ${record.summary.games} games, doubleheaders ${record.doubleheaderWeeks.join(', ')}`);
    for (const m of record.marquee) console.log(`     Week ${String(m.week).padStart(2)}  ${m.awayName} @ ${m.homeName}`);
    console.log(`  wrote ${path.relative(ROOT, file)}`);
    locked += 1;
  } catch (err) {
    console.error(`  [fail] ${err.message}`);
    failed += 1;
  }
}

/**
 * Build a reveal record from the plan already on disk. Deliberately does NOT
 * call the planner: the point is to canonise the exact schedule that was
 * generated (and possibly already pasted), not to draw a new one.
 */
async function releaseFromPlan(slug, y) {
  const registry = LEAGUES[slug];
  const planFile = path.join(ROOT, registry.dataPath, 'schedule-plan', `${y}-schedule.json`);
  if (!fs.existsSync(planFile)) {
    // No plan yet — draw one. The workflow runs generate-schedule.mjs first so
    // this is the fallback, not the usual path.
    throw new Error(
      `no generated plan at ${path.relative(ROOT, planFile)} — run: node scripts/generate-schedule.mjs --league=${slug} --year=${y}`,
    );
  }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.problems?.length) {
    throw new Error(`that plan breaks ${plan.problems.length} rule(s) — refusing to reveal it`);
  }

  const readFeed = (yy, feed) => {
    const f = path.join(ROOT, registry.dataPath, 'mfl-feeds', String(yy), `${feed}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  const meta = readFeed(y, 'league')?.league;
  if (!meta) throw new Error(`missing league feed for ${slug} ${y}`);

  const divisionName = {};
  const divisionConference = {};
  for (const d of [].concat(meta.divisions?.division ?? [])) {
    divisionName[d.id] = d.name;
    divisionConference[d.id] = d.conference;
  }
  const name = {};
  const divisionOf = {};
  const conferenceOf = {};
  for (const f of [].concat(meta.franchises?.franchise ?? [])) {
    name[f.id] = f.name;
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
    conferenceOf[f.id] = divisionConference[String(f.division)] ?? '00';
  }

  let lastChampionship = null;
  const champFile = path.join(ROOT, registry.dataPath, 'championship-history.json');
  if (fs.existsSync(champFile)) {
    const raw = JSON.parse(fs.readFileSync(champFile, 'utf8'));
    lastChampionship = Object.values(raw.championships ?? raw).find((c) => Number(c?.year) === y - 1) ?? null;
  }

  const weeks = new Map(Object.entries(plan.weeks).map(([w, g]) => [Number(w), g]));
  const marquee = marqueeMatchups(
    weeks,
    {
      divisionOf,
      conferenceOf,
      name,
      winRate: priorWinRates(readFeed(y - 1, 'standings')?.leagueStandings?.franchise),
      lastChampionship,
      lastWeek: Number(meta.lastRegularSeasonWeek),
      doubleheaderWeeks: plan.doubleheaderWeeks,
    },
    4,
  );

  return {
    league: slug,
    year: y,
    revealedAt: new Date().toISOString(),
    text: plan.text,
    weeks: plan.weeks,
    doubleheaderWeeks: plan.doubleheaderWeeks,
    byeFreeWeeks: plan.byeFreeWeeks,
    marquee,
    summary: {
      games: plan.plan.games,
      byeFreeDivisionGames: plan.plan.byeFreeDivisionGames,
      divisionGameCeiling: plan.divisionGameCeiling.ceiling,
      netByeSpread: plan.plan.netByeSpread,
      homeGames: plan.plan.homeGames,
      minRematchGap: plan.plan.minRematchGap,
    },
  };
}

console.log(`\n${locked} reveal(s) locked, ${failed} failure(s).`);
// A failed lock ON RELEASE DAY is worth a red run; a quiet no-op day is not.
if (failed) process.exitCode = 1;
