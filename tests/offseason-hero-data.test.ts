import { describe, it, expect } from 'vitest';
import {
  getChampionshipResult,
  getTaggedPlayers,
  getCutCandidates,
  isDraftComplete,
  areAllDraftPicksFilled,
  selectBreakingStory,
} from '../src/utils/offseason-hero-data';

// These tests use real data files from the repo for FROZEN historical years
// only (their feeds never change). Anything about the current/in-progress
// year must use fixtures — live data flips state as the season advances.

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

  it('returns true for 2025 (completed draft, frozen data)', () => {
    expect(isDraftComplete(2025)).toBe(true);
  });
});

describe('selectBreakingStory (fixtures)', () => {
  const at = (iso: string, over: Record<string, unknown> = {}) => ({
    id: 'sf_x',
    tier: 'breaking',
    playerIds: ['15282'],
    headline: 'Mafia open the vault for DeVonta Smith',
    hotTake: 'League sources say the room tapped out.',
    timestamp: iso,
    ...over,
  });
  const REF = new Date('2026-03-25T12:00:00Z');

  it('returns null for junk / non-array input', () => {
    expect(selectBreakingStory(undefined, REF)).toBeNull();
    expect(selectBreakingStory([], REF)).toBeNull();
  });

  it('picks the freshest breaking post within the 48h window', () => {
    const posts = [
      at('2026-03-24T21:45:00Z', { headline: 'newest', playerIds: ['1'] }),
      at('2026-03-24T09:00:00Z', { headline: 'older' }),
    ];
    const story = selectBreakingStory(posts, REF);
    expect(story?.headline).toBe('newest');
    expect(story?.id).toBe('sf_x');
    expect(story?.playerIds).toEqual(['1']);
    expect(story?.summary).toContain('tapped out');
    expect(story?.timestampMs).toBe(Date.parse('2026-03-24T21:45:00Z'));
  });

  it('excludes stale, future, non-breaking, and player-less posts', () => {
    expect(selectBreakingStory([at('2026-03-22T00:00:00Z')], REF)).toBeNull(); // >48h old
    expect(selectBreakingStory([at('2026-03-26T00:00:00Z')], REF)).toBeNull(); // future
    expect(selectBreakingStory([at('2026-03-25T00:00:00Z', { tier: 'standard' })], REF)).toBeNull();
    expect(selectBreakingStory([at('2026-03-25T00:00:00Z', { playerIds: [] })], REF)).toBeNull();
  });

  it('respects a custom window', () => {
    const posts = [at('2026-03-24T06:00:00Z')]; // ~30h before REF
    expect(selectBreakingStory(posts, REF, 24)).toBeNull();
    expect(selectBreakingStory(posts, REF, 48)).not.toBeNull();
  });
});

describe('areAllDraftPicksFilled (fixtures)', () => {
  const wrap = (draftPick: unknown) => ({ draftResults: { draftUnit: { draftPick } } });

  it('returns false for missing or empty data', () => {
    expect(areAllDraftPicksFilled(null)).toBe(false);
    expect(areAllDraftPicksFilled({})).toBe(false);
    expect(areAllDraftPicksFilled(wrap([]))).toBe(false);
  });

  it('returns false when any pick has an empty player field', () => {
    expect(areAllDraftPicksFilled(wrap([{ player: '12345' }, { player: '' }]))).toBe(false);
    expect(areAllDraftPicksFilled(wrap([{ player: '   ' }]))).toBe(false);
    expect(areAllDraftPicksFilled(wrap({ player: '' }))).toBe(false); // single pick, not array
  });

  it('returns true when every pick is filled', () => {
    expect(areAllDraftPicksFilled(wrap([{ player: '12345' }, { player: '67890' }]))).toBe(true);
    expect(areAllDraftPicksFilled(wrap({ player: '12345' }))).toBe(true);
  });
});
