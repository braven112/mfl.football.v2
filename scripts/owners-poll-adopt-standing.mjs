#!/usr/bin/env node
/**
 * ONE-SHOT: lift a league's existing week-scoped ballots into the standing hash.
 *
 * Before standing votes, ballots lived at `poll:<navSlug>:<year>-w<week>` and
 * were abandoned every Thursday. Those are real ballots real owners cast, and
 * the standing model would otherwise start from an empty league — every owner
 * silently losing a vote they had already filed.
 *
 * Run ONCE per league, then delete this script. It is deliberately not wired
 * into any cron: a second run is harmless (it only ever writes records that
 * validate, and re-writing an identical record is a no-op) but there is no
 * reason for one, and a scheduled migration is a migration nobody reviews.
 *
 * Usage:
 *   node scripts/owners-poll-adopt-standing.mjs --league theleague --week 5 [--dry-run]
 *
 * See docs/plans/owners-poll.md.
 */

import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { currentSeasonYear } from './lib/schefter-recurrence-ledger.mjs';
import {
  ownersPollRedis,
  readAllBallots,
  writeStandingBallot,
} from './lib/owners-poll-redis.mjs';
import {
  ownersPollBallotsKey,
  ownersPollStandingKey,
} from '../src/utils/owners-poll-ballot.mjs';
import { normalizeFranchiseId } from '../src/utils/franchise-id.mjs';
import { readFile } from 'node:fs/promises';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const slug = arg('league');
const week = Number(arg('week'));
const dryRun = process.argv.includes('--dry-run');

const league = ALL_LEAGUES.find((l) => l.slug === slug || l.navSlug === slug);
if (!league?.ownersPoll?.enabled) {
  console.error(`Unknown or poll-disabled league: ${JSON.stringify(slug)}`);
  process.exit(1);
}
if (!Number.isInteger(week)) {
  console.error('--week is required (the week whose ballots should be adopted)');
  process.exit(1);
}

const redis = ownersPollRedis();
if (!redis) {
  console.error("No Redis credentials — cannot read the league's ballots.");
  process.exit(1);
}

const seasonYear = Number(arg('year', currentSeasonYear()));
const config = JSON.parse(
  await readFile(new URL(`../${league.configPath}`, import.meta.url), 'utf8'),
);
const eligibleFranchiseIds = Array.from(
  new Set((config.teams ?? []).map((t) => normalizeFranchiseId(t.franchiseId))),
).filter(Boolean);
if (eligibleFranchiseIds.length === 0) {
  console.error(`No franchises found in ${league.configPath}.`);
  process.exit(1);
}

const sourceKey = ownersPollBallotsKey(league.navSlug, seasonYear, week);
const { ballots, dropped, stored } = await readAllBallots(redis, league.navSlug, sourceKey, {
  slots: league.ownersPoll.slots,
  eligibleFranchiseIds,
});

console.log(`  ${league.name}: ${stored} stored, ${ballots.length} valid, ${dropped} dropped.`);
if (ballots.length === 0) {
  console.log('  Nothing to adopt.');
  process.exit(0);
}

const targetKey = ownersPollStandingKey(league.navSlug, seasonYear);
if (dryRun) {
  console.log(`  --- DRY RUN --- would HSET ${ballots.length} fields into ${targetKey}`);
  for (const b of ballots) console.log(`    ${b.franchiseId}: ${b.ranking.join(' ')}`);
  process.exit(0);
}

for (const ballot of ballots) {
  // Stamp the season on the way across. The old records predate the field, and
  // inventing one for a ballot we could not date would defeat the check it
  // exists for — but a ballot adopted INTO this season is, by construction,
  // this season's.
  const record = { ...ballot, seasonYear };
  await writeStandingBallot(redis, league.navSlug, seasonYear, record);
}
console.log(`  ✓ Adopted ${ballots.length} ballots into ${targetKey}`);
