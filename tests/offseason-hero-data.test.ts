import fs from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getChampionshipResult,
  getTaggedPlayers,
  getCutCandidates,
  isDraftComplete,
  areAllDraftPicksFilled,
  getLatestScoredWeek,
  getWeekInTheBooks,
  getMarqueeGameStars,
  getWeeklyTopScorerCandidates,
} from '../src/utils/offseason-hero-data';
import { nflWeekFor } from '../src/utils/nfl-week-starts.mjs';
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

  // No assertion on the live/in-progress year: its playerScores feed fills in
  // as the season plays, so a hardcoded expectation would go flaky. The
  // missing-feed path (→ 0) is covered by the non-existent year below.
  it('returns 0 for a non-existent year (no feed on disk)', () => {
    expect(getLatestScoredWeek(1999)).toBe(0);
  });
});

/**
 * THE BUG THIS EXISTS FOR (issue #1086 F1).
 *
 * MFL's playerScores export is fetched with no `W=`, so the feed on disk holds
 * exactly ONE week — whatever MFL currently considers live. The recap hero read
 * the max week in it and called that "the week in the books". The moment MFL
 * rolls the feed to the upcoming week, with nothing played, that number jumps
 * and the hero names and links a week nobody has played — which is the same
 * Tuesday-morning failure the hero was just fixed for from the `getCurrentNFLWeek`
 * side. The calendar supplies the ceiling the feed cannot.
 */
describe('getWeeklyTopScorerCandidates — week scoping keeps label and data honest', () => {
  // The recap card labels its top scorer with a week. That label is capped at
  // the calendar while the feed holds whatever week MFL considers live, so the
  // read has to be scoped to the SAME week or the card can caption week N's
  // numbers as week N-1's. A disagreement must yield nothing, not a wrong card.
  it('returns the feed week\'s scorers when asked for that week', () => {
    const scoped = getWeeklyTopScorerCandidates(2025, 'theleague', 17);
    expect(scoped.length).toBeGreaterThan(0);
    // Same answer as the unfiltered read, because the feed IS week 17.
    expect(scoped.length).toBe(getWeeklyTopScorerCandidates(2025).length);
  });

  it('returns NOTHING when asked for a week the feed does not hold', () => {
    expect(getWeeklyTopScorerCandidates(2025, 'theleague', 16)).toEqual([]);
    expect(getWeeklyTopScorerCandidates(2025, 'theleague', 18)).toEqual([]);
  });

  it('is unfiltered when no week is given (the AFL casting path)', () => {
    expect(getWeeklyTopScorerCandidates(2025).length).toBeGreaterThan(0);
  });
});

describe('getWeekInTheBooks — the feed may never outrun the calendar', () => {
  // nflWeekFor hands week N over to N+1 on the TUESDAY after N opened, so
  // inside week N's window the last week that CAN be complete is N-1.
  const TUE_WEEK_2 = new Date('2026-09-15T06:00:00-07:00'); // week 2's window
  const TUE_WEEK_3 = new Date('2026-09-22T06:00:00-07:00'); // week 3's window
  const PRESEASON = new Date('2026-08-01T06:00:00-07:00');

  // The 2026 cases run against a FIXTURE feed, never the committed one: that
  // file is the live season, and cron rolls it forward every week. Pinned to
  // it, these assertions held for exactly one week and then went red on main
  // (2026-09-22, when the feed reached week 2). Only 2026's playerScores is
  // substituted — the frozen 2025 cases below still read the real archive.
  function withFeedWeek(week: number): void {
    const hit = (p: unknown) =>
      typeof p === 'string' && /[\\/]mfl-feeds[\\/]2026[\\/]playerScores\.json$/.test(p);
    const body = JSON.stringify({
      playerScores: {
        playerScore: week > 0 ? [{ id: '1', week: String(week), score: '1.0' }] : [],
      },
    });
    const realExists = fs.existsSync;
    const realRead = fs.readFileSync;
    vi.spyOn(fs, 'existsSync').mockImplementation(((p: fs.PathLike) =>
      hit(p) ? true : realExists(p)) as typeof fs.existsSync);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, ...rest: any[]) =>
      hit(p) ? body : (realRead as any)(p, ...rest)) as typeof fs.readFileSync);
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('agrees with the feed when the feed is behind the calendar', () => {
    // The live case on the day this shipped: week 1 played, week 2 under way.
    withFeedWeek(1);
    expect(getLatestScoredWeek(2026, 'theleague')).toBe(1);
    expect(getWeekInTheBooks(2026, 'theleague', TUE_WEEK_2)).toBe(1);
    expect(getWeekInTheBooks(2026, 'afl-fantasy', TUE_WEEK_2)).toBe(1);
  });

  it('does not invent a week the feed has no scores for', () => {
    // A ceiling, not a floor. Deep into week 3's window a feed that still only
    // carries week 1 answers week 1.
    withFeedWeek(1);
    expect(getWeekInTheBooks(2026, 'theleague', TUE_WEEK_3)).toBe(1);
  });

  it('caps a current-season feed that rolled on Tuesday morning', () => {
    // MFL moved the feed to week 2 inside week 2's own window: nothing of week
    // 2 is played, so the answer is still week 1.
    withFeedWeek(2);
    expect(getLatestScoredWeek(2026, 'theleague')).toBe(2);
    expect(getWeekInTheBooks(2026, 'theleague', TUE_WEEK_2)).toBe(1);
    expect(getWeekInTheBooks(2026, 'theleague', TUE_WEEK_3)).toBe(2);
  });

  it('CAPS a feed that has rolled ahead of the games', () => {
    // The F1 failure, simulated: the 2025 feed carries week 17, read at a date
    // inside the 2025 season when only week 4 could possibly be complete. The
    // raw reading is 17; the answer must be 4. This is exactly the shape of
    // "MFL rolled playerScores before Tuesday morning".
    const insideWeek5 = new Date('2025-10-07T06:00:00-07:00');
    expect(getLatestScoredWeek(2025)).toBe(17);
    const capped = getWeekInTheBooks(2025, 'theleague', insideWeek5);
    expect(capped).toBeLessThan(17);
    expect(capped).toBe(nflWeekFor(2025, insideWeek5) - 1);
  });

  it('is 0 before the season has played a down', () => {
    // The committed feed carries week 1 rows year-round, so the raw reading
    // says 1 even in August. No week is in the books in August.
    withFeedWeek(1);
    expect(getLatestScoredWeek(2026, 'theleague')).toBe(1);
    expect(getWeekInTheBooks(2026, 'theleague', PRESEASON)).toBe(0);
  });

  it('leaves a frozen archive season alone', () => {
    // nflWeekFor saturates at MAX_WEEK for a season long past, so the ceiling
    // never bites on an archive year and the hero still reads its real week.
    expect(getWeekInTheBooks(2025, 'theleague', TUE_WEEK_2)).toBe(17);
  });

  it('returns 0 when there is no feed at all', () => {
    expect(getWeekInTheBooks(1999, 'theleague', TUE_WEEK_2)).toBe(0);
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
