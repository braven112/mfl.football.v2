/**
 * `readFiledWaiverClaims` — the claims an owner has already filed, as the
 * manage-claims panel needs them.
 *
 * The fixtures here are the REAL payload captured from MFL on 2026-09-02 after
 * a claim actually filed. That matters: the first parser written against this
 * export was written against an invented shape, found nothing, and reported a
 * live claim as unverifiable. Guessed shapes belong in the fallback test, not
 * in the ones that define behaviour.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readFiledWaiverClaims } from '../src/utils/waiver-claim';

/** Verbatim from the AFL's `export?TYPE=pendingWaivers` with one claim filed. */
const REAL = {
  version: '1.0',
  encoding: 'utf-8',
  pendingWaivers: {
    waiverRequest: { timestamp: '1788405970', addsDrops: '15889_14059', comments: '', round: '1' },
  },
};

/**
 * Verbatim from TheLeague's `export?TYPE=pendingWaivers`, captured 2026-09-03
 * immediately after a claim filed.
 *
 * NOTE THE CONTAINER KEY. Rolling priority (the AFL, above) answers with
 * `waiverRequest`; blind bidding answers with `blindBidWaiverRequest`. The
 * parser looked up `waiverRequest` by name, found nothing, and correctly
 * reported the payload as UNREADABLE — so every TheLeague owner with a filed
 * claim saw "Could not read your pending waivers" in the manage panel.
 *
 * The pick format needed no change: `add_bid_drop`, with `0000` for no drop.
 */
const REAL_BBID = {
  version: '1.0',
  encoding: 'utf-8',
  pendingWaivers: {
    blindBidWaiverRequest: {
      timestamp: '1788478227',
      round: '1',
      addsDrops: '16778_425000_0000',
      comments: '',
    },
  },
};

describe('readFiledWaiverClaims', () => {
  it('reads the real single-claim payload', () => {
    expect(readFiledWaiverClaims(REAL)).toEqual([
      {
        round: '1',
        index: 0,
        addPlayerId: '15889',
        dropPlayerId: '14059',
        bid: null,
        comment: '',
        timestamp: '1788405970',
      },
    ]);
  });

  it('reads the real BLIND-BID payload, whose container key is different', () => {
    // The bug this pins: `pendingWaivers.waiverRequest` is the PRIORITY league's
    // key. TheLeague bids and answers with `blindBidWaiverRequest`, so the panel
    // read null for every filed claim.
    expect(readFiledWaiverClaims(REAL_BBID)).toEqual([
      {
        round: '1',
        index: 0,
        addPlayerId: '16778',
        dropPlayerId: null,
        bid: 425000,
        comment: '',
        timestamp: '1788478227',
      },
    ]);
  });

  it('finds the request by SHAPE, so a third container name needs no code change', () => {
    // MFL has now used two names for the same record and there is no reason to
    // believe two is the limit. The record is whatever carries an `addsDrops`
    // string, which is the field the pick format already depends on.
    const claims = readFiledWaiverClaims({
      pendingWaivers: {
        someFutureWaiverRequest: { round: '3', addsDrops: '16778_425000_0000', comments: 'hi' },
      },
    });
    expect(claims).toHaveLength(1);
    expect(claims![0]).toMatchObject({ round: '3', addPlayerId: '16778', bid: 425000, comment: 'hi' });
  });

  it('still separates UNREADABLE from NOTHING FILED after the shape search', () => {
    // The whole reason this bug was legible as a bug: a payload with content but
    // no recognisable record must be null, never []. Reporting [] tells an owner
    // their filed claim is gone.
    expect(readFiledWaiverClaims({ pendingWaivers: { somethingElse: { foo: 'bar' } } })).toBeNull();
    // And the genuine empty states stay empty.
    expect(readFiledWaiverClaims({ pendingWaivers: '' })).toEqual([]);
    expect(readFiledWaiverClaims({ pendingWaivers: {} })).toEqual([]);
  });

  it('keeps MFL\'s order, because that order IS the priority', () => {
    // A round is one record and `addsDrops` is ordered; MFL appends. So the
    // index is the claim's priority AND the `drop_N` slot its edit form uses.
    const claims = readFiledWaiverClaims({
      pendingWaivers: { waiverRequest: { addsDrops: '15889_14059,16174_0000,15754_13001', round: '2' } },
    });
    expect(claims!.map((c) => c.addPlayerId)).toEqual(['15889', '16174', '15754']);
    expect(claims!.map((c) => c.index)).toEqual([0, 1, 2]);
    // `0000` is MFL's "no drop" sentinel, not a player.
    expect(claims![1].dropPlayerId).toBeNull();
  });

  it('normalises the array form MFL uses for several rounds', () => {
    // MFL collapses a single-element list to a bare object, so one round and
    // two rounds are genuinely different shapes.
    const claims = readFiledWaiverClaims({
      pendingWaivers: {
        waiverRequest: [
          { addsDrops: '15889_14059', round: '1' },
          { addsDrops: '16174_0000', round: '2' },
        ],
      },
    });
    expect(claims!.map((c) => `${c.round}:${c.addPlayerId}`)).toEqual(['1:15889', '2:16174']);
    // Index is WITHIN the round — it addresses `drop_N` on that round's form.
    expect(claims!.every((c) => c.index === 0)).toBe(true);
  });

  it('reads a blind bid\'s amount without mistaking it for the drop', () => {
    // `add_bid_drop` in a bidding league. The drop is always LAST, so a
    // three-part pick must not read the bid as the player to drop.
    const [claim] = readFiledWaiverClaims({
      pendingWaivers: { waiverRequest: { addsDrops: '15889_425000_14059', round: '1' } },
    })!;
    expect(claim.bid).toBe(425000);
    expect(claim.dropPlayerId).toBe('14059');
  });

  it('separates "nothing filed" from "could not read"', () => {
    // The distinction the whole feature rests on: an empty list is a fact, a
    // null is an admission. Conflating them tells an owner they have no claims
    // when we simply could not look.
    expect(readFiledWaiverClaims({ pendingWaivers: {} })).toEqual([]);
    expect(readFiledWaiverClaims({ pendingWaivers: '' })).toEqual([]);
    expect(readFiledWaiverClaims(null)).toBeNull();
    expect(readFiledWaiverClaims({})).toBeNull();
    expect(readFiledWaiverClaims({ error: { $t: 'API requires logged in user' } })).toBeNull();
    // Populated, but nothing we recognise → null, never [].
    expect(readFiledWaiverClaims({ pendingWaivers: { somethingNew: [{ ref: 'abc' }] } })).toBeNull();
  });
});

