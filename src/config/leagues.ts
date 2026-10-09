/**
 * Typed wrapper around the league registry (src/config/leagues.mjs).
 *
 * App code should import from here; node scripts import the .mjs directly.
 * The registry is the single source of truth for league ids, slugs, names,
 * MFL hosts, data paths, domains, and feature flags.
 */

import type { LeagueSlug } from '../types/nav';
import {
  LEAGUES as RAW_LEAGUES,
  DEFAULT_LEAGUE_SLUG as RAW_DEFAULT,
  DEFAULT_LEAGUE_ID as RAW_DEFAULT_ID,
  getLeagueBySlug as rawGetBySlug,
  getLeagueById as rawGetById,
  getLeagueByPath as rawGetByPath,
  leagueOrigin as rawLeagueOrigin,
  leagueUrl as rawLeagueUrl,
  stripLeaguePrefix as rawStripLeaguePrefix,
  ensureLeaguePrefix as rawEnsureLeaguePrefix,
  buildHostToSlugMap,
  defaultMflWriteHost,
  SHARED_APP_ORIGIN,
  isSharedAppHost,
  leagueHasOwnFrontDoor,
  resolveSharedHostHiddenLeague as rawResolveSharedHostHiddenLeague,
  MFL_LIVE_OPEN_SIGN_IN,
  MFL_LIVE_PILOT_LEAGUE_IDS,
  mflLiveSignInLeagueIds,
} from './leagues-data.mjs';

/** Canonical slug: the path segment under src/pages/ */
export type CanonicalLeagueSlug = keyof typeof RAW_LEAGUES | DemoOnlyLeagueSlug;

/**
 * Slots registered only on a custom-site demo deployment (see the `isDemoEnv`
 * block in leagues-data.mjs) — absent from `LEAGUES` everywhere else, so a
 * lookup of one must go through `getLeagueBySlug` and handle null.
 */
export type DemoOnlyLeagueSlug = 'keeper';

/** Starting presets for a league's features — see src/config/league-archetypes.mjs. */
export type LeagueArchetype = 'dynasty-cap' | 'deluxe-keeper' | 'contest' | 'best-ball' | 'standard-redraft';

export interface LeagueFeatures {
  contracts: boolean;
  salaryCap: boolean;
  keepers: boolean;
  powerRankings: boolean;
  /** Rules page + Ask Roger (src/utils/league-rulebook.ts for package leagues). */
  rulesQa: boolean;
  /** Playoffs page — shown once MFL has the league's real brackets (src/utils/playoff-bracket-index.mjs). */
  playoffs: boolean;
  /** Franchise pages (detail + index) from the league's MFL history (scripts/compute-franchise-history.mjs). */
  franchisePages: boolean;
  liveLineups: boolean;
  schefterFeed: boolean;
  /**
   * Anonymous tip submission + rumor-mill pipeline (tip page, style book,
   * whisper-back threads, rumor scanner lane). Distinct from schefterFeed,
   * which only governs the news feed page.
   */
  schefterTips: boolean;
  liveScoring: boolean;
  /**
   * The live-scoring board falls back to a BUNDLED REPLAY of the last
   * completed regular-season week when MFL's feed comes back empty-but-healthy
   * — which it does all offseason, because MFL switches liveScoring off.
   *
   * Off for a league with no season to replay. A brand-new best-ball league is
   * the live example: its honest empty state ("scores will appear when games
   * begin") is a better answer than last season's numbers under a badge, and
   * the flag is what keeps that decision in the registry rather than in a slug
   * comparison inside the page AND inside the poll route.
   */
  liveScoringSample: boolean;
  /**
   * The league has a practice ("taxi") squad — rookies parked off the active
   * roster. TheLeague's holds 3; the AFL has no such thing, so anything that
   * names it must gate on this rather than assume every league has one.
   *
   * NOTE: `src/pages/api/move-to-practice.ts` predates this flag and still
   * hardcodes TheLeague's cap without gating by league. Wiring it up is a
   * separate change — this flag exists so UI copy can stop guessing today.
   */
  taxiSquad: boolean;
  /**
   * The league replaces offseason free agency with a live auction on MFL.
   * While that window is open (src/utils/auction-window.ts) an in-place waiver
   * claim is the wrong mechanism, so the acquisition affordance deep-links to
   * MFL instead of opening the claim form.
   */
  offseasonAuction: boolean;
  /**
   * Commissioner accounting page: read/write of MFL's league accounting
   * ledger and the season payout run. Requires a league that (a) actually
   * settles money on MFL and (b) has a documented prize table under
   * `payouts` — a league with the flag on and no `payouts` can still keep
   * the ledger, it just has no payouts to plan.
   */
  accounting: boolean;
  /**
   * The league publishes `/preferences` — the viewer's country and clock.
   * The nav's account menu prints the chosen clock and links here, so a
   * league without the page must not be offered the row.
   */
  viewerPreferences: boolean;
  /**
   * The league publishes `/notifications` — per-category push settings.
   * Same reason: the account menu links it only where the page exists.
   */
  pushNotifications: boolean;
  /** Commissioner branding editor (names, colours, uploaded marks). */
  brandingEditor: boolean;
}

