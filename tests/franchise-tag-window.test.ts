/**
 * The franchise tag calendar (Constitution § PLAYER TAGS; Brandon, 2026-11-15):
 * declared Feb 1 to Feb 14 at 8:45pm PT, written to MFL on Feb 15 as a 1-year
 * contract. And the server path that queues one with its own price.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  franchiseTagCloses,
  franchiseTagOpens,
  isFranchiseTagOpen,
  isFranchiseTagWritable,
  nextFranchiseTagWindow,
} from '../src/utils/franchise-tag-window.mjs';

describe('the tagging period', () => {
  it('opens Feb 1 at midnight PT and closes Feb 14 at 8:45pm PT', () => {
    expect(franchiseTagOpens(2027).toISOString()).toBe('2027-02-01T08:00:00.000Z');
    expect(franchiseTagCloses(2027).toISOString()).toBe('2027-02-15T04:45:00.000Z');
    expect(isFranchiseTagOpen(new Date('2027-02-01T07:59:00Z'))).toBe(false);
    expect(isFranchiseTagOpen(new Date('2027-02-01T08:00:00Z'))).toBe(true);
    expect(isFranchiseTagOpen(new Date('2027-02-15T04:44:00Z'))).toBe(true);
    expect(isFranchiseTagOpen(new Date('2027-02-15T04:45:00Z'))).toBe(false);
    expect(isFranchiseTagOpen(new Date('2026-11-15T20:00:00Z'))).toBe(false);
    expect(isFranchiseTagOpen(new Date('2027-03-01T20:00:00Z'))).toBe(false);
  });

  it('names the next window', () => {
    expect(nextFranchiseTagWindow(new Date('2026-11-15T20:00:00Z')).opens.getUTCFullYear()).toBe(2027);
    expect(nextFranchiseTagWindow(new Date('2027-01-15T20:00:00Z')).opens.getUTCFullYear()).toBe(2027);
    expect(nextFranchiseTagWindow(new Date('2027-03-01T20:00:00Z')).opens.getUTCFullYear()).toBe(2028);
  });
});

describe('the Feb 15 write', () => {
  const queued = '2027-02-10T20:00:00.000Z';
  it('holds a queued tag until Feb 15 at midnight PT, then releases it', () => {
    expect(isFranchiseTagWritable(queued, new Date('2027-02-14T20:00:00Z'))).toBe(false);
    expect(isFranchiseTagWritable(queued, new Date('2027-02-15T07:59:00Z'))).toBe(false);
    expect(isFranchiseTagWritable(queued, new Date('2027-02-15T08:00:00Z'))).toBe(true);
  });

  it('never writes an older pending tag mid-season: it waits for the next Feb 15', () => {
    expect(isFranchiseTagWritable('2026-11-15T20:00:00Z', new Date('2026-12-01T00:00:00Z'))).toBe(false);
    expect(isFranchiseTagWritable('2026-11-15T20:00:00Z', new Date('2027-02-15T08:00:00Z'))).toBe(true);
  });

  it('is what the contracts job checks before it writes a tag', () => {
    const script = readFileSync(join(__dirname, '..', 'scripts', 'apply-pending-contracts.mjs'), 'utf8');
    expect(script).toContain("from '../src/utils/franchise-tag-window.mjs'");
    expect(script).toMatch(/d\.type !== 'franchise-tag' \|\| isFranchiseTagWritable\(d\.submittedAt, now\)/);
  });
});

// ── The server check (franchise-tag-server.ts) ──────────────────────────────

const rosters: Record<string, any> = {};
const tags: any[] = [];
vi.mock('../src/utils/mfl-roster-cache', () => ({ getCachedRosters: vi.fn(async () => rosters) }));
vi.mock('../src/utils/player-map', () => ({
  preloadPlayerIdentity: vi.fn(async () => undefined),
  getPlayerMap: vi.fn(() => new Map([['P1', { position: 'RB' }], ['P2', { position: 'RB' }]])),
}));
vi.mock('../src/utils/veteran-extension-server', () => ({
  loadExtensionSalaryAverages: vi.fn(async () => ({ positions: { RB: { top3Average: 9_000_000 } } })),
}));
vi.mock('../src/utils/contract-storage', () => ({
  getTeamFranchiseTag: vi.fn(async (franchiseId: string) => tags.find((t) => t.franchiseId === franchiseId)),
}));

import { checkFranchiseTagOnServer } from '../src/utils/franchise-tag-server';

const FEB = new Date('2027-02-10T20:00:00Z');
const check = (over: Record<string, unknown> = {}) =>
  checkFranchiseTagOnServer({ leagueId: 'L', franchiseId: '0001', playerId: 'P1', now: FEB, ...over } as any);

beforeEach(() => {
  tags.length = 0;
  for (const k of Object.keys(rosters)) delete rosters[k];
  rosters.P1 = { franchiseId: '0001', salary: '5000000', contractYear: '1', contractInfo: '' };
  rosters.P2 = { franchiseId: '0001', salary: '10000000', contractYear: '1', contractInfo: '' };
});

describe('checkFranchiseTagOnServer', () => {
  it('prices from the live contract: the greater of the top-3 average and +20%, 1 year', async () => {
    expect(await check()).toMatchObject({ ok: true, currentSalary: 5_000_000, newSalary: 9_000_000, newYears: 1 });
    expect(await check({ playerId: 'P2' })).toMatchObject({ ok: true, newSalary: 12_000_000 });
  });

  it('refuses outside Feb 1-14 and says when the window opens', async () => {
    const out = await check({ now: new Date('2026-11-15T20:00:00Z') });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/Feb 1 to Feb 14 at 8:45 PM PT.*2027/);
  });

  it("refuses a player who is not on the owner's roster, has years left, or is on a rookie deal", async () => {
    rosters.P1.franchiseId = '0002';
    expect((await check()).ok).toBe(false);
    rosters.P1.franchiseId = '0001';
    rosters.P1.contractYear = '2';
    expect((await check()).ok).toBe(false);
    rosters.P1.contractYear = '1';
    for (const info of ['RC', 'TO', 'F']) {
      rosters.P1.contractInfo = info;
      expect((await check()).ok).toBe(false);
    }
  });

  it('allows one tag per team, but lets the owner re-file the same pending one', async () => {
    tags.push({ franchiseId: '0001', playerId: 'P1', status: 'pending' });
    expect((await check()).ok).toBe(true);
    expect((await check({ playerId: 'P2' })).ok).toBe(false);
  });
});
