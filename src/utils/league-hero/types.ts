/**
 * The shared homepage hero's types — one state shape for every league.
 *
 * Every league's homepage hero is resolved by `resolveLeagueHeroState`
 * (./resolver.ts) from a PROFILE (./profiles.ts): which capabilities the league
 * has (auction, draft, keepers, pools that draft separately, live scoring, a
 * power-rankings column…), its calendar, and the handful of facts its copy
 * names. A capability is available to any league whose registry entry and
 * profile say it has it — nothing here branches on a league slug.
 */
import type { HeroContent, WhatsNewEntry } from '../../types/whats-new';
import type { DailySlot, GameWindow } from '../../types/hero-state';
import type { ResolvedLeagueEvent, WhatsNextTimeline } from '../../types/league-events';
import type { CompositeHeroTreatment } from '../../types/composite-hero';
import type { HeroModel } from '../hero-casting';
import type { ArticleHeroByline, LatestArticle } from '../article-hero-view';
import type { RecapDestination } from '../hero-recap-destination';
import type { WaiverDeadlineCopy } from '../waiver-deadline-copy';
import type { CanonicalLeagueSlug } from '../../config/leagues';
import type { LeagueEventView } from '../league-event-hero-view';

/** A secondary hero link — rendered smaller, next to the primary CTA. */
export interface HeroSecondaryLink {
  label: string;
  href: string;
  /** Renders a live dot (plus an SR-only "live now") ahead of the label. */
  live?: boolean;
  /** An off-site link (MFL's own pages) — opens in a new tab. */
  isExternal?: boolean;
}

/** Visual props passed straight to the branded event card or the composite. */
export interface EventHeroView {
  pill: string;
  /**
   * Small caps date shown beside the pill. Only the article card carries one —
   * a story's dateline is part of the story; a keeper deadline's is not.
   */
  pillDate?: string;
  headline: string;
  accentWord?: string;
  summary: string;
  link?: string;
  linkLabel?: string;
  isExternal?: boolean;
  /**
   * Author's face and name, for a card promoting an AUTHORED article. Resolved
   * from the post's own `authorId` (see article-hero-view.ts) — the feeds carry
   * external bylines, so this is never assumed to be the house reporter.
   */
  byline?: ArticleHeroByline;
  /**
   * Extra links rendered beside the primary CTA. Only the pool drafts populate
   * this today, from two places that MERGE (see mergeSecondaryLinks):
   *
   * - A view builder may add a link about its OWN event — a live-room draft
   *   card demotes the draft order here once the CTA becomes the room.
   * - Sibling-pool LIVE board links are attached post-resolve in
   *   pickLeadCalendarEvent, because a builder only sees its own event and
   *   can't know the sibling's live state. The hero leads with the VIEWER'S
   *   OWN pool, so without that an NL owner has no route to the AL board
   *   while the AL is actually drafting — and the pools draft on different
   *   days.
   */
  secondaryLinks?: HeroSecondaryLink[];
  icon?: string;
  /**
   * Which casting rule this view wants, when the state's KIND is not specific
   * enough to say. Two different heroes resolve to `kind: 'event'` — the
   * schedule-release tease and the generic dated-event card — and they want
   * different faces, so the RESOLVER says which rather than the caster
   * re-deriving it from a link string.
   */
  cast?: 'top-ranked';
  badge?: string;
  /** Dark-mode variant of `badge` — required whenever `badge` is set. */
  badgeDark?: string;
  badgeAlt?: string;
  accent?: string;
  glow?: string;
  player?: string;
  playerAlt?: string;
  /**
   * Feature screenshot filename relative to /assets/whats-new/ — the fresh
   * What's New hero shows the feature itself in a browser frame. Takes
   * precedence over the `player` webp; a cast `model` still wins over both
   * (set only when the entry names a featured player).
   */
  screenshot?: string;
  countValue?: string | number;
  countLabel?: string;
  /**
   * Cast composite model (ESPN cutout over team-color treatment). NOT set by
   * the resolver — the homepage attaches it post-resolve via castLeagueHeroModel
   * (data-wired, fs reads). When present it replaces the `player` webp art.
   */
  model?: HeroModel | null;
  /**
   * Hex the model's glow is tinted with, when the hero belongs to a FANTASY
   * franchise rather than to the cast player's NFL team — the viewer's own
   * club, when their pool rosters him. Attached post-resolve beside `model`
   * (it needs the rosters feed), and null everywhere the answer is "his NFL
   * team", which is most of the time. See hero-franchise-accent.ts for why
   * pool scoping is the rule.
   */
  modelAccent?: string | null;
  /**
   * The franchise whose crest belongs behind this hero, when one owns the
   * story — the same club `modelAccent` took its colour from. See hero-crest.ts.
   */
  modelFranchiseId?: string | null;
  /**
   * Render this state as a COMPOSITE (the shared `CompositeHero` shell) rather
   * than through the branded promo card, when a model resolves. Set here, not
   * in the component, because whether a draft is live or a deadline is today is
   * already known right here — and the wordmark is the phase's identity, which
   * is a copy decision like every other field on this view.
   *
   * `LeagueHero` falls back to the event card whenever this is absent OR no
   * model was cast, so a missing feed degrades to the card that always worked.
   */
  composite?: CompositeHeroTreatment;
}

