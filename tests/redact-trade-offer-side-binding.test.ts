import { describe, it, expect } from 'vitest';
import { attributeSides, redactTradeOffer } from '../scripts/lib/redact-trade-offer.mjs';

/**
 * Which franchise is giving up which side.
 *
 * `tests/redact-trade-offer-attribution.test.ts` pins the rule that a named
 * team may only be paired with players from its OWN side. This file pins the
 * layer under it: that the side actually IS its own.
 *
 * 2026-09-10 shipped "Fire have been shopping Cyrus Allen and a 2027 second —
 * looking for a running back that isn't on anybody's block." Cyrus Allen
 * (17518) is a Bring The Pain (0008) player and has been since the May auction;
 * Fire Ready Aim (0007) was the team being ASKED. `buildExposure` behaved
 * correctly the whole way through — it named the chosen franchise's own side,
 * and the row it was handed had the sides inverted, so "its own side" was
 * somebody else's players.
 *
 * Rows reach this lane from three sources and only one of them is guaranteed
 * to carry MFL's commish-view field semantics, so the fixtures below are the
 * four shapes a row can plausibly arrive in. Replaying the real offer through
 * them reproduced the published sentence from exactly one — ids correct, sides
 * swapped — which is why "the field name says so" is not enough on its own.
 *
 * A PENDING proposal has not executed, so a player being given up in it is
 * still rostered by the franchise giving him up. That makes roster ownership
 * an exact check here, and it is the check these tests assert.
 */

const CYRUS = '17518';       // WR, Bring The Pain (0008)
const CLAIBORNE = '17481';   // RB, Fire Ready Aim (0007)

const playerMap = new Map<string, { name: string; position: string; nflTeam: string }>([
  [CYRUS, { name: 'Cyrus Allen', position: 'WR', nflTeam: 'KC' }],
  [CLAIBORNE, { name: 'Demond Claiborne', position: 'RB', nflTeam: 'ARI' }],
]);

const teamMap = new Map<string, { name: string; nameShort: string; division?: string }>([
  ['0007', { name: 'Fire Ready Aim', nameShort: 'Fire', division: 'West' }],
  ['0008', { name: 'Bring The Pain', nameShort: 'Pain', division: 'East' }],
]);

/** Ground truth, as data/<league>/mfl-feeds/<year>/rosters.json states it. */
const rosterOwnerByPlayerId = new Map<string, string>([
  [CYRUS, '0008'],
  [CLAIBORNE, '0007'],
]);

/** Pain sends Cyrus Allen and a 2027 2nd; Fire sends Claiborne. */
const PAIN_SIDE = `${CYRUS},FP_0008_2027_2`;
const FIRE_SIDE = CLAIBORNE;

/**
 * Every shape the real offer 1078 could have arrived in. The `sides swapped`
 * row is the one that shipped; the others are the neighbouring failure modes
 * the same code path allows.
 */
const ROW_SHAPES: Record<string, Record<string, string>> = {
  'ids and sides consistent': {
    franchise: '0008', franchise2: '0007',
    franchise1_gave_up: PAIN_SIDE, franchise2_gave_up: FIRE_SIDE,
  },
  'ids right, sides swapped': {
    franchise: '0008', franchise2: '0007',
    franchise1_gave_up: FIRE_SIDE, franchise2_gave_up: PAIN_SIDE,
  },
  'originator unresolved': {
    franchise: '', franchise2: '0007',
    franchise1_gave_up: PAIN_SIDE, franchise2_gave_up: FIRE_SIDE,
  },
  'both ids the same franchise': {
    franchise: '0007', franchise2: '0007',
    franchise1_gave_up: FIRE_SIDE, franchise2_gave_up: PAIN_SIDE,
  },
};

/** exposureCount 2 → signal 3, the first signal that prints a player's name. */
function redact(row: Record<string, string>, opts: { rosters?: boolean } = {}) {
  return redactTradeOffer({
    rawOffer: { id: '1078', timestamp: '1788624000', ...row },
    offeringFid: row.franchise || '0008',
    playerMap,
    teamMap,
    counts: { ownerOfferCount7d: 1, divisionOfferCount7d: 0, playerHistory: new Map() },
    currentYear: 2026,
    exposureCount: 2,
    adpRankByPlayerId: new Map([[CYRUS, 40], [CLAIBORNE, 90]]),
    ...(opts.rosters === false ? {} : { rosterOwnerByPlayerId }),
  });
}

