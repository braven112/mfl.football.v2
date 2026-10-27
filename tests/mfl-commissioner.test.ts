import { describe, expect, it, vi } from 'vitest';

/**
 * Who is a league's commissioner, for any MFL league the app serves
 * (src/utils/live/mfl-commissioner.ts). MFL widens `TYPE=league` for the
 * commissioner's own cookie; a plain owner gets a few owner-only fields; an
 * anonymous read gets neither, and must never read as "not the commissioner".
 */

const fetched: string[] = [];
let reply: { ok: boolean; body: unknown } = { ok: true, body: null };
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: async ({ url, mflUserCookie }: { url: string; mflUserCookie: string }) => {
    fetched.push(`${url} ${mflUserCookie}`);
    return { ok: reply.ok, json: async () => reply.body };
  },
}));

const { checkCommissioner, commissionerFromLeague } = await import('../src/utils/live/mfl-commissioner');

const anonymous = { league: { id: '55555', franchises: { franchise: [{ id: '0001', name: 'A' }, { id: '0002', name: 'B' }] } } };
const owner = {
  league: { id: '55555', franchises: { franchise: [{ id: '0001', name: 'A', username: 'me', mail_event: '1' }, { id: '0002', name: 'B' }] } },
};
const commissioner = {
  league: {
    id: '55555',
    commish_username: 'boss',
    franchises: { franchise: [{ id: '0001', name: 'A', lastVisit: '1761600000', email: 'a@example.com' }] },
  },
};

describe('commissionerFromLeague', () => {
  it('reads the commissioner-only fields as the commissioner', () => {
    expect(commissionerFromLeague(commissioner)).toBe('commissioner');
    expect(commissionerFromLeague({ league: { franchises: { franchise: { id: '0001', lastVisit: 1 } } } })).toBe('commissioner');
  });

  it('a signed-in owner without them is not the commissioner', () => {
    expect(commissionerFromLeague(owner)).toBe('not-commissioner');
  });

  it('an anonymous or broken read is unknown, never "no"', () => {
    expect(commissionerFromLeague(anonymous)).toBe('unknown');
    expect(commissionerFromLeague(null)).toBe('unknown');
    expect(commissionerFromLeague({ error: 'x' })).toBe('unknown');
  });
});

describe('checkCommissioner', () => {
  const league = { leagueId: '55555', leagueName: 'X', franchiseId: '0001', franchiseName: 'A', year: 2026, host: 'https://www44.myfantasyleague.com' };

  it("asks the league's own host with the owner's own cookie", async () => {
    reply = { ok: true, body: commissioner };
    expect(await checkCommissioner(league, 'owner-cookie')).toBe('commissioner');
    expect(fetched.at(-1)).toMatch(/^https:\/\/www44\.myfantasyleague\.com\/2026\/export\?TYPE=league&L=55555.* owner-cookie$/);
  });

  it('fails closed on an MFL error or no cookie', async () => {
    reply = { ok: false, body: null };
    expect(await checkCommissioner(league, 'owner-cookie')).toBe('unknown');
    reply = { ok: true, body: { error: { $t: 'API requires a logged in user' } } };
    expect(await checkCommissioner(league, 'owner-cookie')).toBe('unknown');
    expect(await checkCommissioner(league, '')).toBe('unknown');
  });
});