/**
 * How the payout planner finds the franchise that won a prize. Every kind is
 * derived from data the league already publishes — none of them is a
 * hand-entered winner.
 */
export type PayoutSource =
  /** Final standing N in the league's championship/placement brackets. */
  | { kind: 'placement'; place: number }
  /** A slug already resolved in the league's awards history. */
  | { kind: 'award'; slug: string }
  /** Highest score in each played regular-season week. */
  | { kind: 'weekly-high'; weeks: number }
  /**
   * Every franchise holding one of these seeds in a conference playoff
   * bracket. The AFL pays its division titles and wild cards this way: seeds
   * 1-2 are the division winners who actually made the playoffs, seeds 3-4
   * the wild cards. Keyed on seed rather than on a division-title award
   * because a division winner who misses the playoffs is not paid.
   */
  | { kind: 'playoff-seed'; seeds: number[] }
  /** Rank N of an all-play tier table (AFL Premier League / D-League). */
  | { kind: 'tier-rank'; tier: string; rank: number };

/** One line of a league's prize table. */
export interface PayoutPrize {
  /** Stable key — the ledger's idempotency handle. Never renumber these. */
  key: string;
  label: string;
  /** Dollars OWED TO the winner. Sign conversion happens in the writer. */
  amount: number;
  source: PayoutSource;
}

export interface LeaguePayouts {
  /**
   * The constitution's stated prize pool. Display-and-reconcile only — the
   * planner never scales a prize to fit it.
   */
  prizePool: number;
  prizes: PayoutPrize[];
}

/** Date (month is 1-indexed) on which a league flips to the new MFL league year. */
export interface LeagueYearRollover {
  /** 1-indexed month (1 = January, 6 = June). */
  month: number;
  /** Day of month. */
  day: number;
}

/**
 * The Owners' Poll — the weekly owner vote that publishes inside The Pecking
 * Order (docs/plans/owners-poll.md).
 *
 * Present on every league, `enabled: false` where it doesn't run, so shared
 * components always have a shape to read rather than branching on undefined.
 */
export interface OwnersPollConfig {
  enabled: boolean;
  /**
   * Ballot depth — how many teams an owner ranks. Deliberately NOT the field
   * size: a 7-slot ballot in a 16-team league leaves a tail the poll does not
   * order, which is a stated design trade.
   */
  slots: number;
  /**
   * Day the ballot closes (0 = Sunday). Thursday, so the deadline is the one
   * owners already obey — lineups are due before the first kickoff.
   */
  closeWeekday: number;
  /** Hour (24h, America/Los_Angeles) the ballot closes on `closeWeekday`. */
  closeHourPT: number;
}

/**
 * A league's official clock. Structurally a `ZoneOption` from
 * `src/utils/viewer-preferences.ts` plus its identity list — declared HERE
 * rather than imported from there because the dependency must not run in that
 * direction: `viewer-preferences.ts` is in Storybook's rendering graph, and
 * pulling the registry into it would wake every Sunday Ticket snapshot on any
 * registry edit (docs/claude/rules/viewer-preferences.md). The clock travels
 * as a value instead. `tests/league-official-clock.test.ts` pins the two
 * shapes against each other so they cannot drift.
 */
