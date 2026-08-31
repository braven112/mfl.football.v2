#!/usr/bin/env tsx
/**
 * Set the AFL's league-wide waiver order on MFL from the previous season's
 * base draft order, per the AFL constitution.
 *
 * WHY THIS EXISTS: MFL does NOT carry `waiverSortOrder` across a league-year
 * rollover. When the new AFL league is created each June it starts at the
 * default — reverse franchise id (0024 first, 0001 last) — which has nothing
 * to do with the constitution. That is the state the 2026 league was found in
 * on 2026-08-31, with Week 1 waivers about to run: the 2025 #1 seed was
 * sitting at waiver 10 and a 17th-place team at waiver 1. The AFL uses
 * `WAIVERS_FCFS` (rolling "Yahoo style" priority, NOT blind bidding), so
 * `waiverSortOrder` is not a tiebreaker here — it IS the waiver order.
 *
 * WHAT IT SETS: the INITIAL order. The AFL's waiver system is rolling, so MFL
 * mutates this value all season as claims are awarded. Run this ONCE per
 * league year, before the first claim of Week 1 — running it mid-season would
 * silently roll back every claim's priority cost. `--force` is required to
 * write once any waiver transaction exists for the year.
 *
 * THE ORDER: reverse previous-season standings per conference with each
 * conference champion forced last (i.e. the base draft order, which is the
 * round-2+ order — NOT round 1, which the NIT bonus reshuffles), then the two
 * conferences interleaved into one 24-slot list. See src/utils/afl-waiver-order.ts
 * for the merge rule and why it is an interpretation.
 *
 * SAFETY:
 *   --dry-run is the DEFAULT. It prints the full before/after diff and exits
 *     without touching MFL. Live writes need an explicit --live.
 *   The write always carries OVERLAY=1 (welded on in setAflWaiverOrderUrl) —
 *     without it MFL erases every franchise field not in the payload.
 *   The pre-write franchises snapshot is saved to disk so the previous order
 *     can be restored by hand if a write lands wrong.
 *   After a live write it re-reads the league and fails loudly if the order
 *     that landed is not the one it sent.
 *
 * Env (live writes only):
 *   MFL_USER_ID      commissioner's MFL_USER_ID cookie
 *   MFL_IS_COMMISH   commissioner's MFL_IS_COMMISH cookie
 *
 * Usage:
 *   pnpm exec tsx scripts/set-afl-waiver-order.ts              # dry run
 *   pnpm exec tsx scripts/set-afl-waiver-order.ts --live
 *   pnpm exec tsx scripts/set-afl-waiver-order.ts --year 2026 --standings-year 2025
 */

import fs from 'node:fs';
import path from 'node:path';
import { calculateAFLDraftOrder, parseConferenceChampions, parseNITResults, buildHeadToHeadFromRaw, isDraftOrderFinal } from '../src/utils/afl-draft-utils';
import { buildAflWaiverOrder, buildFranchisesWaiverXml, setAflWaiverOrderUrl, type ConferenceBaseOrder, type WaiverOrderEntry } from '../src/utils/afl-waiver-order';
import { mflFetch } from '../src/utils/mfl-fetch';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getAflLeagueYear } from '../src/utils/league-year';

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

const feeds = (year: number, file: string) =>
  path.join(root, league.dataPath, 'mfl-feeds', String(year), file);
const readFeed = (year: number, file: string) => JSON.parse(fs.readFileSync(feeds(year, file), 'utf-8'));

console.log(`\nAFL waiver order — league ${league.id}, setting ${targetYear} from the ${standingsYear} season`);
console.log(`Mode: ${LIVE ? 'LIVE WRITE' : 'DRY RUN (pass --live to write)'}\n`);

// ── 1. Base draft order, per conference ──────────────────────────────────────
const aflConfig = JSON.parse(fs.readFileSync(path.join(root, league.configPath), 'utf-8'));
const teamConfigMap = new Map<string, { id: string; name: string; conference?: string; division?: string }>(
  aflConfig.teams.map((t: any) => [
    t.franchiseId,
    { id: t.franchiseId, name: t.name, conference: t.conference, division: t.division },
  ])
);
const teamName = (id: string) => teamConfigMap.get(id)?.name ?? `(unknown ${id})`;

