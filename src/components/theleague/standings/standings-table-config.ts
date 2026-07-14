/**
 * Unified standings-table configuration (Phase 6).
 *
 * Column set, team-cell mode, tiering, header and accent are all DATA, passed
 * to `standings/StandingsTable.astro`. Page code keeps building `TeamStanding[]`
 * from the `standings.ts` producers — the refactor is purely presentational.
 *
 * See docs/standings-table-design.md §3 for the full rationale.
 */
import type { TeamStanding } from '../../../types/standings';

/** Which prebuilt column a config references. Formatter/alignment/width are
 *  resolved inside the component from the key, not at the call site. */
export type StandingsColumnKey =
  | 'seedPill' // gray pill '#{seed}' (legacy unused league-view branch; kept for completeness)
  | 'seedPlain' // plain bold '#{seed}' (TheLeague playoff standings)
  | 'seedAccent' // conference-colored '#{conferenceSeed}', AL red / NL blue
  | 'playoffBadge' // <PlayoffBadge> (division / all-play)
  | 'rankCircle' // circular rank badge (tier table)
  | 'team' // team cell — render mode set by `teamCell`
  | 'overallRecord' // h2hwlt
  | 'overallPct' // h2hpct (3dp)
  | 'divRecord' // divwlt
  | 'divPct' // divpct (3dp)
  | 'allPlayRecord' // all_play_wlt or derived
  | 'allPlayPct' // all_play_pct (3dp)
  | 'gamesBack' // computed within-group GB (division only)
  | 'streak' // strk
  | 'pf'
  | 'pa'
  | 'pwr'
  | 'vp'
  | 'prize'; // AFL tier prize + promo/reg arrow

export interface StandingsColumn {
  key: StandingsColumnKey;
  header: string;
  align?: 'left' | 'center' | 'right';
  /** Hide below ~767px. Maps to a utility class, not inline media queries. */
  hideBelow?: 'sm';
  widthCh?: number;
  /** allPlayRecord only. Render '12-3' when ties are zero (tier table) instead
   *  of '12-3-0'. Default false. */
  omitZeroTies?: boolean;
}

// 'chip' (color-chip + name, hero/compact) is a planned mode for the
// out-of-scope hero/compact follow-up; the renderer implements only the two
// shipped modes today. Add 'chip' back alongside its renderer, not before.
export type TeamCellMode = 'banner' | 'icon';

/** What the 'banner' team cell renders when the banner is missing or is the
 *  HISTORICAL placeholder:
 *  - 'name'  → text-fallback span (TheLeague division / all-play, AFL division)
 *  - 'blank' → banner only; empty cell when missing (seeded league tables) */
export type TeamCellFallback = 'name' | 'blank';

export interface StandingsTiering {
  seedField: 'seed' | 'conferenceSeed';
  bands: Array<{
    name: 'division-winners' | 'wild-cards' | 'play-in' | 'toilet-bowl' | 'eliminated';
    upTo?: number;
    boundary?: boolean;
  }>;
}

export interface DefendingChampion {
  name: string;
  year?: number;
  logoSrc?: string;
}

export interface StandingsHeader {
  kind: 'division' | 'brandedDivision' | 'conference' | 'tier';
  title: string;
  logoSrc?: string;
  logoDarkSrc?: string;
  /** Compass badge (brandedDivision). Undefined → fall back to plain 'division'
   *  rendering (never a broken <img>). */
  badgeSrc?: string;
  accentColor?: string;
  accentColorDark?: string;
  defendingChampion?: DefendingChampion;
  subtitle?: string;
}

export type StandingsAccent = 'league-blue' | 'afl-red' | 'conference-blue';

export interface StandingsTableProps {
  teams: TeamStanding[];
  columns: StandingsColumn[];
  teamCell: TeamCellMode;
  teamCellFallback?: TeamCellFallback;
  tiering?: StandingsTiering;
  header?: StandingsHeader;
  year?: number;
  preferredTeamId?: string;
  rosterBaseUrl?: string;
  franchiseBaseUrl?: string;
  /** AFL red / conference-blue card glow vs TheLeague blue. Replaces the
   *  data-league / conferenceId branches. */
  accent?: StandingsAccent;
  /** Tier-table extras (only read when a prize/rankCircle column is present). */
  tierName?: string;
  promotionCutoff?: number;
}

