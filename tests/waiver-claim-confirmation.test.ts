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

/**
 * `ROUTE` with comments removed. Several rules here are written up in prose in
 * the route itself, and that prose necessarily NAMES the thing it is warning
 * against — so a naive `not.toContain` on the raw file matches the warning and
 * fails on a correct implementation. Assert structure against this.
 */
const ROUTE_CODE = ROUTE.split('\n')
  .filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

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

  it('keeps a tolerant fallback for a shape MFL has not shown us', () => {
    // These are HYPOTHETICAL shapes, and this test used to assert them as if
    // they were real — including that a DROP id counts. The live payload
    // (below) proved both wrong. The fallback survives only so a future shape
    // change degrades to "verified" instead of hard-failing every claim; it is
    // not a description of anything MFL is known to return.
    const nested = { pendingWaivers: { waiverRequest: [{ round: '1', player: { id: '12616' } }] } };
    expect(readPendingWaiverPlayerIds(nested)).toContain('12616');

    // MFL collapses single-element arrays to a bare object.
    const single = { pendingWaivers: { waiver: { player: { id: '12616' } } } };
    expect(readPendingWaiverPlayerIds(single)).toContain('12616');

    // A drop is NOT an add. Counting one would let an unrelated drop vouch for
    // an add that never landed — the false confirmation this whole route
    // exists to prevent.
    const withDrop = { pendingWaivers: { waiverRequest: { addsDrops: '12616_15708', round: '1' } } };
    expect(readPendingWaiverPlayerIds(withDrop)).toEqual(['12616']);
  });

  it('reads the REAL pendingWaivers payload — captured from a live filed claim', () => {
    // The shape, verbatim from MFL on 2026-09-02 after a claim actually filed.
    // The first version of this parser guessed at `id`/`player` keys that do not
    // exist here, found nothing, and reported a perfectly good claim as
    // unverifiable — the owner was shown "we could not confirm it" for a claim
    // MFL was already listing.
    const real = {
      version: '1.0',
      encoding: 'utf-8',
      pendingWaivers: {
        waiverRequest: { timestamp: '1788405970', addsDrops: '15889_14059', comments: '', round: '1' },
      },
    };
    // The ADD only. 14059 is the drop — a player already on the roster, so
    // counting it would let an unrelated drop vouch for an add that never landed.
    expect(readPendingWaiverPlayerIds(real)).toEqual(['15889']);

    // `round` and `timestamp` are digit strings too and must not be mistaken for ids.
    expect(readPendingWaiverPlayerIds(real)).not.toContain('1');
    expect(readPendingWaiverPlayerIds(real)).not.toContain('1788405970');

    // MFL collapses a single-element list to a bare object, so several claims
    // in a round arrive as an ARRAY, and multiple picks share one addsDrops.
    expect(
      readPendingWaiverPlayerIds({
        pendingWaivers: {
          waiverRequest: [
            { addsDrops: '15889_14059', round: '1' },
            { addsDrops: '16174_0000,15754_13001', round: '2' },
          ],
        },
      })
    ).toEqual(['15889', '16174', '15754']);

    // Verified-empty stays empty; that is what an unclaimed round looks like.
    expect(readPendingWaiverPlayerIds({ pendingWaivers: {} })).toEqual([]);
  });

  it('separates a REFUSAL from an indeterminate answer', () => {
    // The load-bearing distinction. `import?TYPE=waiverRequest` answers with an
    // EMPTY body whether it stored the claim or not — probed live against
    // www44, where every import type including a bogus one does the same. So
    // "no affirmative OK" cannot mean failure, or every good claim is rejected.
    const empty = readMflImportResult('');
    expect(empty.accepted).toBe(false);
    expect(empty.refused, 'an empty body is indeterminate, not a refusal').toBe(false);

    const unknown = readMflImportResult('something new from MFL');
    expect(unknown.refused).toBe(false);

    // These ARE refusals and must stay hard failures.
    for (const body of ['<error>Invalid Waiver Round</error>', '<html><body>Login</body></html>', '{"error":{"$t":"nope"}}']) {
      expect(readMflImportResult(body).refused, body.slice(0, 30)).toBe(true);
    }
    expect(readMflImportResult('', 500).refused).toBe(true);
    expect(readMflImportResult('<status>OK</status>').accepted).toBe(true);
    expect(readMflImportResult('<status>OK</status>').refused).toBe(false);
  });

  it('hands the owner a link to see the claim on MFL, built from the registry', () => {
    // A filed claim is invisible on our side until waivers process, so the
    // success message points at MFL's own add/drop page, which lists the round.
    expect(ROUTE_CODE).toMatch(/confirmUrl = `https:\/\/\$\{writeHost\}\/\$\{year\}\/add_drop\?L=\$\{leagueId\}`/);
    // Returned on BOTH outcomes — most of all when we could not confirm it
    // ourselves, which is exactly when the owner needs somewhere to look.
    const fcfs = ROUTE_CODE.slice(ROUTE_CODE.indexOf("mode: 'fcfs'"), ROUTE_CODE.indexOf("mode: 'fcfs'") + 200);
    expect(fcfs).toContain('confirmUrl');
    expect(ROUTE_CODE.slice(ROUTE_CODE.indexOf("mode: 'waiver'"))).toContain('confirmUrl');
  });

  it('writes to the LEAGUE host, never the api. gateway', () => {
    // api.myfantasyleague.com is the API gateway, not a page handler: it answers
    // a posted write with an empty 200 and stores nothing.
    expect(ROUTE).toContain('league.mflHost');
    const writeBlock = ROUTE_CODE.slice(ROUTE_CODE.indexOf('const writeHost'), ROUTE_CODE.indexOf('let text ='));
    expect(writeBlock, 'the write must not be posted to the api. gateway').not.toContain('api.myfantasyleague.com');
    expect(writeBlock).toContain('${writeHost}');
  });

  it('files a QUEUED claim through add_drop, not the import API', () => {
    // `import?TYPE=waiverRequest` answers an authenticated, correctly-hosted
    // request with an empty 200 and stores nothing — proven twice against a live
    // owner session, with the pendingWaivers read-back confirming the claim
    // never appeared. add_drop is the page owners actually use, and the one
    // cut-player.ts already replays for the same class of reason.
    expect(ROUTE_CODE).toContain('/add_drop');
    // MFL dispatches on the button VALUE, and its picker.js rewrites it to
    // "Submit Request" when FORCE_WAIVER is ticked. Sending the unticked value
    // asks for an instant add, which a locked pool refuses.
    expect(ROUTE_CODE).toContain("SUBMIT: 'Submit Request'");
    expect(ROUTE_CODE).toContain('add_pid');
    // FORCE_WAIVER is what makes it a CLAIM rather than an instant add. Without
    // it, a locked free-agent pool refuses the add by silently re-rendering the
    // form — no error, no transaction. Read off MFL's live authenticated form,
    // where it is a checkbox with no `value` attribute (so: 'on').
    expect(ROUTE_CODE).toMatch(/FORCE_WAIVER: 'on'/);
    expect(ROUTE_CODE).toMatch(/ROUND: String\(round\)/);
    expect(ROUTE_CODE, 'the dead waiverRequest import must be gone').not.toContain('TYPE=waiverRequest');
  });

  it('performs an FCFS add through add_drop too — the import API drops it silently', () => {
    // THE BUG THIS PINS (2026-09-07, live, in the AFL's first FCFS window of the
    // season). The immediate path posted `import?TYPE=fcfsWaiver`, and that
    // import applies the same strict "resulting roster must be inside the
    // in-season limit" validation cut-player.ts documents — scoring the ADD
    // before the DROP. An owner at 16/16 dropping someone to make room is
    // therefore refused, which is every add/drop that matters. MFL refuses it
    // with HTTP 200 and an EMPTY BODY: no error, no transaction, nothing in the
    // league log. Three pickups vanished in eleven minutes while another owner
    // made the identical full-roster swap on MFL's own page in the same window.
    expect(ROUTE_CODE, 'the fcfsWaiver import cannot come back').not.toContain('TYPE=fcfsWaiver');
    // The instant-add pair: NO FORCE_WAIVER, and the button value MFL's
    // picker.js shows when the box is unticked. Both halves, or the page files a
    // claim instead of making the pickup.
    expect(ROUTE_CODE).toContain("SUBMIT: 'Perform Add/Drop'");
    const fcfsWrite = ROUTE_CODE.slice(
      ROUTE_CODE.indexOf('const writes'),
      ROUTE_CODE.indexOf('SUBMIT: \'Perform Add/Drop\'')
    );
    expect(fcfsWrite, 'FORCE_WAIVER on the immediate write would queue it').not.toContain('FORCE_WAIVER');
    // The add/drop is the FIRST claim only — the rest of an ordered board has no
    // meaning once the add resolves instantly.
    expect(ROUTE_CODE).toMatch(/add_pid: String\(claims!\[0\]\.addPlayerId\)/);
  });

  it('surfaces the refusals an INSTANT add has and a queued claim does not', () => {
    // A locked player is the headline one, and MFL states it with the player's
    // own name in front:
    //   "Okonkwo, Chigoziem WAS TE Cannot Be Added Because Is Locked."
    // Without this pattern the page classified as "no complaint", the roster
    // read-back then reported the player missing, and the owner got the generic
    // "MFL did not add the player" for a cause MFL had named outright.
    expect(ROUTE_CODE).toMatch(/Cannot Be \(\?:Added\|Dropped\) Because/);
    // Captured with the leading characters, or the sentence loses its subject.
    expect(ROUTE_CODE).toMatch(/\[\^<>\]\{0,\d+\}Cannot Be/);
    // SCOPED TO THE IMMEDIATE PATH. The queued path posts one request per claim
    // in a loop, and any complaint match aborts the rest of the board — so a
    // pattern that false-positives on the re-rendered page (which carries the
    // whole free agent listing, not just MFL's prose) would strand claims 2..n
    // after claim 1 was already filed. FCFS sends one write and has no board.
    expect(ROUTE_CODE).toMatch(/immediate\s*\n?\s*\?\s*\[\.\.\.text\.matchAll\(\/\[\^<>\]/);
  });

  it('sends the BID with a blind-bid claim, and only for a blind-bid league', () => {
    // THE BUG THIS PINS (2026-09-03): the add_drop replay was built and proven
    // against the AFL, which runs rolling waiver PRIORITY and has no amount box
    // on its form. TheLeague is blind-bid, so MFL rejected every claim it ever
    // filed through this route:
    //
    //   Cannot Save Request: Invalid Bid Amount (bid amount must not include
    //   letters or symbols)
    //   Cannot Save Request: Bid amount ($) is below bid minimum ($425000)
    //
    // The `($)` is MFL echoing back the empty value it read. A whole league's
    // claims failed for one missing field.
    //
    // `BBID_AMT` is the name off MFL's LIVE form. It is worth spelling out that
    // it was not guessable: MFL's own JS calls the wrapper `amt_field_id`, and
    // the sibling wrappers `round_field_id` / `comments_field_id` hold inputs
    // named ROUND and COMMENTS — so the two obvious inferences, `AMT` and
    // `AMOUNT`, are both wrong.
    expect(ROUTE_CODE).toContain('BBID_AMT');
    // Gated on the league's SYSTEM, read from MFL's live payload — not sent
    // unconditionally. The AFL's form has no such field and its claims work.
    expect(ROUTE_CODE).toMatch(/rules\.blindBid\s*\?\s*\{\s*BBID_AMT:/);
    // The claim's own bid, not the league minimum: an owner who bids above the
    // floor must not have it silently rewritten down to it.
    expect(ROUTE_CODE).toMatch(/BBID_AMT:\s*String\(c\.bid\)/);
    // Bare integer dollars. MFL parses this field itself and says so — "must
    // not include letters or symbols" — so any formatting sent here is a
    // rejection.
    expect(ROUTE_CODE, 'the bid must not be currency-formatted').not.toMatch(
      /BBID_AMT:[^,\n]*(toLocaleString|toFixed|\$\{'\$'\}|'\$')/
    );
  });

  it('surfaces MFL\'s own "Cannot Save Request" wording to the owner', () => {
    // MFL states a rejected waiver claim as prose in the page body, one sentence
    // per problem. The matcher only knew about `Transaction Would Create` and
    // `Exceeds League Limit`, so a bid problem classified as "no error found",
    // the pendingWaivers delta then reported the claim missing, and the owner
    // was told the generic "MFL did not record the claim" — while MFL had named
    // the cause. That is what made the missing BBID_AMT cost an afternoon.
    expect(ROUTE).toMatch(/Cannot Save Request:/);
    // EVERY occurrence, not the first: MFL emits one line per problem and the
    // second is usually the actionable one.
    expect(ROUTE_CODE).toMatch(/matchAll\(\/Cannot Save Request:\[\^<\]\*\/gi\)/);
  });

  it('reads add_drop\'s HTML page for MFL\'s own complaint', () => {
    // add_drop re-renders the page carrying its error rather than returning XML,
    // so readMflImportResult (which would call any HTML a refusal) must not be
    // the reader for either path — and now that BOTH writes are add_drop, it has
    // no business in this route at all.
    expect(ROUTE).toMatch(/Transaction Would Create/);
    expect(ROUTE).toMatch(/Exceeds League Limit/);
    expect(ROUTE_CODE, 'an import-API classifier would call every add_drop page a refusal')
      .not.toContain('readMflImportResult(');
  });

  it('the route hard-fails on what MFL SAID, never on a missing OK', () => {
    // Gating the write on `!outcome.accepted` 502'd a real claim during a live
    // waiver window, because MFL affirms nothing on either endpoint. Now that
    // both writes replay a page there is no affirmation to look for at all, and
    // reintroducing one would repeat the same outage.
    expect(ROUTE_CODE, 'must not block the write on the absence of an affirmative OK').not.toMatch(
      /if \(!\w*[Oo]utcome\.accepted\) \{\s*\n\s*return fail/
    );
    expect(ROUTE_CODE, 'the only hard stop before the read-back is MFL\'s own complaint')
      .toMatch(/if \(complaints\.length > 0\) \{/);
    // But an unaffirmed write whose read-back shows nothing is still a failure.
    expect(ROUTE_CODE).toMatch(/canDiff && unconfirmed\.length > 0/);
    expect(ROUTE_CODE).toMatch(/stored !== null && missing\.length > 0/);
  });

  it('hard-fails a non-2xx from MFL instead of letting the read-back soften it', () => {
    // Copilot, post-merge on #1018, and correct. Everything after the write is
    // written for MFL's own 200-with-a-page answer: the complaint scan finds
    // nothing in a gateway error page, so a 502/503 fell through to the
    // read-back — which reports "Submitted, but we could not confirm it" when it
    // cannot read the roster. That is the softest possible wording for a write
    // known never to have reached MFL. The old FCFS path got this for free
    // (`readMflImportResult` scored a non-2xx as `refused`); retiring that
    // reader took the status check out with it.
    const loop = ROUTE_CODE.slice(
      ROUTE_CODE.indexOf('for (const write of writes)'),
      ROUTE_CODE.indexOf('NOTHING IS AFFIRMED') > 0
        ? ROUTE_CODE.indexOf('let stored')
        : ROUTE_CODE.length
    );
    expect(loop).toMatch(/if \(!res\.ok\) \{/);
    expect(loop.slice(loop.indexOf('if (!res.ok)'), loop.indexOf('if (!res.ok)') + 300))
      .toContain('return fail(');
  });

  it('reads the roster back CACHE-BUSTED, and twice before calling a pickup a miss', () => {
    // Every other MFL read in this route carries `_=Date.now()`. `getRosters()`
    // is the one that does not — its URL is byte-identical on every call, so
    // anything between the route and MFL may answer from a copy taken before
    // the write. That was harmless while the FCFS write never landed. Once it
    // does, a stale or lagging read turns a SUCCESSFUL pickup into "Nothing was
    // recorded — try again", in the one window where the owner will try again.
    const fcfs = ROUTE_CODE.slice(
      ROUTE_CODE.indexOf('if (immediate) {', ROUTE_CODE.indexOf('let stored')),
      ROUTE_CODE.indexOf("mode: 'fcfs'")
    );
    expect(fcfs).toMatch(/TYPE=rosters[^`]*_=\$\{Date\.now\(\)\}/);
    expect(fcfs, 'the read-back must not go through the un-busted client')
      .not.toContain('getRosters()');
    // One retry, on the failure path only, for MFL trailing its own write.
    expect(fcfs).toMatch(/setTimeout/);
  });

  it('shows the confirm link AFTER the error, because showError re-hides it', () => {
    // `showError` clears the previous attempt by setting `confirmBox.hidden =
    // true`, so calling showConfirmLink first renders the link and then hides it
    // again — the whole "hand them MFL's page on a failure" addition, silently
    // inert. Ordering is the feature here.
    const modal = fs.readFileSync(
      path.join(process.cwd(), 'src/components/shared/WaiverClaimModal.astro'),
      'utf-8'
    );
    const branch = modal.slice(
      modal.indexOf('if (!res.ok || !data.success)'),
      modal.indexOf('waiver-claims:changed')
    );
    expect(branch).toContain('showConfirmLink(data.confirmUrl)');
    expect(
      branch.indexOf('showError('),
      'showError must run BEFORE showConfirmLink on the failure path'
    ).toBeLessThan(branch.indexOf('showConfirmLink('));
  });

  it('hands the owner MFL\'s own page on a FAILED write, not only a successful one', () => {
    // A pickup lost in a first-come window is worth seconds. When the route
    // refuses, the owner's next move is MFL's add/drop page — the same link the
    // success path already returns — so it rides on the failures too rather than
    // being re-derived by hand (which is how one got lost on 2026-09-07).
    for (const marker of ['MFL rejected the ${immediate', 'MFL did not add the player']) {
      const at = ROUTE_CODE.indexOf(marker);
      expect(at, `${marker} must exist`).toBeGreaterThan(-1);
      expect(ROUTE_CODE.slice(at, at + 400)).toContain('confirmUrl');
    }
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

  it('logs MFL\'s response body whenever it does not affirm — a no-op is invisible without it', () => {
    // console.warn, not error: an unaffirmed write is not yet known to have
    // failed (MFL affirms nothing on this endpoint), but the body is still the
    // whole diagnosis and must never be discarded.
    expect(ROUTE).toMatch(/console\.(warn|error)\('\[waiver-claim\][^)]*text\.slice/);
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
