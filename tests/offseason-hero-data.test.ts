import { describe, it, expect } from 'vitest';
import {
  getChampionshipResult,
  getTaggedPlayers,
  getCutCandidates,
  isDraftComplete,
  areAllDraftPicksFilled,
  getLatestScoredWeek,
  getMarqueeGameStars,
  getWeeklyTopScorerCandidates,
} from '../src/utils/offseason-hero-data';
import { castBestScoredModel } from '../src/utils/hero-casting';
import { getPlayerMap } from '../src/utils/player-map';

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

describe('getLatestScoredWeek', () => {
  it('returns the completed week from a frozen season feed (2025 → 17)', () => {
    expect(getLatestScoredWeek(2025)).toBe(17);
  });

  it('returns 0 out of season (2026 feed carries an empty week)', () => {
    expect(getLatestScoredWeek(2026)).toBe(0);
  });

  it('returns 0 for a non-existent year', () => {
    expect(getLatestScoredWeek(1999)).toBe(0);
  });
});

describe('recap slot — top scorer cast (frozen 2025)', () => {
  it('casts the week\'s highest actual scorer (Derrick Henry, 45.6)', () => {
    const candidates = getWeeklyTopScorerCandidates(2025);
    expect(candidates.length).toBeGreaterThan(0);
    const model = castBestScoredModel(candidates, getPlayerMap(2025), undefined, 'Top Scorer');
    expect(model).not.toBeNull();
    // Derrick Henry (MFL 12626) put up the top week-17 score in the frozen feed.
    expect(model!.mflId).toBe('12626');
    expect(model!.descriptor).toBe('Top Scorer');
    const winner = candidates.find((c) => c.playerId === model!.mflId);
    expect(winner!.score).toBeCloseTo(45.6, 1);
  });
});

describe('getMarqueeGameStars (frozen 2025 — completed-season fallback)', () => {
  const stars = getMarqueeGameStars(2025);

  it('resolves the earliest game of the latest scored week', () => {
    expect(stars).not.toBeNull();
    // Week 17's earliest kickoff in the frozen full-schedule feed is DAL @ WAS.
    expect(stars!.awayCode).toBe('DAL');
    expect(stars!.homeCode).toBe('WSH');
    expect(stars!.awayName).toBeTruthy();
    expect(stars!.homeName).toBeTruthy();
  });

  it('scores at least one player on each side (so the split panel is justified)', () => {
    expect(stars!.awayCandidates.some((c) => c.score > 0)).toBe(true);
    expect(stars!.homeCandidates.some((c) => c.score > 0)).toBe(true);
  });

  it('casts a distinct star for each side', () => {
    const players = getPlayerMap(2025);
    const away = castBestScoredModel(stars!.awayCandidates, players, undefined, 'Team Star');
    const home = castBestScoredModel(stars!.homeCandidates, players, undefined, 'Team Star');
    expect(away).not.toBeNull();
    expect(home).not.toBeNull();
    expect(away!.mflId).not.toBe(home!.mflId);
    expect(away!.nflTeam).toBe('DAL');
    expect(home!.nflTeam).toBe('WSH');
  });

  it('returns null for a year with no schedule or scores', () => {
    expect(getMarqueeGameStars(1999)).toBeNull();
  });
});