const standingsData = readFeed(standingsYear, 'standings.json');
const standings = Array.isArray(standingsData.leagueStandings.franchise)
  ? standingsData.leagueStandings.franchise
  : [standingsData.leagueStandings.franchise];

// The same-division standings tiebreaker needs real head-to-head; the plain
// standings feed's h2h fields only echo the overall record.
const headToHead = buildHeadToHeadFromRaw(readFeed(standingsYear, 'weekly-results-raw.json'));
const brackets = readFeed(standingsYear, 'playoff-brackets.json');
const conferenceChampions = parseConferenceChampions(brackets, teamConfigMap as any);
const nitResults = parseNITResults(brackets, teamConfigMap as any);

// The champion forcing is what makes this the BASE order rather than plain
// reverse standings, so an unresolved champion is a hard stop, not a warning.
if (!isDraftOrderFinal(conferenceChampions, nitResults)) {
  throw new Error(
    `The ${standingsYear} draft order is still a projection — conference champions ` +
      `and/or NIT finishers could not be resolved from playoff-brackets.json. ` +
      `The base order is not final, so neither is the waiver order.`
  );
}
console.log(`${standingsYear} conference champions: ` +
  [...conferenceChampions.entries()].map(([c, f]) => `${c}=${f} ${teamName(f)}`).join(', '));

const draftOrders = calculateAFLDraftOrder(
  standings,
  teamConfigMap as any,
  conferenceChampions,
  nitResults,
  headToHead
);

// Round 2 IS the base order: the NIT bonus is a round-1-only adjustment, so
// rounds 2-9 revert to reverse standings with the champion last.
const CONFERENCE_CODES: Record<string, string> = { 'American League': '00', 'National League': '01' };
const baseOrders: ConferenceBaseOrder[] = draftOrders.map((o) => {
  const code = CONFERENCE_CODES[o.conference];
  if (!code) throw new Error(`Unrecognized conference name "${o.conference}"`);
  return {
    conference: code,
    franchiseIds: o.picks
      .filter((p: any) => p.round === 2)
      .sort((a: any, b: any) => a.pickInRound - b.pickInRound)
      .map((p: any) => p.franchiseId),
  };
});

// ── 2. Which conference leads the alternation ────────────────────────────────
// The league's single worst team, so waiver #1 goes to a team with a claim to
// being the worst overall. Ranked by win% then points-for, with franchise id as
// a final tiebreak so the result can never flip between runs.
const gp = (t: any) => Number(t.h2hw) + Number(t.h2hl) + Number(t.h2ht || 0);
const winPct = (t: any) => (Number(t.h2hw) + 0.5 * Number(t.h2ht || 0)) / Math.max(1, gp(t));
const worst = [...standings].sort((a: any, b: any) =>
  winPct(a) - winPct(b) || Number(a.pf) - Number(b.pf) || a.id.localeCompare(b.id)
)[0];
const leadConference = teamConfigMap.get(worst.id)?.conference;
console.log(
  `Worst ${standingsYear} team: ${worst.id} ${teamName(worst.id)} ` +
  `(${worst.h2hw}-${worst.h2hl}, ${Number(worst.pf).toFixed(0)} PF) — conference ${leadConference} leads\n`
);

const order = buildAflWaiverOrder(baseOrders, worst.id);

// ── 3. Current live order, for the diff and the pre-write snapshot ───────────
/** MFL collapses a one-element list to a bare object; always read it as a list. */
function asFranchiseList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

const exportUrl = `https://api.myfantasyleague.com/${targetYear}/export?TYPE=league&L=${league.id}&JSON=1`;
const liveRes = await fetch(exportUrl);
if (!liveRes.ok) throw new Error(`Could not read the live league: HTTP ${liveRes.status}`);
const liveLeague = (await liveRes.json())?.league;
const liveFranchises = asFranchiseList(liveLeague?.franchises?.franchise);
if (liveFranchises.length !== order.length) {
  throw new Error(
    `MFL reports ${liveFranchises.length} franchises for ${targetYear} but the base order has ` +
      `${order.length}. Refusing to write a partial order.`
  );
}
const before = new Map<string, string>(liveFranchises.map((f) => [f.id, f.waiverSortOrder ?? '?']));

