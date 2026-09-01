#!/usr/bin/env tsx
/**
 * Set the AFL's waiver order on MFL from the previous season's base draft
 * order, per the constitution.
 *
 * WHY A FORM POST AND NOT THE API: `import?TYPE=franchises` does not carry
 * `waiverSortOrder` — it answers `<status>OK</status>` and changes nothing
 * (2026-08-31, proven against throwaway league 36189; see the mfl-api insights
 * entry). No import type sets waiver order. So this replays the POST that MFL's
 * own Custom Waiver Order page makes, the way src/pages/api/cut-player.ts
 * replays `add_drop` for the same reason. The field contract was captured from
 * a real successful save and is pinned byte-for-byte by
 * tests/afl-waiver-order.test.ts.
 *
 * WHY IT MUST GET BEFORE IT POSTS: the form carries an `input_expires` nonce,
 * valid for a few tens of minutes. MFL drops a POST with an expired one
 * SILENTLY — HTTP 200, no error, nothing changes. That is not hypothetical: on
 * 2026-08-31 a stale browser tab's save was dropped exactly this way, which is
 * the only reason a default-ordered payload did not overwrite the real order.
 * The nonce is harvested immediately before each POST and never reused.
 *
 * WHAT IT SETS: the INITIAL order. The AFL's waiver system is rolling, so MFL
 * mutates this all season as claims are awarded. Run it ONCE per league year,
 * after the previous season's NIT wraps and before Week 1 waivers process.
 * `--force` is required once any waiver transaction exists, because rewriting
 * mid-season refunds priority teams have already spent.
 *
 * SAFETY:
 *   --dry-run is the DEFAULT; it prints the diff and the exact body it would
 *     send, and exits without contacting the write path.
 *   Success is judged by RE-READING the live order, never by MFL's response —
 *     a silent no-op is the failure mode this endpoint actually has.
 *   The pre-write order is printed as a replayable form body, so a bad write
 *     can be undone from the log alone (a CI runner's disk does not survive).
 *
 * Env (live only): MFL_USER_ID, MFL_IS_COMMISH — commissioner of THIS league.
 *
 * Usage:
 *   pnpm exec tsx scripts/set-afl-waiver-order.ts            # dry run
 *   pnpm exec tsx scripts/set-afl-waiver-order.ts --live
 */

import { mflFetch } from '../src/utils/mfl-fetch';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getAflLeagueYear } from '../src/utils/league-year';
import { computeAflWaiverOrder } from '../src/utils/afl-waiver-order-source';
import {
  buildWaiverOrderFormBody,
  compareAflWaiverOrder,
  parseInputExpires,
  waiverOrderPageUrl,
  AFL_CONFERENCE_LABELS,
  type WaiverOrderEntry,
} from '../src/utils/afl-waiver-order';

const argv = process.argv.slice(2);
const hasFlag = (f: string) => argv.includes(f);
const flagValue = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LIVE = hasFlag('--live');
const FORCE = hasFlag('--force');
const root = process.cwd();

const league = getLeagueBySlug('afl-fantasy');
if (!league) throw new Error('League registry is missing the "afl-fantasy" entry');

const targetYear = Number(flagValue('--year') ?? getAflLeagueYear());
const standingsYear = Number(flagValue('--standings-year') ?? targetYear - 1);
if (!Number.isInteger(targetYear) || !Number.isInteger(standingsYear)) {
  throw new Error('--year and --standings-year must be integers');
}

console.log(`\nAFL waiver order — league ${league.id}, setting ${targetYear} from the ${standingsYear} season`);
console.log(`Mode: ${LIVE ? 'LIVE WRITE' : 'DRY RUN (pass --live to write)'}\n`);

// ── 1. What the order should be ──────────────────────────────────────────────
const { teamNames, champions, order } = computeAflWaiverOrder(root, league, standingsYear);
const name = (id: string) => teamNames.get(id) ?? `(unknown ${id})`;
console.log(
  `${standingsYear} conference champions: ` +
    [...champions.entries()].map(([c, f]) => `${c}=${f} ${name(f)}`).join(', ')
);