describe('the manage-claims route', () => {
  const ROUTE = fs.readFileSync(path.join(process.cwd(), 'src/pages/api/waiver-claims.ts'), 'utf-8');
  const CODE = ROUTE.split('\n')
    .filter((l) => {
      const t = l.trim();
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  it('offers no reorder action — MFL exposes no reorder primitive', () => {
    // Reordering could only be delete-then-refile, which leaves a window where
    // the owner holds no claim. Both shipped actions map to ONE MFL call.
    expect(CODE).toContain("action === 'delete'");
    expect(CODE).toContain("action === 'editDrop'");
    expect(CODE, 'a reorder action would need a destructive refile — do not add one quietly')
      .not.toMatch(/action === '(reorder|move|sort)'/);
    expect(CODE, 'REPLACE=1 is inert for these leagues').not.toContain('REPLACE');
  });

  it('verifies every write by reading the claims back', () => {
    // MFL's page handlers answer 200 with an HTML page whether or not anything
    // happened, so the response body is never evidence.
    expect(CODE).toMatch(/verified:/);
    expect(CODE.match(/readClaims\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('acts only on a claim found in the CALLER\'s own pending waivers', () => {
    // pendingWaivers is session-scoped, so finding the claim there is the
    // ownership check — no client-supplied id can reach someone else's claim.
    expect(CODE).toMatch(/const target = before\.find\(/);
    expect(CODE).toMatch(/if \(!target\)/);
  });

  it('builds MFL URLs from the registry, never a literal', () => {
    expect(CODE).toContain('league.mflHost');
    expect(CODE).not.toContain('myfantasyleague.com/2026');
  });
});

describe('the claims panel — hiding it', () => {
  const COMPONENT = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/WaiverClaimsPanel.astro'),
    'utf-8'
  );

  it('collapses the LIST, never the whole panel', () => {
    // A control that made the panel vanish would leave no route back to claims
    // that are still live and still going to process. The header stays, and the
    // button carries the count.
    expect(COMPONENT).toContain('body.hidden = collapsed');
    expect(COMPONENT).toMatch(/Show\$\{count \? ` \(\$\{count\}\)` : ''\}/);
    expect(COMPONENT, 'the panel itself must not be hidden by the toggle')
      .not.toMatch(/panel\.hidden = collapsed/);
  });

  it('scopes the remembered choice per league', () => {
    // Both leagues render this panel, and with the ClientRouter one module
    // instance survives a hop between them — an unscoped key would carry the
    // wrong league's choice across.
    expect(COMPONENT).toMatch(/wcp\.collapsed\.\$\{cfg\.leagueId\}/);
  });

  it('never lets storage take the page down with it', () => {
    // localStorage throws outright in some privacy modes.
    expect(COMPONENT).toMatch(/try \{ return localStorage\.getItem/);
    expect(COMPONENT).toMatch(/catch \{ return false; \}/);
  });

  it('keeps the control accessible', () => {
    expect(COMPONENT).toContain('aria-expanded');
    expect(COMPONENT).toContain('aria-controls="wcp-body"');
  });
});

describe('the panel refreshes when a claim is filed', () => {
  const PANEL = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/WaiverClaimsPanel.astro'),
    'utf-8'
  );
  const MODAL = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/WaiverClaimModal.astro'),
    'utf-8'
  );

  it('the modal announces the change and the panel listens', () => {
    // The panel loaded once on page load and never heard about a claim filed
    // through the modal on the same page — an owner filed one, watched it land
    // on MFL, and saw nothing here.
    // The event now carries `detail.playerId` so the player modal can drop him
    // from its claimable set — assert the name, not the whole call.
    expect(MODAL).toContain("new CustomEvent('waiver-claims:changed'");
    expect(MODAL).toContain('detail: { playerId: activeId }');
    expect(PANEL).toContain("addEventListener('waiver-claims:changed'");
  });

  it('announces BEFORE branching on verified', () => {
    // A claim can land on MFL and still come back unverified — the read-back is
    // best-effort — and that is exactly when a stale list misleads most. So the
    // dispatch must not sit inside the verified-only path.
    const submitBody = MODAL.slice(MODAL.indexOf('const data = await res.json()'));
    const dispatchAt = submitBody.indexOf("waiver-claims:changed");
    const verifiedAt = submitBody.indexOf('data.verified === false');
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(verifiedAt).toBeGreaterThan(-1);
    expect(dispatchAt, 'the refresh must fire on the unverified path too').toBeLessThan(verifiedAt);
  });

  it('replaces its document listeners instead of once-flagging them', () => {
    // Both failure modes are real. Adding them plainly STACKS across a
    // ClientRouter hop between the two leagues' Free Agents pages; a once-flag
    // is worse still, pinning the surviving listener to the first evaluation's
    // closure, whose DOM the hop detached — a silently dead panel.
    expect(PANEL).toContain("removeEventListener('waiver-claims:changed'");
    expect(PANEL).toContain("removeEventListener('astro:page-load'");
    expect(PANEL, 'a bare once-flag would keep a stale closure alive')
      .not.toMatch(/if \(!w\.__wcpListeners\)/);
  });

  it('the modal re-initialises on astro:page-load rather than capturing the DOM once', () => {
    // Same trap, one component over. A component script is evaluated ONCE per
    // document and ClientRouter swaps the DOM without re-evaluating it, so a
    // `dlg` resolved at module scope is a DETACHED node after the first in-site
    // navigation and `showModal()` on it puts nothing on screen. The Bid button
    // silently did nothing until a hard reload; that shipped.
    const initAt = MODAL.indexOf('function init()');
    expect(initAt, 'the wiring must live in an init() that re-runs per load').toBeGreaterThan(-1);

    // init() delegates the element wiring to wire(), which it calls on every
    // load — and which /api/claim-context can also call later, on the pages
    // that have no SSR config. Both entry points run per document, so the
    // requirement is unchanged: nothing is resolved at MODULE scope.
    const wireAt = MODAL.indexOf('function wire(');
    expect(wireAt, 'the element wiring lives in wire()').toBeGreaterThan(-1);
    const wiring = MODAL.slice(wireAt);
    for (const read of [
      "getElementById('waiver-claim-modal')",
      "getElementById('wcm-submit')",
    ]) {
      expect(wiring, `${read} must be re-read inside wire()`).toContain(read);
      expect(
        MODAL.slice(0, wireAt),
        `${read} must not be resolved at module scope`,
      ).not.toContain(read);
    }
    // The config blob goes stale exactly like the elements do.
    expect(MODAL.indexOf("getElementById('waiver-claim-config')")).toBeGreaterThan(initAt);
    // Every wire() call is from init() or the late-binding entry point; a call
    // at module scope would capture the first document's nodes forever.
    expect(MODAL).not.toMatch(/^\s*wire\(/m);

    // resumePendingClaim's first act is a synchronous attempt on the parked
    // player, so it runs inside init() — after the handler is wired.
    expect(MODAL.indexOf('resumePendingClaim()')).toBeGreaterThan(initAt);

    expect(MODAL).toContain("document.addEventListener('astro:page-load', init)");
    // astro:page-load fires on the initial load too — a direct call double-inits,
    // which duplicates every option appended to the drop and round selects.
    expect(MODAL, 'astro:page-load already fires on the first load').not.toMatch(/^\s*init\(\);\s*$/m);
  });

  it('the modal replaces its delegated click listener rather than stacking it', () => {
    // `document` is the one thing that SURVIVES the swap, so re-adding per
    // navigation stacks a handler each time. A once-flag is no better: it pins
    // the survivor to the first page's dead nodes, which is the original bug.
    expect(MODAL).toContain("removeEventListener('click', onDocumentClick)");
    expect(MODAL).toContain("addEventListener('click', onDocumentClick)");
  });
});
