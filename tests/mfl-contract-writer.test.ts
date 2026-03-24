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

// Mock mflFetch (used for write calls)
const mockMflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mockMflFetch(...args),
}));

// Mock global fetch (used for backup reads in createPreWriteBackup)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
      // Mock backup fetch (raw fetch for createPreWriteBackup)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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
      const writeCall = mockMflFetch.mock.calls[0][0];
      expect(writeCall.url).toContain('APPEND=1');
    });

    it('sends correct XML in body parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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

      const writeCall = mockMflFetch.mock.calls[0][0];
      const bodyStr = writeCall.body;
      expect(bodyStr).toContain('id%3D%2214056%22');
      expect(bodyStr).toContain('salary%3D%22500000%22');
      expect(bodyStr).toContain('contractYear%3D%223%22');
      expect(bodyStr).toContain('contractInfo%3D%22RC%22');
    });

    it('uses MFL_USER_ID for auth via mflFetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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

      const writeCall = mockMflFetch.mock.calls[0][0];
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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

      const writeCall = mockMflFetch.mock.calls[0][0];
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

      // Mock backup fetch for writeMultipleContractsToMFL
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ salaries: { leagueUnit: { player: [] } } }),
      });
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
      mockFetch.mockResolvedValueOnce({
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
    });

    it('returns null when cookie is missing', async () => {
      process.env.MFL_USER_ID = '';

      const { createPreWriteBackup } = await import('../src/utils/mfl-contract-writer');
      const filepath = await createPreWriteBackup();

      expect(filepath).toBeNull();
    });
  });
});
