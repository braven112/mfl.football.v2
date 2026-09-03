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

/** Verbatim from `export?TYPE=pendingWaivers` with one claim filed. */
const REAL = {
  version: '1.0',
  encoding: 'utf-8',
  pendingWaivers: {
    waiverRequest: { timestamp: '1788405970', addsDrops: '15889_14059', comments: '', round: '1' },
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