export interface LeagueClock {
  /** Stable id, unique within a country's catalog. */
  id: string;
  /** IANA zone. */
  zone: string;
  /** Fixed label ('PT') or 'auto' for Intl's short name. */
  label: string;
  /** Locale for an 'auto' label. */
  locale?: string;
  /** What the preferences picker calls it. */
  name: string;
  /**
   * Zones that ARE this clock — same wall clock year-round, DST included.
   * An identity list, never computed from a current offset.
   */
  equivalents?: readonly string[];
}

export type LeagueChatConfig =
  | { provider: 'groupme'; botEnv: string }
  | { provider: 'slack'; tokenEnv: string; channelEnv: string };

/** Schedule planner policy — see `schedulePolicy` on a registry entry and src/utils/schedule-plan.mjs. */
export interface SchedulePolicy {
  mode: 'simple' | 'constructive';
  startWindow: number[];
  endWindow: number[];
  doubleheaderCount: number;
  keepDivisionFinish: boolean;
  crossConference: {
    week: number;
    anchorYear: number;
    /** Each entry is a pair of division (or, for rivalries, team) names. */
    anchorPairing: string[][];
    alternatePairing: string[][];
    protectedRivalries: string[][];
  } | null;
}

export interface LeagueDefinition {
  id: string;
  slug: CanonicalLeagueSlug;
  /** Short slug used by nav config / styles */
  navSlug: LeagueSlug;
  /** Color theme id — a file in src/themes/ (see scripts/generate-league-themes.mjs). */
  theme: string;
  /**
   * The preset this league's feature checkboxes started from
   * (src/config/league-archetypes.mjs). Informational: code gates on
   * `features` via leagueHasFeature, never on the archetype.
   */
  archetype: LeagueArchetype;
  /** Franchises that see admin-only nav links, get ops alerts, and count as commissioners (auth fallback). */
  adminFranchiseIds: string[];
  /**
   * Opts the league into the Schefter scanners (scripts/lib/schefter-leagues.mjs):
   * its events file, the NAMES of its GroupMe env vars, and which lanes run.
   * Absent = a news feed (if `schefterFeed`) but no scanner.
   */
  schefter?: {
    eventsPath: string;
    env: { schefterBot: string; rogerBot: string; groupId: string; rogerSender: string };
    lanes: {
      tradeBait: boolean;
      eventReminders: boolean;
      directGroupMe: boolean;
      tradeOfferRumors: boolean;
      groupmeListen: boolean;
      rogerReplies: boolean;
    };
  };
  /** Opts the league into the schedule planner and reveal. Absent = no planner. */
  schedulePolicy?: SchedulePolicy;
  name: string;
  mflHost: string;
  dataPath: string;
  domains: string[];
  /** Canonical host for absolute URLs to this league — see leagueOrigin(). */
  canonicalDomain?: string;
  /** The custom-site demo's path for this slot (demo.mfl.football/<demoPath>). */
  demoPath?: string;
  /** When set, the only nav link ids this league renders. */
  navLinks?: string[];
  /**
   * Stable staging hostnames (e.g. staging.theleague.us). Feed buildHostToSlugMap
   * ONLY — never leagueOrigin/leagueUrl, which must stay on production hosts.
   * See the note above buildHostToSlugMap in leagues-data.mjs.
   */
  stagingDomains?: string[];
  /**
   * Optional per-league year-rollover date. Present for leagues whose MFL
   * season is created on a different schedule than TheLeague's Feb 14 default
   * (e.g. AFL rolls over June 1). Consumed by getAflLeagueYear() in
   * src/utils/league-year.ts.
   */
  leagueYearRollover?: LeagueYearRollover;
  /**
   * True for leagues where the same NFL player can be rostered by more than
   * one franchise at once (AFL's 24-team duplicate-player conferences).
   * Logic that infers anything from "player is on another franchise's
   * roster" must be skipped for these leagues.
   */
  duplicatePlayers?: boolean;
  /**
   * True for draft-only best-ball leagues: the startup draft is the whole
   * game — no lineups, no add/drops, no in-season management UI. Nav and
   * shared components must not offer roster-management actions for these
   * leagues, and their nav links are opt-in (see nav-utils).
   */
  bestBall?: boolean;
  /**
   * Weeks that run Throwback Week — franchises wear a legacy identity instead
   * of their current one. Absent for a league that doesn't run it, which is
   * every league but TheLeague today.
   */
  throwbackWeeks?: number[];
  /**
   * Prize table for the accounting page's payout run. Absent for a league
   * that pays out nothing (or hasn't written its table down yet) — the page
   * then offers the ledger and CSV import without a payouts panel.
   */
  payouts?: LeaguePayouts;
  /**
   * Owners' Poll configuration. Always present; check `enabled` before
   * offering any poll UI or accepting a ballot.
   */
  ownersPoll: OwnersPollConfig;
  /**
   * Pecking Order options for a big league. `topN`: write up only the top N
   * teams (the rest are ranked and shown in their division lists). Absent →
   * every team gets a blurb, as TheLeague and the AFL always have.
   */
  peckingOrder?: { topN?: number };
  /**
   * The league's own playoff seeding, when it is not TheLeague's "division
   * winners, then wild cards" ladder. `mad` is Archie's MAD POWER 99: each
   * division's first `divisionLeaders` rows, then its second rows
   * (`runnersUp`), then `wildCards` more — each tier in MFL's row order. Read
   * by the shared standings page and the league's MFL widget
   * (public/mfl/10105/standings.js). Absent → the default ladder.
   */
  standingsSeeding?: { kind: 'mad'; divisionLeaders: number; runnersUp: number; wildCards: number };
  /**
   * The zone this league keeps its own time in — see `officialClock` in
   * leagues-data.mjs. Always present; read it with `leagueClock(slug)` rather
   * than reaching into the entry, and never fall back to a hardcoded Pacific
   * when you have a slug in hand.
   */
  officialClock: LeagueClock;
  /**
   * `false` keeps the league off the mfl.football front door (src/pages/index.astro)
   * while it stays served at its own path. Absent → listed.
   */
  advertiseOnSharedHost?: boolean;
  /**
   * Nav renders only links tagged `leagueOnly: <navSlug>` (src/utils/nav-utils.ts),
   * as it always has for best-ball. Absent → the default link set.
   */
  optInNav?: boolean;
  /**
   * `'package'`: the league's pages are the package-league set
   * (src/config/package-league-routes.mjs), entitled by its features — each
   * route exists iff its feature is ticked, and a nav link to a route it is
   * not entitled to is hidden. Archie's and every league scripts/new-league.mjs
   * launches. Absent: hand-built pages (TheLeague, the AFL, best ball).
   */
  pageKit?: 'package';
  /**
   * MFL reassigns this league's franchise ids between seasons, so a departed
   * team's seasons are grouped by team name across ids (owner-tenures), not
   * per id. Current teams are followed by `ownerHistory` in the config.
   */
  renumbersFranchises?: boolean;
  /** Short display name for tight spaces (the site header). */
  shortName?: string;
  /** The league's mark for the shared header and layout, per theme. */
  /**
   * The league's mark. BOTH cuts are always set, even when they are the same
   * file (Archie's): whether the dark cut differs is a per-league choice made
   * here, never a missing field a component has to guess around.
   */
  logo: { light: string; dark: string };
  /**
   * The Schefter share card's mark, when `logo.dark` is a format the card
   * renderer cannot read (it takes PNG or SVG, not WebP). Defaults to logo.dark.
   */
  logoOg?: string;
  /** Schefter share-card branding. Absent = derived from name, domain and themeColor. */
  shareCard?: { name: string; domain: string; primary: string };
  /** Demo banner line, when the archetype's default does not fit. */
  demoPitch?: string;
  /** First season of the league's player archive. Absent = not stated on draft results. */
  playerArchiveStartYear?: number;
  /** Weekly Schefter article types the league gets. Absent = every type. */
  articleTypes?: string[];
  /** Push notification icon + Android badge. Absent = the site's PWA art. */
  pushArt?: { icon: string; badge: string };
  /** Optional wordmark shown beside `logo` instead of the text short name. */
  wordmark?: string;
  /** Browser chrome `theme-color` for a package league. */
  themeColor?: string;
  /**
   * The chat the league's news persona posts into (scripts/lib/chat.mjs).
   * Env var NAMES only. Absent → the league has no chat.
   */
  chat?: LeagueChatConfig;
  /**
   * The league's default news persona, used until the commissioner saves one
   * (src/utils/persona.mjs). Absent → Claude Schefter.
   */
  persona?: { name?: string; avatarUrl?: string; voice?: string };
  /**
   * League-minimum salary — what any roster add costs, FCFS free-agent adds
   * included. Absent for a league without salaries.
   */
  minimumSalary?: number;
  features: LeagueFeatures;
}

