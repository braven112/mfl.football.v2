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
 *   node scripts/lock-schedule-release.mjs --from-live      # canonise what is already in MFL
 *   node scripts/lock-schedule-release.mjs --from-live --relock   # ...over a wrong reveal
 *
 * --from-live exists because the plan on disk and the schedule the
 * commissioner actually pasted can be two DIFFERENT valid draws. The optimiser
 * is simulated annealing, so a second run — the admin page, a re-run of the
 * CLI — produces another season that satisfies every rule and shares not one
 * week with the committed plan. When that has already happened, the reveal has
 * to describe the season being played, not the one the file remembers, so this
 * mode reads the live MFL schedule feed and canonises THAT. It validates the
 * live schedule with the same audit and refuses to lock a broken one.
 *
 * --relock is what makes --from-live usable in the case it exists for. The
 * archive IS the lock, so an existing one normally ends the run — but a reveal
 * built from the wrong draw is precisely a state in which the archive already
 * exists, and without an escape hatch the documented repair is a silent no-op
 * that exits 0 while the column stays deadlocked. --relock overwrites it, and
 * ONLY alongside --from-live: overwriting with a fresh PLAN would draw a new
 * season and defeat the lock entirely, which is the one thing it is for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES, SHARED_APP_ORIGIN } from '../src/config/leagues-data.mjs';
import { marqueeMatchups, priorWinRates, releaseIsReady, scheduleReleaseDate } from '../src/utils/schedule-release.mjs';
import { rivalrySeriesByPair } from '../src/utils/rivalry-intensity.mjs';
import {
  byeExposure,
  describeSeason,
  SCHEDULE_POLICY,
  seasonShape,
  toMflScheduleText,
  validateSeason,
} from '../src/utils/schedule-plan.mjs';
import {
  byeFreeWeeks,
  divisionGameCeiling,
  doubleheaderWeeks,
  regularSeasonGames,
} from '../src/utils/schedule-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dryRun = process.argv.includes('--dry-run');

const force = process.argv.includes('--force');
const fromLive = process.argv.includes('--from-live');
const relock = process.argv.includes('--relock');
const year = Number(arg('year', new Date().getUTCFullYear()));
const only = arg('league', null);
const slugs = only ? [only] : Object.keys(LEAGUES).filter((sl) => scheduleReleaseDate(sl, year));

if (!slugs.length) {
  console.log('No league has a schedule-release date configured. Nothing to do.');
  process.exit(0);
}

const byesFor = (y) => {
  try {
    const f = path.join(ROOT, 'data/nfl/bye-weeks.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).seasons?.[String(y)] ?? null : null;
  } catch {
    return null;
  }
};
const byes = byesFor(year);

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
    // The archive is the lock. Replacing it is only ever right when the
    // replacement is the season MFL is ALREADY running — never a fresh draw.
    if (!(relock && fromLive)) {
      console.log(`  [skip] already revealed — ${path.relative(ROOT, file)}`);
      if (relock) console.log('  [relock] ignored: --relock requires --from-live (a re-drawn plan would defeat the lock).');
      continue;
    }
    console.log(`  [relock] overwriting ${path.relative(ROOT, file)} with the schedule live in MFL.`);
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
    const record = fromLive ? await releaseFromLive(slug, year) : await releaseFromPlan(slug, year);
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

  const ctx = revealContext(slug, y);
  const weeks = new Map(Object.entries(plan.weeks).map(([w, g]) => [Number(w), g]));

  return {
    league: slug,
    year: y,
    revealedAt: new Date().toISOString(),
    source: 'plan',
    text: plan.text,
    weeks: plan.weeks,
    doubleheaderWeeks: plan.doubleheaderWeeks,
    byeFreeWeeks: plan.byeFreeWeeks,
    marquee: pickMarquee(ctx, weeks, plan.doubleheaderWeeks),
    summary: {
      games: plan.plan.games,
      byeFreeDivisionGames: plan.plan.byeFreeDivisionGames,
      divisionGameCeiling: plan.divisionGameCeiling.ceiling,
      divisionGames: plan.divisionGameCeiling.total,
      netByeSpread: plan.plan.netByeSpread,
      homeGames: plan.plan.homeGames,
      minRematchGap: plan.plan.minRematchGap,
    },
  };
}

/**
 * Build a reveal record from the schedule that is ALREADY LIVE in MFL.
 *
 * The committed plan and the pasted season can be two different valid draws —
 * the optimiser anneals, so the admin page and the CLI each produce a season
 * that satisfies every rule and shares not one week with the other. Once a
 * paste has landed, the reveal has to describe the season being played;
 * anything else shows owners a schedule nobody will play and leaves Schefter's
 * column permanently gated on a match that will never happen.
 *
 * The live schedule gets the SAME audit a generated one does. A schedule that
 * fails it is not lockable — the point of the archive is that it is the truth,
 * and canonising a broken season would only make it the official one.
 */
