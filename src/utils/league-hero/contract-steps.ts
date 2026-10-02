/**
 * The contract-league rungs of the shared hero ladder — the offseason of a
 * salary-cap dynasty league: the free-agent auction, the rookie draft and its
 * undrafted free agents, franchise tags and the tagged-player market, the
 * roster cut-down, and the lulls before its draft and kickoff. Plus the
 * breaking-story rung and the What's New fallback that league's homepage runs
 * on.
 *
 * TheLeague's today. Any league whose profile lists these rungs in its
 * `ladder` and supplies a `contractCalendar` (the dates its constitution sets)
 * gets them — a league with an auction and no rookie draft lists `auction`
 * and not `rookie-draft`, and so on. Nothing here names a league; the dates
 * come from the profile's calendar and the links from the league's own prefix.
 */
import type { HeroContent, WhatsNewEntry } from '../../types/whats-new';
import { entryAppliesToLeague } from '../../types/whats-new';
import { buildLeagueEventView } from '../league-event-hero-view';
import { isGameLive } from '../hero-resolver';
import type { LeagueHeroState } from './types';
import type { StepContext } from './resolver';
import { eventSlotView, featureSlotView } from './views';

/** The dates a contract league's constitution sets (see profiles.ts `contractCalendar`). */
export interface ContractLeagueCalendar {
  isAuctionHeroPeriod(now: Date): boolean;
  isAuctionLive(now: Date): boolean;
  isDraftHeroPeriod(now: Date): boolean;
  isDraftLive(now: Date): boolean;
  draftStartFormatted(year: number): string;
  isTagWindow(now: Date): boolean;
  isTaggedShowcase(now: Date): boolean;
  isUDFAWindow(now: Date, draftComplete?: boolean): boolean;
  isCutWatchUrgent(now: Date): boolean;
  isCutWatchEarly(now: Date): boolean;
  isDraftCountdown(now: Date): boolean;
  isPreseasonCountdown(now: Date): boolean;
  /** The roster limit the cut-down trims to, for the cut-watch copy. */
  activeRosterLimit: number;
  /** Whether a What's New entry is inside its own hero window (`heroRotationDays`, else 7 days). */
  isEntryInHeroWindow(entry: WhatsNewEntry, now: Date): boolean;
  /** The What's New fallback's own resolution (fresh feature → events → newest article). */
  resolveFallbackContent(entries: WhatsNewEntry[], timeline: NonNullable<StepContext['input']['timeline']>, now: Date): HeroContent;
}

function calendarOf(ctx: StepContext): ContractLeagueCalendar | null {
  return ctx.profile.contractCalendar ?? null;
}

// ── The auction and the rookie draft ─────────────────────────────────────────

export function auctionStep(ctx: StepContext): LeagueHeroState | null {
  const cal = calendarOf(ctx);
  if (!cal?.isAuctionHeroPeriod(ctx.now)) return null;
  const live = cal.isAuctionLive(ctx.now);
  return {
    kind: 'auction',
    priority: 'P0',
    live,
    leagueYear: ctx.now.getFullYear(),
    content: {
      source: 'auction',
      title: 'Free Agent Auction',
      summary: live
        ? 'The auction is under way. Place bids, track results, and build your roster.'
        : 'Auction season is almost here. Get your roster ready and plan your bids.',
      icon: 'banknote',
      accentColor: 'var(--cat-free-agency, #2e8743)',
      kicker: live ? 'Auction Under Way' : 'Auction Opens Soon',
      isActive: live,
    },
    resolvedBy: 'isAuctionHeroPeriod',
  };
}

/** The rookie draft window — skipped once the draft is complete (its UDFA window opens early). */
export function rookieDraftStep(ctx: StepContext): LeagueHeroState | null {
  const cal = calendarOf(ctx);
  if (!cal?.isDraftHeroPeriod(ctx.now) || ctx.input.draftComplete) return null;
  const live = cal.isDraftLive(ctx.now);
  const year = ctx.now.getFullYear();
  return {
    kind: 'rookie-draft',
    priority: 'P0',
    live,
    leagueYear: year,
    draftStartFormatted: cal.draftStartFormatted(year),
    content: {
      source: 'draft',
      title: 'Rookie Draft',
      summary: live
        ? 'The rookie draft is under way. Make your picks, trade up, and build your dynasty.'
        : 'Draft day is almost here. Scout the class, check your picks, and plan your strategy.',
      icon: 'draft-podium',
      accentColor: 'var(--cat-draft, #7c3aed)',
      kicker: live ? 'Draft Under Way' : 'Draft Day Is Coming',
      isActive: live,
    },
    resolvedBy: 'isDraftHeroPeriod',
  };
}

