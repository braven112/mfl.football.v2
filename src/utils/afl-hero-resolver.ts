/**
 * AFL Hero Resolver
 *
 * Determines which hero to display on the AFL homepage based on the AFL
 * league calendar (src/data/afl-fantasy/league-events.json). The calendar is
 * the single source of truth for dates; this resolver picks the most relevant
 * event for "now" and decorates it with a per-event visual treatment for the
 * branded AflEventHero.
 *
 * Hero priority (high → low):
 *   P0++ Trade Deadline Day            → TradeDeadlineHero (live countdown)
 *   P0   Championship Week (active)    → AflChampionshipHero (matchup card)
 *   P0   Champion Crowned window       → AflEventHero (calendar-driven)
 *   P0   Conference Playoffs (active)  → AflPlayoffsHero (bracket)
 *   P0   Calendar event active         → AflEventHero (calendar-driven)
 *   P1   Calendar event urgent         → AflEventHero (calendar-driven)
 *   P0   Regular season slot rotation  → AflEventHero (Schefter-voiced slot, no border)
 *   P2   Fresh What's New entry        → AflEventHero (no border)
 *   P3   Active/upcoming timeline      → AflEventHero (no border)
 *   P5   Default / quiet offseason     → AflEventHero (no border)
 *
 * Only calendar-driven events get the gold border; slot/feature/default states
 * render the same card without it. HeroBanner is no longer used here.
 */

import type { WhatsNewEntry, HeroContent } from '../types/whats-new';
import { dailyPick, type HeroModel } from './hero-casting';
import { entryAppliesToLeague, WHATS_NEW_CATEGORY_LABELS } from '../types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent } from '../types/league-events';
import type { DailySlot, GameWindow } from '../types/hero-state';
import { getAllResolvedAflEvents } from './league-event-resolver';
import { getDailySlot } from './hero-resolver';
import { getCurrentNFLWeek } from './current-week';
import { randomHeroPlayer } from './hero-players';

/** How long a fresh What's New entry stays in the hero. */
const FEATURE_HERO_DAYS = 7;

/** Visual props passed straight to AflEventHero. */
export interface EventHeroView {
  pill: string;
  headline: string;
  accentWord?: string;
  summary: string;
  link?: string;
  linkLabel?: string;
  isExternal?: boolean;
  icon?: string;
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
   * the resolver — the homepage attaches it post-resolve via castAflHeroModel
   * (data-wired, fs reads). When present it replaces the `player` webp art.
   */
  model?: HeroModel | null;
}

/** AFL hero state — discriminated by `kind`. */
export type AflHeroState =
  | {
      kind: 'calendar-event';
      priority: 'P0' | 'P1';
      eventId: string;
      content: HeroContent;
      view: EventHeroView;
      /** Populated only when the lead event is an AL or NL draft, so the page can render both pills. */
      conferenceDraft?: {
        al: { date: Date; live: boolean };
        nl: { date: Date; live: boolean };
        userConference?: '00' | '01';
      };
    }
  | {
      kind: 'trade-deadline';
      priority: 'P0++';
      content: HeroContent;
      deadlineMidnightPT: string;
      /** Test-mode reference clock for the countdown — set only when ?testDate= drove resolution. */
      referenceNowISO?: string;
    }
  | { kind: 'championship'; priority: 'P0'; content: HeroContent }
  | { kind: 'playoffs'; priority: 'P0'; content: HeroContent; slot?: DailySlot; gameWindow?: GameWindow; week?: number }
  | { kind: 'regular-season'; priority: 'P0'; content: HeroContent; view: EventHeroView; slot: DailySlot; gameWindow: GameWindow; week?: number }
  | { kind: 'event'; priority: 'P3' | 'P4'; content: HeroContent; view: EventHeroView }
  | { kind: 'feature'; priority: 'P2'; content: HeroContent; view: EventHeroView }
  | { kind: 'default'; priority: 'P5'; content: HeroContent; view: EventHeroView };

