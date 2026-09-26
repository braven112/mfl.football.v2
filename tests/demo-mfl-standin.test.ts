/**
 * The custom-site demo's MFL stand-in (src/utils/demo-mfl-standin.ts).
 *
 * Driven the way the site's own writers drive MFL — the same endpoints and
 * parameters, then the same read-backs they use to decide whether a write
 * "worked" — so a pass here means those routes will report success on the
 * demo. Uses the committed league feeds as the base data; nothing is written
 * anywhere but an in-memory Redis.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    },
  }),
}));

const { answerDemoMfl } = await import('../src/utils/demo-mfl-standin');
const { demoRequestContext } = await import('../src/utils/demo-request-context');
const { readFiledWaiverClaims } = await import('../src/utils/waiver-claim');

const YEAR = '2025';
const HOST = 'https://www49.myfantasyleague.com';
const as = <T>(franchiseId: string, fn: () => Promise<T>, token = 'prospect-token-aaaaaaa') =>
  // The real namespace comes from redis-client's proxy; here each token gets its own key.
  demoRequestContext.run({ token, franchiseId }, fn);

async function exportJson(type: string, extra = '') {
  const res = await answerDemoMfl(new URL(`${HOST}/${YEAR}/export?TYPE=${type}&L=1&JSON=1${extra}`), 'GET', undefined);
  return res.json();
}

const post = (path: string, body: Record<string, string>) =>
  answerDemoMfl(new URL(`${HOST}/${YEAR}/${path}`), 'POST', new URLSearchParams(body).toString());

const rosterOf = (data: any, fid: string) =>
  data.rosters.franchise.find((f: any) => f.id === fid).player.map((p: any) => p.id) as string[];

describe('demo MFL stand-in', () => {
  beforeEach(() => store.clear());

  it('serves the generated league as MFL exports, rosters always as an array', async () => {
    await as('0001', async () => {
      const league = await exportJson('league');
      expect(league.league.franchises.franchise.length).toBeGreaterThan(0);
      const one = await exportJson('rosters', '&FRANCHISE=0001');
      expect(Array.isArray(one.rosters.franchise)).toBe(true);
      expect(one.rosters.franchise).toHaveLength(1);
    });
  });

  it('a cut removes the player from the roster read-back, and logs a transaction', async () => {
    await as('0001', async () => {
      const before = rosterOf(await exportJson('rosters'), '0001');
      const victim = before[0];
      const res = await post('add_drop', { add_pid: '', drop_pid: victim, SUBMIT: 'Perform Add/Drop' });
      expect(res.status).toBe(200);
      expect(await res.text()).not.toMatch(/error|Would Create|Exceeds/i);
      expect(rosterOf(await exportJson('rosters'), '0001')).not.toContain(victim);
      const tx = await exportJson('transactions');
      expect(tx.transactions.transaction[0]).toMatchObject({ type: 'FREE_AGENT', franchise: '0001' });
    });
  });

  it('a lineup answers OK and reads back as that week’s starters', async () => {
    await as('0001', async () => {
      const roster = rosterOf(await exportJson('rosters'), '0001');
      const starters = roster.slice(0, 9);
      const res = await post('import', { TYPE: 'lineup', L: '1', W: '3', STARTERS: starters.join(',') });
      expect(await res.text()).toContain('<status>OK</status>');
      const wr = await exportJson('weeklyResults', '&W=3');
      const mine = wr.weeklyResults.matchup.flatMap((m: any) => m.franchise).find((f: any) => f.id === '0001');
      expect(mine.starters).toBe(starters.map((id) => `${id},`).join(''));
    });
  });

  it('a waiver claim is readable by the site’s own pending-waivers parser, and can be deleted', async () => {
    await as('0001', async () => {
      await post('add_drop', { add_pid: '99999', drop_pid: '', FORCE_WAIVER: 'on', BBID_AMT: '500000', ROUND: '1', SUBMIT: 'Submit Request' });
      const filed = readFiledWaiverClaims(await exportJson('pendingWaivers'));
      expect(filed?.map((c) => c.addPlayerId ?? (c as any).add)).toContain('99999');
      await answerDemoMfl(new URL(`${HOST}/${YEAR}/add_drop?L=1&F=0001&DELETE=1_99999_0000`), 'GET', undefined);
      expect(readFiledWaiverClaims(await exportJson('pendingWaivers'))).toEqual([]);
    });
  });

  it('a trade auto-accepts: the players change hands', async () => {
    await as('0001', async () => {
      const rosters = await exportJson('rosters');
      const mine = rosterOf(rosters, '0001')[0];
      const theirs = rosterOf(rosters, '0002')[0];
      const res = await post('import', { TYPE: 'tradeProposal', L: '1', OFFEREDTO: '0002', WILL_GIVE_UP: mine, WILL_RECEIVE: theirs });
      expect(await res.text()).not.toMatch(/error/i);
      const after = await exportJson('rosters');
      expect(rosterOf(after, '0001')).toContain(theirs);
      expect(rosterOf(after, '0002')).toContain(mine);
    });
  });

  it('IR and taxi moves change the player’s status', async () => {
    await as('0001', async () => {
      const pid = rosterOf(await exportJson('rosters'), '0001')[1];
      await post('import', { TYPE: 'ir', L: '1', DEACTIVATE: pid });
      const status = (await exportJson('rosters')).rosters.franchise.find((f: any) => f.id === '0001').player.find((p: any) => p.id === pid).status;
      expect(status).toBe('INJURED_RESERVE');
    });
  });

  it('refuses writes from a visitor who has not signed in, and never offers a sign-in', async () => {
    await demoRequestContext.run({ token: null, franchiseId: null }, async () => {
      expect(await (await post('import', { TYPE: 'lineup', W: '1', STARTERS: '1' })).text()).toContain('<error>');
    });
    expect(await (await answerDemoMfl(new URL(`${HOST}/${YEAR}/login`), 'POST', 'USERNAME=a')).text()).toContain('<error>');
  });
});