/**
 * A fresh (<48h) trade/auction bomb. Sits below the deadline / championship /
 * auction / draft windows but above every ambient slot. Yields only to a game
 * that's ACTUALLY in-season live — `isGameLive` alone is true on any
 * game-time window (incl. offseason Sundays), which would wrongly suppress it.
 */
export function breakingStoryStep(ctx: StepContext): LeagueHeroState | null {
  if (!ctx.input.hasBreakingStory) return null;
  if (isGameLive(ctx.now) && (ctx.isRegularSeason() || ctx.isPlayoffs())) return null;
  return {
    kind: 'breaking-story',
    priority: 'P0',
    // The story itself (headline, cast player) is the page's — it cast the
    // player before asking. This is the state's plain-text label only.
    content: { source: 'event', title: 'Breaking News', summary: '', kicker: 'Breaking', isUrgent: true },
    resolvedBy: 'hasBreakingStory',
  };
}

// ── The dated offseason phases ───────────────────────────────────────────────

function tagWindow(ctx: StepContext, priority: 'P1' | 'P3'): LeagueHeroState {
  return {
    kind: 'league-phase',
    phase: 'tag-window',
    priority,
    content: {
      source: 'event',
      title: 'Franchise Tags & Extensions',
      summary: 'Protect your core. Tag players to retain exclusive rights. Extend contracts before they hit the open market.',
      link: ctx.p('/rosters'),
      linkLabel: 'Manage Your Roster',
      icon: 'tag',
      // The two tiers have always carried different category shades.
      accentColor: priority === 'P1' ? 'var(--cat-preseason, #2563eb)' : 'var(--cat-preseason, #60a5fa)',
      kicker: 'Offseason',
      isActive: true,
    },
    resolvedBy: 'isTagWindow',
  };
}

function taggedShowcase(ctx: StepContext, priority: 'P1' | 'P3'): LeagueHeroState {
  return {
    kind: 'league-phase',
    phase: 'tagged-showcase',
    priority,
    content: {
      source: 'event',
      title: 'Tagged Players — Open for Offers',
      summary: 'These franchise-tagged players can be poached. Make an offer before the matching period ends.',
      link: ctx.p('/rosters'),
      linkLabel: 'View Roster Details',
      icon: 'target',
      accentColor: 'var(--cat-free-agency, #2e8743)',
      kicker: 'Tag Showcase',
      isActive: true,
    },
    resolvedBy: 'isTaggedShowcase',
  };
}

function udfaWindow(ctx: StepContext, priority: 'P1' | 'P3'): LeagueHeroState {
  return {
    kind: 'league-phase',
    phase: 'udfa-window',
    priority,
    content: {
      source: 'event',
      title: 'Undrafted Free Agents Available',
      summary: "The draft is over but the bargains aren't. Undrafted rookies are now free agents.",
      link: ctx.p('/free-agents'),
      linkLabel: 'Browse Free Agents',
      icon: 'binoculars',
      accentColor: 'var(--cat-draft, #7c3aed)',
      kicker: 'UDFA Window',
      isActive: true,
    },
    resolvedBy: 'isUDFAWindow',
  };
}

/**
 * The roster deadlines at P1: the tag window, the tagged-player market, the
 * UDFA window, and the FINAL 30 days of the cut-down — the one ambient phase
 * that outranks a fresh feature, because the deadline is close enough that it
 * must lead regardless of what just shipped.
 *
 * Exception: an extended-rotation What's New entry (explicit
 * `heroRotationDays`, e.g. a campaign) stays in rotation through the urgent
 * tier — the cut-down and the promo split visits 50/50 (rng() < 0.5 = the
 * deadline wins). Ordinary 7-day features are still locked out here.
 */
