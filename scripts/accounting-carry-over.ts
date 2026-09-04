/**
 * Carry each league's closing balances into the new MFL league year.
 *
 * MFL's yearly league upgrade creates the new league with rosters, keepers and
 * picks carried and its BOOKS EMPTY. This is the step that moves the money, run
 * unattended so the newest league year is always the one worth looking at.
 *
 * Run:
 *   pnpm exec tsx scripts/accounting-carry-over.ts [--dry-run] [--league=<slug>]
 *
 * ── THIS WRITES REAL MONEY, SO IT REFUSES MORE THAN IT WRITES ─────────────
 * MFL's accounting import has no delete and no upsert: a wrong record is
 * corrected by hand, with an offsetting record, by a human who first has to
 * notice. An unattended writer therefore has to treat "don't know" as "don't
 * write". Every precondition below SKIPS the league with a stated reason
 * rather than carrying what it can:
 *
 *   1. Both ledgers must read cleanly. A failed read and an empty ledger look
 *      identical downstream, and the failure mode of guessing is carrying
 *      nothing while reporting success.
 *   2. The source year must have records at all — the same 409 the API route
 *      raises. A year that genuinely ended empty has nothing to carry anyway.
 *   3. No conflicts. A carry line already present at a different amount means
 *      the source moved after a partial run, or someone edited by hand. The
 *      correct balance is then ambiguous and no machine should pick one.
 *   4. No warnings. A warning is a balance whose franchise no longer exists —
 *      real money with nowhere to go, needing a human to reassign it. Carrying
 *      "the rest" would quietly drop it.
 *   5. Source net must equal carried net. If those disagree the plan is losing
 *      money somewhere this script did not anticipate.
 *   6. The source year must be SETTLED — see below.
 *
 * ── WHY IT WAITS FOR QUIET ────────────────────────────────────────────────
 * The carry moves a CLOSING balance, so it has to run after the old year is
 * finished: payouts recorded, winnings sent, corrections made. Anything written
 * to the old year afterwards has to be carried by hand, because a second run
 * will NOT do it — the description already matches, so the line comes back
 * `already-migrated` at the old amount and the difference is simply lost.
 *
 * "The new league year exists" is not that signal; it fires on rollover day,
 * months before a season settles. There is no MFL flag for "these books are
 * closed", so this uses quiescence: the old year's most recent transaction must
 * be at least SETTLED_AFTER_DAYS old. Imperfect, and deliberately biased toward
 * waiting — being a fortnight late costs nothing, carrying early costs a
 * hand-reconciliation nobody will think to do.
 */

import {
  fetchAccountingLedger,
  writeAccountingRecords,
  formatAmount,
} from '../src/utils/mfl-accounting';
import { loadFranchises } from '../src/utils/accounting-season-data';
import { leagueYearFor } from '../src/utils/accounting-request';
import { ALL_LEAGUES, type LeagueDefinition } from '../src/config/leagues';
// Shared .mjs helper used by the other MFL write scripts. No ts-expect-error:
// its types resolve under the project config, so the directive would be unused.
import { loginToMFL } from './lib/mfl-api.mjs';
// .mjs planner, shared with the API route (see its header). Its JSDoc types
// resolve, so no ts-expect-error is needed here.
import { planYearMigration, assessCarryReadiness } from '../src/utils/accounting-migration.mjs';

/**
 * How quiet the old year must be before its balance counts as closing.
 * A const in code, not a GitHub variable — see CLAUDE.md on feature flags.
 */
const SETTLED_AFTER_DAYS = 14;


interface Outcome {
  league: string;
  status: 'carried' | 'nothing-to-do' | 'skipped' | 'failed';
  detail: string;
  written?: number;
  failed?: number;
}

const parseArgs = () => {
  const args = { dryRun: false, league: '' };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--league=')) args.league = arg.slice('--league='.length);
  }
  return args;
};