async function releaseFromLive(slug, y) {
  const ctx = revealContext(slug, y);
  const { registry, shape, readFeed } = ctx;

  const weeks = regularSeasonGames(readFeed(y, 'schedule')?.schedule?.weeklySchedule, shape.lastWeek);
  if (!weeks.size) throw new Error(`no live schedule in ${registry.dataPath}/mfl-feeds/${y}/schedule.json`);

  // EVERY regular-season week, or this is not a season yet.
  //
  // `regularSeasonGames` drops a week with no matchups and `validateSeason`
  // only walks the weeks it is given, so a half-applied paste — or a feed
  // fetched while the commissioner was mid-paste — passes every check it has:
  // each franchise still loses the SAME game, so the equal-games test holds,
  // and a missing week carrying no division game is invisible to the rivals
  // test too. A 13-week AFL season audits clean and locks as truth, and the
  // column opens by announcing 192 games of a 204-game season. The planner
  // always emits every week, so this hole only opened when a live feed became
  // a possible source.
  const missing = [];
  for (let w = 1; w <= shape.lastWeek; w++) if (!weeks.has(w)) missing.push(w);
  if (missing.length) {
    throw new Error(
      `the live schedule is missing Week ${missing.join(', ')} of 1-${shape.lastWeek} — ` +
        'a partly-applied paste is not a season; refetch the feed and try again',
    );
  }

  const seasonByes = byesFor(y);
  if (!seasonByes) throw new Error(`no NFL bye calendar for ${y} — cannot audit the live schedule`);
  const byeFree = byeFreeWeeks(seasonByes, shape.lastWeek);
  const doubleheaders = doubleheaderWeeks(weeks);

  const problems = validateSeason(weeks, shape, { byeFree, doubleheaders });
  if (problems.length) {
    throw new Error(`the live schedule breaks ${problems.length} rule(s) — refusing to reveal it:\n     ${problems.join('\n     ')}`);
  }

  const exposure = byeExposure(readFeed(y, 'rosters'), readFeed(y, 'players'), seasonByes, shape.franchiseIds);
  const described = describeSeason(weeks, shape, { byes: seasonByes, exposure, byeFree, doubleheaders });
  const divisionSize = shape.franchiseIds.length / shape.divisionCount;
  const ceiling = divisionGameCeiling({
    teamCount: shape.franchiseIds.length,
    divisionSize,
    byeFree,
    doubleheaders,
    // The cross-conference round is a slot a franchise cannot spend on a
    // division game; the AFL reserves one, The League none.
    reservedSlotsPerTeam: SCHEDULE_POLICY[slug]?.crossConference ? 1 : 0,
  });

  return {
    league: slug,
    year: y,
    revealedAt: new Date().toISOString(),
    source: 'live',
    text: toMflScheduleText(weeks),
    weeks: Object.fromEntries([...weeks].sort((a, b) => a[0] - b[0]).map(([w, g]) => [String(w), g])),
    doubleheaderWeeks: doubleheaders,
    byeFreeWeeks: byeFree,
    marquee: pickMarquee(ctx, weeks, doubleheaders),
    summary: {
      games: described.games,
      byeFreeDivisionGames: described.byeFreeDivisionGames,
      divisionGameCeiling: ceiling.ceiling,
      divisionGames: ceiling.total,
      netByeSpread: described.netByeSpread,
      homeGames: described.homeGames,
      minRematchGap: described.minRematchGap,
    },
  };
}

/**
 * Everything a reveal needs about a league that is not the schedule itself:
 * who the franchises are, last year's finish, the career head-to-head, and
 * whether the league runs a Throwback Week. Shared so a plan-sourced and a
 * live-sourced reveal cannot describe the same league differently.
 */
function revealContext(slug, y) {
  const registry = LEAGUES[slug];
  const readFeed = (yy, feed) => {
    const f = path.join(ROOT, registry.dataPath, 'mfl-feeds', String(yy), `${feed}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  const leagueJson = readFeed(y, 'league');
  const shape = seasonShape(leagueJson);
  if (!shape) throw new Error(`missing league feed for ${slug} ${y}`);
  // MFL stores a few franchise names with a stray leading space.
  for (const id of shape.franchiseIds) shape.name[id] = String(shape.name[id] ?? '').trim();

  let lastChampionship = null;
  const champFile = path.join(ROOT, registry.dataPath, 'championship-history.json');
  if (fs.existsSync(champFile)) {
    const raw = JSON.parse(fs.readFileSync(champFile, 'utf8'));
    lastChampionship = Object.values(raw.championships ?? raw).find((c) => Number(c?.year) === y - 1) ?? null;
  }

  // Career head-to-head, so a long series counts toward a game being marquee.
  // Missing history is not an error: a league with no ingested archives simply
  // scores on this year's evidence, exactly as it did before.
  let rivalry = {};
  const historyFile = path.join(ROOT, registry.dataPath, 'derived', 'franchise-history.json');
  if (fs.existsSync(historyFile)) {
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    rivalry = rivalrySeriesByPair(history.franchises ?? history);
  }

  // Throwback Week, if this league runs one. Straight off the registry rather
  // than a slug test, so giving a second league a throwback week is a one-key
  // change there and needs no branch here.
  const throwbackWeek = registry.throwbackWeeks?.[0] ?? null;

  return { registry, readFeed, year: y, shape, lastChampionship, rivalry, throwbackWeek };
}

/** The four games the league is shown on release day. */
function pickMarquee(ctx, weeks, doubleheaders) {
  const { shape, readFeed, lastChampionship, rivalry, throwbackWeek } = ctx;
  return marqueeMatchups(
    weeks,
    {
      divisionOf: shape.divisionOf,
      conferenceOf: shape.conferenceOf,
      name: shape.name,
      winRate: priorWinRates(readFeed(ctx.year - 1, 'standings')?.leagueStandings?.franchise),
      lastChampionship,
      lastWeek: shape.lastWeek,
      doubleheaderWeeks: doubleheaders,
      rivalry,
      throwbackWeek,
    },
    4,
  );
}

console.log(`\n${locked} reveal(s) locked, ${failed} failure(s).`);
// A failed lock ON RELEASE DAY is worth a red run; a quiet no-op day is not.
if (failed) process.exitCode = 1;
