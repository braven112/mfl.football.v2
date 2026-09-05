#!/usr/bin/env node
/**
 * The Owners' Poll — open, inspect, or close a ballot window by hand.
 *
 * The normal path is automatic: the Tuesday Pecking Order pass opens the
 * window and the Wednesday close pass tallies it. This CLI is the manual
 * equivalent, for three real jobs:
 *
 *   1. Seeding a demo window on a preview deployment, so the ballot can be
 *      driven before the cron has ever run.
 *   2. Re-opening or extending a window when a run failed or the league asks.
 *   3. Answering "is a ballot open, and how many are in?" without a dashboard.
 *
 * Usage:
 *   node scripts/owners-poll-window.mjs status --league theleague
 *   node scripts/owners-poll-window.mjs open   --league theleague --week 5
 *   node scripts/owners-poll-window.mjs open   --league theleague --week 5 --hours 36
 *   node scripts/owners-poll-window.mjs close  --league theleague
 *
 * `open` writes the pointer the API reads. `close` only REMOVES the pointer —
 * it does not tally. Tallying is generate-pecking-order.mjs --close-poll, and
 * keeping them separate means an accidental `close` here can never publish a
 * consensus or destroy ballots (the ballots hash is untouched, so re-opening
 * the same week picks them all back up).
 *
 * Needs Upstash credentials in the environment (see CLAUDE.md — `vercel env
 * pull`). Exits non-zero with a clear message when they're absent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  resolveOwnersPollWindow,
  windowHours,
  SHORT_WINDOW_HOURS,
} from '../src/utils/owners-poll-window.mjs';
import { normalizeFranchiseId } from '../src/utils/franchise-id.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import {
  ownersPollRedis,
  writeWindow,
  readWindow,
  clearWindow,
  countBallots,
} from './lib/owners-poll-redis.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

function usage(message) {
  if (message) console.error(`\n  ${message}\n`);
  console.error('  Usage:');
  console.error('    node scripts/owners-poll-window.mjs status --league <slug>');
  console.error('    node scripts/owners-poll-window.mjs open   --league <slug> --week <n> [--year <y>] [--hours <h>]');
  console.error('    node scripts/owners-poll-window.mjs close  --league <slug>');
  console.error('');
  const enabled = Object.values(LEAGUES)
    .filter((l) => l.ownersPoll?.enabled)
    .map((l) => l.slug);
  console.error(`  Leagues running the poll: ${enabled.join(', ') || '(none)'}`);
  process.exit(1);
}

/** The league's franchises, from its committed config. */
async function loadEligibleFranchiseIds(league) {
  const raw = await fs.readFile(path.join(projectRoot, league.configPath), 'utf8');
  const config = JSON.parse(raw);
  const ids = (config.teams ?? [])
    .map((t) => normalizeFranchiseId(t?.franchiseId))
    .filter(Boolean);
  return Array.from(new Set(ids));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.command || opts.command.startsWith('--')) usage('No command given.');

  const league = LEAGUES[opts.league];
  if (!league) usage(`Unknown league ${JSON.stringify(opts.league ?? '')}.`);
  const poll = league.ownersPoll;
  if (!poll?.enabled) usage(`${league.name} does not run the Owners' Poll.`);

  const redis = ownersPollRedis();
  if (!redis) {
    console.error(
      '\n  No Upstash credentials in the environment.\n' +
        '  Run `pnpm dlx vercel env pull` in the repo root, or export\n' +
        '  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.\n',
    );
    process.exit(2);
  }

  if (opts.command === 'status') return status(redis, league);
  if (opts.command === 'open') return open(redis, league, opts);
  if (opts.command === 'close') return close(redis, league);
  usage(`Unknown command ${JSON.stringify(opts.command)}.`);
}

async function status(redis, league) {
  const window = await readWindow(redis, league.navSlug);
  if (!window) {
    console.log(`\n  ${league.name}: no ballot is open.\n`);
    return;
  }
  const ballotsIn = await countBallots(redis, league.navSlug, window.year, window.week);
  const closesIn = (Date.parse(window.closesAt) - Date.now()) / 3600000;
  console.log(`\n  ${league.name} — Week ${window.week} (${window.year})`);
  console.log(`    opens   ${window.opensAt}`);
  console.log(`    closes  ${window.closesAt}  (${closesIn.toFixed(1)}h from now)`);
  console.log(`    slots   ${window.slots}`);
  console.log(`    ballots ${ballotsIn} of ${window.eligibleFranchiseIds.length}`);
  console.log('');
}

async function open(redis, league, opts) {
  const poll = league.ownersPoll;
  const week = Number(opts.week);
  if (!Number.isInteger(week) || week < 1) usage('--week must be a week number.');
  // See the note in src/pages/api/owners-poll/window.ts — the season clock,
  // not the calendar year, or a January open is stored against a season that
  // has not happened and the close pass refuses to tally it.
  const year = opts.year ? Number(opts.year) : getCurrentYears().currentSeasonYear;

  const existing = await readWindow(redis, league.navSlug);
  if (existing && !opts.force) {
    console.error(
      `\n  A ballot is already open for Week ${existing.week} (${existing.year}), closing ${existing.closesAt}.\n` +
        '  Pass --force to replace it. The existing week\'s ballots are not deleted either way.\n',
    );
    process.exit(3);
  }

  const eligibleFranchiseIds = await loadEligibleFranchiseIds(league);
  if (eligibleFranchiseIds.length <= poll.slots) {
    console.error(
      `\n  ${league.name} has ${eligibleFranchiseIds.length} franchises but a ballot depth of ` +
        `${poll.slots}. A top-N ballot needs a field bigger than N.\n`,
    );
    process.exit(4);
  }

  const now = new Date();
  const window = opts.hours
    ? {
        opensAt: now.toISOString(),
        closesAt: new Date(now.getTime() + Number(opts.hours) * 3600000).toISOString(),
      }
    : resolveOwnersPollWindow({
        publishedAt: now,
        closeHourPT: poll.closeHourPT,
        closeWeekday: poll.closeWeekday,
      });

  const record = {
    year,
    week,
    ...window,
    slots: poll.slots,
    eligibleFranchiseIds,
  };

  await writeWindow(redis, league.navSlug, record);

  const hours = windowHours(record);
  console.log(`\n  ✓ ${league.name} — ballot OPEN for Week ${week} (${year})`);
  console.log(`    closes ${record.closesAt}  (${hours.toFixed(1)}h)`);
  console.log(`    ${record.slots} slots · quorum ${poll.quorum} of ${eligibleFranchiseIds.length}`);
  if (hours < SHORT_WINDOW_HOURS) {
    console.warn(
      `    [warn] That is under ${SHORT_WINDOW_HOURS}h. Owners may not see it in time.`,
    );
  }
  console.log('');
}

async function close(redis, league) {
  const window = await readWindow(redis, league.navSlug);
  if (!window) {
    console.log(`\n  ${league.name}: no ballot was open. Nothing to do.\n`);
    return;
  }
  await clearWindow(redis, league.navSlug);
  console.log(
    `\n  ✓ ${league.name} — ballot for Week ${window.week} is no longer accepting votes.\n` +
      `    The ballots themselves are untouched. Tally them with:\n` +
      `      node scripts/generate-pecking-order.mjs --close-poll --league ${league.slug}\n`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