// A rolling waiver order is mutated by every awarded claim, so overwriting it
// mid-season would refund priority to teams that already spent it.
const transactionsPath = feeds(targetYear, 'transactions.json');
if (fs.existsSync(transactionsPath) && !FORCE) {
  const raw = JSON.parse(fs.readFileSync(transactionsPath, 'utf-8'));
  const list = raw?.transactions?.transaction ?? [];
  const waiverTx = (Array.isArray(list) ? list : [list]).filter((t: any) =>
    typeof t?.type === 'string' && t.type.toUpperCase().includes('WAIVER')
  );
  if (waiverTx.length > 0) {
    throw new Error(
      `${waiverTx.length} waiver transaction(s) already exist for ${targetYear}. This sets the ` +
        `INITIAL order and the AFL's system is rolling, so writing now would undo priority that ` +
        `has already been spent. Pass --force only if you mean to reset the season's order.`
    );
  }
}

// ── 4. Report ────────────────────────────────────────────────────────────────
const confLabel = (c: string) => (c === '00' ? 'AM' : 'NA');
let changed = 0;
console.log('  new  was   conf  base  franchise');
console.log('  ---  ----  ----  ----  ---------');
for (const e of order) {
  const wasValue = before.get(e.franchiseId) ?? '?';
  const moved = String(e.position) !== wasValue;
  if (moved) changed++;
  console.log(
    `  ${String(e.position).padStart(3)}  ${wasValue.padStart(4)}  ` +
    `${confLabel(e.conference).padStart(4)}  ${String(e.conferenceBasePosition).padStart(4)}  ` +
    `${e.franchiseId} ${teamName(e.franchiseId)}${moved ? '' : '   (unchanged)'}`
  );
}
console.log(`\n${changed} of ${order.length} franchises change position.`);

const xml = buildFranchisesWaiverXml(order);

if (!LIVE) {
  console.log('\nDRY RUN — nothing was written. Payload that would be sent:\n');
  console.log(xml);
  console.log(`\nTarget: ${setAflWaiverOrderUrl(league.mflHost, targetYear, league.id)}`);
  process.exit(0);
}

// ── 5. Live write ────────────────────────────────────────────────────────────
const userId = process.env.MFL_USER_ID || '';
const commish = process.env.MFL_IS_COMMISH || '';
if (!userId || !commish) {
  throw new Error(
    'A live write needs BOTH MFL_USER_ID and MFL_IS_COMMISH. The franchises import is ' +
      'commissioner-only and MFL rejects it with the user cookie alone.'
  );
}