export const LEAGUES = RAW_LEAGUES as Record<Exclude<CanonicalLeagueSlug, DemoOnlyLeagueSlug>, LeagueDefinition> &
  Partial<Record<DemoOnlyLeagueSlug, LeagueDefinition>>;
export const DEFAULT_LEAGUE_SLUG = RAW_DEFAULT as Exclude<CanonicalLeagueSlug, DemoOnlyLeagueSlug>;
/** MFL numeric id of the default league. Use instead of hardcoding '13522'. */
export const DEFAULT_LEAGUE_ID = RAW_DEFAULT_ID as string;
export const ALL_LEAGUES: LeagueDefinition[] = Object.values(RAW_LEAGUES) as LeagueDefinition[];
/**
 * The default league's full registry entry — for TheLeague-only components
 * (auction/draft heroes, demo/prototype components) that need a
 * `mflHost`/`leagueId` prop default and don't take a `league` param. Use
 * `DEFAULT_LEAGUE.mflHost` / `DEFAULT_LEAGUE.id` instead of each call site
 * re-deriving `getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!` independently (code
 * review flagged this pattern copy-pasted across 6 components).
 */
export const DEFAULT_LEAGUE: LeagueDefinition = LEAGUES[DEFAULT_LEAGUE_SLUG];

export function getLeagueBySlug(slug: string): LeagueDefinition | null {
  return rawGetBySlug(slug) as LeagueDefinition | null;
}