async function carryLeague(
  league: LeagueDefinition,
  opts: { dryRun: boolean; userCookie: string; commishCookie?: string }
): Promise<Outcome> {
  const to = leagueYearFor(league);
  const from = to - 1;
  const label = `${league.name} ${from} → ${to}`;

  const creds = { mflUserCookie: opts.userCookie, mflCommishCookie: opts.commishCookie };

  // Sequential rather than concurrent: two authenticated reads against one
  // league gain nothing from parallelism, and a rate-limited second read would
  // land as "could not read the target year" — a skip for the wrong reason.
  const source = await fetchAccountingLedger({ leagueId: league.id, year: from, ...creds });
  // (1) Both reads must succeed.
  if (!source.ok) {
    return { league: label, status: 'failed', detail: `could not read ${from}: ${source.error}` };
  }

  const target = await fetchAccountingLedger({ leagueId: league.id, year: to, ...creds });
  if (!target.ok) {
    return { league: label, status: 'failed', detail: `could not read ${to}: ${target.error}` };
  }

  // (2) An empty source is indistinguishable from a bad read.
  if (source.ledger.records.length === 0) {
    return { league: label, status: 'skipped', detail: `${from} has no accounting records at all` };
  }

  const plan = planYearMigration({
    fromYear: from,
    toYear: to,
    sourceLedger: source.ledger,
    targetRecords: target.ledger.records,
    franchises: loadFranchises(league, to),
  });

  // (2)-(6): every remaining precondition, in one tested place. See
  // assessCarryReadiness — it refuses the whole league rather than carrying
  // the part it is sure about.
  const readiness = assessCarryReadiness({
    sourceLedger: source.ledger,
    plan,
    nowMs: Date.now(),
    settleAfterDays: SETTLED_AFTER_DAYS,
  });
  if (!readiness.ready) {
    return {
      league: label,
      status: readiness.nothingToDo ? 'nothing-to-do' : 'skipped',
      detail: readiness.reason ?? 'not ready',
    };
  }

  const carryable = plan.lines.filter((l: any) => l.status === 'payable');

  const summary = `${carryable.length} franchise(s), ${formatAmount(plan.totals.carryable)}`;
  if (opts.dryRun) {
    for (const line of carryable) {
      console.log(`  would carry ${line.franchiseId} ${formatAmount(line.amount)} — ${line.description}`);
    }
    return { league: label, status: 'carried', detail: `DRY RUN — would carry ${summary}`, written: 0 };
  }

  const results = await writeAccountingRecords(
    carryable.map((line: any) => ({
      franchiseId: line.franchiseId,
      amount: line.amount,
      description: line.description,
      ref: line.franchiseId,
    })),
    {
      league,
      year: to,
      mflUserCookie: opts.userCookie,
      mflCommishCookie: opts.commishCookie,
    }
  );

  const written = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  for (const f of failed) console.error(`  FAILED ${f.row.franchiseId}: ${f.error}`);

  return {
    league: label,
    // A partial carry is safe to re-run — the rows that landed come back
    // already-migrated — but it must still surface as a failure so the run
    // is not reported green.
    status: failed.length ? 'failed' : 'carried',
    detail: failed.length ? `carried ${written}/${carryable.length}; ${failed.length} failed` : `carried ${summary}`,
    written,
    failed: failed.length,
  };
}

