/**
 * The server path for a veteran extension: everything filed comes from the
 * live roster and the server's own price, never from the request body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rosters: Record<string, any> = {};
const stored: any[] = [];

vi.mock('../src/utils/mfl-roster-cache', () => ({
  getCachedRosters: vi.fn(async () => rosters),
  invalidateRosterCache: vi.fn(async () => undefined),
}));
const mfl = { creds: { mflUserId: 'commish' } as any, result: { success: true, attempts: 1 } as any };
const writeContractToMFL = vi.fn(async () => mfl.result);
vi.mock('../src/utils/mfl-contract-writer', () => ({
  writeContractToMFL: (...args: any[]) => (writeContractToMFL as any)(...args),
  leagueCommissionerCredentials: () => mfl.creds,
}));
vi.mock('../src/utils/player-map', () => ({
  preloadPlayerIdentity: vi.fn(async () => undefined),
  getPlayerMap: vi.fn(() => new Map([['P1', { position: 'WR' }], ['P2', { position: 'WR' }]])),
}));
vi.mock('../src/utils/league-data', () => ({
  loadLeagueData: vi.fn(async () => ({
    metadata: { week: 14, freezeWeek: 14 },
    positions: { WR: { top5Average: 8_500_000 } },
  })),
}));
vi.mock('../src/utils/contract-storage', () => ({
  generateDeclarationId: () => `D${stored.length + 1}`,
  addDeclaration: vi.fn(async (d: any) => {
    stored.push(d);
    return d;
  }),
  updateDeclaration: vi.fn(async (id: string, patch: any) => {
    const d = stored.find((x) => x.id === id);
    Object.assign(d, patch);
    return d;
  }),
  getPendingDeclarationForPlayer: vi.fn(async (playerId: string, franchiseId: string) =>
    stored.find((d) => d.playerId === playerId && d.franchiseId === franchiseId && d.status === 'pending'),
  ),
  getTeamVeteranExtension: vi.fn(async (franchiseId: string) =>
    stored.find((d) => d.franchiseId === franchiseId && d.type === 'veteran-extension'),
  ),
}));

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileVeteranExtension } from '../src/utils/veteran-extension-filing';

const user = { id: 'U', name: 'Owner' } as any;
const file = (over: Record<string, unknown> = {}) =>
  fileVeteranExtension({
    user,
    leagueId: 'L',
    franchiseId: '0001',
    franchiseName: 'Team',
    playerId: 'P1',
    playerName: 'Player One',
    addedYears: 2,
    ...over,
  } as any);

beforeEach(() => {
  stored.length = 0;
  writeContractToMFL.mockClear();
  mfl.creds = { mflUserId: 'commish' };
  mfl.result = { success: true, attempts: 1 };
  for (const k of Object.keys(rosters)) delete rosters[k];
  rosters.P1 = { franchiseId: '0001', salary: '0', contractYear: '2', contractInfo: '', status: 'ROSTER' };
  rosters.P2 = { franchiseId: '0001', salary: '1000000', contractYear: '3', contractInfo: '', status: 'ROSTER' };
});

describe('fileVeteranExtension', () => {
  it('writes the server price from the live contract straight to MFL', async () => {
    const out = await file({ addedYears: 2 });
    expect(out.ok).toBe(true);
    expect(stored[0]).toMatchObject({
      type: 'veteran-extension',
      currentYears: 2,
      currentSalary: 0,
      requestedYears: 4,
      requestedSalary: 4_250_000,
      status: 'applied',
      mflSynced: true,
    });
    expect(writeContractToMFL).toHaveBeenCalledWith(
      { playerId: 'P1', salary: '4250000', contractYear: '4', contractInfo: 'E' },
      { mflUserId: 'commish' },
    );
  });

  it('leaves it pending for the commissioner when MFL refuses the write', async () => {
    mfl.result = { success: false, error: 'MFL down', attempts: 3 };
    const out = await file();
    expect(out.ok).toBe(true);
    expect(stored[0]).toMatchObject({ status: 'pending', mflError: 'MFL down' });
  });

  it('leaves it pending when the deployment has no commissioner login', async () => {
    mfl.creds = null;
    await file();
    expect(writeContractToMFL).not.toHaveBeenCalled();
    expect(stored[0].status).toBe('pending');
  });

  it("refuses a player who is not on the owner's roster", async () => {
    rosters.P1.franchiseId = '0002';
    expect((await file()).ok).toBe(false);
  });

  it('refuses a rookie contract', async () => {
    rosters.P1.contractInfo = 'RC';
    expect((await file()).ok).toBe(false);
  });

  it('allows changing the term of the pending request for the same player', async () => {
    mfl.creds = null;
    await file();
    const out = await file({ addedYears: 1 });
    expect(out.ok).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].requestedYears).toBe(3);
  });

  it('refuses a second player while the slot is used', async () => {
    await file();
    const out = await file({ playerId: 'P2', playerName: 'Player Two' });
    expect(out.ok).toBe(false);
    expect(String(out.body.error)).toContain('Player One');
  });

  it('refuses re-extending a player whose extension was already applied', async () => {
    await file();
    stored[0].status = 'applied';
    expect((await file()).ok).toBe(false);
  });
});

describe('the commissioner-credential exception stays one caller wide', () => {
  // MFL writes use the caller's own cookie (CLAUDE.md § Auth). The veteran
  // extension filing is the one sanctioned exception; a second caller of
  // leagueCommissionerCredentials is a new owner-triggered commissioner write
  // that nobody approved.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|astro|mjs|js)$/.test(f) ? [p] : [];
    });
  it('is called only from veteran-extension-filing.ts', () => {
    const callers = walk(join(__dirname, '..', 'src'))
      .filter((f) => readFileSync(f, 'utf8').includes('leagueCommissionerCredentials('))
      .map((f) => f.replace(/\\/g, '/').split('/src/')[1])
      .sort();
    expect(callers).toEqual(['utils/mfl-contract-writer.ts', 'utils/veteran-extension-filing.ts']);
  });
});