// ---------------------------------------------------------------------------
// Column presets — keep call sites terse.
// ---------------------------------------------------------------------------

export const COLUMNS = {
  division: [
    { key: 'playoffBadge', header: 'Seed' },
    { key: 'team', header: 'Team' },
    { key: 'overallRecord', header: 'Overall' },
    { key: 'overallPct', header: 'PCT' },
    { key: 'gamesBack', header: 'GB' },
    { key: 'streak', header: 'Strk' },
    { key: 'divRecord', header: 'Div' },
    { key: 'pf', header: 'PF' },
    { key: 'pa', header: 'PA' },
  ],
  leagueSeeded: [
    { key: 'seedPlain', header: 'Seed' },
    { key: 'team', header: 'Team' },
    { key: 'overallRecord', header: 'Overall' },
    { key: 'overallPct', header: 'PCT' },
    { key: 'divRecord', header: 'Div' },
    { key: 'divPct', header: 'PCT' },
    { key: 'allPlayRecord', header: 'All Play' },
    { key: 'pf', header: 'PF' },
    { key: 'pwr', header: 'PWR' },
    { key: 'vp', header: 'VP' },
    { key: 'pa', header: 'PA' },
  ],
  conferenceSeeded: [
    { key: 'seedAccent', header: 'Seed' },
    { key: 'team', header: 'Team' },
    { key: 'overallRecord', header: 'Overall' },
    { key: 'overallPct', header: 'PCT' },
    { key: 'divRecord', header: 'Div' },
    { key: 'divPct', header: 'PCT', hideBelow: 'sm' },
    { key: 'allPlayRecord', header: 'All Play' },
    { key: 'pf', header: 'PF' },
    { key: 'pwr', header: 'PWR', hideBelow: 'sm' },
    { key: 'vp', header: 'VP' },
    { key: 'pa', header: 'PA', hideBelow: 'sm' },
  ],
  allPlay: [
    { key: 'playoffBadge', header: 'Seed' },
    { key: 'team', header: 'Team' },
    { key: 'allPlayRecord', header: 'Record' },
    { key: 'allPlayPct', header: 'PCT' },
    { key: 'pf', header: 'PF' },
    { key: 'pa', header: 'PA' },
    { key: 'pwr', header: 'PWR' },
    { key: 'vp', header: 'VP' },
  ],
  tierAllPlay: [
    { key: 'rankCircle', header: 'Rank' },
    { key: 'team', header: 'Team' },
    { key: 'allPlayRecord', header: 'All-Play Record', omitZeroTies: true },
    { key: 'prize', header: 'Prize' },
  ],
} satisfies Record<string, StandingsColumn[]>;

export const TIERING = {
  leagueSeed: {
    seedField: 'seed',
    bands: [
      { name: 'division-winners', upTo: 4, boundary: true },
      { name: 'wild-cards', upTo: 7, boundary: true },
      { name: 'play-in', upTo: 9, boundary: true },
      { name: 'toilet-bowl' },
    ],
  },
  conferenceSeed: (dwCount: number): StandingsTiering => ({
    seedField: 'conferenceSeed',
    bands: [
      { name: 'division-winners', upTo: dwCount, boundary: true },
      { name: 'wild-cards', upTo: 4, boundary: true },
      { name: 'eliminated' },
    ],
  }),
} satisfies Record<string, StandingsTiering | ((n: number) => StandingsTiering)>;

/** Resolve the tier-band name for a seed value under a tiering config.
 *  Returns '' for a missing/zero seed (no band). */
export function resolveBand(seedValue: number | undefined, tiering: StandingsTiering): string {
  if (!seedValue) return '';
  for (const band of tiering.bands) {
    if (band.upTo === undefined) return band.name; // catch-all (final band)
    if (seedValue <= band.upTo) return band.name;
  }
  return '';
}

export type { TeamStanding };