export interface AflHeroResolverInput {
  referenceDate: Date;
  testMode?: boolean;
  whatsNewEntries?: WhatsNewEntry[];
  timeline?: WhatsNextTimeline;
  /** User's conference id from AFL cookie/auth ("00"=AL, "01"=NL) — for conference-aware draft hero. */
  userConferenceId?: '00' | '01';
  /** User's AFL tier ("Premier League" | "D-League") — for keeper hero badge selection. */
  userTier?: string;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.ceil((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / (1000 * 60 * 60 * 24));
}

function midnightAfter(date: Date): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00-08:00`;
}

// ── Brand palette ────────────────────────────────────────────────────────────
// AFL hero accent/glow values. These flow into the `--ev-accent` / `--ev-glow`
// inline custom properties on AflEventHero, so they're raw strings (not CSS
// `var()` tokens) — named here so a single source governs the recurring values.
const ACCENT_GOLD = '#c9a94e';
const ACCENT_RED = '#dc2626';
const ACCENT_GREEN = '#2e8743';
const ACCENT_AMBER = '#d97706';
const ACCENT_STEEL = '#cfd6db';
const GLOW_GOLD = 'rgba(201,169,78,.45)';
const GLOW_GOLD_SOFT = 'rgba(201,169,78,.4)';
const GLOW_RED = 'rgba(196,30,58,.6)';
const GLOW_RED_LIVE = 'rgba(220,38,38,.55)';
const GLOW_GREEN = 'rgba(46,135,67,.55)';
const GLOW_AMBER = 'rgba(217,119,6,.55)';
const GLOW_NAVY = 'rgba(28,73,124,.55)';

// ── Per-event view configs ───────────────────────────────────────────────────

interface ViewContext {
  now: Date;
  tier?: string;
  userConferenceId?: '00' | '01';
}

type ViewBuilder = (event: ResolvedLeagueEvent, ctx: ViewContext) => EventHeroView;

const isDleague = (tier?: string) => /d.?league|develop|^0?1$/i.test((tier ?? '').trim());

const dayPhrase = (days: number): string =>
  days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

const EVENT_VIEW: Record<string, ViewBuilder> = {
  'afl-keeper-deadline': (event, { now, tier }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    const dleague = isDleague(tier);
    return {
      pill: `${event.startDate.getFullYear()} Keeper Deadline`,
      headline: 'Lock in your',
      accentWord: 'core.',
      summary:
        days === 0
          ? 'Today is the day — declare your 7 keepers before 8pm PT or the league picks for you.'
          : days === 1
            ? 'Tomorrow at 8pm PT — declare your 7 keepers. Anyone left undeclared hits the draft pool.'
            : `${days} days until the keeper deadline. Lock in your 7 protected players before July 15 @ 8pm PT.`,
      link: '/afl-fantasy/rosters?view=planner',
      linkLabel: 'Manage Keepers',
      accent: ACCENT_GOLD,
      glow: GLOW_RED,
      player: randomHeroPlayer(now),
      badge: dleague ? '/assets/afl/dleague.svg' : '/assets/afl/premier.svg',
      badgeDark: dleague ? '/assets/afl/dleague-dark.svg' : '/assets/afl/premier-dark.svg',
      badgeAlt: dleague ? 'D-League' : 'Premier League',
      countValue: days,
      countLabel: days === 0 ? 'Lock by 8PM PT — today' : 'Days to lock · Jul 15 · 8PM PT',
    };
  },

  'afl-al-draft': (event, { now, userConferenceId }) => {
    const live = event.isActive;
    const days = Math.max(0, daysBetween(event.startDate, now));
    const isUserAl = userConferenceId === '00';
    return {
      pill: 'AL · Live Draft',
      headline: live ? (isUserAl ? 'Your draft is' : 'AL draft is') : 'Build your',
      accentWord: live ? 'live.' : 'empire.',
      summary: isUserAl
        ? live
          ? 'The American League live draft is happening right now. Make your picks before the timer expires.'
          : `Your live draft is ${dayPhrase(days)} — Saturday at 9am PT. Scout the board and finalize your queue.`
        : event.definition.description,
      link: '/afl-fantasy/draft-predictor',
      linkLabel: live ? 'Enter Draft Room' : 'Open Draft Predictor',
      icon: 'draft-podium',
      accent: ACCENT_STEEL,
      glow: 'rgba(59,107,154,.55)',
      player: randomHeroPlayer(now),
      countValue: live ? 'LIVE' : days,
      countLabel: live ? 'Drafting now' : 'Days to AL draft · Sat 9AM PT',
    };
  },

  'afl-nl-draft': (event, { now, userConferenceId }) => {
    const live = event.isActive;
    const days = Math.max(0, daysBetween(event.startDate, now));
    const isUserNl = userConferenceId === '01';
    return {
      pill: 'NL · Email Draft',
      headline: live ? (isUserNl ? 'Your draft is' : 'NL draft is') : 'Build your',
      accentWord: live ? 'open.' : 'empire.',
      summary: isUserNl
        ? live
          ? 'The National League email draft is open. Submit your queue and watch the clock — picks tick through one at a time.'
          : `Your email draft starts ${dayPhrase(days)} — Sunday at 9am PT. Set your queue before the first pick is on the clock.`
        : event.definition.description,
      link: '/afl-fantasy/draft-predictor',
      linkLabel: live ? 'Watch the Board' : 'Open Draft Predictor',
      icon: 'draft-podium',
      accent: ACCENT_GOLD,
      glow: 'rgba(196,30,58,.55)',
      player: randomHeroPlayer(now),
      countValue: live ? 'LIVE' : days,
      countLabel: live ? 'Drafting now' : 'Days to NL draft · Sun 9AM PT',
    };
  },

  'afl-season-start': (event, { now }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    return {
      pill: 'NFL Kickoff',
      headline: 'Football is',
      accentWord: 'back.',
      summary: event.definition.description,
      link: '/afl-fantasy/lineup',
      linkLabel: 'Set Lineup',
      icon: 'nfl',
      accent: ACCENT_GOLD,
      glow: 'rgba(196,30,58,.5)',
      player: randomHeroPlayer(now),
      countValue: days,
      countLabel: days === 0 ? 'Kickoff tonight · 5:20 PM PT' : 'Days to NFL kickoff',
    };
  },

  'afl-trade-deadline': (event, { now }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    return {
      pill: 'Trade Deadline',
      headline: 'Last call to',
      accentWord: 'deal.',
      summary:
        days === 1
          ? 'Trade deadline is tomorrow. After Wednesday night, rosters are locked through the playoffs.'
          : `${days} days until the trade deadline. Use the trade builder to line up your final moves of the season.`,
      link: '/afl-fantasy/trade-builder',
      linkLabel: 'Open Trade Builder',
      icon: 'exchange',
      accent: '#ff7a59',
      glow: 'rgba(220,38,38,.55)',
      player: randomHeroPlayer(now),
      countValue: days,
      countLabel: 'Days to deadline · Wed 11:59 PM PT',
    };
  },

  'afl-regular-season-ends': (event, { now }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    return {
      pill: 'Season Finale',
      headline: 'Seeds are',
      accentWord: 'locking.',
      summary: event.definition.description,
      link: '/afl-fantasy/standings',
      linkLabel: 'View Standings',
      icon: 'gavel',
      accent: ACCENT_GOLD,
      glow: GLOW_NAVY,
      player: randomHeroPlayer(now),
      countValue: days,
      countLabel: 'Days to Week 13 finale',
    };
  },

  'afl-conference-playoffs': (event, { now }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    return {
      pill: 'Playoffs Incoming',
      headline: 'Bracket time is',
      accentWord: 'here.',
      summary: event.definition.description,
      link: '/afl-fantasy/playoffs',
      linkLabel: 'View Bracket',
      icon: 'playoff',
      accent: ACCENT_GOLD,
      glow: 'rgba(196,30,58,.55)',
      player: randomHeroPlayer(now),
      countValue: days,
      countLabel: 'Days to Week 14 tipoff',
    };
  },

  'afl-championship-week': (event, { now }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    return {
      pill: 'World Championship',
      headline: 'One game for the',
      accentWord: 'crown.',
      summary: event.definition.description,
      link: '/afl-fantasy/playoffs',
      linkLabel: 'View Bracket',
      icon: 'champ',
      accent: ACCENT_GOLD,
      glow: GLOW_GOLD,
      player: randomHeroPlayer(now),
      countValue: days,
      countLabel: 'Days to Week 16 title game',
    };
  },

  'afl-new-season-starts': (event, { now }) => {
    const days = Math.max(0, daysBetween(event.startDate, now));
    return {
      pill: 'New League Year',
      headline: 'The season',
      accentWord: 'resets.',
      summary: event.definition.description,
      link: '/afl-fantasy/rosters',
      linkLabel: 'Review Rosters',
      icon: 'star',
      accent: ACCENT_GOLD,
      glow: GLOW_NAVY,
      player: randomHeroPlayer(now),
      countValue: days,
      countLabel: days === 0 ? 'Rolling over today' : 'Days to league rollover',
    };
  },
};

// ── Slot / feature / default view builders ───────────────────────────────────
// Synthetic keys dispatched by the resolver — NOT calendar event ids. These
// MUST NOT set `bordered: true`; the gold border is reserved for calendar
// events. Player image is always randomized from the shared 21-image pool.
// Voice: Claude Schefter — beat reporter, present tense, ALL CAPS headlines.

interface SlotContext {
  now: Date;
  slot?: DailySlot;
  gameWindow?: GameWindow;
  week?: number;
  whatsNewEntry?: WhatsNewEntry;
}

const GAME_WINDOW_LABEL: Record<NonNullable<GameWindow>, string> = {
  tnf: 'Thursday Night Football',
  sunday: 'Sunday slate',
  snf: 'Sunday Night Football',
  mnf: 'Monday Night Football',
};

const GAME_WINDOW_PILL: Record<NonNullable<GameWindow>, string> = {
  tnf: 'THURSDAY NIGHT',
  sunday: 'SUNDAY — LIVE',
  snf: 'SUNDAY NIGHT',
  mnf: 'MONDAY NIGHT',
};

type SlotKey =
  | 'slot:live-scoring'
  | 'slot:standings'
  | 'slot:recap'
  | 'slot:waiver-wire'
  | 'slot:game-day-preview'
  | 'slot:article'
  | 'feature'
  | 'default';

const SLOT_VIEW: Record<SlotKey, (ctx: SlotContext) => EventHeroView> = {
  'slot:live-scoring': ({ now, gameWindow, week }) => {
    const gw = gameWindow && gameWindow in GAME_WINDOW_LABEL
      ? (gameWindow as NonNullable<GameWindow>)
      : null;
    const weekLabel = week ? `Week ${week}` : 'this week';
    const summary =
      gw === 'tnf'
        ? `Thursday night kicks off ${weekLabel}. Scores updating across both conferences.`
        : gw === 'snf'
          ? 'Sunday Night Football is on — late swings still in play across the AL and NL.'
          : gw === 'mnf'
            ? `Monday Night Football closes ${weekLabel}. Final swings on the board.`
            : `${weekLabel} is in motion — scoreboards updating across the AL and NL.`;
    return {
      pill: gw ? GAME_WINDOW_PILL[gw] : 'LIVE NOW',
      headline: 'GAMES ARE',
      accentWord: 'LIVE.',
      summary,
      link: '/afl-fantasy/standings',
      linkLabel: 'VIEW LIVE SCORES',
      icon: 'nfl',
      accent: ACCENT_RED,
      glow: GLOW_RED_LIVE,
      player: randomHeroPlayer(now),
      countValue: 'LIVE',
      countLabel: gw ? GAME_WINDOW_LABEL[gw] : 'live games',
    };
  },

  'slot:standings': ({ now, week }) => ({
    pill: 'MONDAY STANDINGS',
    headline: 'THE RACE',
    accentWord: 'TIGHTENS.',
    summary: `Where the AL and NL playoff picture stands after ${week ? `Week ${week}` : 'this week'} — seeds, tiebreakers, and the bubble.`,
    link: '/afl-fantasy/standings',
    linkLabel: 'SEE THE RACE',
    icon: 'trophy',
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
  }),

  'slot:recap': ({ now, week }) => ({
    pill: 'TUESDAY RECAP',
    headline: 'THE WEEK IN',
    accentWord: 'REVIEW.',
    summary: `${week ? `Week ${week}` : 'The week'} is in the books — top scorers, biggest swings, and the games that moved the standings.`,
    link: '/afl-fantasy/news',
    linkLabel: 'READ THE RECAP',
    icon: 'commenting',
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
  }),

  'slot:waiver-wire': ({ now }) => ({
    pill: 'WAIVER DAY',
    headline: 'CLAIMS RUN',
    accentWord: 'TONIGHT.',
    summary: 'Waivers process Wednesday at 8PM PT. After that, free agents go first-come, first-served through Sunday kickoff.',
    link: '/afl-fantasy/rosters',
    linkLabel: 'SET YOUR CLAIMS',
    icon: 'binoculars',
    accent: ACCENT_GREEN,
    glow: GLOW_GREEN,
    player: randomHeroPlayer(now),
    countValue: 'TONIGHT',
    countLabel: 'Process at 8PM PT',
  }),

  'slot:game-day-preview': ({ now, week }) => ({
    pill: 'GAME DAY',
    headline: 'LINEUPS LOCK AT',
    accentWord: 'KICKOFF.',
    summary: `Last call to set starters for ${week ? `Week ${week}` : 'this week'} — swap injuries, finalize FCFS pickups, lock it in.`,
    link: '/afl-fantasy/lineup',
    linkLabel: 'SET LINEUP',
    icon: 'clipboard',
    accent: ACCENT_AMBER,
    glow: GLOW_AMBER,
    player: randomHeroPlayer(now),
    countValue: 'LIVE SOON',
    countLabel: 'Lineups lock at kickoff',
  }),

  'slot:article': ({ now, week }) => ({
    pill: week ? `WEEK ${week}` : 'AROUND THE AFL',
    headline: 'AROUND THE',
    accentWord: 'AFL.',
    summary: 'Schefter covers the moves, the matchups, and the storylines shaping the AL and NL races.',
    link: '/afl-fantasy/news',
    linkLabel: 'READ THE LATEST',
    icon: 'news',
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  }),

  feature: ({ now, whatsNewEntry: entry }) => {
    const pillBase = entry ? WHATS_NEW_CATEGORY_LABELS[entry.category] : "WHAT'S NEW";
    return {
      pill: (pillBase ?? "WHAT'S NEW").toUpperCase(),
      headline: 'FRESH ON THE',
      accentWord: 'SITE.',
      summary: entry?.summary ?? 'New on the AFL site — take a look.',
      // No explicit link → CTA into the entry's own article, never the listing
      // (same rule as featureToHero — this view is what AflEventHero renders).
      link: entry ? (entry.link ?? `/afl-fantasy/whats-new/${entry.id}`) : undefined,
      linkLabel: (entry?.linkLabel ?? (entry?.link ? 'CHECK IT OUT' : 'READ THE FULL STORY')).toUpperCase(),
      icon: entry?.icon ?? 'news',
      accent: ACCENT_GOLD,
      glow: GLOW_GOLD,
      // The feature's own screenshot is the art; the random player webp is
      // only the fallback for entries that never got a capture.
      screenshot: entry?.image,
      player: randomHeroPlayer(now),
    };
  },

  default: ({ now }) => ({
    pill: 'AFL',
    headline: 'TWO CONFERENCES.',
    accentWord: 'ONE.',
    summary: 'Two conferences, 24 teams, one champion. Welcome to the AFL.',
    link: '/afl-fantasy/standings',
    linkLabel: 'VIEW STANDINGS',
    icon: 'star',
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  }),
};

// ── Calendar pick ────────────────────────────────────────────────────────────

/**
 * Dedupe resolved events across overlapping league years.
 * Keep the soonest UPCOMING occurrence of each event id (or the most recent
 * past if none upcoming), so a single event id never appears twice in the pool.
 */
function dedupeEvents(events: ResolvedLeagueEvent[]): ResolvedLeagueEvent[] {
  const byId = new Map<string, ResolvedLeagueEvent>();
  for (const e of events) {
    const prev = byId.get(e.definition.id);
    if (!prev) {
      byId.set(e.definition.id, e);
      continue;
    }
    // Prefer non-past over past; among non-past prefer soonest; among past prefer most recent.
    if (prev.isPast && !e.isPast) {
      byId.set(e.definition.id, e);
    } else if (!prev.isPast && !e.isPast) {
      if (e.startDate.getTime() < prev.startDate.getTime()) byId.set(e.definition.id, e);
    } else if (prev.isPast && e.isPast) {
      if (e.startDate.getTime() > prev.startDate.getTime()) byId.set(e.definition.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}


interface LeadPick {
  event: ResolvedLeagueEvent;
  view: EventHeroView;
  priority: 'P0' | 'P1';
  conferenceDraft?: AflHeroState extends { kind: 'calendar-event' }
    ? AflHeroState['conferenceDraft']
    : never;
}

/** Per-event lead-up window override (days before startDate). Falls back to calendar's urgencyDays. */
const URGENCY_OVERRIDES: Record<string, number> = {
  'afl-keeper-deadline': 30,
  'afl-season-start': 7,
  'afl-new-season-starts': 14,
};

/**
 * Find the occurrence of an event id closest in time to an anchor date.
 * Must run against the RAW (pre-dedup) list: dedup keeps only the soonest
 * upcoming occurrence, so a just-passed sibling (e.g. the AL draft on NL
 * draft day) would otherwise resolve to NEXT year's date.
 */
function nearestOccurrence(
  rawEvents: ResolvedLeagueEvent[],
  id: string,
  anchor: Date,
): ResolvedLeagueEvent | undefined {
  let best: ResolvedLeagueEvent | undefined;
  let bestDelta = Infinity;
  for (const e of rawEvents) {
    if (e.definition.id !== id) continue;
    const delta = Math.abs(e.startDate.getTime() - anchor.getTime());
    if (delta < bestDelta) {
      best = e;
      bestDelta = delta;
    }
  }
  return best;
}

function pickLeadCalendarEvent(
  events: ResolvedLeagueEvent[],
  rawEvents: ResolvedLeagueEvent[],
  ctx: ViewContext,
): LeadPick | null {
  const candidates = events
    .filter((e) => EVENT_VIEW[e.definition.id])
    .filter((e) => {
      if (e.isActive) return true;
      if (e.isPast) return false;
      const urgency = URGENCY_OVERRIDES[e.definition.id] ?? e.definition.urgencyDays ?? 0;
      return urgency > 0 && e.daysUntilStart > 0 && e.daysUntilStart <= urgency;
    })
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const lead = candidates[0];
  if (!lead) return null;

  const view = EVENT_VIEW[lead.definition.id](lead, ctx);
  const priority: 'P0' | 'P1' = lead.isActive ? 'P0' : 'P1';

  // For the conference-draft week, surface BOTH AL & NL dates so the page can render the dual pills.
  // Pair from rawEvents anchored on the lead's date: the deduped list swaps a
  // just-passed sibling for next year's occurrence (the AL pill showed 2027's
  // date on NL draft day).
  let conferenceDraft: LeadPick['conferenceDraft'];
  if (lead.definition.id === 'afl-al-draft' || lead.definition.id === 'afl-nl-draft') {
    const al = nearestOccurrence(rawEvents, 'afl-al-draft', lead.startDate);
    const nl = nearestOccurrence(rawEvents, 'afl-nl-draft', lead.startDate);
    if (al && nl) {
      conferenceDraft = {
        al: { date: al.startDate, live: al.isActive },
        nl: { date: nl.startDate, live: nl.isActive },
        userConference: ctx.userConferenceId,
      };
    }
  }

  return { event: lead, view, priority, conferenceDraft };
}

// ── Phase detectors (still needed for bespoke heroes) ────────────────────────

function findEvent(events: ResolvedLeagueEvent[], id: string): ResolvedLeagueEvent | undefined {
  return events.find((e) => e.definition.id === id);
}

function isRegularSeasonActive(events: ResolvedLeagueEvent[], now: Date): boolean {
  // Scan ALL year occurrences — by mid-September the season's kickoff event is
  // already `isPast`, and `dedupeEvents` will have promoted next year's kickoff
  // into the single-entry slot. Match by phase window across pairs of years.
  const kickoffs = events.filter((e) => e.definition.id === 'afl-season-start');
  const playoffs = events.filter((e) => e.definition.id === 'afl-conference-playoffs');
  for (const k of kickoffs) {
    const p = playoffs.find((x) => x.startDate.getTime() > k.startDate.getTime());
    if (p && now >= k.startDate && now < p.startDate) return true;
  }
  return false;
}

/** Playoffs phase = AFL Weeks 14–15 (afl-conference-playoffs → afl-championship-week). */
function isInPlayoffsPhase(events: ResolvedLeagueEvent[], now: Date): boolean {
  // Scan ALL year occurrences — the 2026 championship event is `isPast` on
  // Dec 26 so the deduped list may have already swapped it for the 2027 one.
  const playoffEvents = events.filter((e) => e.definition.id === 'afl-conference-playoffs');
  const champEvents = events.filter((e) => e.definition.id === 'afl-championship-week');
  for (const p of playoffEvents) {
    const champAfter = champEvents.find((c) => c.startDate.getTime() > p.startDate.getTime());
    if (champAfter && now >= p.startDate && now < champAfter.startDate) return true;
  }
  return false;
}

/** Championship phase = AFL Week 16 (afl-championship-week → +7 days). */
function isInChampionshipPhase(events: ResolvedLeagueEvent[], now: Date): boolean {
  for (const c of events.filter((e) => e.definition.id === 'afl-championship-week')) {
    const end = new Date(c.startDate);
    end.setDate(end.getDate() + 7);
    if (now >= c.startDate && now < end) return true;
  }
  return false;
}

function isQuietOffseason(events: ResolvedLeagueEvent[], now: Date): boolean {
  const newSeason = findEvent(events, 'afl-new-season-starts');
  const keeper = findEvent(events, 'afl-keeper-deadline');
  if (!newSeason || !keeper) return false;
  if (now < newSeason.startDate || now >= keeper.startDate) return false;
  // Quiet stretch ends when keeper urgency window kicks in (handled by pickLeadCalendarEvent).
  return true;
}

// ── Content builders for bespoke heroes & fallbacks ─────────────────────────

function formatKickerDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Entries without an explicit link CTA into their own What's New article —
 * never the generic listing.
 * ⚠️ Duplicated in hero-resolver.ts, and SLOT_VIEW.feature above must apply
 * the same link default — it builds the view AflEventHero actually renders.
 */
function featureToHero(entry: WhatsNewEntry): HeroContent {
  return {
    source: 'feature',
    title: entry.title,
    summary: entry.summary,
    link: entry.link ?? `/afl-fantasy/whats-new/${entry.id}`,
    linkLabel: entry.linkLabel ?? (entry.link ? 'Check it out' : 'Read the full story'),
    icon: entry.icon,
    accentColor: 'var(--color-secondary, #2e8743)',
    image: entry.image,
    imageAlt: entry.imageAlt,
    kicker: WHATS_NEW_CATEGORY_LABELS[entry.category],
    kickerDate: formatKickerDate(new Date(entry.date + 'T00:00:00')),
    heroArt: entry.heroArt,
    heroPlayerId: entry.heroPlayerId,
    heroPlayerDescriptor: entry.heroPlayerDescriptor,
    heroEntryId: entry.id,
  };
}

function eventToHero(event: ResolvedLeagueEvent): HeroContent {
  const link = event.actionLinks[0] ?? event.resultLinks[0];
  return {
    source: 'event',
    title: event.definition.name,
    summary: event.definition.description,
    link: link?.url,
    linkLabel: link?.label ?? 'Learn more',
    icon: event.definition.icon,
    accentColor: 'var(--color-primary, #1c497c)',
    heroEventId: event.definition.id,
    image: event.definition.image,
    imageAlt: event.definition.imageAlt,
    isActive: event.isActive,
    isUrgent: event.isUrgent,
    isExternal: link?.external,
    kicker: event.isActive ? 'Happening Now' : event.isUrgent ? 'Coming Up' : 'League Event',
    kickerDate: formatKickerDate(event.startDate),
  };
}

function buildRegularSeasonHero(slot: DailySlot, week: number | undefined, gameWindow: GameWindow): HeroContent {
  const weekLabel = week ? `Week ${week}` : 'Regular Season';
  switch (slot) {
    case 'live-scoring': {
      const label = gameWindow && gameWindow in GAME_WINDOW_LABEL ? GAME_WINDOW_LABEL[gameWindow as NonNullable<GameWindow>] : 'live games';
      return {
        source: 'event',
        title: `Games in Progress — ${weekLabel}`,
        summary: `${label} is under way. Scoreboards update live across both conferences.`,
        link: '/afl-fantasy/standings',
        linkLabel: 'View Standings',
        icon: 'nfl',
        accentColor: 'var(--color-error, #dc2626)',
        kicker: 'Live Now',
        isActive: true,
      };
    }
    case 'standings':
      return {
        source: 'event',
        title: `Monday Standings Check — ${weekLabel}`,
        summary: 'Where the AL and NL playoff picture stands heading into Monday Night Football.',
        link: '/afl-fantasy/standings',
        linkLabel: 'See the race',
        icon: 'trophy',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Standings',
      };
    case 'recap':
      return {
        source: 'event',
        title: `${weekLabel} Recap`,
        summary: 'Top performances, biggest blowouts, and the AL/NL games that swung the standings.',
        link: '/afl-fantasy/news',
        linkLabel: 'Read the recap',
        icon: 'commenting',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Weekly Recap',
      };
    case 'waiver-wire':
      return {
        source: 'event',
        title: 'Waivers Process Tonight',
        summary: 'Waiver claims run Wednesday at 8pm PT. After that, free agents go first-come, first-served through Sunday kickoff.',
        link: '/afl-fantasy/rosters',
        linkLabel: 'Set Your Claims',
        icon: 'binoculars',
        accentColor: 'var(--cat-free-agency, #2e8743)',
        kicker: 'Waiver Day',
      };
    case 'game-day-preview':
      return {
        source: 'event',
        title: `Game Day — ${weekLabel}`,
        summary: 'Lineups lock at kickoff. Last call to set starters, swap injured players, and submit FCFS pickups.',
        link: '/afl-fantasy/lineup',
        linkLabel: 'Set Lineup',
        icon: 'clipboard',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Game Day',
      };
    case 'article':
    default:
      return {
        source: 'event',
        title: `${weekLabel} — Around the AFL`,
        summary: 'Schefter covers the moves, the matchups, and the storylines shaping the AL and NL races.',
        link: '/afl-fantasy/news',
        linkLabel: 'Read the latest',
        icon: 'news',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'The Beat',
      };
  }
}

function buildPlayoffsHero(): HeroContent {
  return {
    source: 'event',
    title: 'Conference Playoffs',
    summary: 'Conference seeds 1–4 are battling for a championship spot. NIT bracket runs alongside for everyone else.',
    link: '/afl-fantasy/playoffs',
    linkLabel: 'View Bracket',
    icon: 'playoff',
    accentColor: 'var(--cat-regular-season, #1c497c)',
    kicker: 'Conference Playoffs',
    isActive: true,
  };
}

function buildChampionshipHero(): HeroContent {
  return {
    source: 'event',
    title: 'Championship Week',
    summary: 'AL champion vs. NL champion. Winner takes the AFL crown.',
    link: '/afl-fantasy/playoffs',
    linkLabel: 'View Bracket',
    icon: 'champ',
    accentColor: 'var(--cat-regular-season, #1c497c)',
    kicker: 'Championship',
    isActive: true,
  };
}

function buildTradeDeadlineHero(): HeroContent {
  return {
    source: 'event',
    title: 'Trade Deadline',
    summary: 'Last call to lock in trades for the season. After today, rosters are locked through the playoffs.',
    link: '/afl-fantasy/rosters',
    linkLabel: 'View Rosters',
    icon: 'exchange',
    accentColor: 'var(--color-error, #dc2626)',
    isUrgent: true,
    kicker: 'Trade Deadline — Today',
  };
}

function buildOffseasonHero(): HeroContent {
  return {
    source: 'default',
    title: 'AFL Offseason',
    summary: 'Quiet stretch on the calendar — but dynasty math never sleeps. Review rosters, scout free agents, and start lining up your keeper class.',
    link: '/afl-fantasy/rosters',
    linkLabel: 'Review Rosters',
    icon: 'shield',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: 'Offseason',
  };
}

function buildDefaultHero(entries: WhatsNewEntry[]): HeroContent {
  const aflEntries = entries
    .filter((e) => entryAppliesToLeague(e, 'afl') && !e.excludeFromHero)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (aflEntries.length > 0) {
    return featureToHero(aflEntries[0]);
  }
  return {
    source: 'default',
    title: 'AFL',
    summary: 'Two conferences, 24 teams, one champion. Welcome to the AFL.',
    link: '/afl-fantasy/standings',
    linkLabel: 'View Standings',
    icon: 'star',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: 'AFL',
  };
}

// ── Champion crowned: post-championship celebration window (kept manual, the
// calendar doesn't model "the week after Week 16") ─────────────────────────────

function isChampionCrownedWindow(events: ResolvedLeagueEvent[], now: Date): boolean {
  for (const c of events.filter((e) => e.definition.id === 'afl-championship-week')) {
    // Championship phase = startDate → +7 days; crowned window = next 7 days after that.
    const phaseEnd = new Date(c.startDate);
    phaseEnd.setDate(phaseEnd.getDate() + 7);
    const crownedEnd = new Date(phaseEnd);
    crownedEnd.setDate(crownedEnd.getDate() + 7);
    if (now >= phaseEnd && now < crownedEnd) return true;
  }
  return false;
}

function buildChampionCrownedView(event: ResolvedLeagueEvent, now: Date): EventHeroView {
  void event;
  return {
    pill: 'Champion Crowned',
    headline: 'A new',
    accentWord: 'champion.',
    summary: 'The season has wrapped. View the bracket and savor the result before keeper math takes over.',
    link: '/afl-fantasy/playoffs',
    linkLabel: 'View Recap',
    icon: 'trophy',
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD_SOFT,
    player: randomHeroPlayer(now),
  };
}

// ── Main resolver ────────────────────────────────────────────────────────────

export function resolveAflHeroState(input: AflHeroResolverInput): AflHeroState {
  const now = input.referenceDate;
  const whatsNew = input.whatsNewEntries ?? [];
  const timeline = input.timeline;
  const ctx: ViewContext = { now, tier: input.userTier, userConferenceId: input.userConferenceId };

  // Resolve every AFL calendar event for the surrounding league years — single
  // source of truth. We pull (year-1, year, year+1) and dedupe by event id so
  // events near calendar boundaries (champion-crowned Jan, new season Feb) still
  // surface even when MFL's "current league year" has rolled to the next one.
  const calYear = now.getFullYear();
  const rawEvents = [
    ...getAllResolvedAflEvents({ leagueYear: calYear - 1, referenceDate: now }),
    ...getAllResolvedAflEvents({ leagueYear: calYear, referenceDate: now }),
    ...getAllResolvedAflEvents({ leagueYear: calYear + 1, referenceDate: now }),
  ];
  const events = dedupeEvents(rawEvents);

  // P0++: Trade Deadline DAY — bespoke live-countdown hero owns the day.
  const tradeDeadline = findEvent(events, 'afl-trade-deadline');
  if (tradeDeadline?.isActive) {
    return {
      kind: 'trade-deadline',
      priority: 'P0++',
      content: buildTradeDeadlineHero(),
      deadlineMidnightPT: midnightAfter(tradeDeadline.startDate),
      referenceNowISO: input.testMode ? now.toISOString() : undefined,
    };
  }

  // P0: Championship Week phase — bespoke matchup hero. Use rawEvents so multi-year
  // occurrences aren't dropped by dedup when the current year's event is `isPast`.
  if (isInChampionshipPhase(rawEvents, now)) {
    return { kind: 'championship', priority: 'P0', content: buildChampionshipHero() };
  }

  // P0: Champion-crowned 7-day window after championship — branded event hero.
  if (isChampionCrownedWindow(rawEvents, now)) {
    const championship = findEvent(events, 'afl-championship-week') ?? rawEvents.find((e) => e.definition.id === 'afl-championship-week');
    if (championship) {
      return {
        kind: 'calendar-event',
        priority: 'P0',
        eventId: 'afl-champion-crowned',
        content: eventToHero(championship),
        view: buildChampionCrownedView(championship, now),
      };
    }
  }

  // P0: Conference Playoffs phase (Weeks 14–15) — bespoke bracket hero.
  if (isInPlayoffsPhase(rawEvents, now)) {
    return { kind: 'playoffs', priority: 'P0', content: buildPlayoffsHero() };
  }

  // P0/P1: Calendar-driven lead event — the new branded AflEventHero.
  const lead = pickLeadCalendarEvent(events, rawEvents, ctx);
  if (lead) {
    return {
      kind: 'calendar-event',
      priority: lead.priority,
      eventId: lead.event.definition.id,
      content: eventToHero(lead.event),
      view: lead.view,
      conferenceDraft: lead.conferenceDraft,
    };
  }

  // P0: Regular season — route through the daily slot rotation, now with a Schefter-voiced view.
  if (isRegularSeasonActive(rawEvents, now)) {
    const { slot, gameWindow } = getDailySlot(now);
    const week = getCurrentNFLWeek(now) ?? undefined;
    const slotKey = `slot:${slot}` as SlotKey;
    const builder = SLOT_VIEW[slotKey] ?? SLOT_VIEW['slot:article'];
    const view = builder({ now, slot, gameWindow, week });
    return {
      kind: 'regular-season',
      priority: 'P0',
      slot,
      gameWindow,
      week,
      content: buildRegularSeasonHero(slot, week, gameWindow),
      view,
    };
  }

  // P2: Fresh AFL-tagged What's New (≤7 days) — branded fresh-on-the-site hero.
  const fresh = whatsNew
    .filter((e) => entryAppliesToLeague(e, 'afl') && !e.excludeFromHero)
    .filter((e) => {
      const age = daysBetween(now, new Date(e.date + 'T00:00:00'));
      return age >= 0 && age <= FEATURE_HERO_DAYS;
    });
  if (fresh.length > 0) {
    // Deterministic per PT day — a per-request random pick makes SSR flip
    // hero content between same-day requests (and fights the composite
    // model's own daily-stable casting).
    const pick = dailyPick(fresh, now, 'afl-feature', (e) => e.id) ?? fresh[0];
    return {
      kind: 'feature',
      priority: 'P2',
      content: featureToHero(pick),
      view: SLOT_VIEW.feature({ now, whatsNewEntry: pick }),
    };
  }

  // P3/P4: Active or upcoming timeline event (fallback for any event without a calendar view config).
  // Synthesize a minimal view from the event's name/description so the hero still renders branded.
  const timelinePick =
    timeline?.next?.isUrgent
      ? { event: timeline.next, priority: 'P3' as const }
      : timeline?.current?.isActive
        ? { event: timeline.current, priority: 'P4' as const }
        : timeline?.next && !timeline.next.isPast && timeline.next.daysUntilStart <= 14
          ? { event: timeline.next, priority: 'P4' as const }
          : null;
  if (timelinePick) {
    const e = timelinePick.event;
    return {
      kind: 'event',
      priority: timelinePick.priority,
      content: eventToHero(e),
      view: {
        pill: (e.isActive ? 'HAPPENING NOW' : e.isUrgent ? 'COMING UP' : 'LEAGUE EVENT'),
        headline: e.definition.name.toUpperCase(),
        accentWord: '',
        summary: e.definition.description,
        link: e.actionLinks[0]?.url ?? e.resultLinks[0]?.url,
        linkLabel: (e.actionLinks[0]?.label ?? e.resultLinks[0]?.label ?? 'LEARN MORE').toUpperCase(),
        icon: e.definition.icon,
        accent: ACCENT_GOLD,
        glow: GLOW_GOLD,
        player: randomHeroPlayer(now),
      },
    };
  }

  // P5: Quiet offseason or ultimate fallback — branded default hero.
  if (isQuietOffseason(events, now)) {
    return {
      kind: 'default',
      priority: 'P5',
      content: buildOffseasonHero(),
      view: SLOT_VIEW.default({ now }),
    };
  }
  return {
    kind: 'default',
    priority: 'P5',
    content: buildDefaultHero(whatsNew),
    view: SLOT_VIEW.default({ now }),
  };
}