export function rosterDeadlinesStep(ctx: StepContext): LeagueHeroState | null {
  const cal = calendarOf(ctx);
  if (!cal) return null;
  const { now, input } = ctx;
  if (cal.isTagWindow(now)) return tagWindow(ctx, 'P1');
  if (cal.isTaggedShowcase(now)) return taggedShowcase(ctx, 'P1');
  if (cal.isUDFAWindow(now, input.draftComplete)) return udfaWindow(ctx, 'P1');
  if (cal.isCutWatchUrgent(now)) {
    const extendedPromoCompeting = !!input.timeline && hasExtendedRotationEntry(ctx, input.whatsNewEntries, now);
    const promoWinsFlip = extendedPromoCompeting && ctx.rng() >= 0.5;
    if (!promoWinsFlip) {
      return {
        kind: 'league-phase',
        phase: 'cut-watch',
        priority: 'P1',
        content: {
          source: 'event',
          title: 'Cut Watch — Roster Deadline',
          summary: `Teams must cut to ${cal.activeRosterLimit} active players. Who's on the bubble?`,
          link: ctx.p('/rosters'),
          linkLabel: 'View Full Rosters',
          icon: 'scissors',
          accentColor: 'var(--color-error, #dc2626)',
          kicker: 'Cut Watch',
          isUrgent: true,
        },
        resolvedBy: 'isCutWatchUrgent',
      };
    }
    // Promo won the flip — fall through: the early tier is false during the
    // urgent one, so the ambient rung defers and the fallback resolves the
    // fresh feature.
  }
  return null;
}

/**
 * The ambient offseason at P3 — tag window, tagged showcase, draft countdown,
 * UDFA, the early cut-down tier, the preseason countdown. These are roster
 * CONTEXT, not deadlines, so a genuinely fresh (≤7 day) feature leads instead
 * and surfaces in the fallback. (With no timeline there is nowhere to render
 * the feature, so they don't defer.)
 *
 * After July 1 the roster deadline claims at least half the homepage: even
 * with a fresh feature competing, the early cut-down wins ~50% of visits (a
 * per-visit coin flip, `rng` injectable for tests).
 */
export function offseasonAmbientStep(ctx: StepContext): LeagueHeroState | null {
  const cal = calendarOf(ctx);
  if (!cal) return null;
  const { now, input } = ctx;
  const hasFreshFeature = !!input.timeline && hasFreshFeatureEntry(ctx, input.whatsNewEntries, now);
  const ptMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric' }).format(now));
  const rosterDeadlineWinsCoinFlip = hasFreshFeature && cal.isCutWatchEarly(now) && ptMonth >= 7 && ctx.rng() < 0.5;
  if (hasFreshFeature && !rosterDeadlineWinsCoinFlip) return null;

  if (cal.isTagWindow(now)) return tagWindow(ctx, 'P3');
  if (cal.isTaggedShowcase(now)) return taggedShowcase(ctx, 'P3');
  if (cal.isDraftCountdown(now)) {
    return {
      kind: 'league-phase',
      phase: 'draft-countdown',
      priority: 'P3',
      content: {
        source: 'event',
        title: 'Draft Season Is Here',
        summary: 'The auction is settled — now scout the rookie class. Build your board and rehearse before draft day.',
        link: ctx.p('/draft/mock'),
        linkLabel: 'Run a mock draft',
        icon: 'draft-podium',
        accentColor: 'var(--cat-draft, #7c3aed)',
        kicker: 'Draft Season',
        isActive: true,
      },
      resolvedBy: 'isDraftCountdown',
    };
  }
  if (cal.isUDFAWindow(now, input.draftComplete)) return udfaWindow(ctx, 'P3');
  if (cal.isCutWatchEarly(now)) {
    return {
      kind: 'league-phase',
      phase: 'cut-watch',
      priority: 'P3',
      content: {
        source: 'event',
        title: 'Cut Watch — Roster Planning',
        summary: `Rosters trim to ${cal.activeRosterLimit} active players before the season. Start lining up your cuts.`,
        link: ctx.p('/rosters'),
        linkLabel: 'View Full Rosters',
        icon: 'scissors',
        accentColor: 'var(--cat-preseason, #60a5fa)',
        kicker: 'Cut Watch',
        isActive: true,
      },
      resolvedBy: 'isCutWatchEarly',
    };
  }
  if (cal.isPreseasonCountdown(now)) {
    return {
      kind: 'league-phase',
      phase: 'preseason-countdown',
      priority: 'P3',
      content: {
        source: 'event',
        title: 'Kickoff Is Coming',
        summary: 'Rosters are set. The countdown to Week 1 is on — lock your lineup and get ready.',
        link: ctx.p('/standings'),
        linkLabel: 'View Standings',
        icon: 'whistle',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Preseason',
        isActive: true,
      },
      resolvedBy: 'isPreseasonCountdown',
    };
  }
  return null;
}

