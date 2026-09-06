#!/usr/bin/env tsx
/**
 * Drift detector: is the AFL's live waiver order still the constitutional one?
 *
 * WHY THIS EXISTS: MFL does not carry `waiverSortOrder` across a league-year
 * rollover, and no API can set it back (2026-08-31 — see the mfl-api insights
 * entry), so every June the order silently reverts to MFL's reverse-franchise-id
 * default until a human re-enters it on `csetup?C=WAIVORD`. In 2026 nobody
 * noticed until ten days before Week 1. A wrong waiver order is invisible: MFL
 * shows *an* order, it just is not the league's. Forgetting is the real failure
 * mode here, not the typing.
 *
 * WHAT IT COMPARES: rank WITHIN each conference, not the flat 1..24 list. The
 * AFL is a duplicate-player league scoped by conference (`playerLimitUnit:
 * CONFERENCE`), so an American and a National team never contend for the same
 * claim and cross-conference position affects nothing. Comparing the flat list
 * would also make this fragile to MFL renumbering the blocks.
 *
 * WHEN IT STAYS QUIET — the part that keeps it from crying wolf:
 *   - Once ANY waiver transaction exists for the year, the order is SUPPOSED to
 *     have moved. The AFL is rolling ("Yahoo style") priority: a team that wins
 *     a claim drops to the back. After the first claim this check is
 *     meaningless, so it reports "rolling" and stops.
 *   - Before the previous season's NIT resolves there is no final base order to
 *     compare against, so it reports "not yet computable" and stops.
 * Neither is a failure. Only a genuine mismatch inside the pre-season window is.
 *
 * WHO HEARS ABOUT IT: the league's admins, by push, under the `ops-league-setup`
 * category — not the group chat. Re-entering the waiver order is a job exactly
 * one person can do (it is a hand edit on MFL's csetup page), so posting it to
 * everyone spent the chat's one daily automated post telling eleven owners
 * about a task none of them can action.
 *
 * Env:
 *   CRON_SECRET   required to push; unset logs the summary and sends nothing
 *
 * Usage:
 *   pnpm exec tsx scripts/check-afl-waiver-order.ts
 *   pnpm exec tsx scripts/check-afl-waiver-order.ts --dry-run   # never posts
 */

import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getAflLeagueYear } from '../src/utils/league-year';
import { computeAflWaiverOrder } from '../src/utils/afl-waiver-order-source';
import { compareAflWaiverOrder } from '../src/utils/afl-waiver-order';
import { sendOpsAlert } from './lib/ops-alert.mjs';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const flagValue = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const league = getLeagueBySlug('afl-fantasy');
if (!league) throw new Error('League registry is missing the "afl-fantasy" entry');

const targetYear = Number(flagValue('--year') ?? getAflLeagueYear());
const standingsYear = Number(flagValue('--standings-year') ?? targetYear - 1);
const root = process.cwd();

console.log(`AFL waiver-order drift check — league ${league.id}, ${targetYear} (from ${standingsYear})\n`);

// ── Expected ─────────────────────────────────────────────────────────────────
let source;
try {
  source = computeAflWaiverOrder(root, league, standingsYear);
} catch (err) {
  console.log(`Not yet computable: ${err instanceof Error ? err.message : String(err)}`);
  console.log('Nothing to check. This is not a failure.');
  process.exit(0);
}
const { teamNames, order: expected } = source;
const name = (id: string) => teamNames.get(id) ?? `(unknown ${id})`;

// ── Live ─────────────────────────────────────────────────────────────────────
const exportUrl = `https://api.myfantasyleague.com/${targetYear}/export?TYPE=league&L=${league.id}&JSON=1&_=${Date.now()}`;
const res = await fetch(exportUrl);
if (!res.ok) throw new Error(`Could not read the live league: HTTP ${res.status}`);
const body = await res.json();
if (body?.error) throw new Error(`MFL: ${body.error.$t ?? JSON.stringify(body.error)}`);
const rawFranchises = body?.league?.franchises?.franchise;
const liveFranchises: any[] = Array.isArray(rawFranchises) ? rawFranchises : rawFranchises ? [rawFranchises] : [];
if (liveFranchises.length !== expected.length) {
  throw new Error(`MFL reports ${liveFranchises.length} franchises but the base order has ${expected.length}`);
}
const liveSlot = new Map<string, number>(
  liveFranchises.map((f) => [String(f.id), Number(f.waiverSortOrder)])
);

