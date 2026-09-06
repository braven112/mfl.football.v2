/**
 * Seed a SYNTHETIC Owners' Poll into an archived Pecking Order issue.
 *
 * Why this exists: the poll shipped after the last real column ran, so every
 * committed issue predates it and `OwnersPollSection.astro` — which renders
 * nothing when the `ownersPoll` block is absent — leaves the column with no
 * mention of the feature at all. The ballot and voters pages link INTO the
 * column, so the one page owners land on had nothing to show them. This fills
 * that gap with a worked example until Week 1 of the season produces a real one.
 *
 * WHAT IT FABRICATES, said plainly: ballots attributed to real franchises that
 * nobody cast. They publish into the archive the voters page reads, so treat
 * them as a demo fixture with a real byline, not as league history. Every
 * seeded block carries `source: "synthetic"`, and this script REFUSES to
 * overwrite a block without it — a real tally is never clobbered by a demo.
 *
 * The tally itself is NOT faked. Ballots go through the same
 * `tallyOwnersPoll` / `consensusRankMap` / `contrarianIndex` / `homerIndex`
 * that `closePoll` uses, and the block is assembled key-for-key the same way,
 * so what renders is the real pipeline's output over invented input.
 *
 * How a plausible ballot is built (deterministic — same seed, same file):
 *
 *   1. The room chases POINTS harder than the machine does. The composite is
 *      50% all-play / 50% rolling-3wk PPG; a voter's base order blends the
 *      composite rank with the pure recent-scoring rank, which is what makes
 *      the Δ column show real disagreement rather than a row of zeros.
 *   2. Per-voter noise, so ballots differ and the tiebreakers get exercised.
 *   3. A homer bump on the voter's own team, varying by owner — that is the
 *      whole reason self-voting is allowed, and it is what the Homer Index
 *      on the voters page reads.
 *
 * Usage:
 *   node scripts/seed-example-owners-poll.mjs --league theleague --year 2025 --week 17
 *   node scripts/seed-example-owners-poll.mjs --league afl-fantasy --year 2025 --week 14
 *   … --turnout 13     override the ballots-cast count (default: ~80% of the field)
 *   … --dry-run        print the block, write nothing
 *   … --force          overwrite an existing synthetic block (a real one is never overwritten)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { resolveOwnersPollWindow } from '../src/utils/owners-poll-window.mjs';
import { normalizeFranchiseId } from '../src/utils/franchise-id.mjs';
import {
  tallyOwnersPoll,
  consensusRankMap,
  contrarianIndex,
  homerIndex,
  describeScoring,
} from './lib/owners-poll-math.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Marks a block this script wrote. Its absence means "real ballots — hands off". */
const SYNTHETIC = 'synthetic';

/** Share of the field that votes when --turnout isn't given. */
const DEFAULT_TURNOUT_RATE = 0.8;

/** How much a voter weights recent scoring over the composite. */
const FORM_CHASE = 0.45;

function parseArgs(argv) {
  const opts = { league: 'theleague', year: null, week: null, turnout: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--league': opts.league = argv[++i]; break;
      case '--year': opts.year = Number(argv[++i]); break;
      case '--week': opts.week = Number(argv[++i]); break;
      case '--turnout': opts.turnout = Number(argv[++i]); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--help': usage(); process.exit(0); break;
      default:
        if (argv[i].startsWith('--')) { usage(); throw new Error(`Unknown flag ${argv[i]}`); }
    }
  }
  return opts;
}

function usage() {
  console.log('Usage: node scripts/seed-example-owners-poll.mjs --league SLUG --year YYYY --week N [--turnout N] [--dry-run] [--force]');
}

/**
 * mulberry32, seeded from a string.
 *
 * A named PRNG rather than Math.random for the same reason the feed writers are
 * canonical: a re-run that shuffles invented ballots would churn the archive
 * and make every diff unreadable.
 */
function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly normal, from two uniforms. Keeps ballot noise off the extremes. */
function jitter(next, sd) {
  const u = Math.max(next(), 1e-9);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
}

/**
 * One owner's ballot: the field scored, sorted, and cut to `slots`.
 *
 * The three terms are the three things that actually move an owner's ranking —
 * the published numbers, their own read of the league, and their own team.
 */
