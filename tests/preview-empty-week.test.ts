import { describe, it, expect } from 'vitest';
import path from 'node:path';

/**
 * A preview of a week with no matchups must not publish.
 *
 * THE BUG THIS EXISTS FOR. On 2026-09-11 the Friday column published "Week 0:
 * TheLeague Waits for Kickoff", an article whose entire body was "There are no
 * matchups scheduled for Week 0 of the 2026 season."
 *
 * The cause is a week-resolution mismatch that is still live: the runner
 * targets `opts.week ?? completedWeek` for every article type
 * (schefter-weekly-articles.mjs), while the two forward-looking columns guard
 * on `currentWeek`. Before the season's first week finishes, completedWeek is
 * 0, `getMatchupPairings(raw, 0)` returns nothing, and the column writes a
 * preview of a week that does not exist. Demoting the tier keeps that post off
 * the breaking hero but not out of the feed — and `ArticleHero#findArticle`
 * matches a Friday-slot article on a headline regex (/preview|weekend/i), so an
 * empty preview would still be fronted in the normal rotation.
 *
 * So the columns decline instead, via the pipeline's documented clean skip: a
 * null fact sheet exits 0 without spending an Anthropic call.
 */
const TYPES_DIR = path.resolve(__dirname, '../scripts/article-types');
const ROOT = path.resolve(__dirname, '..');

/** The forward-looking columns — the two that can outrun the results feed. */
const PREVIEW_TYPES = ['weekend-preview', 'matchup-preview'];

/** Minimal pipeline data; `weeklyResultsRaw` is the only part under test. */
function data(weeklyResultsRaw: unknown[]) {
  return {
    players: { players: { player: [] } },
    projectedScores: { projectedScores: { playerScore: [] } },
    rosters: { rosters: { franchise: [] } },
    standings: { leagueStandings: { franchise: [] } },
    league: { league: {} },
    'weekly-results-raw': weeklyResultsRaw,
  };
}

/** One real-shaped matchup, so the positive control is not vacuous. */
const weekWithGames = (week: number) => [
  {
    weeklyResults: {
      week: String(week),
      matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }],
    },
  },
];

describe('a preview with no matchups declines to publish', () => {
  for (const type of PREVIEW_TYPES) {
    it(`${type} returns null for a week with no pairings`, async () => {
      const mod = await import(path.join(TYPES_DIR, `${type}.mjs`));
      // Week 0 with an empty results feed: exactly the season-opener state that
      // produced sf_2026_weekend_preview_w00.
      const result = await mod.buildFactSheet(data([]), 0, 2026, ROOT, { league: 'theleague' });
      expect(result).toBeNull();
    });

    it(`${type} returns null when the feed has other weeks but not this one`, async () => {
      const mod = await import(path.join(TYPES_DIR, `${type}.mjs`));
      const result = await mod.buildFactSheet(data(weekWithGames(5)), 4, 2026, ROOT, { league: 'theleague' });
      expect(result).toBeNull();
    });

    // Positive control: the guard must not swallow a week that HAS games, or it
    // would silence the column every week instead of only the empty ones.
    it(`${type} still builds a fact sheet for a week with matchups`, async () => {
      const mod = await import(path.join(TYPES_DIR, `${type}.mjs`));
      const result = await mod.buildFactSheet(data(weekWithGames(5)), 5, 2026, ROOT, { league: 'theleague' });
      expect(result).not.toBeNull();
      expect(result.factSheet).toContain('WEEK 5');
    });
  }
});
