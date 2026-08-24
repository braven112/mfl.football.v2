/**
 * Guard tests for the accounting gate and registry wiring.
 *
 * Every /api/accounting route reads or writes the WHOLE league's books. The
 * gate is the only thing between an owner and every other owner's balances,
 * and between a commissioner of one league and another league's money.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LEAGUES, getLeaguePayouts, leagueHasFeature } from '../src/config/leagues';

const asUser = (over: Record<string, unknown> = {}) => ({
  id: 'mfl-cookie',
  name: 'Commish',
  franchiseId: '0001',
  leagueId: LEAGUES['theleague'].id,
  role: 'commissioner' as const,
  ...over,
});

async function loadContext(user: unknown, cookies: Record<string, string | null>) {
  vi.resetModules();
  vi.doMock('../src/utils/auth', async () => {
    const actual = await vi.importActual<any>('../src/utils/auth');
    return { ...actual, getAuthUser: () => user };
  });
  vi.doMock('../src/utils/session', async () => {
    const actual = await vi.importActual<any>('../src/utils/session');
    return {
      ...actual,
      getMFLCookiesFromRequest: () => ({
        mflUserId: cookies.mflUserId ?? null,
        mflIsCommish: cookies.mflIsCommish ?? null,
      }),
    };
  });
  return import('../src/utils/accounting-request');
}

const call = async (
  mod: any,
  search: string
): Promise<any> =>
  mod.resolveAccountingContext({
    request: new Request('https://www.theleague.us/api/accounting/records'),
    url: new URL(`https://www.theleague.us/api/accounting/records?${search}`),
  });

describe('resolveAccountingContext', () => {
  beforeEach(() => vi.resetModules());

  it('401s an anonymous request', async () => {
    const mod = await loadContext(null, { mflUserId: 'c' });
    const result = await call(mod, 'league=theleague');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('403s a plain owner — these routes expose the whole league', async () => {
    const mod = await loadContext(asUser({ role: 'owner', franchiseId: '0009' }), {
      mflUserId: 'c',
    });
    const result = await call(mod, 'league=theleague');
    expect((result as Response).status).toBe(403);
  });

  it("403s a commissioner reaching into ANOTHER league's books", async () => {
    // The `league` param is a check against the session, never an input on
    // its own — the same rule the rankings scope enforces.
    const mod = await loadContext(asUser(), { mflUserId: 'c' });
    const result = await call(mod, 'league=afl-fantasy');
    expect((result as Response).status).toBe(403);
  });

  it('400s a league without accounting enabled', async () => {
    const mod = await loadContext(asUser({ leagueId: LEAGUES['best-ball-1'].id }), {
      mflUserId: 'c',
    });
    const result = await call(mod, 'league=best-ball-1');
    expect((result as Response).status).toBe(400);
  });

  it('401s when the session carries no MFL cookie to act with', async () => {
    const mod = await loadContext(asUser(), { mflUserId: null });
    const result = await call(mod, 'league=theleague');
    expect((result as Response).status).toBe(401);
  });

  it('resolves a commissioner of the right league', async () => {
    const mod = await loadContext(asUser(), { mflUserId: 'cookie', mflIsCommish: 'yes' });
    const result = await call(mod, 'league=theleague');
    expect(result).not.toBeInstanceOf(Response);
    expect(result.league.slug).toBe('theleague');
    expect(result.mflCommishCookie).toBe('yes');
  });

  it('keeps the ledger year and the payout season as separate clocks', async () => {
    // Settling the 2025 season in the 2026 league year is the normal case;
    // collapsing them pays the wrong season out of the wrong year's books.
    const mod = await loadContext(asUser(), { mflUserId: 'cookie' });
    const result = await call(mod, 'league=theleague&year=2026&season=2025');
    expect(result.year).toBe(2026);
    expect(result.season).toBe(2025);
  });

  it('ignores a nonsense year rather than trusting it', async () => {
    const mod = await loadContext(asUser(), { mflUserId: 'cookie' });
    const result = await call(mod, 'league=theleague&year=abc');
    expect(Number.isInteger(result.year)).toBe(true);
    expect(result.year).toBeGreaterThan(2000);
  });
});

describe('registry wiring', () => {
  it('enables accounting only where the league settles money on MFL', () => {
    expect(leagueHasFeature('theleague', 'accounting')).toBe(true);
    expect(leagueHasFeature('afl-fantasy', 'accounting')).toBe(true);
    // Draft-only: turning this on would be bb1's first MFL write.
    expect(leagueHasFeature('best-ball-1', 'accounting')).toBe(false);
  });

  it('gives every accounting league a prize table with stable keys', () => {
    for (const slug of ['theleague', 'afl-fantasy'] as const) {
      const payouts = getLeaguePayouts(slug);
      expect(payouts, slug).toBeTruthy();
      const keys = payouts!.prizes.map((prize) => prize.key);
      // Keys are the ledger's idempotency handle — a duplicate would make two
      // prizes indistinguishable in a plan.
      expect(new Set(keys).size, slug).toBe(keys.length);
      for (const prize of payouts!.prizes) {
        expect(prize.amount, `${slug}/${prize.key}`).toBeGreaterThan(0);
        expect(prize.label.length, `${slug}/${prize.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("matches TheLeague's prize table to the constitution", () => {
    const prizes = Object.fromEntries(
      getLeaguePayouts('theleague')!.prizes.map((prize) => [prize.key, prize.amount])
    );
    expect(prizes).toMatchObject({
      champion: 300,
      second: 150,
      third: 100,
      fourth: 50,
      fifth: 45,
      sixth: 25,
      'weekly-high': 3,
    });
  });

  it("matches the AFL's prize table to the constitution", () => {
    const prizes = Object.fromEntries(
      getLeaguePayouts('afl-fantasy')!.prizes.map((prize) => [prize.key, prize.amount])
    );
    expect(prizes).toMatchObject({
      'afl-championship': 300,
      'al-champion': 150,
      'nl-champion': 150,
      'division-title': 150,
      'wild-card': 100,
      'premier-league': 225,
      'dleague-champion': 50,
      nit: 50,
    });
  });
});
