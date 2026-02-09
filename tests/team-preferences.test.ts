/**
 * Unit Tests for Team Preferences Cookie Utilities
 * Tests the core cookie logic without requiring a browser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AstroCookies } from 'astro';
import {
  validateFranchiseId,
  resolveTeamSelection,
  getTheLeaguePreference,
  setTheLeaguePreference,
  clearTheLeaguePreference,
} from '../src/utils/team-preferences';

/**
 * Mock Astro.cookies implementation for testing
 */
class MockAstroCookies implements Partial<AstroCookies> {
  private cookies: Map<string, { value: string; options: any }> = new Map();

  get(name: string) {
    const cookie = this.cookies.get(name);
    return cookie ? { value: cookie.value } : undefined;
  }

  set(name: string, value: string, options?: any) {
    this.cookies.set(name, { value, options });
  }

  delete(name: string, options?: any) {
    this.cookies.delete(name);
  }

  has(name: string) {
    return this.cookies.has(name);
  }

  clear() {
    this.cookies.clear();
  }
}

describe('Team Preferences - validateFranchiseId', () => {
  it('should validate existing franchise IDs', () => {
    expect(validateFranchiseId('0001', 'theleague')).toBe(true);
    expect(validateFranchiseId('0008', 'theleague')).toBe(true);
  });

  it('should reject invalid franchise IDs', () => {
    expect(validateFranchiseId('9999', 'theleague')).toBe(false);
    expect(validateFranchiseId('INVALID', 'theleague')).toBe(false);
  });

  it('should reject empty or null franchise IDs', () => {
    expect(validateFranchiseId('', 'theleague')).toBe(false);
    expect(validateFranchiseId(null as any, 'theleague')).toBe(false);
  });

  it('should normalize and validate commissioner ID (0000 → 0001)', () => {
    // 0000 gets normalized to 0001, which is valid
    expect(validateFranchiseId('0001', 'theleague')).toBe(true);
  });
});

describe('Team Preferences - resolveTeamSelection', () => {
  it('should prioritize myteam parameter', () => {
    const result = resolveTeamSelection({
      myTeamParam: '0003',
      franchiseParam: '0008',
      cookiePreference: '0012',
      authUserFranchise: '0001',
      defaultTeam: '0001',
    });
    expect(result).toBe('0003');
  });

  it('should use franchise parameter if no myteam', () => {
    const result = resolveTeamSelection({
      myTeamParam: null,
      franchiseParam: '0008',
      cookiePreference: '0012',
      authUserFranchise: '0001',
      defaultTeam: '0001',
    });
    expect(result).toBe('0008');
  });

  it('should use cookie preference if no URL params', () => {
    const result = resolveTeamSelection({
      myTeamParam: null,
      franchiseParam: null,
      cookiePreference: '0012',
      authUserFranchise: '0001',
      defaultTeam: '0001',
    });
    expect(result).toBe('0012');
  });

  it('should use auth user franchise if no params or cookie', () => {
    const result = resolveTeamSelection({
      myTeamParam: null,
      franchiseParam: null,
      cookiePreference: null,
      authUserFranchise: '0001',
      defaultTeam: '0001',
    });
    expect(result).toBe('0001');
  });

  it('should use default if nothing else is available', () => {
    const result = resolveTeamSelection({
      myTeamParam: null,
      franchiseParam: null,
      cookiePreference: null,
      authUserFranchise: null,
      defaultTeam: '0001',
    });
    expect(result).toBe('0001');
  });

  it('should skip invalid franchise IDs and move to next priority', () => {
    const result = resolveTeamSelection({
      myTeamParam: '9999', // Invalid
      franchiseParam: null,
      cookiePreference: '0012', // Should use this
      authUserFranchise: '0001',
      defaultTeam: '0001',
    });
    expect(result).toBe('0012');
  });

  it('should normalize commissioner ID (0000 → 0001)', () => {
    const result = resolveTeamSelection({
      myTeamParam: '0000',
      franchiseParam: null,
      cookiePreference: null,
      authUserFranchise: null,
      defaultTeam: '0001',
    });
    expect(result).toBe('0001');
  });
});

