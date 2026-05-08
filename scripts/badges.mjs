/**
 * Badge engine — Phase 3.
 *
 * Each badge definition has a `compute(fr, ctx)` that returns an array of
 * award instances (one entry per qualifying year/event, or a single
 * unparameterised entry for one-shot badges). Empty array means not earned.
 *
 * `buildBadgeContext(franchises)` is called once across the league to
 * pre-compute cross-franchise comparisons (league records, per-year leaders).
 *
 * `computeBadgesFor(fr, ctx)` runs every badge against one franchise and
 * returns the list of badges it earned.
 *
 * Badges intentionally don't duplicate the existing awards bar (League
 * Titles, Runner-Ups, Division Titles, MVP, Jerry Jones, Brock Osweiler) —
 * those are surfaced separately on the detail page.
 */

export const BADGE_TIERS = ['career', 'season', 'game'];

const TIER_LABEL = {
  career: 'Career',
  season: 'Single-Season',
  game: 'Single-Game',
};

export const BADGES = [
  // ── Career milestones ──────────────────────────────────────────────
  {
    id: 'founding-member',
    name: 'Founding Member',
    description: "Active in TheLeague's inaugural 2007 season.",
    icon: '🌟',
    tier: 'career',
    compute: (fr) => {
      const played = fr.yearByYear.some(
        (y) => y.year === 2007 && y.wins + y.losses + y.ties > 0
      );
      return played ? [{ label: 'Class of 2007' }] : [];
    },
  },
  {
    id: 'decade-of-service',
    name: 'Decade of Service',
    description: 'Owned this franchise for 10+ seasons.',
    icon: '🎖️',
    tier: 'career',
    compute: (fr) =>
      fr.yearsActive >= 10 ? [{ value: fr.yearsActive, suffix: 'seasons' }] : [],
  },
  {
    id: 'playoff-legend',
    name: 'Playoff Legend',
    description: 'Reached the playoffs 10 or more times.',
    icon: '🌠',
    tier: 'career',
    compute: (fr) =>
      fr.playoffAppearances >= 10
        ? [{ value: fr.playoffAppearances, suffix: 'appearances' }]
        : [],
  },
  {
    id: 'playoff-veteran',
    name: 'Playoff Veteran',
    description: 'Reached the playoffs 5–9 times.',
    icon: '🎯',
    tier: 'career',
    compute: (fr) =>
      fr.playoffAppearances >= 5 && fr.playoffAppearances < 10
        ? [{ value: fr.playoffAppearances, suffix: 'appearances' }]
        : [],
  },
  {
    id: 'triple-century',
    name: 'Triple Century',
    description: '300+ all-time wins.',
    icon: '👑',
    tier: 'career',
    compute: (fr) =>
      fr.careerWins >= 300 ? [{ value: fr.careerWins, suffix: 'wins' }] : [],
  },
  {
    id: 'double-century',
    name: 'Double Century',
    description: '200+ all-time wins.',
    icon: '🔥',
    tier: 'career',
    compute: (fr) =>
      fr.careerWins >= 200 && fr.careerWins < 300
        ? [{ value: fr.careerWins, suffix: 'wins' }]
        : [],
  },
  {
    id: 'century-club',
    name: 'Century Club',
    description: '100+ all-time wins.',
    icon: '💯',
    tier: 'career',
    compute: (fr) =>
      fr.careerWins >= 100 && fr.careerWins < 200
        ? [{ value: fr.careerWins, suffix: 'wins' }]
        : [],
  },

  // ── Single-season ──────────────────────────────────────────────────
  {
    id: 'perfect-regular-season',
    name: 'Perfect Regular Season',
    description: 'Finished a season undefeated.',
    icon: '✨',
    tier: 'season',
    compute: (fr) =>
      fr.yearByYear
        .filter((y) => y.wins >= 13 && y.losses === 0)
        .map((y) => ({ year: y.year, label: `${y.wins}-${y.losses}` })),
  },
  {
    id: 'top-scorer',
    name: 'League Scoring Champ',
    description: 'Led the league in regular-season points in a year.',
    icon: '🚀',
    tier: 'season',
    compute: (fr, ctx) => {
      const years = ctx.topScorerByYear[fr.franchiseId] || [];
      return years.map((year) => ({ year }));
    },
  },
  {
    id: 'cellar-dweller',
    name: 'Cellar Dweller',
    description: 'Finished dead last in regular-season standings.',
    icon: '📉',
    tier: 'season',
    compute: (fr, ctx) =>
      fr.yearByYear
        .filter((y) => {
          if (y.regSeasonRank == null) return false;
          const leagueSize = ctx.leagueSizeByYear[y.year];
          if (!leagueSize) return false;
          return y.regSeasonRank === leagueSize;
        })
        .map((y) => ({ year: y.year, label: `#${y.regSeasonRank}` })),
  },

  // ── Single-game (league records, sole-holder) ──────────────────────
  {
    id: 'all-time-highest-score',
    name: 'League Record: Highest Score',
    description: 'Holds the all-time single-game scoring record.',
    icon: '💥',
    tier: 'game',
    compute: (fr, ctx) => {
      if (ctx.highestScoreEver?.franchiseId !== fr.franchiseId) return [];
      return [
        {
          year: ctx.highestScoreEver.year,
          week: ctx.highestScoreEver.week,
          value: Number(ctx.highestScoreEver.score.toFixed(2)),
          suffix: 'pts',
        },
      ];
    },
  },
  {
    id: 'all-time-biggest-blowout',
    name: 'League Record: Biggest Blowout',
    description: 'Holds the all-time biggest blowout win.',
    icon: '🚂',
    tier: 'game',
    compute: (fr, ctx) => {
      if (ctx.biggestBlowoutEver?.franchiseId !== fr.franchiseId) return [];
      return [
        {
          year: ctx.biggestBlowoutEver.year,
          week: ctx.biggestBlowoutEver.week,
          value: Number(ctx.biggestBlowoutEver.margin.toFixed(2)),
          suffix: 'pt margin',
        },
      ];
    },
  },
];

