import type { LeagueEventDefinition } from '../../types/league-events';

/**
 * TheLeague important dates, derived from the constitution (rules.astro).
 * Listed in chronological order within a league year (starting Feb 1).
 *
 * Date resolution types:
 * - 'fixed': calendar dates that never change
 * - 'computed': rule-based (Labor Day, 3rd Thursday of March, etc.)
 * - 'configured': from league-year-config.ts (NFL Draft date)
 * - 'relative': offset from another event (rookie draft = 1 week after NFL draft)
 *
 * Icon IDs reference symbols in public/assets/icons/sprite.svg (without "icon-" prefix).
 */
export const THE_LEAGUE_EVENTS: LeagueEventDefinition[] = [
  {
    id: 'team-purchase-deadline',
    name: 'Team Purchase Deadline',
    description: 'Deadline to purchase your team for the following season',
    icon: 'dollar',
    category: 'preseason',
    startDate: { type: 'fixed', month: 2, day: 1, time: '20:45' },
    urgencyDays: 7,
    sortOrder: 1,
  },
  {
    id: 'tagging-period',
    name: 'Tagging Period',
    description: 'Apply franchise tags to expiring players',
    icon: 'bookmark',
    category: 'preseason',
    startDate: { type: 'fixed', month: 2, day: 1 },
    endDate: { type: 'fixed', month: 2, day: 14, time: '20:45' },
    actionLinks: [
      {
        label: 'Message Board',
        url: 'https://www.theleague.us/forum/index.php',
        external: true,
      },
    ],
    urgencyDays: 3,
    sortOrder: 2,
  },
  {
    id: 'last-day-release',
    name: 'Last Day to Release Players',
    description: 'Final opportunity to release players in the current season',
    icon: 'user-times',
    category: 'preseason',
    startDate: { type: 'fixed', month: 2, day: 14, time: '20:45' },
    actionLinks: [
      {
        label: 'Manage Roster',
        url: '/theleague/rosters?myteam={franchiseId}',
        external: false,
      },
    ],
    urgencyDays: 3,
    sortOrder: 3,
  },
  {
    id: 'new-season-starts',
    name: 'New Season Starts',
    description: 'Contracts roll over, 10% salary escalation applied',
    icon: 'star',
    category: 'preseason',
    startDate: { type: 'fixed', month: 2, day: 15 },
    sortOrder: 4,
  },
  {
    id: 'tag-offer-period',
    name: 'Offer Period on Tagged Players',
    description: 'Teams may bid on franchise-tagged players from other teams',
    icon: 'bookmark',
    category: 'preseason',
    startDate: { type: 'fixed', month: 2, day: 15 },
    endDate: { type: 'fixed', month: 2, day: 28, time: '20:45' },
    actionLinks: [
      {
        label: 'Message Board',
        url: 'https://www.theleague.us/forum/index.php',
        external: true,
      },
    ],
    urgencyDays: 3,
    sortOrder: 5,
  },
  {
    id: 'tag-matching-period',
    name: 'Tag Matching Period',
    description: 'Original teams must match offers or lose tagged players',
    icon: 'bookmark',
    category: 'preseason',
    startDate: { type: 'fixed', month: 3, day: 1 },
    endDate: { type: 'fixed', month: 3, day: 7, time: '20:45' },
    actionLinks: [
      {
        label: 'Message Board',
        url: 'https://www.theleague.us/forum/index.php',
        external: true,
      },
    ],
    urgencyDays: 2,
    sortOrder: 6,
  },
  {
    id: 'offseason-fa-opens',
    name: 'Offseason Free Agency Opens',
    description: 'Blind-bid auction for all free agents begins',
    icon: 'banknote',
    category: 'free-agency',
    startDate: { type: 'computed', rule: 'third-thursday-march' },
    actionLinks: [
      {
        label: 'Free Agent Auction',
        url: 'https://{mflHost}/{year}/options?L={leagueId}&O=52',
        external: true,
      },
    ],
    resultLinks: [
      {
        label: 'Auction Results',
        url: 'https://{mflHost}/{year}/options?L={leagueId}&O=171',
        external: true,
      },
    ],
    urgencyDays: 5,
    sortOrder: 7,
  },
  {
    id: 'nfl-draft',
    name: 'NFL Draft',
    description: 'NFL Draft weekend',
    icon: 'nfl',
    category: 'draft',
    startDate: { type: 'configured', configKey: 'nflDraftDate' },
    sortOrder: 8,
  },
  {
    id: 'rookie-draft',
    name: 'Rookie Draft',
    description: '3-round rookie draft, 12-hour pick timer',
    icon: 'draft-podium',
    category: 'draft',
    startDate: { type: 'relative', rule: 'saturday-after-next-week', relativeTo: 'nfl-draft' },
    actionLinks: [
      {
        label: 'Draft Room',
        url: 'https://{mflHost}/{year}/options?L={leagueId}&O=17',
        external: true,
      },
    ],
    resultLinks: [
      {
        label: 'Draft Results',
        url: 'https://{mflHost}/{year}/options?L={leagueId}&O=17',
        external: true,
      },
    ],
    urgencyDays: 7,
    sortOrder: 9,
  },
  {
    id: 'declare-rookie-contracts',
    name: 'Declare Contracts / Cut to 22',
    description: 'Set contract years for rookies and trim roster to 22 active',
    icon: 'clipboard',
    category: 'draft',
    startDate: { type: 'computed', rule: 'third-sunday-august' },
    actionLinks: [
      {
        label: 'Manage Roster',
        url: '/theleague/rosters?myteam={franchiseId}',
        external: false,
      },
    ],
    urgencyDays: 7,
    sortOrder: 10,
  },
  {
    id: 'offseason-fa-closes',
    name: 'Offseason FA Closes for New Bids',
    description: 'No new auctions can start after this date. Remaining blind bids and live auctions will finish.',
    icon: 'podium-persona',
    category: 'free-agency',
    startDate: { type: 'computed', rule: 'third-sunday-august' },
    urgencyDays: 7,
    sortOrder: 11,
  },
  {
    id: 'nfl-season-starts',
    name: 'NFL Season Starts',
    description: 'NFL kickoff and the start of weekly fantasy matchups',
    icon: 'nfl',
    category: 'regular-season',
    startDate: { type: 'computed', rule: 'nfl-kickoff' },
    sortOrder: 12,
  },
  {
    id: 'trading-deadline',
    name: 'Trading Deadline',
    description: 'Last day to execute trades this season',
    icon: 'exchange',
    category: 'regular-season',
    startDate: { type: 'computed', rule: 'friday-before-week-11' },
    actionLinks: [
      {
        label: 'Trade Center',
        url: 'https://{mflHost}/{year}/options?L={leagueId}&O=03',
        external: true,
      },
    ],
    urgencyDays: 7,
    sortOrder: 13,
  },
  {
    id: 'in-season-fa-ends',
    name: 'In-Season FA Ends',
    description: 'No more free agent pickups after Week 16',
    icon: 'gavel',
    category: 'regular-season',
    startDate: { type: 'computed', rule: 'after-week-16' },
    sortOrder: 14,
  },
];
