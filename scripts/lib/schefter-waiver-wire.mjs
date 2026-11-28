/**
 * schefter-waiver-wire.mjs — ONE short post per league after the weekly
 * waiver run: every claim the run awarded, then the first-come-first-served
 * adds made after it.
 *
 * Replaced the AI-written "waiver pickups" column (Brandon, 2026-11-26: "we
 * don't need a recap for either league but a single post in each league is
 * great"). That column also shipped "Zero claims, zero dollars" on a week with
 * a $725K claim, because it read a stale transactions copy — so this post is
 * built from MFL's LIVE export by its caller, and a window that holds no
 * waiver run is a skip, never an empty post.
 *
 * Written in code, not by a model, like the roster lists in
 * schefter-wire-formats.mjs: a post asserts only what MFL's rows carry.
 *
 * Pure: rows, players and teams in, a post (or null) out. The caller
 * (scripts/schefter-waiver-wire.mjs) owns the fetch and the feed write.
 * Guard: tests/schefter-waiver-wire.test.ts.
 */

import { parseRosterMove, rosterMoveString } from './roster-move-parse.mjs';
import { playerLine } from './schefter-wire-formats.mjs';
import { formatSalary } from './schefter-move-story.mjs';

/** Feed sub-type of the post. */
export const WAIVER_WIRE_SUBTYPE = 'WAIVER_WIRE';

/** The row MFL writes once per waiver run, claims or not. */
const RUN_TYPES = new Set(['BBID_AUTO_PROCESS_WAIVERS', 'AUTO_PROCESS_WAIVERS']);
/** A claim the run decided: a blind bid (TheLeague) or rolling priority (AFL). */
const CLAIM_TYPES = new Set(['BBID_WAIVER', 'WAIVER']);
/** A run is looked for this far back from the post time. */
const LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
/** Claims are stamped with the run's second; allow a little slack. */
const CLAIM_SLACK_SECONDS = 5 * 60;

const tsOf = (row) => parseInt(row?.timestamp, 10);

/**
 * The newest waiver run at or before `nowSeconds`, within the last week, as
 * epoch seconds — or null.
 */
export function latestWaiverRun(rows, nowSeconds) {
  let best = null;
  for (const row of rows) {
    if (!RUN_TYPES.has(row?.type)) continue;
    const ts = tsOf(row);
    if (!Number.isFinite(ts) || ts > nowSeconds || ts < nowSeconds - LOOKBACK_SECONDS) continue;
    if (best === null || ts > best) best = ts;
  }
  return best;
}

/** YYYY-MM-DD of epoch seconds on the league's clock. */
function dayOf(seconds, zone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(seconds * 1000));
}

/** "Wednesday" for epoch seconds on the league's clock. */
function weekdayOf(seconds, zone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date(seconds * 1000));
}

/** The post id for the run on `day` — one per league feed per run. */
export function waiverWireId(runSeconds, zone) {
  return `sf_waiver_wire_${dayOf(runSeconds, zone).replace(/-/g, '')}`;
}

const countOf = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Player ids added by one roster-move row (a pure drop adds none). */
export function addedIdsOf(row) {
  return parseRosterMove(rosterMoveString(row)).addedIds;
}

/**
 * The run's claims and the FCFS adds after it, grouped by team in the order
 * the moves happened.
 * @returns {{ claims: Map<string, string[]>, fcfs: Map<string, string[]>, claimCount: number, fcfsCount: number, playerIds: string[], franchiseIds: string[] } | null}
 *   null when a player cannot be named — a post never prints "Player 12345".
 */
export function collectWaiverWire(rows, { runSeconds, nowSeconds, players }) {
  const claims = new Map();
  const fcfs = new Map();
  const playerIds = new Set();
  const franchiseIds = new Set();
  let claimCount = 0;
  let fcfsCount = 0;

  const sorted = [...rows].sort((a, b) => tsOf(a) - tsOf(b));
  for (const row of sorted) {
    const ts = tsOf(row);
    if (!Number.isFinite(ts)) continue;
    const isClaim = CLAIM_TYPES.has(row.type) && Math.abs(ts - runSeconds) <= CLAIM_SLACK_SECONDS;
    const isFcfs = row.type === 'FREE_AGENT' && ts > runSeconds && ts <= nowSeconds;
    if (!isClaim && !isFcfs) continue;

    const { addedIds, bbidAmount } = parseRosterMove(rosterMoveString(row));
    if (addedIds.length === 0) continue; // a plain drop
    const into = isClaim ? claims : fcfs;
    const lines = into.get(row.franchise) ?? [];
    for (const id of addedIds) {
      const line = playerLine(players.get(id));
      if (!line) return null;
      // A blind bid prices the one player it bought.
      const price = row.type === 'BBID_WAIVER' && addedIds.length === 1 && Number.isFinite(bbidAmount) && bbidAmount > 0
        ? ` (${formatSalary(bbidAmount)})`
        : '';
      lines.push(`${line}${price}`);
      playerIds.add(id);
      if (isClaim) claimCount += 1; else fcfsCount += 1;
    }
    into.set(row.franchise, lines);
    franchiseIds.add(row.franchise);
  }
  return { claims, fcfs, claimCount, fcfsCount, playerIds: [...playerIds], franchiseIds: [...franchiseIds] };
}

/**
 * The post, or null when there is no run to report or a player can't be named.
 *
 * @param {object} input
 * @param {object[]} input.rows MFL transaction rows (live)
 * @param {Map<string, {name: string, position: string}>} input.players MFL players by id
 * @param {Map<string, {name: string}>} input.teams franchises by id
 * @param {string} input.league registry slug
 * @param {number} input.nowSeconds the post time, epoch seconds
 * @param {string} [input.zone] the league's clock
 */
export function buildWaiverWirePost({ rows, players, teams, league, nowSeconds, zone = 'America/Los_Angeles' }) {
  const runSeconds = latestWaiverRun(rows, nowSeconds);
  if (runSeconds === null) return null;
  const got = collectWaiverWire(rows, { runSeconds, nowSeconds, players });
  if (!got) return null;

  const teamName = (fid) => teams.get(fid)?.name ?? `Team ${fid}`;
  const section = (label, map) => (map.size
    ? `🏈 ${label}:\n${[...map].map(([fid, lines]) => `${teamName(fid)}: ${lines.join(', ')}`).join('\n')}`
    : `🏈 ${label}:\nNone`);

  const night = `${weekdayOf(runSeconds, zone)} night's waiver run`;
  const body = got.claimCount === 0 && got.fcfsCount === 0
    ? `No claims in ${night}, and no first-come-first-served pickups since.`
    : [
      `Waiver wire wrap from ${night}:`,
      section('Waiver claims', got.claims),
      section('First come, first served after waivers', got.fcfs),
    ].join('\n\n');

  return {
    id: waiverWireId(runSeconds, zone),
    timestamp: new Date(nowSeconds * 1000).toISOString(),
    type: 'transaction',
    transactionSubType: WAIVER_WIRE_SUBTYPE,
    format: 'waiver-wire',
    tier: 'minor',
    headline: `Waiver wire: ${countOf(got.claimCount, 'claim')}, ${countOf(got.fcfsCount, 'pickup')} after waivers`,
    body,
    franchiseIds: got.franchiseIds,
    playerIds: got.playerIds,
    sourceTimestamp: String(runSeconds),
    league,
    authorId: 'claude',
  };
}
