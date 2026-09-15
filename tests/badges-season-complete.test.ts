import { describe, it, expect } from 'vitest';
import { buildBadgeContext, computeBadgesFor } from '../scripts/badges.mjs';

// Sept 2026: one week into the season, the nightly franchise-history run
// awarded Top of the Standings, League Scoring Champ and Cellar Dweller for
// 2026 off the week-1 table, and the milestone diff posted all three to the
// Schefter feed ("closed 2026 at the bottom of the standings"). Single-season
// badges must wait for the season to finish.

const season = (year: number, wins: number, losses: number, rank: number, pointsFor: number) => ({
  year,
  wins,
  losses,
  ties: 0,
  pointsFor,
  regSeasonRank: rank,
  playoffResult: null,
});

const franchises = {
  '0006': {
    franchiseId: '0006',
    yearByYear: [season(2025, 12, 2, 1, 2100), season(2026, 0, 2, 2, 90)],
    highlights: {},
    trades: [],
  },
  '0016': {
    franchiseId: '0016',
    yearByYear: [season(2025, 2, 12, 2, 1500), season(2026, 2, 0, 1, 164)],
    highlights: {},
    trades: [],
  },
};

const summaries = (complete2026: boolean | undefined) => [
  { year: 2025, leagueSize: 2, seasonComplete: true },
  { year: 2026, leagueSize: 2, ...(complete2026 === undefined ? {} : { seasonComplete: complete2026 }) },
];

const seasonYears = (fid: '0006' | '0016', complete2026: boolean | undefined) => {
  const ctx = buildBadgeContext(franchises, summaries(complete2026));
  return computeBadgesFor(franchises[fid], ctx)
    .filter((b: { tier: string }) => b.tier === 'season')
    .flatMap((b: { id: string; awards: { year?: number }[] }) =>
      b.awards.map((a) => `${b.id}:${a.year}`)
    )
    .sort();
};

describe('single-season badges wait for the season to finish', () => {
  it('awards nothing for an in-progress season', () => {
    expect(seasonYears('0016', false)).toEqual(['cellar-dweller:2025']);
    expect(seasonYears('0006', false)).toEqual([
      'best-record:2025',
      'highest-scoring-season-ever:2025',
      'top-scorer:2025',
    ]);
  });

  it('awards the season once it is complete', () => {
    expect(seasonYears('0016', true)).toEqual([
      'best-record:2026',
      'cellar-dweller:2025',
      'top-scorer:2026',
    ]);
    expect(seasonYears('0006', true)).toContain('cellar-dweller:2026');
  });

  it('treats a summary with no seasonComplete field as complete', () => {
    expect(seasonYears('0016', undefined)).toEqual(seasonYears('0016', true));
  });
});