const snapshotDir = path.join(root, league.dataPath, 'waiver-order-backups');
fs.mkdirSync(snapshotDir, { recursive: true });
const snapshotFile = path.join(snapshotDir, `${targetYear}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
// Persist only the three primitive fields a restore needs, each coerced to a
// string — never MFL's raw response object. Keeps an unexpected payload shape
// (or anything else MFL decides to include) out of a file we later read back.
const snapshot = {
  capturedAt: new Date().toISOString(),
  targetYear,
  franchises: liveFranchises.map((f) => ({
    id: String(f?.id ?? ''),
    name: String(f?.name ?? ''),
    waiverSortOrder: String(f?.waiverSortOrder ?? ''),
  })),
};
fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
console.log(`\nPre-write snapshot: ${path.relative(root, snapshotFile)}`);
// On a CI runner that file dies with the job, so the log is the real restore
// artifact — print the prior order inline, in payload form, ready to replay.
console.log('Prior order (restore payload — replay this DATA to undo):');
console.log(
  buildFranchisesWaiverXml(
    snapshot.franchises
      .filter((f) => f.waiverSortOrder)
      .map((f) => ({
        position: Number(f.waiverSortOrder),
        franchiseId: f.id,
        conference: '',
        conferenceBasePosition: 0,
      }))
      .sort((a, b) => a.position - b.position)
  )
);

const url = setAflWaiverOrderUrl(league.mflHost, targetYear, league.id);
console.log(`POST ${url}`);
const res = await mflFetch({
  url,
  method: 'POST',
  mflUserCookie: userId,
  mflCommishCookie: commish,
  body: new URLSearchParams({ DATA: xml }).toString(),
});
const text = await res.text();

// ALWAYS log what MFL said. A franchises import that silently no-ops returns
// HTTP 200 with no "error" anywhere, so the body is the only thing that
// distinguishes "not a commissioner", "attribute not importable", and "wrong
// DATA shape". The 2026-08-31 run lost half an hour to not having this.
console.log(`MFL responded HTTP ${res.status}, ${text.length} bytes:`);
console.log(text.slice(0, 800).trim() || '  (empty body)');

const commishHint =
  `\n\nIf this is an access problem: the franchises import is commissioner-only AND ` +
  `per-league. The MFL_USER_ID/MFL_IS_COMMISH pair this repo's other write jobs use is ` +
  `TheLeague's commissioner, which is NOT automatically a commissioner of AFL ${league.id}.`;

// An HTML body is never a successful import — MFL answers imports with XML.
// A login page, a permission notice and a league home page are all HTML, all
// HTTP 200, and none of them contain the word "error".
if (/^\s*(<!doctype html|<html)/i.test(text)) {
  throw new Error(
    `MFL returned an HTML page rather than an import result, so the write did NOT apply ` +
      `(HTTP ${res.status}). Body above.${commishHint}`
  );
}
if (!res.ok || /error/i.test(text)) {
  throw new Error(`MFL rejected the write (HTTP ${res.status}): ${text.slice(0, 400)}${commishHint}`);
}
console.log('MFL accepted the write. Verifying…');

// ── 6. Verify — never trust the 200 ──────────────────────────────────────────
const verifyRes = await fetch(exportUrl + `&_=${Date.now()}`);
const verifyFranchises = asFranchiseList((await verifyRes.json())?.league?.franchises?.franchise);
const actual = new Map<string, string>(verifyFranchises.map((f) => [f.id, f.waiverSortOrder ?? '?']));

// Data loss FIRST. It is the graver outcome and the one needing immediate
// action, so it must not sit behind a mismatch check that throws before it.
// Names surviving is the canary for OVERLAY having been honored.
const blanked = verifyFranchises.filter((f) => !f.name);
if (blanked.length > 0) {
  throw new Error(
    `${blanked.length} franchise(s) lost their name — OVERLAY did not take. ` +
      `Restore IMMEDIATELY by replaying the prior-order payload printed above.`
  );
}

const mismatches = order.filter((e) => actual.get(e.franchiseId) !== String(e.position));
if (mismatches.length > 0) {
  for (const m of mismatches) {
    console.error(`  MISMATCH ${m.franchiseId} ${teamName(m.franchiseId)}: expected ${m.position}, MFL has ${actual.get(m.franchiseId)}`);
  }
  // A no-op is exactly "every franchise still holds its PRE-write value".
  const isNoOp = order.every((e) => actual.get(e.franchiseId) === before.get(e.franchiseId));
  const noOpHint = isNoOp
    ? `\n\nEvery value still matches the PRE-write order, so MFL accepted the request and ` +
      `applied nothing — this is a silent no-op, not a partial write. Nothing needs restoring. ` +
      `Read MFL's response body logged above to tell which it is: not a commissioner of this ` +
      `league, waiverSortOrder not accepted by the franchises import, or a DATA shape MFL parsed ` +
      `as zero franchises.`
    : `\n\nThis is a PARTIAL write — some franchises moved. Restore by replaying the ` +
      `prior-order payload printed above.`;
  throw new Error(`${mismatches.length} franchise(s) did not land as sent.${noOpHint}`);
}

console.log(`\nDone. All ${order.length} franchises verified against the live league.`);
