/**
 * Package M: trades in the MFL Football app, for any MFL league.
 *
 * What these pin:
 *  - MFL answers an import error as HTTP 200, so the body decides
 *    (docs/claude/rules/lineups.md).
 *  - A proposal may only offer the proposer's own players, and the team is
 *    the one `requireOwnerLeague` resolved, never one from the body.
 *  - Every MFL call carries the owner's cookie (`user.id`) and nothing else.
 *  - A counter sends the new offer BEFORE rejecting the original, and says
 *    so when the original is still open.
 *  - Offers read from the owner's side: `will_give_up` is what YOU give.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ url: string; method: string; cookie: string; body?: string }> = [];
let replies: Array<(url: string, body?: string) => Response | undefined> = [];

vi.mock('../src/utils/mfl-fetch', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    mflFetch: vi.fn(async (opts: any) => {
      calls.push({ url: opts.url, method: opts.method, cookie: opts.mflUserCookie, body: opts.body });
      for (const r of replies) {
        const res = r(opts.url, opts.body);
        if (res) return res;
      }
      return new Response('{}', { status: 200 });
    }),
  };
});

const LEAGUE = {
  leagueId: '55555',
  leagueName: 'Stranger League',
  franchiseId: '0002',
  franchiseName: 'My Team',
  year: 2026,
  host: 'https://www44.myfantasyleague.com',
};
vi.mock('../src/utils/live/owner-league', () => ({
  requireOwnerLeague: vi.fn(async () => ({ user: { id: 'OWNER-COOKIE', leagueId: '55555' }, league: LEAGUE })),
  appJson: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
}));
vi.mock('../src/utils/owner-trade-reports', () => ({ reportOwnerTrades: vi.fn(async () => {}) }));
vi.mock('../src/utils/app-badge-cache', () => ({ invalidateAppBadge: vi.fn(async () => {}) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const text = (body: string) => new Response(body, { status: 200 });

const ROSTERS = {
  rosters: {
    franchise: [
      { id: '0002', player: [{ id: '1001' }, { id: '1002' }] },
      { id: '0004', player: { id: '2001' } },
    ],
  },
};
const LEAGUE_EXPORT = {
  league: { franchises: { franchise: [{ id: '0002', name: 'My Team' }, { id: '0004', name: 'Their Team' }] } },
};

const on = (match: RegExp, res: () => Response) => (url: string, body?: string) =>
  match.test(url + ' ' + (body ?? '')) ? res() : undefined;

beforeEach(() => {
  calls.length = 0;
  replies = [];
});

async function post(path: string, body: unknown) {
  const mod = await import(`../src/pages/api/mfl-live/${path}.ts`);
  const url = new URL(`https://mfl.football/api/mfl-live/${path}?league=55555`);
  const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
  const res: Response = await mod.POST({ request, url } as any);
  return { status: res.status, body: await res.json() };
}

describe('readMflImportReply', () => {
  it('treats an error body on HTTP 200 as a rejection', async () => {
    const { readMflImportReply } = await import('../src/utils/mfl-trade-ops');
    const r = readMflImportReply(200, true, '<error>Roster limit exceeded</error>', { rejected: 'x', success: 'y' });
    expect(r).toEqual({ ok: false, status: 400, message: 'Roster limit exceeded' });
  });
  it('treats a login page on HTTP 200 as not processed', async () => {
    const { readMflImportReply } = await import('../src/utils/mfl-trade-ops');
    const r = readMflImportReply(200, true, '<!DOCTYPE html><html>', { rejected: 'x', success: 'y' });
    expect(r.ok).toBe(false);
  });
  it('passes a clean reply', async () => {
    const { readMflImportReply } = await import('../src/utils/mfl-trade-ops');
    expect(readMflImportReply(200, true, '<status>OK</status>', { rejected: 'x', success: 'y' })).toEqual({ ok: true, message: 'y' });
  });
});

describe('POST /api/mfl-live/trades', () => {
  it('proposes as the resolved team with the owner cookie only', async () => {
    replies = [on(/TYPE=rosters/, () => json(ROSTERS)), on(/tradeProposal/, () => text('<status>OK</status>'))];
    const res = await post('trades', { offeredTo: '0004', give: ['1001', 'FP_0002_2027_1'], get: ['2001'], franchiseId: '0004' });
    expect(res).toEqual({ status: 200, body: { success: true, message: 'Trade proposal submitted' } });
    const imp = calls.find((c) => c.method === 'POST')!;
    const params = new URLSearchParams(imp.body);
    expect(params.get('L')).toBe('55555');
    expect(params.get('OFFEREDTO')).toBe('0004');
    expect(params.get('WILL_GIVE_UP')).toBe('1001,FP_0002_2027_1');
    expect(params.get('WILL_RECEIVE')).toBe('2001');
    expect(calls.every((c) => c.cookie === 'OWNER-COOKIE')).toBe(true);
    // Roster read on the league's own host.
    expect(calls.find((c) => /TYPE=rosters/.test(c.url))!.url).toContain('www44.myfantasyleague.com/2026/export');
  });

  it('refuses to offer a player who is not on your roster, without calling the import', async () => {
    replies = [on(/TYPE=rosters/, () => json(ROSTERS))];
    const res = await post('trades', { offeredTo: '0004', give: ['2001'], get: [] });
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('reports MFL rejecting the trade even though MFL answered 200', async () => {
    replies = [on(/TYPE=rosters/, () => json(ROSTERS)), on(/tradeProposal/, () => text('<error>Trades are locked</error>'))];
    const res = await post('trades', { offeredTo: '0004', give: ['1001'], get: ['2001'] });
    expect(res).toEqual({ status: 400, body: { success: false, message: 'Trades are locked' } });
  });

  it('counters by sending the new offer first, then rejecting the original', async () => {
    replies = [
      on(/TYPE=rosters/, () => json(ROSTERS)),
      on(/tradeProposal/, () => text('<status>OK</status>')),
      on(/tradeResponse/, () => text('<status>OK</status>')),
    ];
    const res = await post('trades', { offeredTo: '0004', give: ['1002'], get: ['2001'], counterOfTradeId: '77' });
    expect(res.body).toEqual({ success: true, message: 'Counter sent' });
    const writes = calls.filter((c) => c.method === 'POST').map((c) => new URLSearchParams(c.body));
    expect(writes.map((p) => p.get('TYPE'))).toEqual(['tradeProposal', 'tradeResponse']);
    expect(writes[1].get('TRADE_ID')).toBe('77');
    expect(writes[1].get('RESPONSE')).toBe('reject');
  });

  it('never rejects the original when the counter bounces', async () => {
    replies = [on(/TYPE=rosters/, () => json(ROSTERS)), on(/tradeProposal/, () => text('<error>No</error>'))];
    const res = await post('trades', { offeredTo: '0004', give: ['1002'], get: ['2001'], counterOfTradeId: '77' });
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('says so when the counter went out but the original stayed open', async () => {
    replies = [
      on(/TYPE=rosters/, () => json(ROSTERS)),
      on(/tradeProposal/, () => text('<status>OK</status>')),
      on(/tradeResponse/, () => text('<error>Trade not found</error>')),
    ];
    const res = await post('trades', { offeredTo: '0004', give: ['1002'], get: ['2001'], counterOfTradeId: '77' });
    expect(res.body.success).toBe(true);
    expect(res.body.originalStillOpen).toBe(true);
  });

  it('validates the proposal before touching MFL', async () => {
    const { readProposal } = await import('../src/pages/api/mfl-live/trades');
    expect(readProposal({ offeredTo: '0002', give: ['1'], get: [] }, '0002')).toMatch(/yourself/);
    expect(readProposal({ offeredTo: '0004', give: [], get: [] }, '0002')).toMatch(/Add something/);
    expect(readProposal({ offeredTo: '0004', give: ['1001,2001'], get: [] }, '0002')).toMatch(/not something MFL/);
    expect(readProposal({ offeredTo: '0004', give: ['1001', '1001'], get: [] }, '0002')).toMatch(/twice/);
    expect(readProposal({ offeredTo: 'x', give: ['1'], get: [] }, '0002')).toMatch(/Pick a team/);
  });
});

describe('POST /api/mfl-live/trade-respond', () => {
  it('accepts with the owner cookie, reading MFL errors from the body', async () => {
    replies = [on(/tradeResponse/, () => text('<status>OK</status>'))];
    expect((await post('trade-respond', { tradeId: '9', response: 'accept' })).body).toEqual({ success: true, message: 'Trade accepted' });
    replies = [on(/tradeResponse/, () => text('<error>Expired</error>'))];
    expect(await post('trade-respond', { tradeId: '9', response: 'reject' })).toEqual({ status: 400, body: { success: false, message: 'Expired' } });
  });
  it('refuses an unknown response', async () => {
    expect((await post('trade-respond', { tradeId: '9', response: 'veto' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('buildTradeOffers', () => {
  const ref = { leagueId: '55555', year: 2026, host: null, franchiseId: '0002', mflUserCookie: 'c' };
  const teams = [{ franchiseId: '0002', name: 'My Team' }, { franchiseId: '0004', name: 'Their Team' }];
  const lookup = async () => new Map([['1001', { name: 'Josh Allen', position: 'QB', team: 'BUF' }]]);

  it('reads offers from the owner side, both directions', async () => {
    const { buildTradeOffers } = await import('../src/utils/live/mfl-live-app-trades');
    const offers = await buildTradeOffers(
      [
        // Outgoing: offeredto is the other team.
        { trade_id: '1', offeredto: '0004', will_give_up: '1001,', will_receive: 'FP_0004_2027_2', timestamp: '100', expires: '0' },
        // Incoming: offeredto is me; the proposer is named in the description.
        { trade_id: '2', offeredto: '0002', description: 'Their Team proposed a trade to My Team', will_give_up: 'FP_0002_2027_1', will_receive: '9999' },
      ],
      ref,
      teams,
      lookup,
    );
    expect(offers[0]).toMatchObject({
      tradeId: '1',
      direction: 'outgoing',
      partner: { franchiseId: '0004', name: 'Their Team' },
      youGive: [{ kind: 'player', id: '1001', label: 'Josh Allen', position: 'QB', nflTeam: 'BUF' }],
      youGet: [{ kind: 'pick', id: 'FP_0004_2027_2', label: '2027 Rd 2' }],
      proposedAt: 100,
    });
    expect(offers[1]).toMatchObject({
      direction: 'incoming',
      partner: { franchiseId: '0004', name: 'Their Team' },
      youGive: [{ kind: 'pick', label: '2027 Rd 1' }],
      youGet: [{ kind: 'player', id: '9999', label: 'Player 9999' }],
    });
  });

  it('names a traded pick by its original team', async () => {
    const { labelAssets } = await import('../src/utils/live/mfl-live-app-trades');
    const names = new Map([['0004', 'Their Team']]);
    expect(labelAssets(['FP_0004_2027_1'], '0002', names, new Map())[0].label).toBe('2027 Rd 1 (Their Team)');
  });

  it('carries no headshot or ESPN id', async () => {
    const { buildTradeOffers } = await import('../src/utils/live/mfl-live-app-trades');
    const offers = await buildTradeOffers([{ trade_id: '1', offeredto: '0004', will_give_up: '1001', will_receive: '' }], ref, teams, lookup);
    expect(JSON.stringify(offers)).not.toMatch(/espn|headshot/i);
  });
});

describe('parseFuturePicks', () => {
  it('turns MFL pick rows into the codes the import takes', async () => {
    const { parseFuturePicks } = await import('../src/utils/live/mfl-live-app-trades');
    expect(
      parseFuturePicks({
        futureDraftPicks: { franchise: { id: '2', futureDraftPick: [{ year: '2027', round: '1', originalPickFor: '4' }] } },
      }),
    ).toEqual({ '0002': ['FP_0004_2027_1'] });
  });
});
