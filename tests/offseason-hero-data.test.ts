import { describe, it, expect } from 'vitest';
import {
  getChampionshipResult,
  getTaggedPlayers,
  getCutCandidates,
  isDraftComplete,
} from '../src/utils/offseason-hero-data';

// These tests use real data files from the repo.
// 2025 season has completed playoff brackets and a full draft.
// 2026 season has empty draft results and current rosters.

describe('getChampionshipResult', () => {
  it('returns null for a non-existent year', () => {
    expect(getChampionshipResult(1999)).toBeNull();
  });

  it('extracts the 2025 championship result correctly', () => {
    // 2025 championship: franchise 0010 beat 0015, 132.29 - 96.78
    const result = getChampionshipResult(2025);
    expect(result).not.toBeNull();
    expect(result!.winnerFranchiseId).toBe('0010');
    expect(result!.loserFranchiseId).toBe('0015');
    expect(result!.winnerScore).toBe(132.29);
    expect(result!.loserScore).toBe(96.78);
  });
});

describe('getTaggedPlayers', () => {
  it('returns empty array for a non-existent year', () => {
    expect(getTaggedPlayers(1999)).toEqual([]);
  });

  it('returns empty array for 2025 (no FRANCHISE_TAG transactions in data)', () => {
    // Current data has no FRANCHISE_TAG transactions
    const result = getTaggedPlayers(2025);
    expect(result).toEqual([]);
  });

  it('returns empty array for 2026 (no FRANCHISE_TAG transactions yet)', () => {
    const result = getTaggedPlayers(2026);
    expect(result).toEqual([]);
  });
});

describe('getCutCandidates', () => {
  it('returns empty array for a non-existent year', () => {
    expect(getCutCandidates(1999)).toEqual([]);
  });

  it('returns data for 2026 rosters', () => {
    const result = getCutCandidates(2026);
    // Result should be an array (may or may not have over-limit teams)
    expect(Array.isArray(result)).toBe(true);

    // Each entry should have the right shape
    for (const team of result) {
      expect(team.franchiseId).toBeTruthy();
      expect(team.activeCount).toBeGreaterThan(22);
      expect(team.cutCandidates.length).toBeGreaterThan(0);
      // Cut candidates should be sorted by salary ascending
      for (let i = 1; i < team.cutCandidates.length; i++) {
        expect(team.cutCandidates[i].salary).toBeGreaterThanOrEqual(team.cutCandidates[i - 1].salary);
      }
    }
  });

  it('cut candidates have valid player IDs and salaries', () => {
    const result = getCutCandidates(2026);
    for (const team of result) {
      for (const c of team.cutCandidates) {
        expect(c.playerId).toBeTruthy();
        expect(c.salary).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('isDraftComplete', () => {
  it('returns false for a non-existent year', () => {
    expect(isDraftComplete(1999)).toBe(false);
  });

  it('returns false for 2026 (draft has not started)', () => {
    // 2026 draft picks all have empty player fields
    expect(isDraftComplete(2026)).toBe(false);
  });

  it('returns true for 2025 (completed draft)', () => {
    // 2025 draft should be complete (all picks filled)
    expect(isDraftComplete(2025)).toBe(true);
  });
});