export function getTierLabel(tier) {
  return TIER_LABEL[tier] || tier;
}

export function buildBadgeContext(franchises, yearSummaries = []) {
  const ctx = {
    highestScoreEver: null,
    biggestBlowoutEver: null,
    topScorerByYear: {},
    leagueSizeByYear: {},
  };

  for (const ys of yearSummaries) {
    if (ys?.year != null && ys.leagueSize != null) {
      ctx.leagueSizeByYear[ys.year] = ys.leagueSize;
    }
  }

  // League single-game records — pull from per-franchise highlights.
  for (const [fid, fr] of Object.entries(franchises)) {
    const h = fr.highlights || {};
    if (
      h.highestSingleGame &&
      (!ctx.highestScoreEver ||
        h.highestSingleGame.score > ctx.highestScoreEver.score)
    ) {
      ctx.highestScoreEver = { ...h.highestSingleGame, franchiseId: fid };
    }
    if (
      h.biggestBlowoutWin &&
      (!ctx.biggestBlowoutEver ||
        h.biggestBlowoutWin.margin > ctx.biggestBlowoutEver.margin)
    ) {
      ctx.biggestBlowoutEver = { ...h.biggestBlowoutWin, franchiseId: fid };
    }
  }

  // Per-year scoring champ. (Bottom-of-standings is detected per-franchise
  // from leagueSizeByYear, so no max-rank tracking needed here.)
  const yearStats = new Map(); // year -> { topScorer }
  for (const [fid, fr] of Object.entries(franchises)) {
    for (const y of fr.yearByYear) {
      // Skip not-yet-played seasons (no real games or stats).
      if (y.wins + y.losses + y.ties === 0 && (!y.pointsFor || y.pointsFor === 0)) {
        continue;
      }
      const stat = yearStats.get(y.year) || { topScorer: null };
      if (!stat.topScorer || y.pointsFor > stat.topScorer.pointsFor) {
        stat.topScorer = { fid, pointsFor: y.pointsFor };
      }
      yearStats.set(y.year, stat);
    }
  }
  for (const [year, stat] of yearStats) {
    if (stat.topScorer) {
      const list = ctx.topScorerByYear[stat.topScorer.fid] || [];
      list.push(Number(year));
      ctx.topScorerByYear[stat.topScorer.fid] = list;
    }
  }

  return ctx;
}

export function computeBadgesFor(fr, ctx) {
  const earned = [];
  for (const def of BADGES) {
    let awards;
    try {
      awards = def.compute(fr, ctx);
    } catch (err) {
      console.error(`[badges] ${def.id} failed for ${fr.franchiseId}:`, err);
      continue;
    }
    if (Array.isArray(awards) && awards.length > 0) {
      earned.push({
        id: def.id,
        name: def.name,
        description: def.description,
        icon: def.icon,
        tier: def.tier,
        awards,
      });
    }
  }
  return earned;
}
