/**
 * Tests for MFL Contract Writer utility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs before importing
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
}));

// Mock mflFetch — every authenticated call goes through it, reads included.
// A bare fetch would lose the Cookie on MFL's api→www49 302.
const mockMflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mockMflFetch(...args),
}));

// Stubbed so an unmocked path can never reach the network. Nothing in this
// suite should land here — a hit means an authenticated call regressed to
// bare fetch.
const mockFetch = vi.fn(() => {
  throw new Error('bare fetch: authenticated MFL calls must use mflFetch');
});
vi.stubGlobal('fetch', mockFetch);

/**
 * Prime the pre-write backup read, which every write performs first.
 *
 * The payload must be NON-EMPTY: createPreWriteBackup refuses to write a
 * backup with no players in it, so an empty response here would silently make
 * every write test exercise the no-backup path instead.
 */
const primeBackupRead = () =>
  mockMflFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        salaries: {
          leagueUnit: {
            player: [{ id: '99999', salary: '100000', contractYear: '1', contractInfo: '' }],
          },
        },
      }),
  });

/**
 * The write is the POST. Found by method rather than by call index so the
 * backup read sitting ahead of it in the queue can't skew the assertions.
 */
const writeCallArg = () =>
  mockMflFetch.mock.calls.map((c) => c[0] as any).find((o) => o?.method === 'POST');

// Mock env vars
const originalEnv = process.env;