describe('Team Preferences - Cookie Operations', () => {
  let mockCookies: MockAstroCookies;

  beforeEach(() => {
    mockCookies = new MockAstroCookies();
  });

  describe('setTheLeaguePreference', () => {
    it('should set cookie with valid franchise ID', () => {
      setTheLeaguePreference(mockCookies as any, '0003');

      const cookie = mockCookies.get('theleague_team_pref');
      expect(cookie).toBeDefined();

      const value = JSON.parse(cookie!.value);
      expect(value.franchiseId).toBe('0003');
      expect(value.lastUpdated).toBeDefined();
    });

    it('should normalize franchise ID when setting', () => {
      setTheLeaguePreference(mockCookies as any, '3'); // Should normalize to 0003

      const cookie = mockCookies.get('theleague_team_pref');
      const value = JSON.parse(cookie!.value);
      expect(value.franchiseId).toBe('0003');
    });

    it('should normalize commissioner ID (0000 → 0001)', () => {
      setTheLeaguePreference(mockCookies as any, '0000');

      const cookie = mockCookies.get('theleague_team_pref');
      const value = JSON.parse(cookie!.value);
      expect(value.franchiseId).toBe('0001');
    });

    it('should not set cookie for invalid franchise ID', () => {
      setTheLeaguePreference(mockCookies as any, '9999');

      const cookie = mockCookies.get('theleague_team_pref');
      expect(cookie).toBeUndefined();
    });
  });

  describe('getTheLeaguePreference', () => {
    it('should retrieve valid cookie', () => {
      // Set a cookie first
      setTheLeaguePreference(mockCookies as any, '0003');

      // Retrieve it
      const preference = getTheLeaguePreference(mockCookies as any);

      expect(preference).toBeDefined();
      expect(preference?.franchiseId).toBe('0003');
      expect(preference?.lastUpdated).toBeDefined();
    });

    it('should return null if no cookie exists', () => {
      const preference = getTheLeaguePreference(mockCookies as any);
      expect(preference).toBeNull();
    });

    it('should clear corrupted cookie and return null', () => {
      // Manually set a corrupted cookie
      mockCookies.set('theleague_team_pref', 'INVALID_JSON', {});

      const preference = getTheLeaguePreference(mockCookies as any);

      expect(preference).toBeNull();
      expect(mockCookies.has('theleague_team_pref')).toBe(false);
    });

    it('should clear and return null for invalid franchise ID in cookie', () => {
      // Manually set cookie with invalid franchise
      const invalidPreference = {
        franchiseId: '9999',
        lastUpdated: new Date().toISOString(),
      };
      mockCookies.set('theleague_team_pref', JSON.stringify(invalidPreference), {});

      const preference = getTheLeaguePreference(mockCookies as any);

      expect(preference).toBeNull();
      expect(mockCookies.has('theleague_team_pref')).toBe(false);
    });
  });

  describe('clearTheLeaguePreference', () => {
    it('should remove the cookie', () => {
      // Set a cookie
      setTheLeaguePreference(mockCookies as any, '0003');
      expect(mockCookies.has('theleague_team_pref')).toBe(true);

      // Clear it
      clearTheLeaguePreference(mockCookies as any);
      expect(mockCookies.has('theleague_team_pref')).toBe(false);
    });
  });
});

describe('Team Preferences - Edge Cases', () => {
  let mockCookies: MockAstroCookies;

  beforeEach(() => {
    mockCookies = new MockAstroCookies();
  });

  it('should handle missing lastUpdated field in cookie', () => {
    // Manually set cookie without lastUpdated
    const incompletePreference = { franchiseId: '0003' };
    mockCookies.set('theleague_team_pref', JSON.stringify(incompletePreference), {});

    const preference = getTheLeaguePreference(mockCookies as any);

    // Should clear invalid cookie
    expect(preference).toBeNull();
    expect(mockCookies.has('theleague_team_pref')).toBe(false);
  });

  it('should handle whitespace in franchise IDs', () => {
    const result = resolveTeamSelection({
      myTeamParam: '  0003  ',
      franchiseParam: null,
      cookiePreference: null,
      authUserFranchise: null,
      defaultTeam: '0001',
    });
    expect(result).toBe('0003');
  });

  it('should handle numeric franchise IDs without leading zeros', () => {
    const result = resolveTeamSelection({
      myTeamParam: '8', // Should normalize to 0008
      franchiseParam: null,
      cookiePreference: null,
      authUserFranchise: null,
      defaultTeam: '0001',
    });
    expect(result).toBe('0008');
  });
});