export function getLeagueById(id: string): LeagueDefinition | null {
  return rawGetById(id) as LeagueDefinition | null;
}

/** Resolve a URL pathname to its league; defaults to theleague. */
export function getLeagueByPath(pathname: string): LeagueDefinition {
  return rawGetByPath(pathname) as LeagueDefinition;
}

/** Whether a feature is enabled for the given league slug. */
export function leagueHasFeature(slug: string, feature: keyof LeagueFeatures): boolean {
  return getLeagueBySlug(slug)?.features[feature] ?? false;
}

/**
 * A salary league's minimum salary — the floor every roster add signs at, a
 * first-come-first-served free-agent add included. Throws for a league with no
 * salaries rather than answering 0: a caller pricing a roster in a league that
 * has none is a bug, and a silent 0 is how the waiver column once called two
 * FCFS pickups "free assets for zero dollars" (#1311). The registry is the one
 * home for the figure; `tests/minimum-salary-literal-guard.test.ts` fails on a
 * bare copy anywhere else.
 */
export function leagueMinimumSalary(slug: string): number {
  const min = getLeagueBySlug(slug)?.minimumSalary;
  if (typeof min !== 'number') throw new Error(`League "${slug}" has no minimumSalary`);
  return min;
}

/**
 * THE ACCESSOR for a league's official clock. Every surface that prints a
 * league moment — a waiver deadline, a draft start, a poll close, the clock
 * line in the nav drawer — resolves it through here, so the zone is a
 * registry setting rather than a constant compiled into the time code.
 *
 * An unknown slug falls back to the DEFAULT league's clock rather than
 * inventing one: a caller that cannot name its league is a caller with no
 * business choosing a different clock than the site's own.
 */