function buildBallot({ voterId, teams, slots, seed }) {
  const next = rng(seed);
  // Some owners are homers and some are not; drawn once per owner so it is a
  // trait, not weekly noise. Negative is allowed — a few owners under-rate
  // their own team, and the Homer Index is more interesting with both signs.
  const homerBias = jitter(next, 1.8) + 1.2;
  const conviction = 1.4 + next() * 1.4; // how far this owner strays from the board

  const ranking = teams
    .map((team) => {
      let score = team.roomBase + jitter(next, conviction);
      if (team.franchiseId === voterId) score -= homerBias;
      return { franchiseId: team.franchiseId, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, slots)
    .map((t) => t.franchiseId);

  return { ranking, next };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const league = getLeagueBySlug(opts.league);
  if (!league) throw new Error(`Unknown league slug ${opts.league}`);

  const poll = league.ownersPoll;
  if (!poll?.enabled) throw new Error(`${league.name} does not run the Owners' Poll.`);
  if (!Number.isInteger(opts.year) || !Number.isInteger(opts.week)) {
    usage();
    throw new Error('--year and --week are required.');
  }

  const issuePath = path.join(projectRoot, league.dataPath, 'pecking-order', `${opts.year}-${opts.week}.json`);
  const issue = JSON.parse(await fs.readFile(issuePath, 'utf8'));

  if (issue.ownersPoll && issue.ownersPoll.source !== SYNTHETIC) {
    throw new Error(`${path.relative(projectRoot, issuePath)} already carries a REAL poll — refusing to overwrite it.`);
  }
  if (issue.ownersPoll && !opts.force) {
    throw new Error('A synthetic poll is already seeded here. Pass --force to regenerate it.');
  }

  const rankings = issue.rankings ?? [];
  if (rankings.length <= poll.slots) {
    throw new Error(`Issue has ${rankings.length} franchises but the ballot is ${poll.slots} slots.`);
  }

  const eligibleFranchiseIds = rankings.map((r) => normalizeFranchiseId(r.franchiseId));
  const compositeRankByFid = Object.fromEntries(rankings.map((r) => [normalizeFranchiseId(r.franchiseId), r.rank]));

  // The room's shared starting point: the published board, pulled toward pure
  // recent scoring. This is the source of the Δ — the machine splits all-play
  // and form 50/50, owners remember last Sunday.
  const byForm = [...rankings]
    .sort((a, b) => (b.metrics?.rolling3Ppg ?? 0) - (a.metrics?.rolling3Ppg ?? 0))
    .map((r) => normalizeFranchiseId(r.franchiseId));
  const formRank = new Map(byForm.map((fid, idx) => [fid, idx + 1]));

  const teams = rankings.map((r) => {
    const fid = normalizeFranchiseId(r.franchiseId);
    return {
      franchiseId: fid,
      roomBase: (1 - FORM_CHASE) * r.rank + FORM_CHASE * (formRank.get(fid) ?? r.rank),
    };
  });

  // Who showed up. Seeded on the week so the same non-voters don't recur if
  // this is ever run for more than one issue.
  const turnout = opts.turnout ?? Math.round(eligibleFranchiseIds.length * DEFAULT_TURNOUT_RATE);
  if (turnout < poll.quorum) {
    console.warn(`  [warn] ${turnout} ballots is under the ${poll.quorum}-ballot quorum — the example will render the no-quorum state.`);
  }
  const pickOrder = rng(`${league.navSlug}:${opts.year}:${opts.week}:voters`);
  const voters = [...eligibleFranchiseIds]
    .map((fid) => ({ fid, key: pickOrder() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, turnout)
    .map((v) => v.fid)
    // Stored in franchise order, the way readAllBallots returns them.
    .sort();

  const window = resolveOwnersPollWindow({
    publishedAt: issue.publishedAt,
    closeHourPT: poll.closeHourPT,
    closeWeekday: poll.closeWeekday,
  });
  const opensMs = Date.parse(window.opensAt);
  const closesMs = Date.parse(window.closesAt);

  const ballots = voters.map((voterId) => {
    const { ranking, next } = buildBallot({
      voterId,
      teams,
      slots: poll.slots,
      seed: `${league.navSlug}:${opts.year}:${opts.week}:${voterId}`,
    });
    // Most owners vote early; the tail trickles in before close.
    const submittedMs = Math.round(opensMs + (closesMs - opensMs) * next() ** 1.7);
    // Roughly one in five changes their mind before the deadline.
    const edited = next() < 0.2;
    const updatedMs = edited
      ? Math.min(closesMs, Math.round(submittedMs + (closesMs - submittedMs) * next()))
      : submittedMs;
    return {
      franchiseId: voterId,
      ranking,
      submittedAt: new Date(submittedMs).toISOString(),
      updatedAt: new Date(updatedMs).toISOString(),
    };
  });

  // From here down this mirrors closePoll — same functions, same key order.
  const tally = tallyOwnersPoll({
    ballots,
    eligibleFranchiseIds,
    slots: poll.slots,
    quorum: poll.quorum,
    compositeRankByFid,
  });
  const consensus = consensusRankMap(tally);

  const block = {
    status: 'closed',
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    slots: poll.slots,
    quorum: poll.quorum,
    eligibleVoters: eligibleFranchiseIds.length,
    ballotsIn: tally.ballotsIn,
    hasQuorum: tally.hasQuorum,
    methodology: describeScoring(poll.slots, poll.quorum, eligibleFranchiseIds.length),
    ranked: tally.ranked,
    unranked: tally.unranked,
    ballots: ballots.map((ballot) => ({
      franchiseId: ballot.franchiseId,
      ranking: ballot.ranking,
      submittedAt: ballot.submittedAt,
      updatedAt: ballot.updatedAt,
      contrarianIndex: round2(contrarianIndex(ballot.ranking, consensus)),
      homerIndex: homerIndex({
        franchiseId: ballot.franchiseId,
        ranking: ballot.ranking,
        consensusRankByFid: consensus,
        slots: poll.slots,
      }),
    })),
    nonVoterCount: eligibleFranchiseIds.length - ballots.length,
    source: SYNTHETIC,
  };

  issue.ownersPoll = block;

  if (opts.dryRun) {
    console.log('--- DRY RUN ---');
    console.log(JSON.stringify(block, null, 2));
    return;
  }

  await fs.writeFile(issuePath, JSON.stringify(issue, null, 2) + '\n', 'utf8');
  const top = block.ranked?.[0];
  console.log(
    `  ✓ Seeded ${path.relative(projectRoot, issuePath)} — ${block.ballotsIn}/${block.eligibleVoters} ballots, ` +
      `quorum ${block.hasQuorum ? 'met' : 'NOT met'}${top ? `, poll #1 ${top.franchiseId} (Δ${top.delta >= 0 ? '+' : ''}${top.delta})` : ''}.`,
  );
}

function round2(x) {
  if (x == null || !Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
