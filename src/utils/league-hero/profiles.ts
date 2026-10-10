/**
 * Hero profiles — what one league's homepage hero is made of.
 *
 * The resolver (./resolver.ts) has no idea which league it is serving. Each
 * profile says:
 *
 *   - where the league's calendar comes from, and what each event MEANS to the
 *     hero (`roleOf` → keeper deadline, a pool's draft, kickoff, …);
 *   - the facts its copy names (how many keepers, when each pool drafts, the
 *     title game's name) — facts from the league's constitution, never
 *     constants in a view;
 *   - its capabilities, read from the REGISTRY (`leagueHasFeature`) wherever
 *     the registry already knows: live scoring, the power-rankings column,
 *     keepers, the auction. A capability is a hero any league can turn on.
 *   - the handful of words that name the league and its pools.
 *
 * Adding a league's hero is adding a profile. Anything a profile would need
 * that is not here yet belongs here as a new FIELD, never as a slug branch in
 * the resolver or a view.
 */
import type { CanonicalLeagueSlug, LeagueDefinition } from '../../config/leagues';
import { getLeagueConfig } from '../league-config';
import { LEAGUES, ensureLeaguePrefix, getLeagueBySlug, leagueHasFeature } from '../../config/leagues';
import type { ResolvedLeagueEvent } from '../../types/league-events';
import type { CompositeHeroTreatment } from '../../types/composite-hero';
import type { LeagueSlug } from '../../types/whats-new';
import { getAllResolvedAflEvents } from '../league-event-resolver';
import { MFL_EMAIL_DRAFT_OPTION, MFL_LINEUP_OPTION, buildMflLiveDraftUrl, buildMflOptionUrl } from '../mfl-url';
import { randomHeroPlayer } from '../hero-players';
import {
  getDraftStartFormatted,
  isAuctionHeroPeriod,
  isAuctionLive,
  isChampionCrownedPeriod,
  isChampionshipWeek,
  isCutWatchEarly,
  isCutWatchUrgent,
  isDraftCountdown,
  isDraftHeroPeriod,
  isDraftLive,
  isEntryInHeroWindow,
  isPlayoffPeriod,
  isPreseasonCountdown,
  isRegularSeason,
  isTagWindow,
  isTaggedShowcase,
  isTradeDeadlineDay,
  isUDFAWindow,
  resolveHeroContent,
} from '../hero-resolver';
import { AUGUST_CUT_TARGET } from '../august-cut-selection-core.mjs';
import type { HeroContent } from '../../types/whats-new';
import type { EventHeroView, HeroEventRoleMatch, HeroSlot } from './types';
import type { HeroStepId } from './resolver';
import type { ContractLeagueCalendar } from './contract-steps';
import { ACCENT_GOLD, ACCENT_STEEL, GLOW_GOLD } from './views';

/** One player pool that drafts on its own (the AFL's conferences). */
export interface HeroPoolConfig {
  id: string;
  /** Short label — "AL". */
  label: string;
  /** Long name — "American League". */
  name: string;
  /** Which MFL page the pool drafts from: the live-draft applet or the email draft. */
  medium: 'live' | 'email';
  /** When the draft starts, in a sentence — "Saturday at 12:30pm PT". */
  when: string;
  /** The same, for the count label — "Sat 12:30PM PT". */
  countLabel: string;
  /** Where this pool actually drafts, on MFL, for a given season. */
  draftUrl: (year: number) => string;
  /** The pool's ghost-wordmark treatment (tone is set per render). */
  composite: CompositeHeroTreatment;
  accent: string;
  glow: string;
}