// ── The What's New fallback (P2–P5) ──────────────────────────────────────────

/**
 * The fallback a contract league's homepage runs on: a fresh feature, then an
 * urgent / active / upcoming league event, then the newest article (≤3
 * weeks), then the generic What's New card. Rendered through the league's
 * branded event card (`eventView`); the shared `view` rides along so the state
 * stays renderable by the shared card too.
 */
export function whatsNewFallbackStep(ctx: StepContext): LeagueHeroState {
  const cal = calendarOf(ctx);
  const { input, now } = ctx;
  const entries = input.whatsNewEntries;
  const timeline = input.timeline;
  if (cal && entries && timeline) {
    const fallback = cal.resolveFallbackContent(entries, timeline, now);
    const { view: eventView, bordered } = buildLeagueEventView(fallback, timeline, now);
    const base = { content: fallback, eventView, eventBordered: bordered, resolvedBy: 'resolveHeroContent-fallback' };
    if (fallback.source === 'feature') {
      const entry = entries.find((e) => e.id === fallback.heroEntryId);
      return { kind: 'feature', priority: 'P2', view: featureSlotView({ env: ctx.env, whatsNewEntry: entry }), ...base };
    }
    if (fallback.source === 'event') {
      return { kind: 'event', priority: fallback.isUrgent ? 'P3' : 'P4', view: eventSlotView(ctx.env, fallback), ...base };
    }
    return { kind: 'default', priority: 'P5', view: eventSlotView(ctx.env, fallback), ...base };
  }
  // Ultimate fallback.
  const ultimate: HeroContent = {
    source: 'default',
    title: "What's New",
    summary: "See all the latest features, tools, and improvements we've shipped.",
    link: ctx.p('/whats-new'),
    linkLabel: 'View all updates',
    icon: 'star',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: "What's New",
  };
  const built = buildLeagueEventView(ultimate, timeline, now);
  return {
    kind: 'default',
    priority: 'P5',
    content: ultimate,
    view: eventSlotView(ctx.env, ultimate),
    eventView: built.view,
    eventBordered: built.bordered,
    resolvedBy: 'ultimate-fallback',
  };
}

// ── Freshness, as this ladder counts it ──────────────────────────────────────

/** A genuinely fresh (in-window) league feature is competing for the hero. */
function hasFreshFeatureEntry(ctx: StepContext, entries: WhatsNewEntry[] | undefined, now: Date): boolean {
  if (!entries) return false;
  const cal = calendarOf(ctx)!;
  return entries.some(
    (e) => !e.excludeFromHero && entryAppliesToLeague(e, ctx.profile.whatsNewTag) && cal.isEntryInHeroWindow(e, now),
  );
}

/** An extended-rotation entry (explicit `heroRotationDays`) is still in window. */
function hasExtendedRotationEntry(ctx: StepContext, entries: WhatsNewEntry[] | undefined, now: Date): boolean {
  if (!entries) return false;
  const cal = calendarOf(ctx)!;
  return entries.some(
    (e) =>
      e.heroRotationDays !== undefined &&
      !e.excludeFromHero &&
      entryAppliesToLeague(e, ctx.profile.whatsNewTag) &&
      cal.isEntryInHeroWindow(e, now),
  );
}
