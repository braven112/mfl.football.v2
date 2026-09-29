/**
 * What differs between leagues on the shared standings page — as DATA, so
 * `StandingsPage.astro` never branches on a league slug.
 *
 * TheLeague's profile is exactly what its page rendered before the extraction
 * (columns, copy, badge ladder, franchise links). A standard-package league
 * (archies) gets the same page with the columns its data supports and the one
 * playoff claim its feed proves: who leads each division.
 */
import {
  COLUMNS,
  TIERING,
  type StandingsColumn,
  type StandingsTiering,
} from '../../theleague/standings/standings-table-config';
import type { CanonicalLeagueSlug, LeagueDefinition } from '../../../config/leagues';

export interface StandingsViewCopy {
  title: string;
  subtitle: string;
}

export interface StandingsPageProfile {
  columns: { division: StandingsColumn[]; league: StandingsColumn[]; allPlay: StandingsColumn[] };
  /**
   * League view row order. 'seeded' = division winners first, then the rest
   * (TheLeague's playoff ladder). 'feed' = MFL's rows exactly as exported.
   */
  leagueViewOrder: 'seeded' | 'feed';
  /** Label of the League tab in the view selector. */
  leagueTabLabel: string;
  copy: { division: StandingsViewCopy; league: StandingsViewCopy; all_play: StandingsViewCopy };
  /** Ladder the DIV / WC pills are drawn on; undefined = the table default. */
  badgeSeeding?: StandingsTiering;
  /** Tiering (row bands) on the league-view table, if any. */
  leagueTiering?: StandingsTiering;
  badgeShowsSeed: boolean;
  /** `${franchiseBaseUrl}/${id}` team links; otherwise per-team hrefs from the route. */
  franchiseBaseUrl?: string;
  /** The league table's banner fallback — TheLeague's seeded table shows banners only. */
  leagueTeamCellFallback: 'name' | 'blank';
}

const THELEAGUE: StandingsPageProfile = {
  columns: { division: COLUMNS.division, league: COLUMNS.leagueSeeded, allPlay: COLUMNS.allPlay },
  leagueViewOrder: 'seeded',
  leagueTabLabel: 'Playoff',
  copy: {
    division: { title: 'Division Standings', subtitle: 'Standings by division within the league' },
    league: { title: 'Playoff Standings', subtitle: 'Division winners are seeded 1-4' },
    all_play: { title: 'All-Play Standings', subtitle: 'Top ranked teams across the league' },
  },
  leagueTiering: TIERING.leagueSeed,
  badgeShowsSeed: true,
  franchiseBaseUrl: '/theleague/franchises',
  leagueTeamCellFallback: 'blank',
};

/**
 * A standard-package league: redraft, sorted by MFL on victory points. Its
 * export has no PWR, and GB is a win-loss measure that says nothing in a league
 * ranked on VP, so both are left out; VP stays visible on phones because it is
 * the sort key.
 */
function packageLeagueProfile(divisionCount: number): StandingsPageProfile {
  const vp: StandingsColumn = { key: 'vp', header: 'VP' };
  return {
    columns: {
      division: [
        { key: 'playoffBadge', header: 'Div' },
        { key: 'team', header: 'Team' },
        { key: 'overallRecord', header: 'Overall' },
        vp,
        { key: 'overallPct', header: 'PCT', hideBelow: 'sm' },
        { key: 'streak', header: 'Strk', hideBelow: 'sm' },
        { key: 'divRecord', header: 'Div Rec', hideBelow: 'sm' },
        { key: 'pf', header: 'PF', hideBelow: 'sm' },
        { key: 'pa', header: 'PA', hideBelow: 'sm' },
      ],
      league: [
        { key: 'rankPlain', header: 'Rank' },
        { key: 'team', header: 'Team' },
        { key: 'playoffBadge', header: 'Div', hideBelow: 'sm' },
        { key: 'overallRecord', header: 'Overall' },
        vp,
        { key: 'overallPct', header: 'PCT', hideBelow: 'sm' },
        { key: 'streak', header: 'Strk', hideBelow: 'sm' },
        { key: 'allPlayRecord', header: 'All Play', hideBelow: 'sm' },
        { key: 'pf', header: 'PF', hideBelow: 'sm' },
        { key: 'pa', header: 'PA', hideBelow: 'sm' },
      ],
      allPlay: [
        { key: 'playoffBadge', header: 'Div' },
        { key: 'team', header: 'Team' },
        { key: 'allPlayRecord', header: 'Record' },
        { key: 'allPlayPct', header: 'PCT', hideBelow: 'sm' },
        { key: 'pf', header: 'PF', hideBelow: 'sm' },
        { key: 'pa', header: 'PA', hideBelow: 'sm' },
        { key: 'vp', header: 'VP', hideBelow: 'sm' },
      ],
    },
    leagueViewOrder: 'feed',
    leagueTabLabel: 'League',
    copy: {
      division: {
        title: 'Division Standings',
        subtitle: 'Each division in MFL order: victory points, then points for, then head-to-head',
      },
      league: {
        title: 'League Standings',
        subtitle: 'Every team in MFL order: victory points, then points for, then head-to-head',
      },
      all_play: {
        title: 'All-Play Standings',
        subtitle: 'Every week’s score against every other team’s',
      },
    },
    badgeSeeding: TIERING.divisionWinners(divisionCount),
    badgeShowsSeed: false,
    leagueTeamCellFallback: 'name',
  };
}

