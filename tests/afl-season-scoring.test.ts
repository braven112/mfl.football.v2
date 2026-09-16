import { describe, it, expect } from 'vitest';

import { processWeeklyScores } from '../src/utils/coach-data';
import {
  loadAflSeasonScores,
  summarizeSeasonScores,
} from '../src/utils/afl-player-scoring';

/**
 * Guard: the AFL roster page's Total / Avg columns.
 *
 * Two AFL-specific facts make the obvious implementation — sum every score
 * row in `weekly-results-raw.json` — wrong by a factor of two or four:
 *
 *   1. The same NFL player is routinely rostered in BOTH conferences, so he
 *      appears once per conference every week (Breece Hall sat on 0001 and
 *      0024 for all of 2025).
 *   2. The AFL plays double-header weeks, where a franchise appears in two
 *      matchups and its players' scores are listed a second time.
 *
 * The fix is to key scores per WEEK rather than accumulate them, which is what
 * `processWeeklyScores` does — so what this pins is that the roster page's
 * season math goes through that map and never re-adds a duplicated row.
 *
 * It also pins the denominator: a bye carries NO score field in this feed and
 * must not count as a game played, while a real 0.00 must.
 */

/** Two conferences × a double-header week: one player, four identical rows. */
const DOUBLE_HEADER_WEEK = {
  weeklyResults: {
    week: '1',
    matchup: [
      {
        franchise: [
          { id: '0001', player: [{ id: '15708', score: '16.50', status: 'nonstarter' }] },
          { id: '0002', player: [{ id: '15708', score: '16.50', status: 'starter' }] },
        ],
      },
      {
        franchise: [
          { id: '0024', player: [{ id: '15708', score: '16.50', status: 'starter' }] },
          { id: '0023', player: [{ id: '15708', score: '16.50', status: 'starter' }] },
        ],
      },
    ],
  },
};

/** A normal week, a bye (no score field at all), and a real zero. */
const LATER_WEEKS = [
  {
    weeklyResults: {
      week: '2',
      matchup: [
        {
          franchise: [
            { id: '0001', player: [{ id: '15708', score: '5.80', status: 'starter' }] },
          ],
        },
      ],
    },
  },
  {
    weeklyResults: {
      week: '3',
      matchup: [
        {
          franchise: [
            // NYJ bye — MFL lists the player with no `score` key.
            { id: '0001', player: [{ id: '15708', status: 'nonstarter' }] },
            { id: '0002', player: [{ id: '16579', score: '0.00', status: 'starter' }] },
          ],
        },
      ],
    },
  },
];

describe('AFL season scoring counts each week once', () => {
  const scores = processWeeklyScores([DOUBLE_HEADER_WEEK, ...LATER_WEEKS], 3);

  it('does not double-count a player rostered in both conferences on a double-header week', () => {
    const season = summarizeSeasonScores(scores, '15708');

    // 16.50 once (not 66.00) + 5.80. Week 3 is a bye and contributes nothing.
    expect(season.total).toBeCloseTo(22.3, 5);
    expect(season.games).toBe(2);
    expect(season.average).toBeCloseTo(11.15, 5);
  });

  it('reports the most recent SCORED week, skipping the bye', () => {
    const season = summarizeSeasonScores(scores, '15708');

    expect(season.lastWeek).toBe(2);
    expect(season.lastScore).toBeCloseTo(5.8, 5);
  });

  it('counts a real 0.00 as a game played', () => {
    const season = summarizeSeasonScores(scores, '16579');

    expect(season.total).toBe(0);
    expect(season.games).toBe(1);
    expect(season.average).toBe(0);
  });

  it('returns nulls — never 0 — for a player with no scored week', () => {
    const season = summarizeSeasonScores(scores, '99999');

    expect(season).toEqual({
      total: null,
      games: 0,
      average: null,
      lastScore: null,
      lastWeek: null,
    });
  });
});

describe('loadAflSeasonScores degrades instead of throwing', () => {
  it('returns an empty map for a season with no feed on disk', () => {
    // Archive seasons are deliberately excluded from the serverless bundle
    // (scripts/lib/archived-feed-files.mjs), so a missing file is a normal
    // runtime state, not an error — the page renders an em dash.
    expect(loadAflSeasonScores(1999).size).toBe(0);
  });

  it('reads the committed current-season feed as a per-week map', () => {
    const scores = loadAflSeasonScores(2026);

    expect(scores.size).toBeGreaterThan(0);
    for (const byWeek of scores.values()) {
      for (const [week, score] of Object.entries(byWeek)) {
        expect(Number(week)).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(score)).toBe(true);
      }
    }
  });
});