// ── Is the order still the INITIAL one, or has it legitimately rolled? ───────
const txUrl = `https://api.myfantasyleague.com/${targetYear}/export?TYPE=transactions&L=${league.id}&TRANS_TYPE=WAIVER&JSON=1&_=${Date.now()}`;
let waiverCount = 0;
try {
  const txBody = await (await fetch(txUrl)).json();
  const tx = txBody?.transactions?.transaction;
  waiverCount = Array.isArray(tx) ? tx.length : tx ? 1 : 0;
} catch {
  // A transactions read failure must not be reported as drift — but it also
  // must not silently green-light a comparison whose premise is unverified.
  console.log('Could not read the transaction log; skipping rather than guessing.');
  process.exit(0);
}
if (waiverCount > 0) {
  console.log(`${waiverCount} waiver transaction(s) already processed for ${targetYear}.`);
  console.log('The AFL order is ROLLING, so it is supposed to have moved by now. Nothing to check.');
  process.exit(0);
}

// ── Compare rank WITHIN each conference ──────────────────────────────────────
const results = compareAflWaiverOrder(expected, liveSlot);
const problems: string[] = [];
// Counted SEPARATELY from the problem lines, because they are not the same
// number: `problems` carries a header per conference plus one line per bad
// rank, so its length reported "26 franchises out of order" for a 24-team
// league, while the missing-slot branch is one line naming several franchises
// and under-reported the other way. The alert states a franchise count, so it
// has to count franchises.
const driftedFranchises = new Set<string>();
for (const r of results) {
  const label = r.conference === '00' ? 'American' : 'National';
  if (r.ok) {
    console.log(`${label} League: OK (${r.expected.length} teams in constitutional order)`);
    continue;
  }
  if (r.missing.length) {
    problems.push(`${label} League: MFL has no waiver slot for ${r.missing.join(', ')}`);
    for (const id of r.missing) driftedFranchises.add(id);
    continue;
  }
  problems.push(`${label} League order does not match the constitution:`);
  r.expected.forEach((id, i) => {
    if (id !== r.actual[i]) {
      problems.push(`  rank ${i + 1}: expected ${id} ${name(id)}, MFL has ${r.actual[i]} ${name(r.actual[i])}`);
      driftedFranchises.add(id);
    }
  });
}

if (problems.length === 0) {
  console.log(`\nAll ${expected.length} franchises match the constitutional order.`);
  process.exit(0);
}

const summary =
  `AFL waiver order drift — ${targetYear}\n\n` +
  problems.join('\n') +
  `\n\nMFL does not carry waiver order across the June rollover and no API can set it. ` +
  `Fix by hand: ${league.mflHost}/${targetYear}/csetup?L=${league.id}&C=WAIVORD`;

console.error(`\n${summary}`);
// The push carries the headline; the full per-franchise diff stays in the
// Actions log above, which is where the fix gets made from anyway. A
// notification body long enough to hold 24 rows is unreadable on a lock screen
// and truncated by the OS regardless.
const count = driftedFranchises.size;
const alert = await sendOpsAlert({
  league,
  category: 'ops-league-setup',
  title: 'AFL waiver order has drifted',
  body:
    `${count} franchise${count === 1 ? '' : 's'} out of constitutional order `
    + `for ${targetYear}. MFL drops waiver priority at the rollover and no API can set it back — `
    + 'it needs a hand fix on csetup.',
  tag: `ops-waiver-order-${targetYear}`,
  dryRun: DRY_RUN,
});

// Exit 0 when the alert actually went out. This used to exit 1 unconditionally,
// which was right when the red X was the only durable signal — but the failure
// watch now turns any failed scheduled run into its own push, so a deliberate
// exit(1) here produced a SECOND, misleading alert ("AFL Waiver Order Check
// failed") next to the accurate one, every week until the order was fixed.
// A check that detected drift and reported it did its job.
//
// A failed SEND is the opposite case: then the red X is the only signal left,
// and the watcher reporting it is exactly what should happen.
if (alert?.skipped && !DRY_RUN) {
  console.error(`\nDrift alert was NOT delivered (${alert.skipped}) — failing so the run is visible.`);
  process.exit(1);
}
process.exit(0);
