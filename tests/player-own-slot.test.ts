/**
 * The player modal's "Your player" chip (after Yahoo's "In your RB slot").
 *
 * The owner strip names the franchise from the PAGE's payload; the chip turns
 * it into "Your player" only when that franchise is the viewer's own. In the
 * AFL the same NFL player is rostered once per conference, so "he is on my
 * roster somewhere" is not enough — the strip may be naming the other
 * conference's owner, and calling that copy "your player" contradicts it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ownSlotFor', () => {
  const dataset: Record<string, string | undefined> = { league: 'theleague' };
  let client: typeof import('../src/utils/player-claim-client');

  const load = async (over: Record<string, unknown> = {}) => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        signedIn: true,
        canClaim: true,
        verb: 'Bid',
        system: 'bbid',
        franchiseId: '0001',
        rules: {},
        roster: [
          { id: '100', name: 'Starter', slot: 'active' },
          { id: '101', name: 'Hurt', slot: 'ir' },
          { id: '102', name: 'Rookie', slot: 'taxi' },
        ],
        year: 2026,
        windowMode: 'open',
        windowLabel: '',
        rosteredIds: ['100', '101', '102', '200'],
        tradeTargets: { '200': '0007' },
        franchiseNames: { '0007': 'Rival' },
        ...over,
      }),
    });
    await client.loadClaimContext();
  };

  beforeEach(async () => {
    vi.resetModules();
    (globalThis as any).document = { documentElement: { dataset } };
    (globalThis as any).window = {};
    client = await import('../src/utils/player-claim-client');
  });

  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    delete (globalThis as any).fetch;
  });

  it("names the bucket of the viewer's own player", async () => {
    await load();
    expect(client.ownSlotFor('100', '0001')).toBe('active');
    expect(client.ownSlotFor('101', '0001')).toBe('ir');
    expect(client.ownSlotFor('102', '0001')).toBe('taxi');
  });

  it("says nothing for a rival's player or a free agent", async () => {
    await load();
    expect(client.ownSlotFor('200', '0007')).toBeNull();
    expect(client.ownSlotFor('300', null)).toBeNull();
  });

  it('says nothing when the strip names a different franchise than the viewer', async () => {
    // AFL: he is on my AL roster, but this page shows his NL owner.
    await load();
    expect(client.ownSlotFor('100', '0013')).toBeNull();
  });

  it('says nothing signed out or before the context lands', async () => {
    expect(client.ownSlotFor('100', '0001')).toBeNull();
    await load({ signedIn: false, franchiseId: null, roster: [] });
    expect(client.ownSlotFor('100', '0001')).toBeNull();
  });
});
