import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWaiverWirePost, latestWaiverRun, waiverWireId } from '../scripts/lib/schefter-waiver-wire.mjs';
import { leaguesFor } from '../scripts/lib/league-jobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The weekly waiver-wire post (Brandon, 2026-11-26): one code-written post per
 * league with the waiver run's claims and the first-come-first-served adds
 * after it. It replaced an AI column that said "Zero claims, zero dollars" on
 * a week with a $725K claim because it read a stale transactions copy.
 */

const players = new Map(
  [
    { id: '15100', name: 'Hill, Justice', position: 'RB' },
    { id: '17668', name: 'Smack, Trey', position: 'PK' },
    { id: '16171', name: 'Miller, Kendre', position: 'RB' },
    { id: '0507', name: 'Giants, New York', position: 'Def' },
  ].map((p) => [p.id, p]),
);
const teams = new Map([
  ['0001', { name: 'Pacific Pigskins' }],
  ['0005', { name: 'Fullybaked' }],
  ['0015', { name: 'The Mariachi Ninjas' }],
]);
const at = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));
const RUN = at('2026-11-26T03:00:00Z'); // Wed Nov 25, 7:00 PM PT
const NOW = Math.floor(Date.parse('2026-11-26T16:00:00Z') / 1000); // Thu 8:00 AM PT

const post = (rows: Array<Record<string, string>>, league = 'theleague') =>
  buildWaiverWirePost({ rows, players, teams, league, nowSeconds: NOW });

describe('waiver-wire post', () => {
  it('lists the claim the old column missed, with its bid', () => {
    const p = post([
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN },
      { type: 'BBID_WAIVER', franchise: '0001', transaction: '15100,|725000|', timestamp: RUN },
    ])!;
    expect(p.body).toContain('Pacific Pigskins: RB Justice Hill ($725K)');
    expect(p.headline).toBe('Waiver wire: 1 claim, 0 pickups after waivers');
    expect(p.id).toBe('sf_waiver_wire_20261125');
    expect(p.transactionSubType).toBe('WAIVER_WIRE');
  });

  it('adds FCFS pickups after the run, and leaves out the ones before it and after the post', () => {
    const p = post([
      { type: 'FREE_AGENT', franchise: '0005', transaction: '16171,|', timestamp: at('2026-11-24T18:00:00Z') },
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN },
      { type: 'FREE_AGENT', franchise: '0005', transaction: '17668,|', timestamp: at('2026-11-26T03:14:00Z') },
      { type: 'FREE_AGENT', franchise: '0001', transaction: '|17668,', timestamp: at('2026-11-26T04:00:00Z') },
      { type: 'FREE_AGENT', franchise: '0001', transaction: '16171,|', timestamp: at('2026-11-26T17:00:00Z') },
    ])!;
    expect(p.body).toContain('First come, first served after waivers:\nFullybaked: PK Trey Smack');
    expect(p.body).not.toContain('Kendre Miller');
    expect(p.headline).toBe('Waiver wire: 0 claims, 1 pickup after waivers');
  });

  it("counts the AFL's rolling-priority WAIVER rows, which carry added/dropped and no transaction", () => {
    const p = post(
      [
        { type: 'AUTO_PROCESS_WAIVERS', transaction: '', franchise: '', timestamp: RUN },
        { type: 'WAIVER', franchise: '0015', added: '15100,', dropped: '', timestamp: RUN },
        { type: 'WAIVER', franchise: '0015', added: '0507,', dropped: '16171,', timestamp: RUN },
      ],
      'afl-fantasy',
    )!;
    expect(p.body).toContain('The Mariachi Ninjas: RB Justice Hill, New York Giants defense');
    expect(p.body).not.toContain('$');
  });

  it('skips when the window has no waiver run, so a stale copy can never read as an empty week', () => {
    expect(post([
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: at('2026-11-19T03:00:00Z') },
      { type: 'BBID_WAIVER', franchise: '0001', transaction: '15100,|725000|', timestamp: at('2026-11-19T03:00:00Z') },
    ])).toBeNull();
    expect(latestWaiverRun([], NOW)).toBeNull();
  });

  it('never prints a player it cannot name', () => {
    expect(post([
      { type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN },
      { type: 'BBID_WAIVER', franchise: '0001', transaction: '99999,|425000|', timestamp: RUN },
    ])).toBeNull();
  });

  it('says so plainly on a quiet week', () => {
    const p = post([{ type: 'BBID_AUTO_PROCESS_WAIVERS', timestamp: RUN }])!;
    expect(p.body).toBe("No claims in Wednesday night's waiver run, and no first-come-first-served pickups since.");
  });

  it('names the run by its day on the league clock', () => {
    expect(waiverWireId(Number(RUN), 'America/Los_Angeles')).toBe('sf_waiver_wire_20261125');
  });
});

describe('waiver-wire wiring', () => {
  it('runs for both full leagues', () => {
    expect(leaguesFor('article:waiver-wire').map((l) => l.slug)).toEqual(expect.arrayContaining(['theleague', 'afl-fantasy']));
  });

  it('is what the scheduled waiver slot runs, reading MFL live', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/schefter-articles.yml'), 'utf8');
    expect(wf).toMatch(/each_league article:waiver-wire node scripts\/schefter-waiver-wire\.mjs/);
    const script = fs.readFileSync(path.join(ROOT, 'scripts/schefter-waiver-wire.mjs'), 'utf8');
    expect(script).toContain('fetchLiveTransactions(league, year)');
  });
});
