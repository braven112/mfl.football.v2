import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Mock fs.readFileSync before importing the module
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

// Sample MFL feed data
const mockFeedData = {
  version: '1.0',
  players: {
    player: [
      {
        id: '13116',
        name: 'Mahomes, Patrick',
        position: 'QB',
        team: 'KCC',
        espn_id: '3139477',
        draft_year: '2017',
      },
      {
        id: '14836',
        name: 'Chase, Ja\'Marr',
        position: 'WR',
        team: 'CIN',
        espn_id: '4362628',
      },
      {
        id: '0521',
        name: 'Chiefs, Kansas City',
        position: 'Def',
        team: 'KCC',
      },
      {
        id: '99999',
        name: 'Smith, John',
        position: 'QB',
        team: 'NEP',
        // No espn_id — should fallback to college IDs
      },
      {
        id: '14000',
        name: 'Lawrence, Trevor',
        position: 'QB',
        team: 'JAC',
        espn_id: '4360310',
      },
      // Non-fantasy positions — should be filtered out
      {
        id: '50000',
        name: 'Linebacker, Joe',
        position: 'LB',
        team: 'DAL',
      },
      {
        id: '50001',
        name: 'Corner, Bob',
        position: 'CB',
        team: 'SF',
      },
      // Free agent
      {
        id: '11111',
        name: 'Nobody, Joe',
        position: 'RB',
        team: 'FA',
      },
      // PK position
      {
        id: '12345',
        name: 'Tucker, Justin',
        position: 'PK',
        team: 'BLT',
        espn_id: '15683',
      },
    ],
  },
};

const mockCollegeIds = {
  meta: { generatedAt: '2026-01-01' },
  players: {
    '99999': { espnCollegeId: '9876543', name: 'John Smith', college: 'Test U' },
  },
  unmatched: [],
};

describe('player-map', () => {
  let getPlayerMap: typeof import('../src/utils/player-map').getPlayerMap;
  let getPlayer: typeof import('../src/utils/player-map').getPlayer;
  let clearPlayerMapCache: typeof import('../src/utils/player-map').clearPlayerMapCache;

  beforeEach(async () => {
    vi.resetModules();

    mockReadFileSync.mockImplementation((filePath: any) => {
      const path = String(filePath);
      if (path.includes('players.json')) {
        return JSON.stringify(mockFeedData);
      }
      if (path.includes('espn-college-ids.json')) {
        return JSON.stringify(mockCollegeIds);
      }
      throw new Error(`File not found: ${path}`);
    });

    const mod = await import('../src/utils/player-map');
    getPlayerMap = mod.getPlayerMap;
    getPlayer = mod.getPlayer;
    clearPlayerMapCache = mod.clearPlayerMapCache;
    clearPlayerMapCache();
  });

  describe('getPlayerMap', () => {
    it('returns a Map with fantasy-relevant players only', () => {
      const map = getPlayerMap(2026);
      // Should include QB, WR, Def, RB, PK
      expect(map.has('13116')).toBe(true); // QB
      expect(map.has('14836')).toBe(true); // WR
      expect(map.has('0521')).toBe(true);  // Def
      expect(map.has('11111')).toBe(true); // RB
      expect(map.has('12345')).toBe(true); // PK
      // Should exclude LB, CB
      expect(map.has('50000')).toBe(false);
      expect(map.has('50001')).toBe(false);
    });

    it('converts "Last, First" to "First Last" for regular players', () => {
      const map = getPlayerMap(2026);
      expect(map.get('13116')!.name).toBe('Patrick Mahomes');
      expect(map.get('14836')!.name).toBe("Ja'Marr Chase");
    });

    it('formats DEF names as "City Team"', () => {
      const map = getPlayerMap(2026);
      expect(map.get('0521')!.name).toBe('Kansas City Chiefs');
    });

    it('normalizes MFL team codes to ESPN format', () => {
      const map = getPlayerMap(2026);
      expect(map.get('13116')!.nflTeam).toBe('KC');   // KCC → KC
      expect(map.get('99999')!.nflTeam).toBe('NE');   // NEP → NE
      expect(map.get('14000')!.nflTeam).toBe('JAX');  // JAC → JAX
      expect(map.get('12345')!.nflTeam).toBe('BAL');  // BLT → BAL
    });

    it('normalizes free agent team code', () => {
      const map = getPlayerMap(2026);
      expect(map.get('11111')!.nflTeam).toBe('NFL');  // FA → NFL
    });

    it('normalizes "Def" position to "DEF"', () => {
      const map = getPlayerMap(2026);
      expect(map.get('0521')!.position).toBe('DEF');
    });

    it('resolves ESPN ID from feed first', () => {
      const map = getPlayerMap(2026);
      expect(map.get('13116')!.espnId).toBe('3139477');
    });

    it('falls back to college ESPN ID when feed has none', () => {
      const map = getPlayerMap(2026);
      expect(map.get('99999')!.espnId).toBe('9876543');
    });

    it('returns null espnId when neither source has it', () => {
      const map = getPlayerMap(2026);
      expect(map.get('0521')!.espnId).toBeNull(); // DEF has no ESPN ID
    });

    it('generates headshot URL with ESPN ID when available', () => {
      const map = getPlayerMap(2026);
      expect(map.get('13116')!.headshot).toContain('espncdn.com');
      expect(map.get('13116')!.headshot).toContain('3139477');
    });

    it('generates MFL headshot URL when no ESPN ID', () => {
      const map = getPlayerMap(2026);
      // DEF with college ID fallback should use that college ID for headshot
      // Player 0521 has no ESPN ID at all
      expect(map.get('0521')!.headshot).toContain('myfantasyleague.com');
    });

    it('caches results — same Map instance on repeated calls', () => {
      const map1 = getPlayerMap(2026);
      const map2 = getPlayerMap(2026);
      expect(map1).toBe(map2);
    });

    it('returns empty Map for missing year', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      clearPlayerMapCache();
      const map = getPlayerMap(2099);
      expect(map.size).toBe(0);
    });
  });

  describe('getPlayer', () => {
    it('returns PlayerIdentity for known player', () => {
      const player = getPlayer(2026, '13116');
      expect(player).toEqual({
        mflId: '13116',
        name: 'Patrick Mahomes',
        position: 'QB',
        nflTeam: 'KC',
        headshot: expect.stringContaining('3139477'),
        espnId: '3139477',
      });
    });

    it('returns undefined for unknown player', () => {
      expect(getPlayer(2026, 'nonexistent')).toBeUndefined();
    });
  });
});