export interface LeagueHeroProfile {
  league: CanonicalLeagueSlug;
  /**
   * The rungs this league climbs, highest priority first (resolver.ts
   * `HERO_STEPS`). A rung it does not list is a hero it does not have — a
   * league with no auction never lists `auction`, and so on.
   */
  ladder: HeroStepId[];
  /**
   * The season's phases from the league's own constitution, when they are
   * RULES rather than calendar events (a trade deadline that is always Nov 13,
   * playoffs that start in week 15). Omitted, each phase is read off the
   * calendar's roles.
   */
  clock?: {
    isTradeDeadlineDay?(now: Date): boolean;
    /** The countdown's target, when `isTradeDeadlineDay` is set. */
    tradeDeadlineMidnight(now: Date): string;
    isChampionship?(now: Date): boolean;
    /** A league with its own champion card (a bespoke component) answers this. */
    isChampionCrowned?(now: Date): boolean;
    isRegularSeason?(now: Date): boolean;
    isPlayoffs?(now: Date): boolean;
  };
  /** The dates a contract league's offseason runs on (auction, rookie draft, tags, cut-down). */
  contractCalendar?: ContractLeagueCalendar;
  /** Content overrides for the rungs whose words are the league's own. */
  content?: {
    tradeDeadline?(p: (path: string) => string): HeroContent;
    championCrowned?(p: (path: string) => string): HeroContent;
  };
  /** Where the schedule-release tease sits, and its accent. */
  scheduleRelease: { priority: 'P1' | 'P3'; accentColor: string };
  /** The What's New league tag that makes an entry this league's. */
  whatsNewTag: LeagueSlug;
  /** Seed for the fresh-feature state's per-day pick. */
  featureSeed: string;
  /** Prefix for the hero's synthetic event ids (`<prefix>-champion-crowned`). */
  eventIdPrefix: string;
  /**
   * Every calendar event the league has around `now` (NOT deduped). A league
   * whose calendar is read off disk has none to load here — its page passes
   * `events` into the resolver.
   */
  loadEvents?: (now: Date) => ResolvedLeagueEvent[];
  /** What an event is to the hero. `definition.heroRole` (a built calendar's own hint) is read first. */
  roleOf?: (event: ResolvedLeagueEvent) => HeroEventRoleMatch | null;
  /** Lead-up window override, days before start, by role key (`pool-draft`, `keeper-deadline`, …). */
  urgency: Partial<Record<string, number>>;
  /** Pools that draft separately, in lead order. */
  pools?: HeroPoolConfig[];
  /** A tiered league's keeper badge for the viewer's tier. */
  tierBadge?: (tier?: string) => Pick<EventHeroView, 'badge' | 'badgeDark' | 'badgeAlt'>;
  /**
   * Which daily slots the league actually runs. A slot it does not run hands
   * its window to the non-live slot of that day (see `slotFor`).
   */
  capabilities: {
    /** The live scoreboard hero (registry `liveScoring`). */
    liveScoring: boolean;
    /** Tuesday's power-rankings column (registry `powerRankings`). */
    peckingOrderSlot: boolean;
    /** Wednesday night's weekly column (a league's regular Wednesday feature). */
    columnSlot: boolean;
    /**
     * A bespoke playoff-bracket and title-game hero. Without one the daily slot
     * rotation keeps running through the playoffs, as it does all season.
     */
    bracketHero: boolean;
  };
  facts: {
    keepers: { count: number; time: string; deadline: string; lockLabel: string; countLabel: string; path: string };
    tradeDeadline: { day: string; countLabel: string; leadIn: string; path: string; linkLabel: string };
    weeks: { finalRegular: number; playoffStart: number; championship: number };
    championshipName: string;
    /** Where the bracket lives. */
    playoffsPath: string;
    /** Where an owner goes to work the wire. */
    freeAgentsPath: string;
    /**
     * Set a lineup — a path on this site, or (`external`) an absolute URL on
     * MFL for the season being played (`now` → that season's MFL year).
     */
    lineup: { href: (now: Date) => string; label: string; external?: boolean };
    /** The pool draft board and our own draft order. */
    draftBoardPath: string;
    draftOrderPath: string;
    /** The Sunday Ticket multiview lives under this league. */
    sundayTicket: boolean;
    /**
     * Where the Tuesday recap sends a reader for a completed week, when the
     * league has no Top Players page (the default destination) to send them to.
     */
    recapPage?: { path: string; label: string };
  };
  copy: {
    /** "AFL" — the league's short name in running copy. */
    shortName: string;
    /**
     * What the desk card is "around": "AFL" reads as AROUND THE AFL, but a
     * possessive name does not ("AROUND THE ARCHIE'S"), so it is its own field.
     */
    aroundThe: string;
    /** The league's weekly column, for the `column` slot ("The Gauntlet"). */
    columnName: string;
    /** Name the schedule-release tease uses. */
    scheduleReleaseName: string;
    /** "both conferences" — every pool at once. */
    everyPool: string;
    /** "the AL and NL" — the pools by name. */
    poolNames: string;
    /** "the AL and NL playoff picture". */
    playoffPicture: string;
    /** Recap content summary. */
    recapSummary: string;
    /** "swap injuries, finalize FCFS pickups" — the game-day chores. */
    gameDayChores: string;
    /** Game-day content summary, after "Lineups lock at kickoff.". */
    gameDayContent: string;
    /** The news desk's standing line, for the desk card. */
    deskSummary: string;
    championCrownedSummary: string;
    playoffs: { title: string; summary: string; kicker: string };
    championship: { title: string; summary: string };
    offseason: { title: string; summary: string };
    default: { title: string; summary: string; kicker: string };
  };
  /** The league's own card, shown when no phase claims the day. */
  defaultView: (now: Date) => EventHeroView;
}

