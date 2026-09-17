/**
 * A free-agent list must not be as old as the last deploy.
 *
 * ## The bug
 *
 * Both `/players` pages answer one question — who is available — and they answer
 * it by inverting roster membership. Derive that membership from the COMMITTED
 * feed and the answer is only as current as the last production build: an owner
 * opens the page and is offered a player who was claimed two hours ago. That is
 * the single thing a free-agent page must not do, and it is the shape of the
 * 2026-09-16 waiver incident.
 *
 * The AFL's copy already knew this — `afl-free-agents-live.ts` exists precisely
 * to re-derive membership at request time, and its header says so. TheLeague's
 * copy never got it, and the two pages are forked siblings, so nothing carried
 * the fix across. This pins the property on BOTH, in the terms each one uses.
 *
 * ## Why the fallback is pinned too
 *
 * A live read that cannot fall back is worse than a stale one. If the overlay
 * returns nothing — Redis down, MFL unreachable — and the page believes it, the
 * roster map is empty and EVERY player in the league reads as a free agent. The
 * static feed is the floor that makes the live read safe to attempt.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const THELEAGUE = 'src/pages/theleague/players.astro';
const AFL = 'src/pages/afl-fantasy/players.astro';

describe('free agents are derived from a LIVE roster read', () => {
  it("TheLeague's players page reads the live roster cache", () => {
    const src = read(THELEAGUE);
    expect(
      /getCachedRosters\s*\(/.test(src),
      `${THELEAGUE} must derive roster membership from getCachedRosters ` +
        '(mfl-roster-cache), not from the committed feed alone. Built from the ' +
        'static feed, the free-agent list is only as current as the last deploy ' +
        'and will offer players who were claimed hours ago.',
    ).toBe(true);
  });

  it("TheLeague's page keeps the committed feed as a fallback", () => {
    const src = read(THELEAGUE);
    // The live read returns null when Redis is unavailable. Believing that null
    // empties the roster map, which reports the entire league as available.
    expect(
      /else if \(rostersData\?\.rosters\?\.franchise\)/.test(src),
      `${THELEAGUE} must still fall back to the committed rosters feed when the ` +
        'live read returns nothing. Without the fallback a Redis outage reports ' +
        'every rostered player in the league as a free agent.',
    ).toBe(true);
  });

  it('treats an EMPTY live map as unavailable, not as "nobody is rostered"', () => {
    const src = read(THELEAGUE);
    // getCachedRosters returns null when Redis is down but `{}` when the cached
    // payload held no players — and `{}` is TRUTHY. A bare truthiness check
    // therefore takes the live branch on an empty map, leaves the roster map
    // empty, and reports EVERY rostered player in the league as a free agent:
    // strictly worse than stale, and the exact failure the fallback exists to
    // prevent. Caught by review on #1157 before it shipped.
    expect(
      /Object\.keys\(cachedRosterPlayers\)\.length\s*>\s*0/.test(src),
      `${THELEAGUE} must reject an EMPTY live roster map, not just a null one. ` +
        '`{}` is truthy, so a bare `if (cachedRosterPlayers)` skips the static ' +
        'fallback and reports the whole league as free agents.',
    ).toBe(true);
  });

  it('the live read precedes the static one', () => {
    const src = read(THELEAGUE);
    const live = src.indexOf('getCachedRosters(');
    const fallback = src.indexOf('else if (rostersData?.rosters?.franchise)');
    expect(live).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(-1);
    expect(
      live < fallback,
      'The committed feed must be the FALLBACK, not the primary. If the static ' +
        'branch wins, the live read is decoration.',
    ).toBe(true);
  });

  it("the AFL's players page keeps its own live overlay — and CALLS it", () => {
    const src = read(AFL);
    // Not the module name: that is satisfied by the import line alone, so
    // deleting the call while leaving the import would keep this green and the
    // guard would pin nothing. Assert the call sites.
    for (const fn of ['fetchLiveAflRosters', 'applyLiveRosters']) {
      expect(
        new RegExp(`${fn}\\s*\\(`).test(src),
        `${AFL} imports its live overlay but no longer calls ${fn}(). It is the ` +
          'copy that had this right first; losing the call would re-open the gap ' +
          'on the other side while every import-level check stayed green.',
      ).toBe(true);
    }
  });

  it('neither page derives availability from the static feed alone', () => {
    // The drift this exists to stop is one page getting the fix and the other
    // not — which is exactly what happened, for months, unnoticed.
    for (const [file, marker] of [
      [THELEAGUE, /getCachedRosters\s*\(/],
      [AFL, /afl-free-agents-live/],
    ] as const) {
      expect(
        marker.test(read(file)),
        `${file} has no live roster source. Both /players pages answer "who is ` +
          'available" and both must read it live — a fix on one sibling that ' +
          'does not reach the other is how this went wrong the first time.',
      ).toBe(true);
    }
  });
});
