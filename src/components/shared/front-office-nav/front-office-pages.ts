/**
 * The Front Office section's page list — one registry, read by both the hub
 * and the sub-nav strip so the two can never disagree about what exists.
 *
 * Unlike the draft section, the two leagues are NOT at parity here and are not
 * meant to be: AFL runs `salaryCap:false` / `contracts:false`, so its Front
 * Office is genuinely smaller (Roster/Salary, Trade Builder, Keeper Planner,
 * Keeper Report Card) than TheLeague's (11 pages, cap/contract/salary tools
 * included). `leagues` on each entry is what makes that honest — a league
 * shows what it HAS, never a page that would 404.
 *
 * Most pages physically live under `/front-office/*`. A few don't: Roster/
 * Salary, League Planner, Keeper Planner and Keeper Report Card are linked
 * here but keep their existing URLs — Roster/Salary is the single most
 * visited page on the site with its own required parity check
 * (scripts/roster-parity-check.mjs) and three unrelated nav entries already
 * deep-linking into it by query string, so moving it bought nothing but risk.
 * `path` on those four is simply their real, unmoved address.
 *
 * Paths are league-NEUTRAL and get prefixed per reader by `resolveLeaguePath`,
 * the same way nav-config.json's are and draft-pages.ts's are.
 */

export type FrontOfficeLeagueSlug = 'theleague' | 'afl-fantasy';
export type FrontOfficeGroupKey = 'team' | 'planning' | 'reports';

export interface FrontOfficePage {
  /** Stable key; also what a page passes as `current` to the strip. */
  key: string;
  label: string;
  /** Shorter label for the strip, where horizontal room is scarce. */
  shortLabel: string;
  /** League-neutral path. May carry a query string (e.g. `?view=planner`). */
  path: string;
  /** Sprite icon id, without the leading `#`. */
  icon: string;
  /** What this page is for — the hub shows it; the strip doesn't. */
  blurb: string;
  group: FrontOfficeGroupKey;
  leagues: FrontOfficeLeagueSlug[];
  /** Per-league text/icon overrides — one mechanism, not parallel *AFL fields. */
  overrides?: Partial<
    Record<
      FrontOfficeLeagueSlug,
      Partial<Pick<FrontOfficePage, 'label' | 'shortLabel' | 'icon' | 'blurb'>>
    >
  >;
}

const TL: FrontOfficeLeagueSlug[] = ['theleague'];
const AFL: FrontOfficeLeagueSlug[] = ['afl-fantasy'];
const BOTH: FrontOfficeLeagueSlug[] = ['theleague', 'afl-fantasy'];

export const FRONT_OFFICE_GROUPS: { key: FrontOfficeGroupKey; title: string }[] = [
  { key: 'team', title: 'Your Team' },
  { key: 'planning', title: 'Cap Planning' },
  { key: 'reports', title: 'Reports & Archive' },
];

export const FRONT_OFFICE_HUB_PATH = '/front-office';

/** The route file a path maps to — strips a query string, if any. */
export const routePathOf = (path: string): string => path.split('?')[0];

