#!/usr/bin/env node
/**
 * Schedule Release Day — the cron that locks the reveal.
 *
 * Unlike every other workflow here, this one does NOT compute-and-commit. The
 * lock lives in Redis, which GitHub Actions cannot reach, and it has to be
 * atomic: the whole point of the reveal is that one schedule is drawn and
 * everybody sees that one. So the cron POSTs to the deployed app, which owns
 * the lock, and then archives the result back into the repo.
 *
 * Two writes, one truth. Redis is the live lock — the thing the page reads and
 * the thing that makes "first write wins" real. The committed archive under
 * data/<league>/schedule-release/<year>.json exists so a reveal survives Redis
 * eviction, is reviewable in a diff, and can be handed to Schefter's column
 * without a network call. The archive is written FROM the API's response, never
 * generated separately — generating twice would produce two different valid
 * schedules and the archive would disagree with what the league saw.
 *
 * Self-guarding: safe to run daily, year-round. The API refuses to lock before
 * the release date, and refuses before the NFL bye calendar for the season has
 * actually landed. A run outside the window is a no-op that exits 0.
 *
 * Environment:
 *   SCHEDULE_RELEASE_TOKEN  required — shared secret the API checks
 *   SCHEDULE_RELEASE_ORIGIN optional — override the target origin (staging)
 *
 * Usage:
 *   node scripts/lock-schedule-release.mjs                  # every league
 *   node scripts/lock-schedule-release.mjs --league=theleague
 *   node scripts/lock-schedule-release.mjs --dry-run        # report, don't lock
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES, SHARED_APP_ORIGIN } from '../src/config/leagues-data.mjs';
import { scheduleReleaseDate } from '../src/utils/schedule-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dryRun = process.argv.includes('--dry-run');

const origin = process.env.SCHEDULE_RELEASE_ORIGIN || SHARED_APP_ORIGIN;
const token = process.env.SCHEDULE_RELEASE_TOKEN;

const year = Number(arg('year', new Date().getUTCFullYear()));
const only = arg('league', null);
const slugs = only ? [only] : Object.keys(LEAGUES).filter((s) => scheduleReleaseDate(s, year));

if (!slugs.length) {
  console.log('No league has a schedule-release date configured. Nothing to do.');
  process.exit(0);
}
if (!token && !dryRun) {
  console.error('SCHEDULE_RELEASE_TOKEN is not set — cannot lock a reveal.');
  process.exit(1);
}

/** Archive path. Keyed by season, so last year's reveal is never overwritten. */
const archivePath = (slug, y) => path.join(ROOT, LEAGUES[slug].dataPath, 'schedule-release', `${y}.json`);

let locked = 0;
let failed = 0;

for (const slug of slugs) {
  const league = LEAGUES[slug];
  const date = scheduleReleaseDate(slug, year);
  const label = `${league?.name ?? slug} ${year}`;
  if (!league || !date) {
    console.log(`  [skip] ${slug}: no release date configured`);
    continue;
  }

  const url = `${origin}/api/schedule-release?league=${encodeURIComponent(slug)}&year=${year}`;
  console.log(`\n${label} — release ${date.toISOString().slice(0, 10)}`);

  if (dryRun) {
    console.log(`  [dry run] would POST ${url}`);
    continue;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-schedule-release-token': token, 'Content-Type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));

    // 409 is the normal outside-the-window answer, not a failure: this runs
    // daily and only one day a year is release day.
    if (res.status === 409) {
      console.log(`  [skip] ${body.reason ?? 'not release day yet'}`);
      continue;
    }
    if (!res.ok) {
      console.error(`  [fail] HTTP ${res.status}: ${body.error ?? 'unknown error'}`);
      failed += 1;
      continue;
    }
    if (body.status === 'already') {
      console.log(`  [skip] already revealed at ${body.release?.revealedAt ?? 'an earlier run'}`);
    } else {
      console.log(`  [locked] ${body.release?.summary?.games ?? '?'} games, doubleheaders ${(body.release?.doubleheaderWeeks ?? []).join(', ')}`);
      for (const m of body.release?.marquee ?? []) {
        console.log(`     Week ${String(m.week).padStart(2)}  ${m.awayName} @ ${m.homeName}`);
      }
      locked += 1;
    }

    // Archive whatever the API holds — including on 'already', so a run that
    // followed a commissioner's manual reveal still captures it.
    if (body.release) {
      const file = archivePath(slug, year);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(body.release, null, 2)}\n`);
      console.log(`  archived ${path.relative(ROOT, file)}`);
    }
  } catch (err) {
    console.error(`  [fail] ${err.message}`);
    failed += 1;
  }
}

console.log(`\n${locked} reveal(s) locked, ${failed} failure(s).`);
// A failed lock ON RELEASE DAY is worth a red run; a quiet no-op day is not.
if (failed) process.exitCode = 1;