/**
 * A package league with its own playoff seeding (archies: MAD POWER 99).
 * The League tab becomes the league's playoff standings — every team seeded,
 * banded by tier — and the DIV / 2ND / WC pills carry real seeds everywhere.
 */
function madProfile(
  divisionCount: number,
  seeding: NonNullable<LeagueDefinition['standingsSeeding']>
): StandingsPageProfile {
  const base = packageLeagueProfile(divisionCount);
  const tiering = TIERING.mad(seeding);
  const inPlayoffs = seeding.divisionLeaders + seeding.runnersUp + seeding.wildCards;
  return {
    ...base,
    columns: {
      // The pill carries a real seed here, so its column says so.
      division: base.columns.division.map((c) => (c.key === 'playoffBadge' ? { ...c, header: 'Seed' } : c)),
      allPlay: base.columns.allPlay.map((c) => (c.key === 'playoffBadge' ? { ...c, header: 'Seed' } : c)),
      league: [
        { key: 'seedPlain', header: 'Seed' },
        { key: 'team', header: 'Team' },
        { key: 'playoffBadge', header: 'Tier', hideBelow: 'sm' },
        { key: 'overallRecord', header: 'Overall' },
        { key: 'vp', header: 'VP' },
        { key: 'overallPct', header: 'PCT', hideBelow: 'sm' },
        { key: 'streak', header: 'Strk', hideBelow: 'sm' },
        { key: 'divRecord', header: 'Div Rec', hideBelow: 'sm' },
        { key: 'pf', header: 'PF', hideBelow: 'sm' },
        { key: 'pa', header: 'PA', hideBelow: 'sm' },
      ],
    },
    leagueViewOrder: 'seeded',
    leagueTabLabel: 'MAD',
    // Banner only, like TheLeague's playoff table: 99 rows, and the art carries the name.
    leagueTeamCellFallback: 'blank',
    copy: {
      ...base.copy,
      league: {
        title: 'MAD Power 99',
        subtitle:
          `The playoff race: ${seeding.divisionLeaders} division leaders, ${seeding.runnersUp} runners-up and ` +
          `${seeding.wildCards} wild cards — ${inPlayoffs} teams, combined score over weeks 15-17`,
      },
    },
    badgeSeeding: tiering,
    leagueTiering: tiering,
    badgeShowsSeed: true,
  };
}

/** Leagues with a bespoke profile; every other league is a package league. */
const PROFILES: Partial<Record<CanonicalLeagueSlug, StandingsPageProfile>> = {
  theleague: THELEAGUE,
};

/** The profile for a league on the shared standings page. */
export function standingsPageProfile(
  slug: CanonicalLeagueSlug,
  divisionCount: number,
  seeding?: LeagueDefinition['standingsSeeding']
): StandingsPageProfile {
  const bespoke = PROFILES[slug];
  if (bespoke) return bespoke;
  return seeding?.kind === 'mad' ? madProfile(divisionCount, seeding) : packageLeagueProfile(divisionCount);
}