export function leagueClock(slug: string | null | undefined): LeagueClock {
  return (getLeagueBySlug(slug ?? '') ?? LEAGUES[DEFAULT_LEAGUE_SLUG]).officialClock;
}

/**
 * A league's prize table, or null when it publishes none. Separate from
 * `leagueHasFeature(slug, 'accounting')` on purpose: the ledger and the
 * payout run are independently available.
 */
export function getLeaguePayouts(slug: string): LeaguePayouts | null {
  return getLeagueBySlug(slug)?.payouts ?? null;
}

/**
 * Resolve a league by its nav slug ('theleague' | 'afl'). The same lookup
 * was previously hand-rolled with ALL_LEAGUES.find() at several call sites
 * (a copy-paste pattern code review has flagged before — see DEFAULT_LEAGUE).
 */
export function getLeagueByNavSlug(navSlug: LeagueSlug): LeagueDefinition {
  const league = ALL_LEAGUES.find((l) => l.navSlug === navSlug);
  if (!league) {
    throw new Error(`No league registered for nav slug '${navSlug}'`);
  }
  return league;
}

/**
 * Canonical absolute origin for a league (e.g. 'https://www.theleague.us'),
 * or null when the league has no apex domain. Session cookies are host-only,
 * so every producer of absolute league URLs must agree on this host.
 */
export function leagueOrigin(league: LeagueDefinition): string | null {
  return rawLeagueOrigin(league) as string | null;
}

/**
 * Absolute URL to a page for a league, with the league's own redundant path
 * prefix stripped (`/theleague/calendar` on www.theleague.us → `/calendar`).
 * Use this instead of concatenating leagueOrigin() with a prefixed path.
 */
export function leagueUrl(league: LeagueDefinition, path?: string): string {
  return rawLeagueUrl(league, path) as string;
}

/** Strip a league's own path prefix from an internal path. See leagueUrl(). */
export function stripLeaguePrefix(league: LeagueDefinition, path: string): string {
  return rawStripLeaguePrefix(league, path) as string;
}

/**
 * Mirror of stripLeaguePrefix — guarantee a league-local path carries its
 * prefix (what routes on the shared host). Cross-league paths pass through.
 */
export function ensureLeaguePrefix(league: LeagueDefinition, path: string): string {
  return rawEnsureLeaguePrefix(league, path) as string;
}

export {
  buildHostToSlugMap,
  defaultMflWriteHost,
  SHARED_APP_ORIGIN,
  isSharedAppHost,
  leagueHasOwnFrontDoor,
  MFL_LIVE_OPEN_SIGN_IN,
  MFL_LIVE_PILOT_LEAGUE_IDS,
  mflLiveSignInLeagueIds,
};

/**
 * An href for a league-prefixed path that actually WORKS from this hostname.
 *
 * Returns the path untouched when this host serves it, and an absolute URL to
 * the league's own domain when it does not. That makes it safe to wrap every
 * league-prefixed href on a page that renders on more than one host: on
 * localhost and Vercel previews nothing changes, so a branch stays drivable,
 * and on the shared app host the two leagues it no longer serves leave for
 * their own domains instead of pointing at a 404.
 *
 * One rule, one implementation. The splash panels, the What's New cards and
 * the nav's league switcher all had to make this decision, and three copies of
 * "is it hidden here, and if so where does it live" is how they drift apart.
 */
export function crossHostLeagueHref(hostname: string, path: string): string {
  const hidden = resolveSharedHostHiddenLeague(hostname, path);
  if (!hidden) return path;
  return leagueUrl(hidden, path.slice(`/${hidden.slug}`.length) || '/');
}

/**
 * The league whose pages must not be served at this hostname + path, or null.
 * Typed wrapper over the registry's resolver — see its comment for why the
 * rule is derived from `domains` rather than a list of slugs.
 */
export function resolveSharedHostHiddenLeague(
  hostname: string,
  pathname: string,
): LeagueDefinition | null {
  return rawResolveSharedHostHiddenLeague(hostname, pathname) as LeagueDefinition | null;
}
