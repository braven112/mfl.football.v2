import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyLiveRosters, type FaSnapshot } from '../src/utils/afl-free-agents-live';
import { buildConferenceStructure } from '../src/utils/afl-conference-rosters.mjs';

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
      rostersPayload({ '0001': ['p1'], '0002': [], '0013': ['p1', 'p2'], '0014': [] }),
    );
    expect(view.freeAgentsCount).toBe(2);
    expect(view.faCounts).toEqual({ ALL: 2, RB: 1, WR: 1 });
    // Players stay in default-sort order, so the newly-freed RB (higher
    // projection) takes the spotlight over the WR.
    expect(view.topFa?.id).toBe('p2');
  });

  it('does not mutate the snapshot (shared JSON module across SSR requests)', () => {
    const snapshot = makeSnapshot();
    applyLiveRosters(
      snapshot,
      rostersPayload({ '0001': [], '0002': [], '0013': ['p1'], '0014': [] }),
    );
    expect(snapshot.players.find((p) => p.id === 'p1')?.rostered).toBe(true);
    expect(snapshot.faCounts).toEqual({ ALL: 1, WR: 1 });
  });

  it('memoizes the view for identical snapshot + payload inputs (cached rosters object)', () => {
    const snapshot = makeSnapshot();
    const payload = rostersPayload({ '0001': ['p1'], '0002': [], '0013': ['p1'], '0014': [] });
    const first = applyLiveRosters(snapshot, payload);
    expect(applyLiveRosters(snapshot, payload)).toBe(first);
    // Different payload object → recompute.
    expect(
      applyLiveRosters(
        snapshot,
        rostersPayload({ '0001': ['p1'], '0002': [], '0013': ['p1'], '0014': [] }),
      ),
    ).not.toBe(first);
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
    const view = applyLiveRosters(
      snapshot,
      rostersPayload({ '0001': [], '0002': [], '0013': [], '0014': [] }),
    );
    expect(view.players).toBe(snapshot.players);
  });

  it('falls back when a franchise is missing from the conference map', () => {
    const snapshot = makeSnapshot();
    const view = applyLiveRosters(
      snapshot,
      rostersPayload({ '0099': ['p1'], '0002': [], '0013': ['p2'], '0014': [] }),
    );
    expect(view.players).toBe(snapshot.players);
  });

  it('falls back when the payload carries fewer franchises than the conference map (partial payload)', () => {
    // A truncated rosters export would otherwise wrongly free every player
    // held only by the omitted franchises.
    const snapshot = makeSnapshot();
    const view = applyLiveRosters(snapshot, rostersPayload({ '0001': ['p1'], '0013': ['p1', 'p2'] }));
    expect(view.players).toBe(snapshot.players);
    expect(view.freeAgentsCount).toBe(1);
  });

  it('single-pool mode still rejects a partial payload via the baked franchise count', () => {
    const snapshot = makeSnapshot({ conferences: null, rosterFranchiseCount: 4 });
    const view = applyLiveRosters(snapshot, rostersPayload({ '0001': ['p1'], '0013': ['p2'] }));
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

describe('buildConferenceStructure', () => {
  it('disambiguates colliding conference abbrevs with the conference id', () => {
    // "National League" and "North League" both initial to "NL" — identical
    // tags would tell owners in BOTH conferences the player is addable.
    const structure = buildConferenceStructure({
      league: {
        conferences: {
          conference: [
            { id: '00', name: 'National League' },
            { id: '01', name: 'North League' },
          ],
        },
        divisions: { division: [{ id: '00', conference: '00' }, { id: '01', conference: '01' }] },
        franchises: { franchise: [{ id: '0001', division: '00' }, { id: '0002', division: '01' }] },
      },
    })!;
    expect(structure.names['00'].abbrev).toBe('NL00');
    expect(structure.names['01'].abbrev).toBe('NL01');
  });
});

describe('fetchLiveAflRosters', () => {
  const okPayload = { rosters: { franchise: [{ id: '0001', player: { id: 'p1' } }] } };
  let fetchMock: ReturnType<typeof vi.fn>;

  // Module-level cache state persists across imports, so each test gets a
  // fresh module instance.
  async function freshFetch() {
    vi.resetModules();
    const mod = await import('../src/utils/afl-free-agents-live');
    return mod.fetchLiveAflRosters;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches once, serves the cached payload inside the 60s TTL, refetches after', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => okPayload });
    expect(await fetchLive(2026)).toEqual(okPayload);
    expect(await fetchLive(2026)).toEqual(okPayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await fetchLive(2026);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by year — a different year inside the TTL refetches', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => okPayload });
    await fetchLive(2026);
    await fetchLive(2027);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/2026/');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/2027/');
  });

  it('caches a failure for only 20s, then retries', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await fetchLive(2026)).toBeNull();
    expect(await fetchLive(2026)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(21_000);
    fetchMock.mockResolvedValue({ ok: true, json: async () => okPayload });
    expect(await fetchLive(2026)).toEqual(okPayload);
  });

  it('serves the last-known-good payload when a refetch fails (no flap back to baked flags)', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => okPayload });
    expect(await fetchLive(2026)).toEqual(okPayload);
    vi.advanceTimersByTime(61_000);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    // Refetch fails → still the stale-good payload, cached on the error TTL.
    expect(await fetchLive(2026)).toEqual(okPayload);
    expect(await fetchLive(2026)).toEqual(okPayload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last-known-good payload across CONSECUTIVE failures (outage longer than the error TTL)', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => okPayload });
    expect(await fetchLive(2026)).toEqual(okPayload);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    vi.advanceTimersByTime(61_000);
    expect(await fetchLive(2026)).toEqual(okPayload);
    vi.advanceTimersByTime(21_000); // past the error TTL → second failed refetch
    expect(await fetchLive(2026)).toEqual(okPayload);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not let a zero-rostered (shape-valid junk) payload evict the last-known-good one', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => okPayload });
    expect(await fetchLive(2026)).toEqual(okPayload);
    vi.advanceTimersByTime(61_000);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rosters: { franchise: [{ id: '0001' }, { id: '0002' }] } }),
    });
    expect(await fetchLive(2026)).toEqual(okPayload);
  });

  it('rejects a partial payload at the cache layer when snapshot validation is supplied', async () => {
    const fetchLive = await freshFetch();
    const validation = {
      conferences: makeSnapshot().conferences,
      rosterFranchiseCount: 4,
    };
    const fullPayload = {
      rosters: {
        franchise: [
          { id: '0001', player: { id: 'p1' } },
          { id: '0002', player: { id: 'p2' } },
          { id: '0013', player: { id: 'p1' } },
          { id: '0014', player: { id: 'p3' } },
        ],
      },
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => fullPayload });
    expect(await fetchLive(2026, validation)).toEqual(fullPayload);
    vi.advanceTimersByTime(61_000);
    // Truncated refetch fails validation → last-good payload survives.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rosters: { franchise: [{ id: '0001', player: { id: 'p1' } }] } }),
    });
    expect(await fetchLive(2026, validation)).toEqual(fullPayload);
  });

  it('treats a 200 with an {error} body (bad league/year) as a failure', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: 'unknown league' }) });
    expect(await fetchLive(2026)).toBeNull();
  });

  it('returns null when the fetch itself rejects (timeout / network)', async () => {
    const fetchLive = await freshFetch();
    fetchMock.mockRejectedValue(new Error('aborted'));
    expect(await fetchLive(2026)).toBeNull();
  });

  it('dedupes concurrent cold-cache calls into one in-flight fetch', async () => {
    const fetchLive = await freshFetch();
    let release!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const [a, b] = [fetchLive(2026), fetchLive(2026)];
    release({ ok: true, json: async () => okPayload });
    expect(await a).toEqual(okPayload);
    expect(await b).toEqual(okPayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
