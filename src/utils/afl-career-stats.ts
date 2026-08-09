/**
 * AFL career (all-time) standings aggregation.
 *
 * Folds every committed season feed (data/afl-fantasy/mfl-feeds/<year>/
 * standings.json, 2003–present) into per-franchise career W/L/T, points,
 * and season counts for the franchises index cards. Attribution follows
 * ownerHistory via attributeAwardYear — a year recorded under a franchise
 * slot an owner has since left credits their current franchise, and years
 * belonging to departed owners drop out entirely (same policy as the
 * trophy room and TheLeague's franchise-history script).
 *
 * Feed quirks this deliberately works around (verified across 2003–2026):
 * - W/L/T come from h2hw/h2hl/h2ht — present every year (h2ht was absent
 *   from the 2019–2022 feeds until the ALL=1 backfill; still defaulted to
 *   0 for safety). h2hwlt is NOT used: it's absent in 2003 and would
 *   silently zero that year.
 * - pf is exact for every season 2004+ (2010–2022 recovered via
 *   scripts/backfill-standings-points.mjs, which re-fetches standings with
 *   leagueStandings ALL=1). Should a feed ever lose pf again, we fall back
 *   to avgpf × gamesPlayed and flag `pointsApproximate` — beware that
 *   approximation ran ~5.9% high for 2010–2012, whose 18 H2H games exceed
 *   the 17-week span avgpf divides by. 2003 has no points data at all on
 *   MFL (pf ".00", no avgpf): it contributes 0 points and is surfaced via
 *   `pointsMissingYears`.
 */
import { attributeAwardYear } from './afl-awards';

export interface AflCareerStats {
  wins: number;
  losses: number;
  ties: number;
  /** Exact pf everywhere the feed has it (all seasons 2004+); 0 for 2003. */
  pointsFor: number;
  /** True when any avgpf-derived (approximated) points contributed. */
  pointsApproximate: boolean;
  /** Seasons that count toward the record but have no points data on MFL
   *  at all (2003) — excluded from pointsFor rather than approximated. */
  pointsMissingYears: number[];
  seasons: number;
  firstYear: number | null;
  lastYear: number | null;
}

interface StandingsRow {
  id?: string;
  h2hw?: string;
  h2hl?: string;
  h2ht?: string;
  pf?: string;
  avgpf?: string;
}

interface StandingsFeed {
  leagueStandings?: { franchise?: StandingsRow[] };
}

const standingsFeeds = import.meta.glob<StandingsFeed>(
  '../../data/afl-fantasy/mfl-feeds/*/standings.json',
  { eager: true, import: 'default' }
);

const num = (v: string | undefined): number => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};

function computeCareerStats(): {
  byFranchise: Map<string, AflCareerStats>;
  yearsCovered: number[];
} {
  const byFranchise = new Map<string, AflCareerStats>();
  const yearsCovered = new Set<number>();

  for (const [path, feed] of Object.entries(standingsFeeds)) {
    const year = Number.parseInt(path.match(/mfl-feeds\/(\d{4})\//)?.[1] ?? '', 10);
    if (!Number.isFinite(year)) continue;
    const rows = feed?.leagueStandings?.franchise ?? [];

    for (const row of rows) {
      const wins = num(row.h2hw);
      const losses = num(row.h2hl);
      const ties = num(row.h2ht);
      const games = wins + losses + ties;
      // Season not yet played (e.g. the preseason feed for the upcoming
      // year) — contributes nothing.
      if (games === 0) continue;

      const target = attributeAwardYear(row.id ?? null, year);
      if (!target) continue;

      yearsCovered.add(year);

      const pfExact = row.pf != null ? num(row.pf) : 0;
      const hasExactPf = row.pf != null && pfExact > 0;
      const approxPoints = num(row.avgpf) * games;
      const points = hasExactPf ? pfExact : approxPoints;

      const stats: AflCareerStats = byFranchise.get(target) ?? {
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsApproximate: false,
        pointsMissingYears: [],
        seasons: 0,
        firstYear: null,
        lastYear: null,
      };
      stats.wins += wins;
      stats.losses += losses;
      stats.ties += ties;
      stats.pointsFor += points;
      if (!hasExactPf) {
        if (approxPoints > 0) stats.pointsApproximate = true;
        else stats.pointsMissingYears.push(year);
      }
      stats.seasons += 1;
      stats.firstYear = stats.firstYear === null ? year : Math.min(stats.firstYear, year);
      stats.lastYear = stats.lastYear === null ? year : Math.max(stats.lastYear, year);
      byFranchise.set(target, stats);
    }
  }

  return { byFranchise, yearsCovered: [...yearsCovered].sort((a, b) => a - b) };
}

let cached: ReturnType<typeof computeCareerStats> | null = null;

export function getAflCareerStats(): ReturnType<typeof computeCareerStats> {
  if (!cached) cached = computeCareerStats();
  return cached;
}