describe('mfl-contract-writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = {
      ...originalEnv,
      MFL_USER_ID: 'test_cookie_value',
      MFL_IS_COMMISH: 'test_commish_value',
      MFL_HOST: 'https://api.myfantasyleague.com',
      MFL_WRITE_HOST: 'https://www49.myfantasyleague.com',
      MFL_LEAGUE_ID: '13522',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('writeContractToMFL', () => {
    it('succeeds on first attempt with valid response', async () => {
      // Mock the backup read in createPreWriteBackup (also via mflFetch)
      primeBackupRead();
      // Mock write via mflFetch
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
    });

    it('includes APPEND=1 in the URL', async () => {
      primeBackupRead();
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      // mflFetch receives an options object with url
      const writeCall = writeCallArg();
      expect(writeCall.url).toContain('APPEND=1');
    });

    it('sends correct XML in body parameter', async () => {
      primeBackupRead();
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: 'RC',
      });

      const writeCall = writeCallArg();
      const bodyStr = writeCall.body;
      expect(bodyStr).toContain('id%3D%2214056%22');
      expect(bodyStr).toContain('salary%3D%22500000%22');
      expect(bodyStr).toContain('contractYear%3D%223%22');
      expect(bodyStr).toContain('contractInfo%3D%22RC%22');
    });

    it('uses MFL_USER_ID for auth via mflFetch', async () => {
      primeBackupRead();
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      const writeCall = writeCallArg();
      expect(writeCall.mflUserCookie).toBe('test_cookie_value');
      expect(writeCall.mflCommishCookie).toBe('test_commish_value');
    });

    it('fails when MFL_USER_ID is not set', async () => {
      process.env.MFL_USER_ID = '';
      process.env.MFL_IS_COMMISH = '';

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No MFL credentials');
      expect(result.attempts).toBe(0);
    });

    it('retries on HTTP failure and reports attempts', async () => {
      // Mock backup
      primeBackupRead();
      // 3 failed attempts via mflFetch
      mockMflFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
      mockMflFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
      mockMflFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toContain('Failed after 3 attempts');
    }, 20000);

    it('detects MFL error responses in otherwise OK HTTP responses', async () => {
      primeBackupRead();
      // MFL returns 200 but with error in body — 3 retries
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<error>Invalid league ID</error>'),
      });
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<error>Invalid league ID</error>'),
      });
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<error>Invalid league ID</error>'),
      });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('MFL returned error');
    }, 20000);
  });

  describe('writeMultipleContractsToMFL', () => {
    it('sends multiple players in single XML payload', async () => {
      primeBackupRead();
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { writeMultipleContractsToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeMultipleContractsToMFL([
        { playerId: '14056', salary: '500000', contractYear: '3', contractInfo: '' },
        { playerId: '15000', salary: '1000000', contractYear: '4', contractInfo: 'RC' },
      ]);

      expect(result.success).toBe(true);

      const writeCall = writeCallArg();
      const bodyStr = writeCall.body;
      // Both player IDs should be in the same payload
      expect(bodyStr).toContain('14056');
      expect(bodyStr).toContain('15000');
    });

    it('returns success for empty array', async () => {
      const { writeMultipleContractsToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeMultipleContractsToMFL([]);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(0);
    });
  });

  describe('restoreFromBackup', () => {
    it('reads backup file and writes all players back', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          salaries: {
            leagueUnit: {
              unit: 'LEAGUE',
              player: [
                { id: '14056', salary: '500000', contractYear: '3', contractInfo: '' },
                { id: '15000', salary: '1000000', contractYear: '4', contractInfo: 'RC' },
              ],
            },
          },
        }),
      );

      // Mock the backup read for writeMultipleContractsToMFL
      primeBackupRead();
      // Mock write via mflFetch
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { restoreFromBackup } = await import('../src/utils/mfl-contract-writer');
      const result = await restoreFromBackup('/path/to/backup.json');

      expect(result.success).toBe(true);
    });

    it('fails gracefully with empty backup', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ salaries: { leagueUnit: { player: [] } } }),
      );

      const { restoreFromBackup } = await import('../src/utils/mfl-contract-writer');
      const result = await restoreFromBackup('/path/to/empty-backup.json');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No player data');
    });
  });

  describe('createPreWriteBackup', () => {
    it('fetches salary data and writes to backup file', async () => {
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            salaries: {
              leagueUnit: {
                player: [{ id: '14056', salary: '500000', contractYear: '3', contractInfo: '' }],
              },
            },
          }),
      });

      const { writeFileSync } = await import('node:fs');
      const { createPreWriteBackup } = await import('../src/utils/mfl-contract-writer');
      const filepath = await createPreWriteBackup();

      expect(filepath).toContain('pre-write.json');
      expect(writeFileSync).toHaveBeenCalled();

      // The read is owner-gated, so it must carry the cookie through the
      // api→www49 302 — bare fetch drops it and MFL answers empty with a 200.
      const readCall = mockMflFetch.mock.calls[0][0];
      expect(readCall.method).toBe('GET');
      expect(readCall.mflUserCookie).toBe('test_cookie_value');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when cookie is missing', async () => {
      process.env.MFL_USER_ID = '';

      const { createPreWriteBackup } = await import('../src/utils/mfl-contract-writer');
      const filepath = await createPreWriteBackup();

      expect(filepath).toBeNull();
    });

    it('uses the credentials the WRITE will use, not just the env', async () => {
      // A session-driven write on a box with no MFL_USER_ID set must still take
      // a backup — otherwise the salary write proceeds with nothing to roll
      // back to, and the null return says so only to the log.
      process.env.MFL_USER_ID = '';
      primeBackupRead();

      const { createPreWriteBackup } = await import('../src/utils/mfl-contract-writer');
      const filepath = await createPreWriteBackup({ mflUserId: 'session_cookie' });

      expect(filepath).toContain('pre-write.json');
      expect(mockMflFetch.mock.calls[0][0].mflUserCookie).toBe('session_cookie');
    });

    // An empty file is not a backup. MFL answers a failed or unauthenticated
    // export with HTTP 200 and a body that parses cleanly, so without these
    // checks the emptiness surfaces at ROLLBACK time — the one moment it
    // cannot be fixed.
    it.each([
      ['an empty player array', { salaries: { leagueUnit: { player: [] } } }],
      ['the zero-entry empty-string shape', { salaries: { leagueUnit: { player: '' } } }],
      [
        "MFL's empty-field sentinel row",
        { salaries: { leagueUnit: { player: { id: '', salary: '' } } } },
      ],
      ['an unauthenticated error payload', { error: 'API requires a logged in user' }],
      ['a body with no salaries key at all', {}],
    ])('writes no file and returns null for %s', async (_label, payload) => {
      mockMflFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(payload) });

      const { writeFileSync } = await import('node:fs');
      const { createPreWriteBackup } = await import('../src/utils/mfl-contract-writer');
      const filepath = await createPreWriteBackup();

      expect(filepath).toBeNull();
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('accepts a single player returned as a bare object, not an array', async () => {
      // MFL collapses a one-entry list to a bare object. Rejecting that shape
      // would refuse a perfectly restorable backup.
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            salaries: {
              leagueUnit: {
                player: { id: '14056', salary: '500000', contractYear: '3', contractInfo: '' },
              },
            },
          }),
      });

      const { writeFileSync } = await import('node:fs');
      const { createPreWriteBackup } = await import('../src/utils/mfl-contract-writer');

      expect(await createPreWriteBackup()).toContain('pre-write.json');
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('a write still proceeds when no backup could be taken', async () => {
      // Deliberate: the backup is best-effort and the write uses APPEND=1, so
      // it only touches the named players. Pinned so the coupling is a choice
      // rather than an accident.
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<status>OK</status>'),
      });

      const { writeContractToMFL } = await import('../src/utils/mfl-contract-writer');
      const result = await writeContractToMFL({
        playerId: '14056',
        salary: '500000',
        contractYear: '3',
        contractInfo: '',
      });

      expect(result.success).toBe(true);
      expect(result.backupFile).toBeUndefined();
    });
  });

  describe('fetchMFLSalaries', () => {
    it('returns null rather than {} when no cookie is available', async () => {
      // {} is truthy, so it slips past reconcile's `if (!salaries)` guard and
      // makes a read that never happened look like "no stuck declarations".
      process.env.MFL_USER_ID = '';

      const { fetchMFLSalaries } = await import('../src/utils/mfl-contract-writer');
      const salaries = await fetchMFLSalaries();

      expect(salaries).toBeNull();
      expect(mockMflFetch).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reads through mflFetch and maps players by id', async () => {
      mockMflFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            salaries: {
              leagueUnit: {
                player: [{ id: '14056', salary: '500000', contractYear: '3', contractInfo: 'RC' }],
              },
            },
          }),
      });

      const { fetchMFLSalaries } = await import('../src/utils/mfl-contract-writer');
      const salaries = await fetchMFLSalaries();

      expect(salaries).toEqual({
        '14056': { salary: '500000', contractYear: '3', contractInfo: 'RC' },
      });
      expect(mockMflFetch.mock.calls[0][0].mflUserCookie).toBe('test_cookie_value');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
