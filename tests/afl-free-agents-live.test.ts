import { describe, it, expect } from 'vitest';
import { applyLiveRosters, type FaSnapshot } from '../src/utils/afl-free-agents-live';

// The AFL is a duplicate-player conference league: the same NFL player can be
// rostered once per conference, so a drop in one conference makes the player
// a free agent THERE even while the other conference still holds him. These
// tests lock in the per-conference rostered math and the fallback-to-snapshot
// behavior for bad/missing live payloads. The regression that motivated this:
// Kyle Pitts, dropped in the American League but still held in the National
// League, vanished from the free agent page entirely (Aug 2026).

function makeSnapshot(overrides: Partial<FaSnapshot> = {}): FaSnapshot {
  return {
    generatedForYear: 2026,
    conferences: {
      ids: ['00', '01'],
      names: {
        '00': { name: 'American League', abbrev: 'AL' },
        '01': { name: 'National League', abbrev: 'NL' },
      },
      franchiseConferences: { '0001': '00', '0002': '00', '0013': '01', '0014': '01' },
    },
    faCounts: { ALL: 1, WR: 1 },
    topFa: { id: 'p3', name: 'Free Agent', position: 'WR', team: 'DAL', espnId: null, projected: 5 },
    players: [
      // Sorted by default sort (projected desc), matching the compute script.
      { id: 'p1', name: 'Both Confs', position: 'QB', team: 'KC', espnId: null, projected: 20, rostered: true, confs: ['00', '01'] },
      { id: 'p2', name: 'AL Only', position: 'RB', team: 'SF', espnId: null, projected: 10, rostered: true, confs: ['00', '01'] },
      { id: 'p3', name: 'Free Agent', position: 'WR', team: 'DAL', espnId: null, projected: 5, rostered: false, confs: [] },
    ],
    ...overrides,
  };
}

function rostersPayload(byFranchise: Record<string, string[]>) {
  return {
    rosters: {
      franchise: Object.entries(byFranchise).map(([id, playerIds]) => ({
        id,
        player: playerIds.map((pid) => ({ id: pid })),
      })),
    },
  };
}

describe('applyLiveRosters', () => {
  it('marks a player dropped in one conference as available with the holding conference listed', () => {
    const snapshot = makeSnapshot();
    // p1 held in both conferences; p2 dropped by the AL (0001/0002) but still
    // held by an NL team; p3 unrostered everywhere.
    const view = applyLiveRosters(
      snapshot,
      rostersPayload({ '0001': ['p1'], '0002': [], '0013': ['p1', 'p2'], '0014': [] }),
    );

    const p1 = view.players.find((p) => p.id === 'p1')!;
    const p2 = view.players.find((p) => p.id === 'p2')!;
    const p3 = view.players.find((p) => p.id === 'p3')!;
    expect(p1.rostered).toBe(true);
    expect(p1.confs).toEqual(['00', '01']);
    expect(p2.rostered).toBe(false);
    expect(p2.confs).toEqual(['01']);
    expect(p3.rostered).toBe(false);
    expect(p3.confs).toEqual([]);
  });

  it('recomputes FA counts and the hero spotlight from the live flags', () => {
    const view = applyLiveRosters(
      makeSnapshot(),
      rostersPayload({ '0001': ['p1'], '0013': ['p1', 'p2'] }),
    );
    expect(view.freeAgentsCount).toBe(2);
    expect(view.faCounts).toEqual({ ALL: 2, RB: 1, WR: 1 });
    // Players stay in default-sort order, so the newly-freed RB (higher
    // projection) takes the spotlight over the WR.
    expect(view.topFa?.id).toBe('p2');
  });

  it('does not mutate the snapshot (shared JSON module across SSR requests)', () => {
    const snapshot = makeSnapshot();
    applyLiveRosters(snapshot, rostersPayload({ '0001': [], '0013': ['p1'] }));
    expect(snapshot.players.find((p) => p.id === 'p1')?.rostered).toBe(true);
    expect(snapshot.faCounts).toEqual({ ALL: 1, WR: 1 });
  });

  it('falls back to the baked snapshot view for a missing or malformed payload', () => {
    const snapshot = makeSnapshot();
    for (const bad of [null, undefined, {}, { rosters: {} }, 'nonsense']) {
      const view = applyLiveRosters(snapshot, bad);
      expect(view.players).toBe(snapshot.players);
      expect(view.faCounts).toBe(snapshot.faCounts);
      expect(view.topFa).toBe(snapshot.topFa);
      expect(view.freeAgentsCount).toBe(1);
    }
  });

  it('falls back when the payload rosters zero players (likely MFL hiccup)', () => {
    const snapshot = makeSnapshot();
    const view = applyLiveRosters(snapshot, rostersPayload({ '0001': [], '0013': [] }));
    expect(view.players).toBe(snapshot.players);
  });

  it('falls back when a franchise is missing from the conference map', () => {
    const snapshot = makeSnapshot();
    const view = applyLiveRosters(snapshot, rostersPayload({ '0099': ['p1'], '0013': ['p2'] }));
    expect(view.players).toBe(snapshot.players);
  });

  it('treats every roster as one pool when the league has no conference structure', () => {
    const snapshot = makeSnapshot({ conferences: null });
    const view = applyLiveRosters(snapshot, rostersPayload({ '0001': ['p1'], '0013': ['p2'] }));
    const p1 = view.players.find((p) => p.id === 'p1')!;
    const p3 = view.players.find((p) => p.id === 'p3')!;
    expect(p1.rostered).toBe(true);
    expect(p3.rostered).toBe(false);
    expect(view.freeAgentsCount).toBe(1);
  });

  it('handles the single-franchise non-array MFL shape', () => {
    const snapshot = makeSnapshot({ conferences: null });
    const view = applyLiveRosters(snapshot, {
      rosters: { franchise: { id: '0001', player: { id: 'p1' } } },
    });
    expect(view.players.find((p) => p.id === 'p1')?.rostered).toBe(true);
    expect(view.freeAgentsCount).toBe(2);
  });
});
