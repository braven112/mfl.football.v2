/**
 * Tests for Contract Declaration API endpoints and storage layer
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the file system before importing modules that use it
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync, writeFileSync } from 'node:fs';
import {
  getDeclarations,
  getPendingDeclarations,
  getDeclarationById,
  addDeclaration,
  updateDeclaration,
  getDeclarationsByFranchise,
  getTeamFranchiseTag,
  getTeamExtension,
  getPendingDeclarationForPlayer,
  generateDeclarationId,
} from '../src/utils/contract-storage';
import type { ContractDeclaration } from '../src/types/contracts';

const mockDeclaration = (overrides: Partial<ContractDeclaration> = {}): ContractDeclaration => ({
  id: 'DECL_123_abc',
  type: 'new-acquisition',
  playerId: '14056',
  playerName: 'Test Player',
  franchiseId: '0001',
  franchiseName: 'Test Team',
  leagueId: '13522',
  currentYears: 1,
  currentSalary: 500000,
  currentContractInfo: '',
  requestedYears: 3,
  status: 'pending',
  submittedBy: 'owner1',
  submittedAt: '2026-02-28T10:00:00.000Z',
  mflSynced: false,
  ...overrides,
});

function setupMockFile(declarations: ContractDeclaration[]) {
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      version: '1.0',
      lastUpdated: '2026-02-28T00:00:00.000Z',
      declarations,
    }),
  );
}

describe('contract-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateDeclarationId', () => {
    it('produces unique IDs with DECL prefix', () => {
      const id1 = generateDeclarationId();
      const id2 = generateDeclarationId();
      expect(id1).toMatch(/^DECL_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^DECL_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('getDeclarations', () => {
    it('returns empty array when file does not exist', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(await getDeclarations()).toEqual([]);
    });

    it('returns declarations from file', async () => {
      const decl = mockDeclaration();
      setupMockFile([decl]);
      const result = await getDeclarations();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('DECL_123_abc');
    });
  });

  describe('getPendingDeclarations', () => {
    it('filters to only pending status', async () => {
      setupMockFile([
        mockDeclaration({ id: '1', status: 'pending' }),
        mockDeclaration({ id: '2', status: 'approved' }),
        mockDeclaration({ id: '3', status: 'pending' }),
        mockDeclaration({ id: '4', status: 'rejected' }),
      ]);
      const result = await getPendingDeclarations();
      expect(result).toHaveLength(2);
      expect(result.map(d => d.id)).toEqual(['1', '3']);
    });
  });

  describe('getDeclarationById', () => {
    it('returns matching declaration', async () => {
      setupMockFile([
        mockDeclaration({ id: 'DECL_A' }),
        mockDeclaration({ id: 'DECL_B' }),
      ]);
      const result = await getDeclarationById('DECL_B');
      expect(result?.id).toBe('DECL_B');
    });

    it('returns undefined for missing ID', async () => {
      setupMockFile([mockDeclaration({ id: 'DECL_A' })]);
      expect(await getDeclarationById('DECL_MISSING')).toBeUndefined();
    });
  });

  describe('addDeclaration', () => {
    it('writes declaration to file', async () => {
      setupMockFile([]);
      const decl = mockDeclaration();
      await addDeclaration(decl);

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
      expect(written.declarations).toHaveLength(1);
      expect(written.declarations[0].id).toBe('DECL_123_abc');
    });

    it('prepends new declaration (newest first)', async () => {
      setupMockFile([mockDeclaration({ id: 'OLD' })]);
      await addDeclaration(mockDeclaration({ id: 'NEW' }));

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
      expect(written.declarations[0].id).toBe('NEW');
      expect(written.declarations[1].id).toBe('OLD');
    });
  });

  describe('updateDeclaration', () => {
    it('updates matching declaration fields', async () => {
      setupMockFile([mockDeclaration({ id: 'DECL_A', status: 'pending' })]);

      const result = await updateDeclaration('DECL_A', {
        status: 'approved',
        reviewedBy: 'commish',
        reviewedAt: '2026-02-28T12:00:00.000Z',
      });

      expect(result?.status).toBe('approved');
      expect(result?.reviewedBy).toBe('commish');

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
      expect(written.declarations[0].status).toBe('approved');
    });

    it('returns null for missing declaration', async () => {
      setupMockFile([]);
      expect(await updateDeclaration('MISSING', { status: 'approved' })).toBeNull();
    });
  });

  describe('getDeclarationsByFranchise', () => {
    it('filters by franchiseId', async () => {
      setupMockFile([
        mockDeclaration({ id: '1', franchiseId: '0001' }),
        mockDeclaration({ id: '2', franchiseId: '0002' }),
        mockDeclaration({ id: '3', franchiseId: '0001' }),
      ]);
      const result = await getDeclarationsByFranchise('0001');
      expect(result).toHaveLength(2);
    });
  });

  describe('getTeamFranchiseTag', () => {
    it('finds existing non-rejected franchise tag for the year', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'TAG_1',
          type: 'franchise-tag',
          franchiseId: '0001',
          status: 'approved',
          submittedAt: '2026-03-01T10:00:00.000Z',
        }),
      ]);
      const result = await getTeamFranchiseTag('0001', 2026);
      expect(result?.id).toBe('TAG_1');
    });

    it('ignores rejected tags', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'TAG_1',
          type: 'franchise-tag',
          franchiseId: '0001',
          status: 'rejected',
          submittedAt: '2026-03-01T10:00:00.000Z',
        }),
      ]);
      expect(await getTeamFranchiseTag('0001', 2026)).toBeUndefined();
    });

    it('ignores tags from different years', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'TAG_1',
          type: 'franchise-tag',
          franchiseId: '0001',
          status: 'approved',
          submittedAt: '2025-03-01T10:00:00.000Z',
        }),
      ]);
      expect(await getTeamFranchiseTag('0001', 2026)).toBeUndefined();
    });
  });

  describe('getTeamExtension', () => {
    it('finds existing veteran extension', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'EXT_1',
          type: 'veteran-extension',
          franchiseId: '0002',
          status: 'pending',
          submittedAt: '2026-02-20T10:00:00.000Z',
        }),
      ]);
      expect((await getTeamExtension('0002', 2026))?.id).toBe('EXT_1');
    });

    it('finds existing rookie extension', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'EXT_2',
          type: 'rookie-extension',
          franchiseId: '0003',
          status: 'approved',
          submittedAt: '2026-02-20T10:00:00.000Z',
        }),
      ]);
      expect((await getTeamExtension('0003', 2026))?.id).toBe('EXT_2');
    });

    it('ignores expired extensions', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'EXT_1',
          type: 'veteran-extension',
          franchiseId: '0002',
          status: 'expired',
          submittedAt: '2026-02-20T10:00:00.000Z',
        }),
      ]);
      expect(await getTeamExtension('0002', 2026)).toBeUndefined();
    });
  });

  describe('getPendingDeclarationForPlayer', () => {
    it('finds pending declaration for player on franchise', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'D1',
          playerId: '14056',
          franchiseId: '0001',
          status: 'pending',
        }),
      ]);
      const result = await getPendingDeclarationForPlayer('14056', '0001');
      expect(result?.id).toBe('D1');
    });

    it('finds approved (not yet synced) declaration', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'D2',
          playerId: '14056',
          franchiseId: '0001',
          status: 'approved',
        }),
      ]);
      expect((await getPendingDeclarationForPlayer('14056', '0001'))?.id).toBe('D2');
    });

    it('does not return rejected declarations', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'D3',
          playerId: '14056',
          franchiseId: '0001',
          status: 'rejected',
        }),
      ]);
      expect(await getPendingDeclarationForPlayer('14056', '0001')).toBeUndefined();
    });

    it('does not match different franchise', async () => {
      setupMockFile([
        mockDeclaration({
          id: 'D4',
          playerId: '14056',
          franchiseId: '0002',
          status: 'pending',
        }),
      ]);
      expect(await getPendingDeclarationForPlayer('14056', '0001')).toBeUndefined();
    });
  });
});
