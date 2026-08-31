#!/usr/bin/env tsx
/**
 * Live probe: does `import?TYPE=franchises` actually accept `waiverSortOrder`?
 *
 * WHY THIS EXISTS: on 2026-08-31 the AFL waiver-order writer POSTed a full
 * 24-franchise payload to `import?TYPE=franchises&OVERLAY=1`, MFL answered
 * HTTP 200 with no error, and not one value changed. Commissioner access was
 * confirmed afterwards, which leaves two explanations — MFL parsed the payload
 * as zero franchises (a DATA-shape problem), or the import simply does not
 * accept `waiverSortOrder` (MFL exposes it on export, but the import is
 * documented as "names, graphics, contact information, and more", and waiver
 * order is a separate page in MFL's commissioner UI).
 *
 * Answering that by firing more writes at the live AFL days before Week 1 is
 * the wrong trade. This probe answers it against a THROWAWAY league instead,
 * and is net-zero: it swaps two franchises' waiver slots, checks whether the
 * swap took, and puts the original order back either way.
 *
 * WHAT IT PROVES
 *   - Shape "wrapped" (<franchises>…</franchises>) took  → payload was fine;
 *     the AFL failure is something else.
 *   - Shape "bare" (<franchise/> children only) took     → the AFL writer was
 *     sending the wrong shape. Fix is one argument.
 *   - Neither took                                        → the import does not
 *     accept waiverSortOrder. Stop using it; replay MFL's own commissioner
 *     waiver-order page instead, the way src/pages/api/cut-player.ts replays
 *     add_drop for exactly this reason.
 *
 * SAFETY
 *   --dry-run is the DEFAULT: it prints the swap it would make and exits.
 *   Every write carries OVERLAY=1 — without it MFL erases every field absent
 *     from the payload (names, logos, icons, divisions).
 *   The original order is captured first, printed to the log as a replayable
 *     payload, and restored at the end of every path including failure.
 *   It refuses to run against a league in the registry, so a fat-fingered
 *     --league can never point it at TheLeague or the AFL.
 *
 * Env: MFL_USER_ID, MFL_IS_COMMISH (commissioner of the probe league).
 *
 * Usage:
 *   pnpm exec tsx scripts/probe-mfl-waiver-order-write.ts            # dry run
 *   pnpm exec tsx scripts/probe-mfl-waiver-order-write.ts --live
 *   pnpm exec tsx scripts/probe-mfl-waiver-order-write.ts --live --league 36189
 */

import { mflFetch } from '../src/utils/mfl-fetch';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import {
  buildFranchisesWaiverXml,
  setAflWaiverOrderUrl,
  type FranchisesXmlShape,
  type WaiverOrderEntry,
} from '../src/utils/afl-waiver-order';

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const value = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LIVE = flag('--live');
/** "Copy of The League" — an existing throwaway already used for write tests. */
const PROBE_LEAGUE = value('--league') ?? '36189';
const YEAR = Number(value('--year') ?? new Date().getFullYear());

// A real league must never be the probe target, whatever gets typed.
const real = ALL_LEAGUES.find((l: any) => l.id === PROBE_LEAGUE);
if (real) {
  throw new Error(
    `${PROBE_LEAGUE} is ${real.name}, a REAL league in the registry. This probe writes and ` +
      `restores waiver order and must only ever target a throwaway league.`
  );
}

const exportUrl = (bust = true) =>
  `https://api.myfantasyleague.com/${YEAR}/export?TYPE=league&L=${PROBE_LEAGUE}&JSON=1` +
  (bust ? `&_=${Date.now()}` : '');

const asList = (raw: unknown): any[] => (Array.isArray(raw) ? raw : raw ? [raw] : []);

async function readLeague() {
  const res = await fetch(exportUrl());
  const body = await res.json();
  if (body?.error) throw new Error(`MFL: ${body.error.$t ?? JSON.stringify(body.error)}`);
  const lg = body?.league;
  return { league: lg, franchises: asList(lg?.franchises?.franchise) };
}

/** Turn `id → slot` into the WaiverOrderEntry[] the shared builder expects. */
const toEntries = (pairs: Array<[string, number]>): WaiverOrderEntry[] =>
  pairs
    .map(([franchiseId, position]) => ({ franchiseId, position, conference: '', conferenceBasePosition: 0 }))
    .sort((a, b) => a.position - b.position);

const { league, franchises } = await readLeague();
console.log(`\nProbe league ${PROBE_LEAGUE} (${league?.name}) — ${franchises.length} franchises, ${YEAR}`);
console.log(`Host: ${league?.baseURL}`);
if (franchises.length < 2) throw new Error('Need at least 2 franchises to swap');

const original: Array<[string, number]> = franchises
  .map((f) => [String(f.id), Number(f.waiverSortOrder)] as [string, number])
  .filter(([, n]) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a[1] - b[1]);
if (original.length !== franchises.length) {
  throw new Error('Some franchises have no waiverSortOrder — cannot probe cleanly');
}

const originalEntries = toEntries(original);
console.log('\nCurrent order (restore payload — replay this DATA to undo):');
console.log(buildFranchisesWaiverXml(originalEntries));