/**
 * What a calendar event MEANS to the hero, independent of the id a league's
 * calendar gave it. The AFL hand-authors ids (`afl-al-draft`); a package
 * league's ids come from MFL (`archies-mfl-DRAFT_START-2026`). Roles are what
 * lets one resolver drive both.
 *
 * `pool-draft` is a draft run by ONE player pool (the AFL's conferences) —
 * `pool` names which. A league-wide draft is `draft`.
 */
export type HeroEventRole =
  | 'keeper-deadline'
  | 'draft'
  | 'pool-draft'
  | 'auction'
  | 'season-start'
  | 'trade-deadline'
  | 'regular-season-ends'
  | 'playoffs'
  | 'championship'
  | 'new-league-year';

export interface HeroEventRoleMatch {
  role: HeroEventRole;
  /** The pool this event belongs to, for a `pool-draft`. */
  pool?: string;
}

/** Both pools' draft dates, when the lead event is a pool draft. */
export interface PoolDraftState {
  pools: Array<{ id: string; label: string; date: Date; live: boolean }>;
  /** The viewer's own pool, when known. */
  userPool?: string;
}

/** The shared hero state — discriminated by `kind`. */
export type LeagueHeroState = LeagueHeroStateKind & {
  /** Which ladder rule matched — printed by a test-mode debug line. */
  resolvedBy?: string;
};

type LeagueHeroStateKind =
  | {
      kind: 'calendar-event';
      priority: 'P0' | 'P1';
      /**
       * The lead event's calendar id. For a pool draft this is still the
       * league's own id (`afl-al-draft`), which is what the What's Next strip
       * matches against.
       */
      eventId: string;
      /** What the event is to the hero. */
      role: HeroEventRole | 'champion-crowned';
      content: HeroContent;
      view: EventHeroView;
      /** Populated only when the lead event is a pool draft, so the page can render every pool's pill. */
      poolDraft?: PoolDraftState;
    }
  | {
      kind: 'trade-deadline';
      priority: 'P0++';
      content: HeroContent;
      deadlineMidnightPT: string;
      /** Test-mode reference clock for the countdown — set only when ?testDate= drove resolution. */
      referenceNowISO?: string;
    }
  /*
   * The playoff phases carry the slot rotation (and its `view`) only for a
   * league with no bracket hero of its own — those keep running the week's
   * cards through the title game. A league with one (the AFL's conference
   * bracket) gets neither, and the component renders the bracket.
   */
  | { kind: 'championship'; priority: 'P0'; content: HeroContent; view?: EventHeroView; slot?: HeroSlot; gameWindow?: GameWindow; week?: number; isLive?: boolean }
  | { kind: 'playoffs'; priority: 'P0'; content: HeroContent; view?: EventHeroView; slot?: HeroSlot; gameWindow?: GameWindow; week?: number; isLive?: boolean }
  | { kind: 'regular-season'; priority: 'P0'; content: HeroContent; view: EventHeroView; slot: HeroSlot; gameWindow: GameWindow; week?: number; isLive: boolean }
  | { kind: 'event'; priority: 'P1' | 'P3' | 'P4'; content: HeroContent; view: EventHeroView; eventView?: LeagueEventView; eventBordered?: boolean }
  | { kind: 'feature'; priority: 'P2'; content: HeroContent; view: EventHeroView; eventView?: LeagueEventView; eventBordered?: boolean }
  | { kind: 'default'; priority: 'P3' | 'P4' | 'P5'; content: HeroContent; view: EventHeroView; eventView?: LeagueEventView; eventBordered?: boolean }
  /*
   * The capability heroes a league turns on in its ladder (profiles.ts).
   * TheLeague renders them through its own bespoke components (via
   * `toSeasonHeroState`); each also carries a shared `view`, so any other
   * league that lists the rung renders it on the shared event card.
   */
  /** The offseason free-agent auction window — a salary-cap league's (`offseasonAuction`). */
  | { kind: 'auction'; priority: 'P0'; content: HeroContent; view?: EventHeroView; live: boolean; leagueYear: number }
  /** The rookie draft window — a league that drafts rookies after the NFL Draft. */
  | { kind: 'rookie-draft'; priority: 'P0'; content: HeroContent; view?: EventHeroView; live: boolean; leagueYear: number; draftStartFormatted: string }
  /** A fresh (<48h) breaking-tier story leads the homepage. */
  | { kind: 'breaking-story'; priority: 'P0'; content: HeroContent; view?: EventHeroView }
  /**
   * The offseason's dated phases of a contract league — its champion card,
   * franchise tags, the tagged-player market, undrafted free agents, the
   * roster cut-down, and the lulls before its draft and kickoff.
   */
  | { kind: 'league-phase'; priority: 'P0' | 'P1' | 'P3'; phase: LeaguePhase; content: HeroContent; view?: EventHeroView };

