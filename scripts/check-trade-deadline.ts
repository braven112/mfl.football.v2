#!/usr/bin/env tsx
/**
 * Drift detector: does MFL's trade deadline agree with the Constitution?
 *
 * WHY THIS EXISTS: MFL is the source of truth for the deadline — it is what
 * actually stops a trade, and the site counts down to MFL's own calendar
 * (`mflTradeCutoff`, src/utils/mfl-trade-deadline.mjs). But MFL's calendar is
 * carried forward every year, and TheLeague's drifted a week late in
 * 2024–2026 without anyone noticing (Nov 20 instead of the Constitution's
 * Friday-before-Week-11, Nov 13, in 2026). Brandon (2026-11-13): always take
 * the date from MFL, and FLAG it when MFL and the Constitution disagree.
 *
 * WHAT IT DOES: for every league with a trade deadline in the registry, reads
 * the live MFL calendar (owner-gated: MFL_USER_ID cookie, never an APIKEY —
 * see fetch-mfl-feeds.mjs), runs `checkTradeDeadline`, and pushes the
 * league's admins under `ops-league-setup` when it is flagged AND inside the
 * check window (60 days before the earlier date through the later one). The
 * same check renders as an admin banner on the homepage and admin hub.
 *
 * WHEN IT STAYS QUIET: no deadline rule, no calendar data, a match, or a
 * mismatch outside the window. A failed MFL read is logged and skipped —
 * never reported as drift.
 *
 * Env:
 *   MFL_USER_ID   required to read the calendar; unset → logs and exits 0
 *   CRON_SECRET   required to push; unset logs the summary and sends nothing
 *
 * Usage:
 *   pnpm exec tsx scripts/check-trade-deadline.ts
 *   pnpm exec tsx scripts/check-trade-deadline.ts --dry-run   # never pushes
 */

import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { getLeagueYearForSlug } from '../src/utils/league-year';
import { checkTradeDeadline, isTradeDeadlineCheckWindow } from '../src/utils/mfl-trade-deadline.mjs';
import { mflFetch } from './lib/mfl-api.mjs';
import { sendOpsAlert } from './lib/ops-alert.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const mflUserId = process.env.MFL_USER_ID;

if (!mflUserId) {
  console.log('MFL_USER_ID is not set — the calendar export is owner-gated, so there is nothing to read. Skipping.');
  process.exit(0);
}

const now = new Date();
let undelivered = 0;

for (const league of ALL_LEAGUES as any[]) {
  if (!league.tradeDeadline || league.bestBall) continue;
  const year = getLeagueYearForSlug(league.slug, now);
  const url = `https://${league.mflHost}/${year}/export?TYPE=calendar&L=${league.id}&JSON=1&_=${Date.now()}`;

  let body: any;
  try {
    const res = await mflFetch({ url, cookies: { MFL_USER_ID: mflUserId }, timeoutMs: 20_000 });
    body = await res.json();
  } catch (err) {
    console.log(`${league.slug} ${year}: could not read MFL's calendar (${err instanceof Error ? err.message : String(err)}). Skipping, not reporting drift.`);
    continue;
  }
  // MFL answers errors at HTTP 200 — an error body is "couldn't read", not "no deadline".
  if (body?.error) {
    console.log(`${league.slug} ${year}: MFL refused the calendar read (${body.error.$t ?? JSON.stringify(body.error)}). Skipping.`);
    continue;
  }

  const check = checkTradeDeadline(league.slug, year, body);
  console.log(`${league.slug} ${year}: ${check.status}${check.message ? ` — ${check.message}` : ''}`);
  if (!check.flag) continue;
  if (!isTradeDeadlineCheckWindow(check, now)) {
    console.log('  Outside the check window — not pushing yet.');
    continue;
  }

  const alert = await sendOpsAlert({
    league,
    category: 'ops-league-setup',
    title: `${league.name}: trade deadline mismatch`,
    body: `${check.message} The site follows MFL. Fix whichever one is wrong.`,
    url: `/${league.slug}`,
    tag: `ops-trade-deadline-${league.slug}-${year}`,
    dryRun: DRY_RUN,
  });
  console.log(`  Alert: ${JSON.stringify(alert)}`);
  if (alert?.skipped && !DRY_RUN) undelivered++;
}

// A detected-and-delivered mismatch exits 0 (the push IS the signal; a red X
// would add a second, misleading "job failed" push). A mismatch that could not
// be delivered fails the run so the failure watcher reports it.
if (undelivered > 0) {
  console.error(`\n${undelivered} mismatch alert(s) were NOT delivered — failing so the run is visible.`);
  process.exit(1);
}
process.exit(0);