describe('a named player is one the named franchise actually rosters', () => {
  it.each(Object.keys(ROW_SHAPES))(
    'holds for a row shaped "%s"',
    (shape) => {
      const { tip } = redact(ROW_SHAPES[shape]);
      const exposure = tip?.exposure;
      if (!exposure?.team) return; // naming nobody is always a safe outcome

      const namedFid = exposure.fid as string;
      for (const player of exposure.players) {
        const playerId = player.name === 'Cyrus Allen' ? CYRUS : CLAIBORNE;
        expect(rosterOwnerByPlayerId.get(playerId)).toBe(namedFid);
      }
    },
  );

  it('never reprints the 2026-09-10 sentence: Fire beside Cyrus Allen', () => {
    for (const [shape, row] of Object.entries(ROW_SHAPES)) {
      const exposure = redact(row).tip?.exposure;
      if (!exposure?.team) continue;
      const namesFire = exposure.team.name === 'Fire Ready Aim';
      const namesCyrus = exposure.players.some((p: { name: string }) => p.name === 'Cyrus Allen');
      expect(namesFire && namesCyrus, `row shape: ${shape}`).toBe(false);
    }
  });

  it('repairs the swapped row rather than dropping the post', () => {
    // The whole deal is recoverable: the rosters say which side is whose, so
    // the post still ships — with the right player and the right direction.
    const { tip } = redact(ROW_SHAPES['ids right, sides swapped']);
    expect(tip!.exposure!.team.name).toBe('Fire Ready Aim');
    expect(tip!.exposure!.players.map((p: { name: string }) => p.name)).toEqual(['Demond Claiborne']);

    const dealShape = tip!.beats!.find((b: { kind: string }) => b.kind === 'deal_shape') as any;
    expect(dealShape.sends.positions).toEqual(['RB']);      // Fire sends Claiborne
    expect(dealShape.gets.positions).toEqual(['WR']);       // and gets Cyrus Allen
    expect(dealShape.gets.picks).toEqual(['2027 2nd']);
  });
});

describe('attributeSides', () => {
  const side = (...ids: string[]) => ids.map((id) => ({
    kind: 'player' as const, playerId: id, name: playerMap.get(id)!.name, position: playerMap.get(id)!.position,
  }));

  it('takes a well-formed row at its word', () => {
    const out = attributeSides({
      fid1: '0008', fid2: '0007', side1: side(CYRUS), side2: side(CLAIBORNE), rosterOwnerByPlayerId,
    });
    expect(out.attributable).toBe(true);
    expect(out.corrected).toBe(false);
    expect(out.verified).toBe(true);
  });

  it('corrects an inverted row', () => {
    const out = attributeSides({
      fid1: '0008', fid2: '0007', side1: side(CLAIBORNE), side2: side(CYRUS), rosterOwnerByPlayerId,
    });
    expect(out.corrected).toBe(true);
    expect(out.sidesByFid['0008'].map((a: { playerId: string }) => a.playerId)).toEqual([CYRUS]);
    expect(out.sidesByFid['0007'].map((a: { playerId: string }) => a.playerId)).toEqual([CLAIBORNE]);
  });

  it('never lets one franchise key both sides', () => {
    // An object literal with two identical computed keys silently drops one
    // side on top of the other, handing BOTH teams' players to one franchise.
    const out = attributeSides({
      fid1: '0007', fid2: '0007', side1: side(CLAIBORNE), side2: side(CYRUS), rosterOwnerByPlayerId,
    });
    expect(Object.keys(out.sidesByFid).sort()).toEqual(['0007', '0008']);
  });

  it('supplies a missing id from the rosters', () => {
    const out = attributeSides({
      fid1: '', fid2: '0007', side1: side(CYRUS), side2: side(CLAIBORNE), rosterOwnerByPlayerId,
    });
    expect(out.attributable).toBe(true);
    expect(out.fids).toEqual(['0008', '0007']);
  });

  it('refuses when a missing id cannot be inferred', () => {
    // Picks-only side: nothing to look up, so nothing to stand on.
    const out = attributeSides({
      fid1: '', fid2: '0007', side1: [{ kind: 'pick', label: '2027 2nd' }], side2: side(CLAIBORNE), rosterOwnerByPlayerId,
    });
    expect(out.attributable).toBe(false);
    expect(out.sidesByFid).toEqual({});
  });

  it('refuses when the rosters contradict both orientations', () => {
    // Both sides claim players of the same franchise — not a trade either way.
    const out = attributeSides({
      fid1: '0008', fid2: '0007', side1: side(CYRUS), side2: side(CYRUS), rosterOwnerByPlayerId,
    });
    expect(out.attributable).toBe(false);
  });

  it('falls back to the row when there is no roster evidence at all', () => {
    // A missing rosters feed must degrade the check, never silence the lane.
    const out = attributeSides({
      fid1: '0008', fid2: '0007', side1: side(CYRUS), side2: side(CLAIBORNE), rosterOwnerByPlayerId: new Map(),
    });
    expect(out.attributable).toBe(true);
    expect(out.verified).toBe(false);
    expect(out.sidesByFid['0008'].map((a: { playerId: string }) => a.playerId)).toEqual([CYRUS]);
  });

  it('still names a team when the rosters are unavailable', () => {
    const exposure = redact(ROW_SHAPES['ids and sides consistent'], { rosters: false }).tip?.exposure;
    expect(exposure?.team.name).toBeTruthy();
  });
});
