/**
 * A waiver claim may only be reported as filed once MFL has been made to say so.
 *
 * The bug these pin, reproduced live on 2026-09-02: a submission made with a
 * session whose MFL cookie was a nonsense string came back
 * `{"success":true,"message":"Round 1 submitted — 1 claim.","confirmed":[]}`.
 * The modal showed "Submitted ✓" and closed. Nothing existed on MFL. Two
 * independent holes let that through, and both are covered here:
 *
 *   1. `!res.ok || /<error/i.test(text)` was the only gate on the write. MFL
 *      answers a REFUSED import with HTTP 200 and a body with no `<error>` in
 *      it at all — a login page, a permission notice. Absence of an error is
 *      not success; `<status>OK</status>` is.
 *   2. The read-back was `stored.length > 0 && !stored.includes(id)`, so an
 *      EMPTY pendingWaivers — exactly what a dropped write produces — made the
 *      round report clean. The verification was disabled in the one case it
 *      was written for.
 *
 * The source-level assertions at the bottom are deliberate: the logic lives in
 * an API route that cannot be imported here (Astro `APIRoute`, live MFL calls),
 * and the failure mode is silent, so a grep guard is the only thing standing
 * between a refactor and a repeat.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readMflImportResult } from '../src/utils/mfl-import-result';
import { readPendingWaiverPlayerIds } from '../src/utils/waiver-claim';

const ROUTE = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/api/waiver-claim.ts'),
  'utf-8'
);

describe('readMflImportResult — nothing is accepted unless MFL says OK', () => {
  it('accepts only an affirmative status', () => {
    expect(readMflImportResult('<status>OK</status>').accepted).toBe(true);
    expect(readMflImportResult('<?xml version="1.0"?><status>OK</status>').accepted).toBe(true);
    expect(readMflImportResult('<status >  OK  </status>').accepted).toBe(true);
  });

  it('rejects MFL\'s explicit error and surfaces its message', () => {
    const out = readMflImportResult('<error>Invalid Waiver Round</error>');
    expect(out.accepted).toBe(false);
    expect(out.error).toBe('Invalid Waiver Round');
  });

  it('rejects an HTML body — the silent auth failure that started all this', () => {
    const login = '<!DOCTYPE html><html><body>Please log in to continue</body></html>';
    expect(readMflImportResult(login).accepted).toBe(false);
    // The old check passed this: HTTP 200, no `<error>` anywhere in it.
    expect(/<error/i.test(login)).toBe(false);
  });

  it('surfaces MFL\'s message from a JSON error payload, not just the XML one', () => {
    // A JSON refusal was already REJECTED (it hit the unrecognized-body branch)
    // but its message was discarded, exactly when the owner most needs it.
    const nested = readMflImportResult('{"error":{"$t":"Invalid Waiver Round"}}');
    expect(nested.accepted).toBe(false);
    expect(nested.error).toBe('Invalid Waiver Round');

    const flat = readMflImportResult('{"error":"Not your franchise"}');
    expect(flat.error).toBe('Not your franchise');

    // Malformed JSON must not throw — it falls through to unrecognized.
    const broken = readMflImportResult('{"error": ');
    expect(broken.accepted).toBe(false);
    expect(broken.reason).toContain('Unrecognized');
  });

  it('rejects an empty body and an unrecognized one, keeping the body for the log', () => {
    expect(readMflImportResult('').accepted).toBe(false);
    const odd = readMflImportResult('<something-else/>');
    expect(odd.accepted).toBe(false);
    expect(odd.reason).toContain('something-else');
  });

  it('rejects a non-2xx response as a transport failure, not a mystery payload', () => {
    const out = readMflImportResult('<status>OK</status>', 503);
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('HTTP 503');
  });
});

describe('readPendingWaiverPlayerIds — "could not verify" is not "nothing there"', () => {
  it('returns null when there is nothing to read, so the caller cannot mistake it for empty', () => {
    expect(readPendingWaiverPlayerIds(null)).toBeNull();
    expect(readPendingWaiverPlayerIds({})).toBeNull();
    expect(readPendingWaiverPlayerIds({ error: { $t: 'API requires logged in user' } })).toBeNull();
  });

  it('reads MFL\'s empty-state "" as a genuine, verified empty list', () => {
    expect(readPendingWaiverPlayerIds({ pendingWaivers: '' })).toEqual([]);
  });

  it('finds the claimed player however MFL nests him', () => {
    const nested = { pendingWaivers: { waiverRequest: [{ round: '1', player: { id: '12616' } }] } };
    expect(readPendingWaiverPlayerIds(nested)).toContain('12616');

    // MFL collapses single-element arrays to a bare object.
    const single = { pendingWaivers: { waiver: { player: { id: '12616' } } } };
    expect(readPendingWaiverPlayerIds(single)).toContain('12616');

    // ...and sometimes carries the ids flat on the request itself.
    const flat = { pendingWaivers: { request: [{ add: '12616', drop: '15708' }] } };
    expect(readPendingWaiverPlayerIds(flat)).toEqual(expect.arrayContaining(['12616', '15708']));
  });

  it('an object payload it cannot read is null, NOT a verified-empty list', () => {
    // Returning [] here told the owner their claim "did not go through" on the
    // strength of a payload we did not understand. {} stays [] — an empty
    // container is a credible "nothing pending".
    expect(readPendingWaiverPlayerIds({ pendingWaivers: { somethingNew: [{ ref: 'abc' }] } })).toBeNull();
    expect(readPendingWaiverPlayerIds({ pendingWaivers: {} })).toEqual([]);
  });

  it('does not mistake a round number or a bid for a player id', () => {
    const ids = readPendingWaiverPlayerIds({
      pendingWaivers: { waiverRequest: [{ round: '1', timestamp: '1788333593', player: { id: '12616' } }] },
    });
    expect(ids).toEqual(['12616']);
  });
});

describe('the route still requires both proofs', () => {
  it('gates the write on readMflImportResult, not on the absence of <error>', () => {
    expect(ROUTE).toContain('readMflImportResult');
    // The exact check that shipped the bug.
    expect(ROUTE).not.toMatch(/!res\.ok \|\| \/<error\/i\.test\(text\)/);
  });

  it('confirms by DELTA — a player already pending cannot vouch for a new write', () => {
    // Claim X in round 1, re-file X in round 2, MFL drops the round-2 write:
    // X is in pendingWaivers either way, so presence alone reported success.
    // The route reads pendingWaivers on BOTH sides and confirms only new ids.
    expect(ROUTE).toContain('pendingBefore');
    // Scoped to the QUEUED branch. The FCFS branch legitimately confirms by
    // presence: validateClaims has just proved the add is a free agent, so
    // finding him on the roster afterwards is itself the delta.
    const queued = ROUTE.slice(ROUTE.indexOf("mode: 'fcfs'"));
    expect(queued, 'confirmation must not be bare presence in the after-read').not.toMatch(
      /verified:\s*stored !== null/
    );
    expect(queued).toContain('newlyPending');
    // Both reads must succeed for a verdict; one failing means unverified.
    expect(queued).toMatch(/canDiff\s*=\s*pendingBefore !== null && stored !== null/);
    expect(queued).toMatch(/confirmed:\s*newlyPending/);
  });

  it('never re-introduces the guard that disabled the read-back', () => {
    // `stored.length > 0 && ...` made an empty pendingWaivers report success.
    // Matched WITH the `&&` so the note explaining the bug isn't a hit.
    expect(ROUTE).not.toMatch(/stored\.length > 0\s*&&/);
  });

  it('reports whether the claim was verified, so the UI cannot show a false ✓', () => {
    expect(ROUTE).toContain('verified:');
    const modal = fs.readFileSync(
      path.join(process.cwd(), 'src/components/shared/WaiverClaimModal.astro'),
      'utf-8'
    );
    expect(modal).toContain('data.verified === false');
    // The checkmark must be unreachable when the server could not confirm.
    expect(modal.indexOf('data.verified === false')).toBeLessThan(modal.indexOf('Submitted ✓'));
  });

  it('logs MFL\'s response body on a refused write — a no-op is invisible without it', () => {
    expect(ROUTE).toMatch(/console\.error\('\[waiver-claim\][^)]*text\.slice/);
  });

  it('verifies an FCFS add against the ONE claim it sent, not the whole board', () => {
    // FCFS resolves instantly, so the route writes only `claims[0]`; the rest of
    // an ordered board is never submitted and was never meant to be. Checking
    // the roster against every requestedAdds entry counted those as missing and
    // reported a successful pickup as "probably did NOT go through".
    const fcfs = ROUTE.slice(ROUTE.indexOf('if (immediate) {', ROUTE.indexOf('Verify by reading')));
    const branch = fcfs.slice(0, fcfs.indexOf("mode: 'fcfs'"));
    expect(branch).toContain('fcfsAdds');
    expect(branch, 'the FCFS read-back must not be scored against unsent claims').not.toMatch(
      /(landed|missing)\s*=\s*stored\s*\?\s*requestedAdds/
    );
  });
});