/** A league-relative path, prefixed for the league. */
export function heroPath(league: CanonicalLeagueSlug): (path: string) => string {
  const def = getLeagueBySlug(league)!;
  return (path: string) => ensureLeaguePrefix(def, path);
}

/** A built calendar's own hint, else the profile's id map. */
export function heroRoleOf(profile: LeagueHeroProfile, event: ResolvedLeagueEvent): HeroEventRoleMatch | null {
  const hint = event.definition.heroRole;
  if (hint) return { role: hint as HeroEventRoleMatch['role'], pool: event.definition.heroPool };
  return profile.roleOf?.(event) ?? null;
}

/** The key one event occupies in the deduped calendar and the urgency map. */
export function heroRoleKey(match: HeroEventRoleMatch): string {
  return match.pool ? `${match.role}:${match.pool}` : match.role;
}

// ── The AFL ──────────────────────────────────────────────────────────────────

const AFL = LEAGUES['afl-fantasy'];
const aflMflHost = () => `https://${AFL.mflHost}`;

const AFL_ROLES: Record<string, HeroEventRoleMatch> = {
  'afl-keeper-deadline': { role: 'keeper-deadline' },
  // The AL and NL draft as separate events, off different MFL pages.
  'afl-al-draft': { role: 'pool-draft', pool: '00' },
  'afl-nl-draft': { role: 'pool-draft', pool: '01' },
  'afl-season-start': { role: 'season-start' },
  'afl-trade-deadline': { role: 'trade-deadline' },
  'afl-regular-season-ends': { role: 'regular-season-ends' },
  'afl-conference-playoffs': { role: 'playoffs' },
  'afl-championship-week': { role: 'championship' },
  'afl-new-season-starts': { role: 'new-league-year' },
};

const isDleague = (tier?: string) => /d.?league|develop|^0?1$/i.test((tier ?? '').trim());

/**
 * The calendar-driven ladder: everything the AFL's hero has always done. A
 * league with a calendar (authored or MFL's) and no contract offseason climbs
 * this one.
 */
const CALENDAR_LADDER: HeroStepId[] = [
  'trade-deadline',
  'championship',
  'champion-crowned',
  'playoffs',
  'calendar-lead',
  'regular-season',
  'schedule-release',
  'fresh-feature',
  'timeline',
  'default',
];