// ── 2. What it currently is ──────────────────────────────────────────────────
const exportUrl = () =>
  `https://api.myfantasyleague.com/${targetYear}/export?TYPE=league&L=${league.id}&JSON=1&_=${Date.now()}`;
const asList = (raw: unknown): any[] => (Array.isArray(raw) ? raw : raw ? [raw] : []);

async function readLive(): Promise<{ slots: Map<string, number>; franchises: any[] }> {
  const res = await fetch(exportUrl());
  if (!res.ok) throw new Error(`Could not read the live league: HTTP ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(`MFL: ${body.error.$t ?? JSON.stringify(body.error)}`);
  const franchises = asList(body?.league?.franchises?.franchise);
  return { slots: new Map(franchises.map((f) => [String(f.id), Number(f.waiverSortOrder)])), franchises };
}

const { slots: before, franchises: liveFranchises } = await readLive();
if (liveFranchises.length !== order.length) {
  throw new Error(
    `MFL reports ${liveFranchises.length} franchises for ${targetYear} but the computed order has ` +
      `${order.length}. Refusing to write a partial order.`
  );
}

// ── 3. Report ────────────────────────────────────────────────────────────────
let changing = 0;
for (const conference of [...new Set(order.map((e) => e.conference))].sort()) {
  console.log(`\n${AFL_CONFERENCE_LABELS[conference] ?? conference} League`);
  console.log('  rank  was   franchise');
  for (const e of order.filter((x) => x.conference === conference)) {
    const was = before.get(e.franchiseId);
    const moved = was !== e.position;
    if (moved) changing++;
    console.log(
      `  ${String(e.conferenceBasePosition).padStart(4)}  ${String(was ?? '?').padStart(4)}  ` +
        `${e.franchiseId} ${name(e.franchiseId)}${moved ? '' : '   (unchanged)'}`
    );
  }
}
console.log(`\n${changing} of ${order.length} franchises change slot.`);

/** The current order, as a body that would restore it. */
function restoreBody(expires: number): string {
  const current: WaiverOrderEntry[] = order
    .map((e) => ({ ...e, position: before.get(e.franchiseId) ?? e.position }))
    .sort((a, b) => a.position - b.position);
  // Re-rank within conference so the restore body is well-formed.
  const byConf = new Map<string, WaiverOrderEntry[]>();
  for (const e of current) {
    if (!byConf.has(e.conference)) byConf.set(e.conference, []);
    byConf.get(e.conference)!.push(e);
  }
  const renumbered: WaiverOrderEntry[] = [];
  for (const [, list] of [...byConf.entries()].sort()) {
    list.forEach((e, i) => renumbered.push({ ...e, conferenceBasePosition: i + 1 }));
  }
  return buildWaiverOrderFormBody(renumbered, { leagueId: league.id, inputExpires: expires });
}

const pageUrl = waiverOrderPageUrl(league.mflHost, targetYear, league.id);

if (!LIVE) {
  console.log(`\nDRY RUN — nothing written.`);
  console.log(`Would POST to: ${pageUrl}`);
  console.log(`Body (input_expires harvested live; shown as 0 here):\n`);
  console.log(buildWaiverOrderFormBody(order, { leagueId: league.id, inputExpires: 0 }));
  process.exit(0);
}

// ── 4. Guards ────────────────────────────────────────────────────────────────
const userId = process.env.MFL_USER_ID || '';
const commish = process.env.MFL_IS_COMMISH || '';
if (!userId || !commish) {
  throw new Error(
    'A live write needs BOTH MFL_USER_ID and MFL_IS_COMMISH, belonging to a commissioner of ' +
      `league ${league.id} specifically.`
  );
}

if (!FORCE) {
  const txUrl = `https://api.myfantasyleague.com/${targetYear}/export?TYPE=transactions&L=${league.id}&TRANS_TYPE=WAIVER&JSON=1&_=${Date.now()}`;
  const tx = (await (await fetch(txUrl)).json())?.transactions?.transaction;
  const count = Array.isArray(tx) ? tx.length : tx ? 1 : 0;
  if (count > 0) {
    throw new Error(
      `${count} waiver transaction(s) already processed for ${targetYear}. This sets the INITIAL ` +
        `order and the AFL's system is rolling, so writing now would refund priority teams have ` +
        `already spent. Pass --force only if you mean to reset the season's order.`
    );
  }
}

// ── 5. Harvest the nonce, then write ─────────────────────────────────────────
console.log(`\nGET ${pageUrl}`);
const pageRes = await mflFetch({ url: pageUrl, method: 'GET', mflUserCookie: userId, mflCommishCookie: commish });
const pageHtml = await pageRes.text();
if (/\bGuest\b[\s\S]{0,80}\bLogin\b/i.test(pageHtml.slice(0, 40_000))) {
  throw new Error(`MFL rendered the page as GUEST — the cookies are not a commissioner of league ${league.id}.`);
}
const expires = parseInputExpires(pageHtml);
if (!expires) {
  throw new Error(
    'Could not find the input_expires nonce on the page. Without it MFL drops the POST silently. ' +
      'The form may have changed — re-run scripts/inspect-mfl-form.ts and compare.'
  );
}
const secondsLeft = expires - Math.floor(Date.now() / 1000);
console.log(`Harvested input_expires=${expires} (${secondsLeft}s remaining)`);
if (secondsLeft <= 0) {
  throw new Error(`The nonce is already expired (${secondsLeft}s). MFL would drop the POST silently.`);
}

console.log('\nPrior order (restore body — replay this to undo):');
console.log(restoreBody(expires));

const body = buildWaiverOrderFormBody(order, { leagueId: league.id, inputExpires: expires });
console.log(`\nPOST ${pageUrl}`);
const res = await mflFetch({
  url: pageUrl,
  method: 'POST',
  mflUserCookie: userId,
  mflCommishCookie: commish,
  body,
});
const responseText = (await res.text()).trim();
console.log(`MFL responded HTTP ${res.status}, ${responseText.length} bytes.`);

// ── 6. Verify by RE-READING — never by the response ──────────────────────────
// This endpoint's real failure mode is a silent no-op, so the response body
// proves nothing either way.
const { slots: after, franchises: afterFranchises } = await readLive();

const blanked = afterFranchises.filter((f) => !f?.name).map((f) => String(f?.id));
if (blanked.length > 0) {
  throw new Error(
    `${blanked.length} franchise(s) lost their name (${blanked.join(', ')}). Restore IMMEDIATELY ` +
      `using the prior-order body printed above.`
  );
}

const results = compareAflWaiverOrder(order, after);
const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  console.log(`\nVerified: all ${order.length} franchises are in the constitutional order.`);
  process.exit(0);
}

for (const r of failed) {
  const label = AFL_CONFERENCE_LABELS[r.conference] ?? r.conference;
  console.error(`\n${label} League did not land as sent:`);
  r.expected.forEach((id, i) => {
    if (id !== r.actual[i]) {
      console.error(`  rank ${i + 1}: expected ${id} ${name(id)}, MFL has ${r.actual[i]} ${name(r.actual[i])}`);
    }
  });
}
const unchanged = order.every((e) => after.get(e.franchiseId) === before.get(e.franchiseId));
throw new Error(
  unchanged
    ? 'Nothing changed at all — MFL accepted the POST and applied none of it. That is the expired-nonce ' +
      'signature, or the form contract has changed. Re-run scripts/inspect-mfl-form.ts and compare the ' +
      'field names against tests/afl-waiver-order.test.ts. Nothing needs restoring.'
    : 'PARTIAL write — some franchises moved. Restore using the prior-order body printed above.'
);
