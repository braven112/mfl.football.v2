/**
 * The owner-presence chip both roster pages render
 * (src/utils/rosters/owner-presence.ts).
 *
 * Extracted in Phase 7 from twelve identical lines carried by BOTH roster
 * pages — so this is also a piece of Phase 9, the shared roster core.
 *
 * The three properties pinned here are the ones a rewrite loses, and each is
 * a real failure rather than a style preference: a slow Redis must not take
 * the roster down with it, "no timestamp" must not render as a claim about
 * the owner, and the read must be league-scoped because both leagues have a
 * franchise 0001.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getAllActivity = vi.fn();
vi.mock('../src/utils/owner-activity', () => ({
  getAllActivity: (...args: unknown[]) => getAllActivity(...args),
  getActivityLevel: (at: number) =>
    Date.now() - at < 86_400_000 ? 'active' : 'dormant',
  formatLastSeen: (at: number) => `seen@${at}`,
}));

const { resolveOwnerPresence, OWNER_PRESENCE_TIMEOUT_MS } = await import(
  '../src/utils/rosters/owner-presence'
);

beforeEach(() => {
  getAllActivity.mockReset();
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

describe('resolveOwnerPresence', () => {
  it('answers per franchise from the league’s own activity map', async () => {
    const now = Date.now();
    getAllActivity.mockResolvedValue({ '0001': now, '0007': 0 });

    const seen = await resolveOwnerPresence('13522');

    expect(seen('0001')).toEqual({ level: 'active', text: `seen@${now}` });
    // A zero stamp is falsy and means "nothing recorded" — not "seen at the
    // epoch", which would print a chip claiming 1970.
    expect(seen('0007')).toBeNull();
    expect(seen('9999')).toBeNull();
  });

  it('reads the league it was asked for — both leagues have a franchise 0001', async () => {
    getAllActivity.mockResolvedValue({});
    await resolveOwnerPresence('19621');
    expect(getAllActivity).toHaveBeenCalledWith('19621');
  });

  it('renders no chip rather than failing the page when Redis is down', async () => {
    getAllActivity.mockRejectedValue(new Error('ECONNREFUSED'));

    // Resolves — it does not reject. The roster is the page's job; this chip
    // is decoration and must never be what stops it rendering.
    const seen = await resolveOwnerPresence('13522');
    expect(seen('0001')).toBeNull();
  });

  it('gives up on a slow Redis instead of holding the render open', async () => {
    vi.useFakeTimers();
    // A read that never settles: without the race this hangs the page.
    getAllActivity.mockReturnValue(new Promise(() => {}));

    const pending = resolveOwnerPresence('13522', 50);
    await vi.advanceTimersByTimeAsync(51);
    const seen = await pending;

    expect(seen('0001')).toBeNull();
    expect(OWNER_PRESENCE_TIMEOUT_MS).toBe(3000);
  });
});