export const FRONT_OFFICE_PAGES: FrontOfficePage[] = [
  {
    key: 'rosters',
    label: 'Roster / Salary',
    shortLabel: 'Roster',
    path: '/rosters',
    icon: 'icon-banknote',
    blurb: 'Every team’s roster and salary cap details.',
    group: 'team',
    leagues: BOTH,
    overrides: {
      'afl-fantasy': { label: 'Rosters', shortLabel: 'Rosters', icon: 'icon-helmet' },
    },
  },
  {
    key: 'contracts',
    label: 'Contracts',
    shortLabel: 'Contracts',
    path: '/front-office/contracts',
    icon: 'icon-file-text',
    blurb: 'View and manage your contract declarations.',
    group: 'team',
    leagues: TL,
  },
  {
    key: 'trade-builder',
    label: 'Trade Builder',
    shortLabel: 'Trades',
    path: '/front-office/trade-builder',
    icon: 'icon-transactions-2',
    blurb: 'Simulate trades and see cap impact.',
    group: 'team',
    leagues: BOTH,
  },
  {
    key: 'league-planner',
    label: 'League Planner',
    shortLabel: 'Planner',
    path: '/rosters?view=planner',
    icon: 'icon-clipboard',
    blurb: 'Phase-aware offseason planner with free agent needs analysis.',
    group: 'team',
    leagues: TL,
  },
  {
    key: 'keepers',
    label: 'Keeper Planner',
    shortLabel: 'Keepers',
    path: '/keepers',
    icon: 'icon-lock',
    blurb: 'Plan and review your keeper selections.',
    group: 'team',
    leagues: AFL,
  },
  {
    key: 'projected-free-agents',
    label: 'Projected Free Agents',
    shortLabel: 'Proj. FAs',
    path: '/front-office/projected-free-agents',
    icon: 'icon-binoculars-front',
    blurb: 'Players in their final contract year heading to free agency.',
    group: 'planning',
    leagues: TL,
  },
  {
    key: 'contract-tools',
    label: 'Contract Tools',
    shortLabel: 'Tools',
    path: '/front-office/contract-tools',
    icon: 'icon-money-bag',
    blurb: 'Extension calculator and contract-cost tools.',
    group: 'planning',
    leagues: TL,
  },
  {
    key: 'dead-money',
    label: 'Dead Money',
    shortLabel: 'Dead Money',
    path: '/front-office/dead-money',
    icon: 'icon-tombstone',
    blurb: 'Cap hits from cuts, by team and year.',
    group: 'planning',
    leagues: TL,
  },
  {
    key: 'salary-analytics',
    label: 'Salary Analytics',
    shortLabel: 'Salaries',
    path: '/front-office/salary-analytics',
    icon: 'icon-bar-chart',
    blurb: 'Cap space, spend by position, and salary benchmarks.',
    group: 'reports',
    leagues: TL,
  },
  {
    key: 'salary-history',
    label: 'Salary History',
    shortLabel: 'History',
    path: '/front-office/salary-history',
    icon: 'icon-standings-2',
    blurb: 'Historical salary trends, year by year.',
    group: 'reports',
    leagues: TL,
  },
  {
    key: 'salary-archive',
    label: 'Salary Archive',
    shortLabel: 'Archive',
    path: '/front-office/salary-archive',
    icon: 'icon-vault',
    blurb: 'Closed-book salary years, for the record.',
    group: 'reports',
    leagues: TL,
  },
  {
    key: 'league-comparison',
    label: 'League Comparison',
    shortLabel: 'Compare',
    path: '/front-office/league-comparison',
    icon: 'icon-line-chart',
    blurb: 'Scoring and cap trends across leagues and seasons.',
    group: 'reports',
    leagues: TL,
  },
  {
    key: 'keeper-analysis',
    label: 'Keeper Report Card',
    shortLabel: 'Report Card',
    path: '/keeper-analysis',
    icon: 'icon-history',
    blurb: 'Hindsight grades for every keeper class — hits, misses, and the ones that got away.',
    group: 'reports',
    leagues: AFL,
  },
];

/** The Front Office pages a given league actually has, with overrides applied, in registry order. */
export function frontOfficePagesFor(league: FrontOfficeLeagueSlug): FrontOfficePage[] {
  return FRONT_OFFICE_PAGES.filter((p) => p.leagues.includes(league)).map((p) => {
    const o = p.overrides?.[league];
    return o ? { ...p, ...o } : p;
  });
}

/** Group key -> pages, in registry order. Groups with no pages for this league are omitted. */
export function frontOfficeGroupsFor(
  league: FrontOfficeLeagueSlug
): { key: FrontOfficeGroupKey; title: string; pages: FrontOfficePage[] }[] {
  const pages = frontOfficePagesFor(league);
  return FRONT_OFFICE_GROUPS.map((g) => ({
    ...g,
    pages: pages.filter((p) => p.group === g.key),
  })).filter((g) => g.pages.length > 0);
}