// Minimal detectable change: swap the top two slots. If the import honors the
// attribute at all, these two move; nothing else is touched.
const [[idA, slotA], [idB, slotB]] = original;
const swapped: Array<[string, number]> = original.map(([id, slot]) =>
  id === idA ? [id, slotB] : id === idB ? [id, slotA] : [id, slot]
);
const swappedEntries = toEntries(swapped);
console.log(`\nProbe swap: ${idA} (${slotA} → ${slotB})  <->  ${idB} (${slotB} → ${slotA})`);

if (!LIVE) {
  console.log('\nDRY RUN — nothing written. Payloads that would be tried:');
  for (const shape of ['wrapped', 'bare'] as FranchisesXmlShape[]) {
    console.log(`\n--- shape "${shape}" ---`);
    console.log(buildFranchisesWaiverXml(swappedEntries, shape));
  }
  const host = String(league?.baseURL ?? '').replace(/^https?:\/\//, '');
  console.log(`\nTarget: ${setAflWaiverOrderUrl(host, YEAR, PROBE_LEAGUE)}`);
  process.exit(0);
}

const userId = process.env.MFL_USER_ID || '';
const commish = process.env.MFL_IS_COMMISH || '';
if (!userId || !commish) {
  throw new Error('A live probe needs BOTH MFL_USER_ID and MFL_IS_COMMISH (commissioner of the probe league).');
}

const host = String(league?.baseURL ?? '').replace(/^https?:\/\//, '');
if (!host) throw new Error('League export carried no baseURL — cannot determine the write host');
const url = setAflWaiverOrderUrl(host, YEAR, PROBE_LEAGUE);

async function post(entries: WaiverOrderEntry[], shape: FranchisesXmlShape): Promise<string> {
  const payload = buildFranchisesWaiverXml(entries, shape);
  const res = await mflFetch({
    url,
    method: 'POST',
    mflUserCookie: userId,
    mflCommishCookie: commish,
    body: new URLSearchParams({ DATA: payload }).toString(),
  });
  const body = (await res.text()).trim();
  console.log(`  MFL responded HTTP ${res.status}, ${body.length} bytes:`);
  console.log(`  ${body.slice(0, 600) || '(empty body)'}`);
  if (/^\s*(<!doctype html|<html)/i.test(body)) {
    throw new Error('MFL returned an HTML page, not an import result — the cookies are probably not a commissioner here.');
  }
  return body;
}

async function currentOrder(): Promise<Map<string, string>> {
  const { franchises: f } = await readLeague();
  return new Map(f.map((x) => [String(x.id), String(x.waiverSortOrder ?? '?')]));
}

async function restore(reason: string) {
  console.log(`\nRestoring original order (${reason})…`);
  for (const shape of ['wrapped', 'bare'] as FranchisesXmlShape[]) {
    await post(originalEntries, shape);
    const now = await currentOrder();
    if (original.every(([id, slot]) => now.get(id) === String(slot))) {
      console.log('  Original order confirmed restored.');
      return;
    }
  }
  const now = await currentOrder();
  const drifted = original.filter(([id, slot]) => now.get(id) !== String(slot));
  if (drifted.length === 0) {
    console.log('  Original order intact (nothing had changed).');
    return;
  }
  console.error(`  RESTORE FAILED for ${drifted.length} franchise(s). Replay the payload printed above by hand.`);
}

let verdict = 'NEITHER shape applied';
try {
  for (const shape of ['wrapped', 'bare'] as FranchisesXmlShape[]) {
    console.log(`\n--- Attempt: DATA shape "${shape}" ---`);
    await post(swappedEntries, shape);

    const { franchises: after } = await readLeague();
    const blanked = after.filter((f) => !f?.name).map((f) => String(f?.id));
    if (blanked.length > 0) {
      throw new Error(`${blanked.length} franchise(s) lost their name (${blanked.join(', ')}) — OVERLAY did not take.`);
    }
    const now = new Map(after.map((f) => [String(f.id), String(f.waiverSortOrder ?? '?')]));
    const took = now.get(idA) === String(slotB) && now.get(idB) === String(slotA);
    console.log(`  ${idA}: ${now.get(idA)} (wanted ${slotB}) | ${idB}: ${now.get(idB)} (wanted ${slotA})`);
    if (took) {
      verdict = `shape "${shape}" APPLIED — the import DOES accept waiverSortOrder`;
      console.log(`  ✓ ${verdict}`);
      break;
    }
    console.log(`  ✗ shape "${shape}" changed nothing`);
  }
} finally {
  await restore('probe complete');
}

console.log(`\n=== VERDICT: ${verdict} ===`);
if (verdict.startsWith('NEITHER')) {
  console.log(
    'Both DATA shapes were accepted and neither moved a waiverSortOrder, with commissioner\n' +
      'cookies proven by the writes being accepted at all. import?TYPE=franchises does not\n' +
      'carry this field. Next step: capture and replay the form POST that MFL\'s own\n' +
      'commissioner waiver-order page makes — the pattern src/pages/api/cut-player.ts uses.'
  );
  process.exit(1);
}