const aflProfile: LeagueHeroProfile = {
  league: 'afl-fantasy',
  ladder: CALENDAR_LADDER,
  scheduleRelease: { priority: 'P3', accentColor: ACCENT_GOLD },
  whatsNewTag: 'afl',
  featureSeed: 'afl-feature',
  eventIdPrefix: 'afl',
  // (year-1, year, year+1): events near calendar boundaries (champion-crowned
  // Jan, new season Feb) still surface even when MFL's "current league year"
  // has rolled to the next one.
  loadEvents: (now) => {
    const calYear = now.getFullYear();
    return [
      ...getAllResolvedAflEvents({ leagueYear: calYear - 1, referenceDate: now }),
      ...getAllResolvedAflEvents({ leagueYear: calYear, referenceDate: now }),
      ...getAllResolvedAflEvents({ leagueYear: calYear + 1, referenceDate: now }),
    ];
  },
  roleOf: (event) => AFL_ROLES[event.definition.id] ?? null,
  urgency: {
    'keeper-deadline': 30,
    'season-start': 7,
    'new-league-year': 14,
    // The conference-draft countdown owns the whole keeper-deadline → draft
    // stretch instead of the generic offseason hero. The drafts land Aug 23–30
    // (Sat/Sun before Labor Day weekend), so 50 days always reaches back past
    // the July 15 keeper deadline. The keeper hero still leads June 15 → Jul 15
    // (it sorts earlier), so the draft only surfaces once the keeper deadline
    // passes.
    'pool-draft:00': 50,
    'pool-draft:01': 50,
  },
  pools: [
    {
      id: '00',
      label: 'AL',
      name: 'American League',
      // The AL meets live and picks in MFL's live-draft applet.
      medium: 'live',
      when: 'Saturday at 12:30pm PT',
      countLabel: 'Sat 12:30PM PT',
      draftUrl: (year) => buildMflLiveDraftUrl({ leagueId: AFL.id, year, host: aflMflHost() }),
      composite: { wordmark: 'AL\u00a0DRAFT', accent: 'navy', tone: null, scope: 'league' },
      accent: ACCENT_STEEL,
      glow: 'rgba(59,107,154,.55)',
    },
    {
      id: '01',
      label: 'NL',
      name: 'National League',
      // The NL runs a slow email draft off MFL's email draft page, which never
      // opens that applet. Sending either conference to the other's page is a
      // dead end on the one day it matters.
      medium: 'email',
      when: 'Sunday at 9am PT',
      countLabel: 'Sun 9AM PT',
      draftUrl: (year) =>
        buildMflOptionUrl({ leagueId: AFL.id, year, option: MFL_EMAIL_DRAFT_OPTION, host: aflMflHost() }),
      composite: { wordmark: 'NL\u00a0DRAFT', accent: 'navy', tone: null, scope: 'league' },
      accent: ACCENT_GOLD,
      glow: 'rgba(196,30,58,.55)',
    },
  ],
  tierBadge: (tier) => {
    const dleague = isDleague(tier);
    return {
      badge: dleague ? '/assets/afl/dleague.svg' : '/assets/afl/premier.svg',
      badgeDark: dleague ? '/assets/afl/dleague-dark.svg' : '/assets/afl/premier-dark.svg',
      badgeAlt: dleague ? 'D-League' : 'Premier League',
    };
  },
  capabilities: {
    liveScoring: leagueHasFeature('afl-fantasy', 'liveScoring'),
    peckingOrderSlot: false,
    columnSlot: false,
    // The conference bracket and the AL-vs-NL title card.
    bracketHero: true,
  },
  facts: {
    keepers: {
      count: 7,
      time: '8:45pm PT',
      deadline: 'July 15 @ 8:45pm PT',
      lockLabel: '8:45PM PT',
      countLabel: 'Jul 15 · 8:45PM PT',
      path: '/rosters?view=planner',
    },
    tradeDeadline: {
      day: 'Wednesday',
      countLabel: 'Wed 11:59 PM PT',
      leadIn: 'Use the trade builder to line up your final moves of the season.',
      path: '/front-office/trade-builder',
      linkLabel: 'Open Trade Builder',
    },
    weeks: { finalRegular: 14, playoffStart: 15, championship: 17 },
    championshipName: 'World Championship',
    playoffsPath: '/playoffs',
    freeAgentsPath: '/rosters',
    lineup: { href: () => '/lineup', label: 'Set Lineup' },
    // `?conference=` is REQUIRED on every board link: the page falls back to the
    // first conference (the AL) when it is missing.
    draftBoardPath: '/draft/broadcast',
    draftOrderPath: '/draft/order',
    sundayTicket: true,
  },
  copy: {
    shortName: 'AFL',
    aroundThe: 'AFL',
    columnName: 'The Column',
    scheduleReleaseName: 'AFL',
    everyPool: 'both conferences',
    poolNames: 'the AL and NL',
    playoffPicture: 'the AL and NL playoff picture',
    recapSummary: 'Top performances, biggest blowouts, and the AL/NL games that swung the standings.',
    gameDayChores: 'swap injuries, finalize FCFS pickups',
    gameDayContent: 'Last call to set starters, swap injured players, and submit FCFS pickups.',
    deskSummary: 'Schefter covers the moves, the matchups, and the storylines shaping the AL and NL races.',
    championCrownedSummary:
      'The season has wrapped. View the bracket and savor the result before keeper math takes over.',
    playoffs: {
      title: 'Conference Playoffs',
      summary: 'Conference seeds 1–4 are battling for a championship spot. NIT bracket runs alongside for everyone else.',
      kicker: 'Conference Playoffs',
    },
    championship: { title: 'Championship Week', summary: 'AL champion vs. NL champion. Winner takes the AFL crown.' },
    offseason: {
      title: 'AFL Offseason',
      summary:
        'Quiet stretch on the calendar — but dynasty math never sleeps. Review rosters, scout free agents, and start lining up your keeper class.',
    },
    default: { title: 'AFL', summary: 'Two conferences, 24 teams, one champion. Welcome to the AFL.', kicker: 'AFL' },
  },
  defaultView: (now) => ({
    pill: 'AFL',
    headline: 'TWO CONFERENCES.',
    accentWord: 'ONE.',
    summary: 'Two conferences, 24 teams, one champion. Welcome to the AFL.',
    link: '/afl-fantasy/standings',
    linkLabel: 'VIEW STANDINGS',
    icon: 'star',
    // The league's own card, shown when no phase claims the day.
    composite: { wordmark: 'AFL', accent: 'navy', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  }),
};

// ── Package leagues (Archie's, and any new league without its own profile) ──
//
// A package league: its calendar is MFL's own export plus the facts every
// league has (package-league-events.ts), passed in by the page, and every
// event carries its own `heroRole`. Pages it does not have (a bracket page, a
// trade builder, a lineup page) point at the nearest page it does, or at MFL.
//
// Everything here is read from the registry entry and the league's config
// (team and division counts), so a new league gets a working hero with no
// edit to this file. Archie's is this profile with its column's own name.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0–99 in words ("ninety-nine"); larger numbers stay digits. */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}
const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export interface PackageHeroOptions {
  /** The league's weekly column, when it runs one under its own name. */
  columnName?: string;
}

/** A calendar-driven hero profile built entirely from a registry league. */
export function buildPackageHeroProfile(
  def: LeagueDefinition,
  options: PackageHeroOptions = {},
): LeagueHeroProfile {
  const slug = def.slug;
  const short = def.shortName ?? def.name;
  const config = getLeagueConfig(slug);
  const teamCount = config.teams?.length ?? 0;
  const divisionCount = config.divisions?.length ?? 0;
  const pools =
    divisionCount === 2 ? 'both divisions' : divisionCount > 2 ? `all ${numberWord(divisionCount)} divisions` : 'the league';
  const tagline =
    teamCount > 0 && divisionCount > 1
      ? `${capitalize(numberWord(teamCount))} teams, ${numberWord(divisionCount)} divisions, one champion. Welcome to ${short}.`
      : `${teamCount > 0 ? `${capitalize(numberWord(teamCount))} teams, one` : 'One'} champion. Welcome to ${short}.`;
  return {
    league: slug,
    ladder: CALENDAR_LADDER,
    scheduleRelease: { priority: 'P3', accentColor: ACCENT_GOLD },
    whatsNewTag: def.navSlug as LeagueSlug,
    featureSeed: `${def.navSlug}-feature`,
    eventIdPrefix: def.navSlug,
    urgency: {
      'season-start': 7,
      'new-league-year': 14,
      draft: 30,
      auction: 14,
      'trade-deadline': 7,
      'keeper-deadline': 30,
    },
    capabilities: {
      liveScoring: def.features.liveScoring,
      peckingOrderSlot: def.features.powerRankings,
      // The weekly column runs in the league's news feed.
      columnSlot: def.features.schefterFeed,
      bracketHero: false,
    },
    facts: {
      keepers: {
        count: 0,
        time: 'the deadline',
        deadline: 'the deadline',
        lockLabel: 'the deadline',
        countLabel: 'Keeper deadline',
        path: '/rosters',
      },
      tradeDeadline: {
        day: 'deadline',
        countLabel: 'Trade deadline',
        leadIn: 'Line up your final moves of the season.',
        path: '/rosters',
        linkLabel: 'View Rosters',
      },
      weeks: { finalRegular: 14, playoffStart: 15, championship: 17 },
      championshipName: 'Championship',
      // No bracket page yet: the standings carry the seeds.
      playoffsPath: '/standings',
      freeAgentsPath: '/free-agents',
      // Lineups are set on MFL — this site has no lineup page for the league.
      lineup: {
        href: (now) =>
          buildMflOptionUrl({
            leagueId: def.id,
            // Lineups are set inside a season, which is always its calendar year.
            year: now.getFullYear(),
            option: MFL_LINEUP_OPTION,
            host: `https://${def.mflHost}`,
          }),
        label: 'Set Lineup',
        external: true,
      },
      draftBoardPath: '/rosters',
      draftOrderPath: '/rosters',
      sundayTicket: false,
      // No Top Players page yet: the standings are where a week's results land.
      recapPage: { path: '/standings', label: 'See the standings' },
    },
    copy: {
      shortName: short,
      aroundThe: 'League',
      columnName: options.columnName ?? 'The Column',
      scheduleReleaseName: short,
      everyPool: pools,
      poolNames: pools,
      playoffPicture: 'the playoff picture',
      recapSummary: 'Top performances, biggest blowouts, and the games that swung the standings.',
      gameDayChores: 'swap injuries, finalize your pickups',
      gameDayContent: 'Last call to set starters, swap injured players, and finalize pickups.',
      deskSummary:
        divisionCount > 1
          ? `The desk covers the moves, the matchups, and the storylines shaping ${pools.replace(/divisions$/, 'division races')}.`
          : 'The desk covers the moves, the matchups, and the storylines shaping the league.',
      championCrownedSummary: 'The season has wrapped. Savor the result — the new season is already on its way.',
      playoffs: {
        title: 'Playoffs',
        summary: 'The bracket is set. Every game from here is win or go home.',
        kicker: 'Playoffs',
      },
      championship: { title: 'Championship Week', summary: 'One game for the title.' },
      offseason: {
        title: `${short} Offseason`,
        summary: 'Quiet stretch on the calendar. Review rosters and get ready for the next draft.',
      },
      default: { title: short, summary: tagline, kicker: short },
    },
    defaultView: (now) => ({
      pill: short.toUpperCase(),
      headline: divisionCount > 1 ? `${numberWord(divisionCount).toUpperCase()} DIVISIONS.` : `${short.toUpperCase()}.`,
      accentWord: 'ONE CHAMP.',
      summary: tagline,
      link: ensureLeaguePrefix(def, '/standings'),
      linkLabel: 'VIEW STANDINGS',
      icon: 'star',
      composite: { wordmark: short.toUpperCase(), accent: 'navy', tone: null, scope: 'league' },
      accent: ACCENT_GOLD,
      glow: GLOW_GOLD,
      player: randomHeroPlayer(now),
    }),
  };
}

const archiesProfile: LeagueHeroProfile = buildPackageHeroProfile(LEAGUES.archies, { columnName: 'The Gauntlet' });

// ── TheLeague ────────────────────────────────────────────────────────────────
//
// A salary-cap contract dynasty league. Its seasons run on RULES rather than
// calendar events (the trade deadline is always Nov 13; the playoffs open in
// week 15), so its phases come from `clock`, and its offseason — auction,
// rookie draft, franchise tags, the cut-down to 22 — from `contractCalendar`.
// Its heroes are TheLeague's own bespoke components (the `LeagueHero` router
// hands a state to them through `SeasonDailyHero`).

const THELEAGUE = LEAGUES.theleague;

/** The calendar year in Pacific time, for the Nov 13 deadline's midnight. */
const ptYear = (now: Date) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' }).format(now));

const theleagueProfile: LeagueHeroProfile = {
  league: 'theleague',
  ladder: [
    'trade-deadline',
    'championship',
    'champion-crowned',
    'auction',
    'rookie-draft',
    'breaking-story',
    'regular-season',
    'playoffs',
    'schedule-release',
    'roster-deadlines',
    'offseason-ambient',
    'whats-new-fallback',
  ],
  clock: {
    isTradeDeadlineDay,
    tradeDeadlineMidnight: (now) => `${ptYear(now)}-11-14T00:00:00-08:00`,
    isChampionship: isChampionshipWeek,
    isChampionCrowned: isChampionCrownedPeriod,
    isRegularSeason,
    isPlayoffs: isPlayoffPeriod,
  },
  contractCalendar: {
    isAuctionHeroPeriod,
    isAuctionLive,
    isDraftHeroPeriod,
    isDraftLive,
    draftStartFormatted: getDraftStartFormatted,
    isTagWindow,
    isTaggedShowcase,
    isUDFAWindow,
    isCutWatchUrgent,
    isCutWatchEarly,
    isDraftCountdown,
    isPreseasonCountdown,
    activeRosterLimit: AUGUST_CUT_TARGET,
    isEntryInHeroWindow,
    resolveFallbackContent: resolveHeroContent,
  },
  content: {
    tradeDeadline: (p) => ({
      source: 'event',
      title: 'Trade Deadline',
      summary: 'Make your moves before midnight PT. After today, rosters are locked for trades.',
      link: p('/front-office/trade-builder'),
      linkLabel: 'Open Trade Builder',
      icon: 'handshake',
      accentColor: 'var(--color-error, #dc2626)',
      kicker: 'Trade Deadline — Today',
      isUrgent: true,
    }),
    championCrowned: (p) => ({
      source: 'event',
      title: 'League Champion',
      summary: 'The season is over. A new champion has been crowned.',
      link: p('/playoffs'),
      linkLabel: 'View Championship Recap',
      icon: 'trophy',
      accentColor: 'var(--color-warning, #d97706)',
      kicker: 'Champion Crowned',
      isActive: true,
    }),
  },
  // Above the ambient offseason, which is exactly the stretch it falls in.
  scheduleRelease: { priority: 'P1', accentColor: 'var(--accent-color, #1c497c)' },
  whatsNewTag: 'theleague',
  featureSeed: 'theleague-feature',
  eventIdPrefix: 'theleague',
  urgency: {},
  capabilities: {
    liveScoring: leagueHasFeature('theleague', 'liveScoring'),
    // Its Pecking Order runs, but its Tuesday is the waiver card.
    peckingOrderSlot: false,
    columnSlot: false,
    // TheLeague's playoff weeks keep the slot rotation (its bracket is the
    // Monday standings slot's round hero).
    bracketHero: false,
  },
  facts: {
    keepers: { count: 0, time: '', deadline: '', lockLabel: '', countLabel: '', path: '/rosters' },
    tradeDeadline: {
      day: 'deadline',
      countLabel: 'Nov 13',
      leadIn: 'Use the trade builder to line up your final moves of the season.',
      path: '/front-office/trade-builder',
      linkLabel: 'Open Trade Builder',
    },
    weeks: { finalRegular: 14, playoffStart: 15, championship: 17 },
    championshipName: 'Championship',
    playoffsPath: '/playoffs',
    freeAgentsPath: '/free-agents',
    lineup: { href: () => '/lineup', label: 'Set Lineup' },
    draftBoardPath: '/draft/broadcast',
    draftOrderPath: '/draft/order',
    sundayTicket: true,
  },
  copy: {
    shortName: 'The League',
    aroundThe: 'League',
    columnName: 'The Column',
    scheduleReleaseName: 'The League',
    everyPool: 'the league',
    poolNames: 'the league',
    playoffPicture: 'the playoff picture',
    recapSummary: 'Top performances, biggest blowouts, and the games that swung the standings.',
    gameDayChores: 'swap injuries, finalize your pickups',
    gameDayContent: 'Last call to set starters, swap injured players, and finalize pickups.',
    deskSummary: 'Schefter covers the moves, the matchups, and the storylines shaping the league.',
    championCrownedSummary: 'The season is over. A new champion has been crowned.',
    playoffs: { title: 'Playoffs', summary: 'The bracket is set.', kicker: 'Playoffs' },
    championship: { title: 'Championship Week', summary: 'One game for the title.' },
    offseason: { title: 'Offseason', summary: 'Review rosters and plan the next move.' },
    default: { title: "What's New", summary: "See all the latest features, tools, and improvements we've shipped.", kicker: "What's New" },
  },
  defaultView: (now) => ({
    pill: 'THE LEAGUE',
    headline: 'THE',
    accentWord: 'LEAGUE.',
    summary: "See all the latest features, tools, and improvements we've shipped.",
    link: ensureLeaguePrefix(THELEAGUE, '/whats-new'),
    linkLabel: 'VIEW ALL UPDATES',
    icon: 'star',
    composite: { wordmark: 'THE\u00a0LEAGUE', accent: 'kickoff', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  }),
};

const PROFILES: Partial<Record<CanonicalLeagueSlug, LeagueHeroProfile>> = {
  theleague: theleagueProfile,
  'afl-fantasy': aflProfile,
  archies: archiesProfile,
};

/** Package profiles built on demand for registry leagues with no profile of their own. */
const BUILT = new Map<string, LeagueHeroProfile>();

/**
 * The hero profile for a league: its own profile when it has one, else the
 * package profile built from its registry entry. Throws only for a slug the
 * registry does not know.
 */
export function getLeagueHeroProfile(league: CanonicalLeagueSlug): LeagueHeroProfile {
  const own = PROFILES[league];
  if (own) return own;
  const def = getLeagueBySlug(league);
  if (!def) throw new Error(`No homepage hero profile for unknown league "${league}".`);
  let built = BUILT.get(league);
  if (!built) {
    built = buildPackageHeroProfile(def);
    BUILT.set(league, built);
  }
  return built;
}

/** Whether a slot is one this league runs, for `slotFor`. */
export function heroRunsSlot(profile: LeagueHeroProfile, slot: HeroSlot): boolean {
  if (slot === 'live-scoring') return profile.capabilities.liveScoring;
  if (slot === 'pecking-order') return profile.capabilities.peckingOrderSlot;
  if (slot === 'column') return profile.capabilities.columnSlot;
  return true;
}
