import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFactSheet } from '../scripts/article-types/waiver-pickups.mjs';
import { fetchLiveTransactions } from '../scripts/article-utils/data-loaders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The weekly waiver recap (2026-11-26).
 *
 * On 2026-11-25 TheLeague's recap published "Zero claims, zero dollars spent
 * on the waiver wire in Week 11" three hours after the scanner posted Pacific
 * Pigskins winning RB Justice Hill at $725K in the same run. The runner read
 * the COMMITTED transactions.json, which the roster sync now holds out of git
 * (it publishes through the live league-data pointer), and that copy's newest
 * row predated the run. These tests pin the three fixes:
 *
 *   1. transactions are read live from MFL, and a copy that does not reach the
 *      week's waiver run is a SKIP, never "zero claims";
 *   2. the AFL's plain WAIVER rows (added/dropped, no `transaction`) count —
 *      the column used to drop every one of them;
 *   3. the recap carries the waiver run AND the FCFS adds after it, labeled,
 *      over a seven-day window ending at the run time, so recaps tile the
 *      calendar.
 */

const players = {
  players: {
    player: [
      { id: '15100', name: 'Hill, Justice', position: 'RB', team: 'BAL', espn_id: '1' },
      { id: '17668', name: 'Smack, Trey', position: 'PK', team: 'GBP', espn_id: '3' },
      { id: '16171', name: 'Miller, Kendre', position: 'RB', team: 'NOS', espn_id: '4' },
    ],
  },
};

// Thursday 2026-11-26, 8:00 AM PT — the recap's slot.
const NOW = Date.parse('2026-11-26T16:00:00Z');
const at = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));
const RUN = at('2026-11-26T03:00:00Z'); // Wed Nov 25, 7:00 PM PT

const sheet = async (rows: Array<Record<string, string>>, league = 'theleague') =>
  buildFactSheet(
    { players, transactions: { transactions: { transaction: rows } }, league: {}, transactionsSource: 'disk' },
    11,
    2026,
    ROOT,
    { league, now: NOW },
  );

describe('waiver recap: a copy that misses the run is a skip, not a zero', () => {
  it('declines to write when the window holds no waiver run (the stale-copy case)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The 2026-11-25 shape: last week's run, eight days before the recap.
    const result = await sheet([
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: at('2026-11-19T03:00:00Z') },
      { type: 'BBID_WAIVER', franchise: '0007', transaction: '16171,|1000000|', timestamp: at('2026-11-19T03:00:00Z') },
      { type: 'FREE_AGENT', franchise: '0011', transaction: '|17668,', timestamp: at('2026-11-19T15:28:00Z') },
    ]);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no waiver run'));
    warn.mockRestore();
  });

  it('writes a real empty week when the run is there but nobody claimed anyone', async () => {
    const result = await sheet([{ type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN }]);
    expect(result?.factSheet).toContain('Total pickups this week: 0');
  });

  it('names the claim the 2026-11-25 recap missed', async () => {
    const result = await sheet([
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN },
      { type: 'BBID_WAIVER', franchise: '0001', transaction: '15100,|725000|', timestamp: RUN },
    ]);
    expect(result?.factSheet).toContain('RB Justice Hill ($725K) [waiver claim, blind bid]');
    expect(result?.factSheet).toContain('Waiver claims in the run: 1');
    expect(result?.factSheet).toContain('Waiver run: Wed, Nov 25, 7:00 PM PT');
  });
});

describe('waiver recap: FCFS adds around the run', () => {
  it('splits FCFS adds after the run from those before it', async () => {
    const result = await sheet([
      { type: 'FREE_AGENT', franchise: '0005', transaction: '16171,|', timestamp: at('2026-11-24T18:00:00Z') },
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN },
      { type: 'BBID_WAIVER', franchise: '0001', transaction: '15100,|725000|', timestamp: RUN },
      { type: 'FREE_AGENT', franchise: '0009', transaction: '17668,|', timestamp: at('2026-11-26T03:14:00Z') },
    ]);
    const fs = result!.factSheet;
    expect(fs).toContain('First-come-first-served adds right after the run: 1');
    expect(fs).toContain('First-come-first-served adds earlier in the week, before the run: 1');
    expect(fs).toMatch(/PK Trey Smack \(\$425K\) \[first-come-first-served add right after the waiver run/);
    expect(fs).toMatch(/RB Kendre Miller \(\$425K\) \[first-come-first-served add earlier in the week/);
  });

  it('counts each pickup in exactly one weekly recap', async () => {
    const result = await sheet([
      // Just over seven days back: last Thursday's recap carried it.
      { type: 'FREE_AGENT', franchise: '0005', transaction: '16171,|', timestamp: at('2026-11-19T15:59:00Z') },
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN },
      // After the recap's run time: next week's.
      { type: 'FREE_AGENT', franchise: '0009', transaction: '17668,|', timestamp: at('2026-11-26T16:30:00Z') },
    ]);
    expect(result?.factSheet).toContain('Total pickups this week: 0');
  });
});

describe('waiver recap: the AFL\'s rolling-priority claims', () => {
  it('counts a plain WAIVER row, which carries added/dropped and no transaction', async () => {
    const result = await sheet(
      [
        { type: 'AUTO_PROCESS_WAIVERS', transaction: '', franchise: '', timestamp: at('2026-11-26T04:00:00Z') },
        { type: 'WAIVER', franchise: '0015', added: '15100,', dropped: '', timestamp: at('2026-11-26T04:00:00Z') },
      ],
      'afl-fantasy',
    );
    const fs = result!.factSheet;
    expect(fs).toContain('Waiver claims in the run: 1');
    expect(fs).toContain('RB Justice Hill [waiver claim, rolling priority]');
    // A league with no salaries and no bids prints no money at all.
    expect(fs).not.toContain('$0');
    expect(fs).not.toContain('Highest single bid');
  });
});

describe('fetchLiveTransactions', () => {
  const respond = (body: unknown, status = 200) =>
    (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;

  it('reads the league\'s own host and id from the registry', async () => {
    const fetchImpl = vi.fn(respond({ transactions: { transaction: [] } }));
    await fetchLiveTransactions('theleague', 2026, { fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/^https:\/\/www\d+\.myfantasyleague\.com\/2026\/export\?TYPE=transactions&L=\d+&JSON=1$/);
  });

  it('wraps a lone row in an array', async () => {
    const one = { type: 'FREE_AGENT', timestamp: '1' };
    const out = await fetchLiveTransactions('theleague', 2026, { fetchImpl: respond({ transactions: { transaction: one } }) });
    expect(out.transactions.transaction).toEqual([one]);
  });

  it('treats MFL\'s HTTP-200 error body as a failure, not an empty league', async () => {
    await expect(
      fetchLiveTransactions('theleague', 2026, { fetchImpl: respond({ error: { $t: 'API rate limit' } }) }),
    ).rejects.toThrow(/no transactions/);
  });
});

describe('the article runner reads transactions live', () => {
  it('fetches them from MFL rather than trusting the committed copy', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/schefter-weekly-articles.mjs'), 'utf8');
    expect(src).toMatch(/data\.transactions = await fetchLiveTransactions\(league, year\)/);
  });
});
