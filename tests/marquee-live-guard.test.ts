import { describe, it, expect, vi } from 'vitest';

/**
 * Regression guard for the marquee-game score source (found by the Codex
 * review of PR #361): a LIVE current-week game must be scored by PROJECTION
 * only. When the projection feed is empty/unpublished, the hero must come up
 * empty and fall back — it must NEVER borrow the last completed week's box
 * score, which would headline the wrong players mid-week.
 *
 * The scenario needs a fabricated feed set (live schedule + empty projections +
 * populated prior-week actuals), so this file mocks node:fs in isolation. It
 * uses a throwaway year (3025) so the player-map module cache can't collide
 * with the real-data tests.
 */

const YEAR = 3025;

// Live schedule (week 5), EMPTY projections, and week-4 actuals for both teams.
const FILES: Record<string, unknown> = {
  [`mfl-feeds/${YEAR}/nflSchedule.json`]: {
    nflSchedule: {
      week: '5',
      matchup: [
        { kickoff: '1000000', team: [{ id: 'DAL', isHome: '0' }, { id: 'PHI', isHome: '1' }] },
      ],
    },
  },
  [`mfl-feeds/${YEAR}/projectedScores.json`]: {
    projectedScores: { week: '5', playerScore: [{ id: '', score: '' }] },
  },
  [`mfl-feeds/${YEAR}/playerScores.json`]: {
    playerScores: {
      playerScore: [
        { id: 'p1', week: '4', score: '30.0' },
        { id: 'p2', week: '4', score: '25.0' },
      ],
    },
  },
  [`mfl-feeds/${YEAR}/rosters.json`]: { rosters: { franchise: [] } },
  [`mfl-feeds/${YEAR}/players.json`]: {
    players: {
      player: [
        { id: 'p1', name: 'Away, Star', position: 'QB', team: 'DAL' },
        { id: 'p2', name: 'Home, Star', position: 'RB', team: 'PHI' },
      ],
    },
  },
};

function findFile(p: string): unknown {
  for (const key of Object.keys(FILES)) {
    if (p.includes(key)) return FILES[key];
  }
  return null;
}

vi.mock('node:fs', () => {
  const existsSync = (p: string) => findFile(String(p)) !== null;
  const readFileSync = (p: string) => {
    const f = findFile(String(p));
    // Unmatched reads (e.g. espn-college-ids.json) get empty JSON so callers
    // that JSON.parse without an existence check don't throw.
    return f ? JSON.stringify(f) : '{}';
  };
  return { default: { existsSync, readFileSync }, existsSync, readFileSync };
});

describe('getMarqueeGameStars — live week never borrows last week\'s box score', () => {
  it('returns null when the live game has no published projections', async () => {
    const { getMarqueeGameStars } = await import('../src/utils/offseason-hero-data');
    // Live schedule present + projections empty → no scored stars → fallback.
    // (On the pre-fix code this returned the week-4 actual leaders instead.)
    expect(getMarqueeGameStars(YEAR)).toBeNull();
  });
});