/** The dated offseason phases a contract league's ladder can reach. */
export type LeaguePhase =
  | 'champion-crowned'
  | 'tag-window'
  | 'tagged-showcase'
  | 'udfa-window'
  | 'cut-watch'
  | 'draft-countdown'
  | 'preseason-countdown';

/**
 * A daily slot, plus the weekly features a league may schedule into one:
 * the power-rankings column (`pecking-order`) and the league's weekly column
 * (`column` — Archie's calls it The Gauntlet). Neither is TheLeague's or the
 * AFL's today, which is why `DailySlot` (shared with the legacy resolver)
 * does not carry them.
 */
export type HeroSlot = DailySlot | 'pecking-order' | 'column';

/** The newest power-rankings issue — what the `pecking-order` slot promotes. */
export interface PeckingOrderHeroIssue {
  week: number;
  /** The #1 team, when the issue names one. */
  leader?: { franchiseId: string; name: string };
  href: string;
}

export interface LeagueHeroResolverInput {
  league: CanonicalLeagueSlug;
  referenceDate: Date;
  testMode?: boolean;
  whatsNewEntries?: WhatsNewEntry[];
  timeline?: WhatsNextTimeline;
  /**
   * Every calendar event the league has, across the surrounding league years,
   * NOT deduped (the resolver dedupes, and a few checks need the raw list).
   * A league whose calendar is read off disk (a package league's MFL export)
   * passes it; omitted, the profile loads its own authored calendar.
   */
  events?: ResolvedLeagueEvent[];
  /** The viewer's player pool (the AFL's conference `00`/`01`) — for the pool-aware draft hero. */
  userPoolId?: string;
  /** The viewer's tier ("Premier League" | "D-League") — for the keeper hero's badge. */
  userTier?: string;
  /**
   * Whether this season's schedule reveal is already locked. Passed in rather
   * than read here: the archive lives on disk and this resolver stays
   * synchronous.
   */
  scheduleReleaseRevealed?: boolean;
  /** Owner's lineup for the week is in (true), not (false), or unknown / signed out (null). The page reads it only on Saturday evening. */
  lineupSubmitted?: boolean | null;
  /**
   * Where Tuesday's recap hero points, and which week it is about. Resolved by
   * the page (`resolveRecapDestination`) because it reads the feeds off disk.
   * Omitted → the recap slot degrades to the news feed.
   */
  recap?: RecapDestination;
  /**
   * The waiver deadline, already worded — day, hour and clock resolved from
   * MFL's own calendar and the viewer's chosen zone. Omitted → copy that names
   * no day. It must NEVER degrade to "Wednesday": the slot runs from Tuesday
   * 2pm PT, and a hardcoded Wednesday told owners for ten hours a week that
   * claims ran that night when they ran the next.
   */
  waiver?: WaiverDeadlineCopy;
  /**
   * The latest article, with its byline resolved — what the news slot
   * promotes. Omitted → the desk card, the ONE state allowed to point the CTA
   * at the news listing.
   */
  article?: LatestArticle;
  /**
   * The newest power-rankings issue for this season, when the league runs one.
   * Omitted → the `pecking-order` slot hands its day to the slot it replaced.
   */
  peckingOrder?: PeckingOrderHeroIssue;
  /**
   * The newest weekly column (`column` slot), when the league runs one.
   * Omitted → the slot hands its day to the slot it replaced.
   */
  column?: LatestArticle;
  /**
   * Whether the league's rookie draft has finished (the draft window closes
   * early, and the undrafted-free-agent window opens, when it has).
   */
  draftComplete?: boolean;
  /** A fresh (<48h) breaking-tier story with a castable headline player exists. */
  hasBreakingStory?: boolean;
  /**
   * Injectable random source (0..1) for the lead-up hero pool; defaults to
   * Math.random. The pool is `[countdown, ...freshEntries]` and the pick is
   * `floor(rng() * pool.length)`.
   */
  rng?: () => number;
}