async function main() {
  const args = parseArgs();
  // Cookie env vars first, username/password second — the same preference
  // order apply-pending-contracts.mjs uses.
  //
  // The fallback is not a nicety. MFL session cookies EXPIRE, and a stale pair
  // fails in the least visible way available: the accounting EXPORT is not
  // auth-gated, so every read still succeeds and only the writes are refused.
  // A dry run against expired credentials therefore looks perfect. That is
  // exactly how a live run came back "carried 0/13; 13 failed" after a clean
  // dry run (2026-09-01). Logging in fresh each run removes the failure mode
  // rather than documenting it.
  let userCookie = process.env.MFL_USER_ID || '';
  let commishCookie = process.env.MFL_IS_COMMISH || '';

  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;

  // A LOGIN WINS OVER A STORED COOKIE, ALWAYS. The first cut of this only
  // logged in when a cookie was MISSING, which is the one failure mode that
  // never happens: a stored cookie is a non-empty string forever, and it is
  // its EXPIRY that breaks the run. That condition could not have fired on
  // the run it was written to fix. If credentials are configured, use them;
  // the stored cookies are the fallback, not the other way round.
  if (username && password) {
    try {
      const fresh = await loginToMFL(username, password);
      if (fresh.mflUserId) userCookie = fresh.mflUserId;
      if (fresh.mflIsCommish) commishCookie = fresh.mflIsCommish;
      console.log(`Logged in to MFL as ${username} (commish cookie: ${fresh.mflIsCommish ? 'yes' : 'no'})`);
    } catch (error) {
      // Fall through to the stored cookies — they may still be good, and the
      // preflight below refuses the run if they are not present at all.
      console.error(`MFL login failed, falling back to stored cookies: ${(error as Error).message}`);
    }
  } else {
    // Say so in the log. Run #4 (2026-09-03) failed every write against
    // expired cookies while the log gave no hint that the login path had
    // simply never been configured; one line here answers that next time.
    console.log(
      'No MFL_USERNAME/MFL_PASSWORD configured — using the stored '
        + 'MFL_USER_ID/MFL_IS_COMMISH cookies, which expire.'
    );
  }

  if (!userCookie) {
    console.error(
      'No MFL credentials. Set MFL_USER_ID (+ MFL_IS_COMMISH), or MFL_USERNAME + MFL_PASSWORD to log in.'
    );
    process.exit(1);
  }
  // Reads work without it, so an unset commish cookie would sail through the
  // whole plan and only fail at the first write. Fail before touching MFL.
  if (!commishCookie && !args.dryRun) {
    console.error(
      'No MFL_IS_COMMISH cookie — MFL will reject every accounting write. Refusing to start. '
        + 'Set the secret, or set MFL_USERNAME + MFL_PASSWORD so a fresh one can be fetched at run time.'
    );
    process.exit(1);
  }

  const leagues = ALL_LEAGUES.filter(
    (l) => l.features.accounting && (!args.league || l.slug === args.league)
  );
  if (!leagues.length) {
    console.error(args.league ? `No accounting-enabled league "${args.league}".` : 'No accounting-enabled leagues.');
    process.exit(1);
  }

  console.log(`Accounting carry-over${args.dryRun ? ' (DRY RUN)' : ''} — ${leagues.map((l) => l.slug).join(', ')}`);

  const outcomes: Outcome[] = [];
  for (const league of leagues) {
    try {
      outcomes.push(await carryLeague(league, { dryRun: args.dryRun, userCookie, commishCookie: commishCookie || undefined }));
    } catch (error) {
      outcomes.push({ league: league.name, status: 'failed', detail: (error as Error).message });
    }
  }

  console.log('');
  for (const o of outcomes) console.log(`${o.status.toUpperCase().padEnd(14)} ${o.league} — ${o.detail}`);

  // GitHub renders this on the run page, which is where a yearly job is
  // actually read — nobody opens the log for a job that no-ops 51 weeks a year.
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const rows = outcomes
      .map((o) => `| ${o.status} | ${o.league} | ${o.detail} |`)
      .join('\n');
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      summaryFile,
      `## Accounting carry-over${args.dryRun ? ' (dry run)' : ''}\n\n| Status | League | Detail |\n|---|---|---|\n${rows}\n`
    );
  }

  if (outcomes.some((o) => o.status === 'failed')) process.exit(1);
}

main().catch((error) => {
  console.error('[accounting-carry-over]', error);
  process.exit(1);
});
