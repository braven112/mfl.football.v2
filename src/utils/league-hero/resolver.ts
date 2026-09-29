/**
 * The shared homepage hero resolver — one ladder for every league.
 *
 * Picks the hero for "now" from the league's calendar and capabilities (its
 * profile, ./profiles.ts), and decorates it with a view (./views.ts) for the
 * shared `LeagueHero` component. Nothing below names a league: which rungs a
 * league reaches is decided by its profile — a league with an auction on its
 * calendar gets the auction hero, a league that drafts gets the draft hero, a
 * league whose pools draft separately gets one card per pool, and a league
 * with neither simply never reaches those rungs.
 *
 * Hero priority (high → low):
 *   P0++ Trade Deadline Day            → TradeDeadlineHero (live countdown)
 *   P0   Championship Week (active)    → bracket hero, or the daily slot rotation
 *   P0   Champion Crowned window       → calendar card
 *   P0   Playoffs (active)             → bracket hero, or the daily slot rotation
 *   P0   Calendar event active         → calendar card
 *   P1   Calendar event upcoming       → calendar card (ONE slot in a per-visit pool with every fresh P2 feature)
 *   P0   Regular season slot rotation  → slot card (no border)
 *   P3   Schedule release              → event card
 *   P2   Fresh What's New entry        → feature card
 *   P3/4 Active/upcoming timeline      → event card
 *   P5   Default / quiet offseason     → the league's own card
 *
 * Only calendar-driven events get the gold border; slot/feature/default states
 * render the same card without it.
 */
import type { WhatsNewEntry, HeroContent } from '../../types/whats-new';
import type { ResolvedLeagueEvent } from '../../types/league-events';
import { entryAppliesToLeague } from '../../types/whats-new';
import { scheduleReleaseTease, scheduleReleaseTeaseCopy } from '../schedule-release.mjs';
import { dailyPick } from '../hero-casting';
import { getDailySlot, isGameLive } from '../hero-resolver';
import { getCurrentNFLWeek } from '../current-week';
import { randomHeroPlayer } from '../hero-players';
import type {
  EventHeroView,
  HeroEventRoleMatch,
  HeroSecondaryLink,
  HeroSlot,
  LeagueHeroResolverInput,
  LeagueHeroState,
  PoolDraftState,
} from './types';
import {
  heroPath,
  heroRoleKey,
  heroRoleOf,
  heroRunsSlot,
  getLeagueHeroProfile,
  type LeagueHeroProfile,
} from './profiles';
import {
  ACCENT_GOLD,
  GLOW_GOLD,
  articleSlotView,
  championCrownedView,
  championshipLeadView,
  daysBetween,
  GAME_WINDOW_LABEL,
  eventSlotView,
  eventToHero,
  featureSlotView,
  featureToHero,
  gameDayPreviewSlotView,
  keeperDeadlineView,
  liveScoringSlotView,
  newLeagueYearView,
  playoffsLeadView,
  poolDraftView,
  recapSlotView,
  regularSeasonContent,
  regularSeasonEndsView,
  seasonStartView,
  standingsSlotView,
  tradeDeadlineView,
  waiverSlotView,
  type SlotContext,
  type ViewEnv,
} from './views';
import { auctionWindowView, columnSlotView, gamesOnSlotView, leagueDraftView, peckingOrderSlotView } from './capability-views';
import {
  auctionStep,
  breakingStoryStep,
  offseasonAmbientStep,
  rookieDraftStep,
  rosterDeadlinesStep,
  whatsNewFallbackStep,
} from './contract-steps';
import type { GameWindow } from '../../types/hero-state';

/** How long a fresh What's New entry stays in the hero. */
const FEATURE_HERO_DAYS = 7;

function midnightAfter(date: Date): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00-08:00`;
}

/**
 * Combine a view builder's own secondary links with the ones attached
 * post-resolve, dropping any that repeat the primary CTA (a second link to
 * where the button already goes is noise) or each other. Order is preserved:
 * builder links first, then the live sibling boards.
 */
function mergeSecondaryLinks(
  own: HeroSecondaryLink[] | undefined,
  extra: HeroSecondaryLink[],
  primaryHref: string | undefined,
): HeroSecondaryLink[] {
  const seen = new Set<string>(primaryHref ? [primaryHref] : []);
  const out: HeroSecondaryLink[] = [];
  for (const link of [...(own ?? []), ...extra]) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    out.push(link);
  }
  return out;
}

// ── The calendar, by role ────────────────────────────────────────────────────

/** An event with what it means to the hero attached. */
export interface RoledEvent {
  event: ResolvedLeagueEvent;
  match: HeroEventRoleMatch;
  key: string;
}

function withRoles(profile: LeagueHeroProfile, events: ResolvedLeagueEvent[]): RoledEvent[] {
  const out: RoledEvent[] = [];
  for (const event of events) {
    const match = heroRoleOf(profile, event);
    if (match) out.push({ event, match, key: heroRoleKey(match) });
  }
  return out;
}

/**
 * Dedupe resolved events across overlapping league years.
 * Keep the soonest UPCOMING occurrence of each role (or the most recent past
 * if none upcoming), so a single role never appears twice in the pool.
 */
function dedupeEvents(events: RoledEvent[]): RoledEvent[] {
  const byKey = new Map<string, RoledEvent>();
  for (const r of events) {
    const prev = byKey.get(r.key);
    const e = r.event;
    if (!prev) {
      byKey.set(r.key, r);
      continue;
    }
    // Prefer non-past over past; among non-past prefer soonest; among past prefer most recent.
    if (prev.event.isPast && !e.isPast) {
      byKey.set(r.key, r);
    } else if (!prev.event.isPast && !e.isPast) {
      if (e.startDate.getTime() < prev.event.startDate.getTime()) byKey.set(r.key, r);
    } else if (prev.event.isPast && e.isPast) {
      if (e.startDate.getTime() > prev.event.startDate.getTime()) byKey.set(r.key, r);
    }
  }
  return [...byKey.values()].sort((a, b) => a.event.startDate.getTime() - b.event.startDate.getTime());
}

const ofRole = (events: RoledEvent[], role: HeroEventRoleMatch['role']) =>
  events.filter((r) => r.match.role === role);

function findRole(events: RoledEvent[], role: HeroEventRoleMatch['role']): ResolvedLeagueEvent | undefined {
  return events.find((r) => r.match.role === role)?.event;
}

/** The card a calendar event leads with, when its role has one. */
function eventView(r: RoledEvent, env: ViewEnv): EventHeroView | null {
  const { event, match } = r;
  switch (match.role) {
    case 'keeper-deadline':
      return keeperDeadlineView(event, env);
    case 'pool-draft': {
      const pool = env.profile.pools?.find((p) => p.id === match.pool);
      // A pool this league has not described is still a draft — the whole-league card says so honestly.
      return pool ? poolDraftView(event, env, pool) : leagueDraftView(event, env);
    }
    case 'draft':
      return leagueDraftView(event, env);
    case 'auction':
      return auctionWindowView(event, env);
    case 'season-start':
      return seasonStartView(event, env);
    case 'trade-deadline':
      return tradeDeadlineView(event, env);
    case 'regular-season-ends':
      return regularSeasonEndsView(event, env);
    case 'playoffs':
      return playoffsLeadView(event, env);
    case 'championship':
      return championshipLeadView(event, env);
    case 'new-league-year':
      return newLeagueYearView(event, env);
    default:
      return null;
  }
}

/**
 * Find the occurrence of a role closest in time to an anchor date. Must run
 * against the RAW (pre-dedup) list: dedup keeps only the soonest upcoming
 * occurrence, so a just-passed sibling (the AL draft on NL draft day) would
 * otherwise resolve to NEXT year's date.
 */
function nearestOccurrence(raw: RoledEvent[], key: string, anchor: Date): ResolvedLeagueEvent | undefined {
  let best: ResolvedLeagueEvent | undefined;
  let bestDelta = Infinity;
  for (const r of raw) {
    if (r.key !== key) continue;
    const delta = Math.abs(r.event.startDate.getTime() - anchor.getTime());
    if (delta < bestDelta) {
      best = r.event;
      bestDelta = delta;
    }
  }
  return best;
}

interface LeadPick {
  roled: RoledEvent;
  view: EventHeroView;
  priority: 'P0' | 'P1';
  poolDraft?: PoolDraftState;
}

function pickLeadCalendarEvent(events: RoledEvent[], raw: RoledEvent[], env: ViewEnv): LeadPick | null {
  const { profile } = env;
  const candidates = events
    .filter((r) => eventView(r, env) !== null)
    .filter((r) => {
      const e = r.event;
      if (e.isActive) return true;
      if (e.isPast) return false;
      const urgency = profile.urgency[r.key] ?? profile.urgency[r.match.role] ?? e.definition.urgencyDays ?? 0;
      return urgency > 0 && e.daysUntilStart > 0 && e.daysUntilStart <= urgency;
    })
    .sort((a, b) => a.event.startDate.getTime() - b.event.startDate.getTime());

  let lead = candidates[0];
  if (!lead) return null;

  // Pool-aware draft: every pool's draft window opens together, so the
  // earliest-dated pool would lead for everyone through the whole stretch — an
  // NL owner would stare at a generic "AL · Live Draft" card for ~6 weeks.
  // When the lead is a pool draft, prefer the viewer's OWN pool's. Guests (no
  // pool) keep the earliest draft as the lead.
  if (lead.match.role === 'pool-draft' && env.userPoolId) {
    const own = candidates.find((r) => r.match.role === 'pool-draft' && r.match.pool === env.userPoolId);
    if (own) lead = own;
  }

  const view = eventView(lead, env)!;
  const priority: 'P0' | 'P1' = lead.event.isActive ? 'P0' : 'P1';

  // For a pool draft, surface EVERY pool's date so the page can render the
  // pills. Paired from the raw list anchored on the lead's date: the deduped
  // list swaps a just-passed sibling for next year's occurrence.
  let poolDraft: PoolDraftState | undefined;
  if (lead.match.role === 'pool-draft' && profile.pools?.length) {
    const pools = profile.pools
      .map((pool) => {
        const e = nearestOccurrence(raw, heroRoleKey({ role: 'pool-draft', pool: pool.id }), lead!.event.startDate);
        return e ? { id: pool.id, label: pool.label, date: e.startDate, live: e.isActive } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (pools.length === profile.pools.length) poolDraft = { pools, userPool: env.userPoolId };
  }

  // Route to whichever pool board is actually LIVE. The hero leads with the
  // viewer's OWN pool, and the pools draft on different days — so on the AL's
  // draft day an NL owner leads with a not-yet-live NL card whose CTA is the
  // draft order, and the live AL board is unreachable from the homepage. Only
  // live boards are offered: a board for a draft that hasn't started is empty
  // slots, which is why the pre-draft CTA points at the order instead. Deduped
  // against the primary CTA, so a card whose CTA already IS a board does not
  // repeat it.
  if (poolDraft) {
    const secondary = poolDraft.pools
      .filter((p) => p.live)
      .map((p) => ({
        label: `${p.label} Draft Board`,
        href: `${env.p(profile.facts.draftBoardPath)}?conference=${p.id}`,
        live: true,
      }));
    const merged = mergeSecondaryLinks(view.secondaryLinks, secondary, view.link);
    view.secondaryLinks = merged.length > 0 ? merged : undefined;
  }

  return { roled: lead, view, priority, poolDraft };
}

// ── Phase detectors ──────────────────────────────────────────────────────────
// All scan the RAW list — by mid-season a phase's opening event is already
// `isPast`, and dedup will have promoted next year's into its single slot.

function isRegularSeasonActive(raw: RoledEvent[], now: Date): boolean {
  const kickoffs = ofRole(raw, 'season-start');
  const playoffs = ofRole(raw, 'playoffs');
  for (const k of kickoffs) {
    const p = playoffs.find((x) => x.event.startDate.getTime() > k.event.startDate.getTime());
    if (p && now >= k.event.startDate && now < p.event.startDate) return true;
  }
  return false;
}

/** Playoffs phase = playoffs open → championship week. */
function isInPlayoffsPhase(raw: RoledEvent[], now: Date): boolean {
  const playoffEvents = ofRole(raw, 'playoffs');
  const champEvents = ofRole(raw, 'championship');
  for (const p of playoffEvents) {
    const champAfter = champEvents.find((c) => c.event.startDate.getTime() > p.event.startDate.getTime());
    if (champAfter && now >= p.event.startDate && now < champAfter.event.startDate) return true;
  }
  return false;
}

/** Championship phase = championship week → +7 days. */
function isInChampionshipPhase(raw: RoledEvent[], now: Date): boolean {
  for (const c of ofRole(raw, 'championship')) {
    const end = new Date(c.event.startDate);
    end.setDate(end.getDate() + 7);
    if (now >= c.event.startDate && now < end) return true;
  }
  return false;
}

/** The week after the championship phase — the calendar does not model it. */
function isChampionCrownedWindow(raw: RoledEvent[], now: Date): boolean {
  for (const c of ofRole(raw, 'championship')) {
    const phaseEnd = new Date(c.event.startDate);
    phaseEnd.setDate(phaseEnd.getDate() + 7);
    const crownedEnd = new Date(phaseEnd);
    crownedEnd.setDate(crownedEnd.getDate() + 7);
    if (now >= phaseEnd && now < crownedEnd) return true;
  }
  return false;
}

/** New league year → keeper deadline: a keeper league's quiet stretch. */
function isQuietOffseason(events: RoledEvent[], now: Date): boolean {
  const newSeason = findRole(events, 'new-league-year');
  const keeper = findRole(events, 'keeper-deadline');
  if (!newSeason || !keeper) return false;
  if (now < newSeason.startDate || now >= keeper.startDate) return false;
  // Quiet stretch ends when the keeper urgency window kicks in (handled by pickLeadCalendarEvent).
  return true;
}

// ── The daily slot ───────────────────────────────────────────────────────────

/**
 * The shared weekly rotation (`getDailySlot`), shaped to what this league
 * runs:
 *
 *   - no live scoring → the live window keeps its slot (the games are still
 *     being played), and its card says so without a scoreboard behind it
 *     (`gamesOnSlotView`).
 *   - a power-rankings column → Tuesday afternoon (the waiver card keeps
 *     Wednesday), when THIS week's issue is out.
 *   - a weekly column → Wednesday night's news slot, when there is one.
 */
export function slotFor(
  profile: LeagueHeroProfile,
  now: Date,
  have: { peckingOrder: boolean; column: boolean },
): { slot: HeroSlot; gameWindow: GameWindow } {
  const base = getDailySlot(now);
  let slot: HeroSlot = base.slot;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(now);
  if (slot === 'waiver-wire' && weekday === 'Tue' && have.peckingOrder && heroRunsSlot(profile, 'pecking-order')) {
    slot = 'pecking-order';
  }
  if (slot === 'article' && weekday === 'Wed' && have.column && heroRunsSlot(profile, 'column')) {
    slot = 'column';
  }
  return { slot, gameWindow: base.gameWindow };
}

function slotView(slot: HeroSlot, ctx: SlotContext, input: LeagueHeroResolverInput): EventHeroView {
  switch (slot) {
    case 'live-scoring':
      if (!heroRunsSlot(ctx.env.profile, 'live-scoring')) {
        const gw = ctx.gameWindow ?? null;
        return gamesOnSlotView(ctx.env, {
          week: ctx.week,
          gameWindowLabel: gw ? GAME_WINDOW_LABEL[gw] : null,
          isLive: isGameLive(ctx.env.now),
        });
      }
      return liveScoringSlotView(ctx);
    case 'standings':
      return standingsSlotView(ctx);
    case 'recap':
      return recapSlotView(ctx);
    case 'waiver-wire':
      return waiverSlotView(ctx);
    case 'game-day-preview':
      return gameDayPreviewSlotView(ctx);
    case 'pecking-order':
      return input.peckingOrder ? peckingOrderSlotView(ctx.env, input.peckingOrder) : waiverSlotView(ctx);
    case 'column':
      return input.column
        ? columnSlotView(ctx.env, input.column, { week: ctx.week, deskByline: ctx.deskByline })
        : articleSlotView(ctx);
    case 'article':
    default:
      return articleSlotView(ctx);
  }
}

// ── Content builders for bespoke heroes & fallbacks ─────────────────────────

/** League-tagged, hero-eligible What's New entries dated within the last 7 days. */
function freshFeatureEntries(profile: LeagueHeroProfile, whatsNew: WhatsNewEntry[], now: Date): WhatsNewEntry[] {
  return whatsNew
    .filter((e) => entryAppliesToLeague(e, profile.whatsNewTag) && !e.excludeFromHero)
    .filter((e) => {
      const age = daysBetween(now, new Date(e.date + 'T00:00:00'));
      return age >= 0 && age <= FEATURE_HERO_DAYS;
    });
}

/**
 * The P2 fresh-feature state. `fresh` must be non-empty.
 *
 * With no `pick`, the entry is chosen deterministically per PT day — a
 * per-request random pick makes SSR flip hero content between same-day
 * requests (and fights the composite model's own daily-stable casting). The
 * lead-up pool passes its own per-visit pick instead: there the whole point is
 * that every load draws from the pool.
 */
function buildFreshFeatureState(fresh: WhatsNewEntry[], env: ViewEnv, pick?: WhatsNewEntry): LeagueHeroState {
  pick ??= dailyPick(fresh, env.now, env.profile.featureSeed, (e) => e.id) ?? fresh[0];
  return {
    kind: 'feature',
    priority: 'P2',
    content: featureToHero(pick, env.p),
    view: featureSlotView({ env, whatsNewEntry: pick }),
  };
}

function playoffsContent(profile: LeagueHeroProfile, p: (path: string) => string): HeroContent {
  return {
    source: 'event',
    title: profile.copy.playoffs.title,
    summary: profile.copy.playoffs.summary,
    link: p(profile.facts.playoffsPath),
    linkLabel: 'View Bracket',
    icon: 'playoff',
    accentColor: 'var(--cat-regular-season, #1c497c)',
    kicker: profile.copy.playoffs.kicker,
    isActive: true,
  };
}

function championshipContent(profile: LeagueHeroProfile, p: (path: string) => string): HeroContent {
  return {
    source: 'event',
    title: profile.copy.championship.title,
    summary: profile.copy.championship.summary,
    link: p(profile.facts.playoffsPath),
    linkLabel: 'View Bracket',
    icon: 'champ',
    accentColor: 'var(--cat-regular-season, #1c497c)',
    kicker: 'Championship',
    isActive: true,
  };
}

function tradeDeadlineContent(p: (path: string) => string): HeroContent {
  return {
    source: 'event',
    title: 'Trade Deadline',
    summary: 'Last call to lock in trades for the season. After today, rosters are locked through the playoffs.',
    link: p('/rosters'),
    linkLabel: 'View Rosters',
    icon: 'exchange',
    accentColor: 'var(--color-error, #dc2626)',
    isUrgent: true,
    kicker: 'Trade Deadline — Today',
  };
}

function offseasonContent(profile: LeagueHeroProfile, p: (path: string) => string): HeroContent {
  return {
    source: 'default',
    title: profile.copy.offseason.title,
    summary: profile.copy.offseason.summary,
    link: p('/rosters'),
    linkLabel: 'Review Rosters',
    icon: 'shield',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: 'Offseason',
  };
}

function defaultContent(profile: LeagueHeroProfile, entries: WhatsNewEntry[], p: (path: string) => string): HeroContent {
  const own = entries
    .filter((e) => entryAppliesToLeague(e, profile.whatsNewTag) && !e.excludeFromHero)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (own.length > 0) return featureToHero(own[0], p);
  return {
    source: 'default',
    title: profile.copy.default.title,
    summary: profile.copy.default.summary,
    link: p('/standings'),
    linkLabel: 'View Standings',
    icon: 'star',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: profile.copy.default.kicker,
  };
}

// ── The ladder ───────────────────────────────────────────────────────────────

/** What every rung is handed. */
export interface StepContext {
  input: LeagueHeroResolverInput;
  profile: LeagueHeroProfile;
  env: ViewEnv;
  now: Date;
  p: (path: string) => string;
  /** Every calendar event, with its role (NOT deduped). */
  raw: RoledEvent[];
  /** The same, deduped to one occurrence per role. */
  events: RoledEvent[];
  rng: () => number;
  /** The league's fresh (≤7 day) What's New entries. */
  fresh: () => WhatsNewEntry[];
  /** The daily slot rotation's fields, for the season phases that run it. */
  slotState: () => SlotStateFields;
  isRegularSeason: () => boolean;
  isPlayoffs: () => boolean;
}

interface SlotStateFields {
  slot: HeroSlot;
  gameWindow: GameWindow;
  week: number | undefined;
  isLive: boolean;
  content: HeroContent;
  view: EventHeroView;
}

/** A rung: returns the hero when its phase is on, null to hand the day down. */
export type HeroStep = (ctx: StepContext) => LeagueHeroState | null;

/** P0++: Trade Deadline DAY — the bespoke live-countdown hero owns the day. */
const tradeDeadlineStep: HeroStep = (ctx) => {
  const { profile, now, input, p } = ctx;
  const clock = profile.clock;
  let midnight: string | null = null;
  if (clock?.isTradeDeadlineDay) {
    if (clock.isTradeDeadlineDay(now)) midnight = clock.tradeDeadlineMidnight(now);
  } else {
    const event = findRole(ctx.events, 'trade-deadline');
    if (event?.isActive) midnight = midnightAfter(event.startDate);
  }
  if (!midnight) return null;
  return {
    kind: 'trade-deadline',
    priority: 'P0++',
    content: profile.content?.tradeDeadline?.(p) ?? tradeDeadlineContent(p),
    deadlineMidnightPT: midnight,
    referenceNowISO: input.testMode ? now.toISOString() : undefined,
    resolvedBy: 'isTradeDeadlineDay',
  };
};

/**
 * P0: Championship Week — a bespoke matchup hero where the league has one,
 * else the daily rotation keeps running through the title game.
 */
const championshipStep: HeroStep = (ctx) => {
  const { profile, now, p } = ctx;
  const on = profile.clock?.isChampionship ? profile.clock.isChampionship(now) : isInChampionshipPhase(ctx.raw, now);
  if (!on) return null;
  if (profile.capabilities.bracketHero) {
    return { kind: 'championship', priority: 'P0', content: championshipContent(profile, p), resolvedBy: 'isChampionshipWeek' };
  }
  return { kind: 'championship', priority: 'P0', ...ctx.slotState(), content: championshipContent(profile, p), resolvedBy: 'isChampionshipWeek' };
};

/** P0: the week after the title game. */
const championCrownedStep: HeroStep = (ctx) => {
  const { profile, now, p } = ctx;
  if (profile.clock?.isChampionCrowned) {
    if (!profile.clock.isChampionCrowned(now)) return null;
    return {
      kind: 'league-phase',
      phase: 'champion-crowned',
      priority: 'P0',
      content: profile.content?.championCrowned?.(p) ?? championshipContent(profile, p),
      resolvedBy: 'isChampionCrownedPeriod',
    };
  }
  if (!isChampionCrownedWindow(ctx.raw, now)) return null;
  const championship = findRole(ctx.events, 'championship') ?? ofRole(ctx.raw, 'championship')[0]?.event;
  if (!championship) return null;
  return {
    kind: 'calendar-event',
    priority: 'P0',
    eventId: `${profile.eventIdPrefix}-champion-crowned`,
    role: 'champion-crowned',
    content: eventToHero(championship),
    view: championCrownedView(ctx.env),
    resolvedBy: 'isChampionCrownedPeriod',
  };
};

/** P0: Playoffs — a bespoke bracket hero where the league has one. */
const playoffsStep: HeroStep = (ctx) => {
  const { profile, p } = ctx;
  if (!ctx.isPlayoffs()) return null;
  if (profile.capabilities.bracketHero) {
    return { kind: 'playoffs', priority: 'P0', content: playoffsContent(profile, p), resolvedBy: 'isPlayoffPeriod' };
  }
  return { kind: 'playoffs', priority: 'P0', ...ctx.slotState(), content: playoffsContent(profile, p), resolvedBy: 'isPlayoffPeriod' };
};

/**
 * P0/P1: Calendar-driven lead event.
 *
 * A P1 lead-up (a countdown to kickoff, a keeper deadline, a draft) is
 * FILLER — roster context, not a live event — and its urgency window (7–50
 * days) is longer than the 7-day fresh-feature window, so it would lock
 * every What's New launch out of the hero for good. The countdown is
 * therefore ONE entry in a per-visit pool with every fresh What's New
 * article, on equal footing: with N fresh articles it shows on 1/(N+1) of
 * loads and so does each article. It never touches a P0 (an ACTIVE event
 * owns the homepage outright), and with no fresh article the pool is just
 * the countdown, so the `rng` is not even consulted.
 *
 * "Upcoming" is judged on the CARD, not just its own priority: a live
 * sibling pool draft makes the card a live event for pooling purposes (it is
 * the only homepage path to that live board).
 */
const calendarLeadStep: HeroStep = (ctx) => {
  const lead = pickLeadCalendarEvent(ctx.events, ctx.raw, ctx.env);
  if (!lead) return null;
  const fresh = ctx.fresh();
  const siblingDraftLive = !!lead.poolDraft?.pools.some((x) => x.live);
  if (lead.priority === 'P1' && !siblingDraftLive && fresh.length > 0) {
    const poolSize = fresh.length + 1;
    const slot = Math.min(poolSize - 1, Math.max(0, Math.floor(ctx.rng() * poolSize)));
    if (slot > 0) return buildFreshFeatureState(fresh, ctx.env, fresh[slot - 1]);
  }
  return {
    kind: 'calendar-event',
    priority: lead.priority,
    eventId: lead.roled.event.definition.id,
    role: lead.roled.match.role,
    content: eventToHero(lead.roled.event),
    view: lead.view,
    poolDraft: lead.poolDraft,
    resolvedBy: 'pickLeadCalendarEvent',
  };
};

/** P0: Regular season — the daily slot rotation. */
const regularSeasonStep: HeroStep = (ctx) =>
  ctx.isRegularSeason()
    ? { kind: 'regular-season', priority: 'P0', ...ctx.slotState(), resolvedBy: 'isRegularSeason' }
    : null;

/**
 * Schedule Release — countdown, release day, and the week after. The DECISION
 * comes from src/utils/schedule-release.mjs, shared by every league's hero: a
 * countdown implemented twice is a countdown that eventually disagrees with
 * itself. Where it sits in the ladder, and so its priority, is the profile's.
 */
const scheduleReleaseStep: HeroStep = (ctx) => {
  const { profile, now, input, p } = ctx;
  const tease = scheduleReleaseTease(profile.league, now, { revealed: Boolean(input.scheduleReleaseRevealed) });
  const copy = scheduleReleaseTeaseCopy(tease, profile.copy.scheduleReleaseName);
  if (!tease.show || !copy) return null;
  return {
    kind: 'event',
    priority: profile.scheduleRelease.priority,
    content: {
      source: 'event',
      title: copy.title,
      summary: copy.summary,
      link: p('/schedule-release'),
      linkLabel: tease.phase === 'out' ? 'See the schedule' : 'See the countdown',
      icon: 'calendar',
      accentColor: profile.scheduleRelease.accentColor,
      kicker: copy.kicker,
      isUrgent: tease.phase === 'imminent',
      isActive: tease.phase === 'out',
    },
    view: {
      pill: tease.phase === 'out' ? 'JUST DROPPED' : 'COMING UP',
      headline: copy.title.toUpperCase(),
      accentWord: '',
      summary: copy.summary,
      link: p('/schedule-release'),
      linkLabel: (tease.phase === 'out' ? 'See the schedule' : 'See the countdown').toUpperCase(),
      icon: 'calendar',
      // The schedule drop is a LEAGUE moment, showcased by one of the
      // league's best players rather than by a franchise headliner.
      // Nobody owns the schedule, so the card keeps the league's own navy.
      cast: 'top-ranked',
      composite: { wordmark: 'SCHEDULE', accent: 'navy', tone: null, scope: 'league' },
      accent: ACCENT_GOLD,
      glow: GLOW_GOLD,
      player: randomHeroPlayer(now),
    },
    resolvedBy: 'scheduleReleaseTease',
  };
};

/** P2: Fresh What's New (≤7 days). */
const freshFeatureStep: HeroStep = (ctx) => {
  const fresh = ctx.fresh();
  return fresh.length > 0 ? buildFreshFeatureState(fresh, ctx.env) : null;
};

/**
 * P3/P4: Active or upcoming timeline event (any event without a calendar
 * card of its own). Synthesize a minimal view from the event's name.
 */
const timelineStep: HeroStep = (ctx) => {
  const { timeline } = ctx.input;
  const timelinePick =
    timeline?.next?.isUrgent
      ? { event: timeline.next, priority: 'P3' as const }
      : timeline?.current?.isActive
        ? { event: timeline.current, priority: 'P4' as const }
        : timeline?.next && !timeline.next.isPast && timeline.next.daysUntilStart <= 14
          ? { event: timeline.next, priority: 'P4' as const }
          : null;
  if (!timelinePick) return null;
  const e = timelinePick.event;
  return {
    kind: 'event',
    priority: timelinePick.priority,
    content: eventToHero(e),
    view: {
      pill: e.isActive ? 'HAPPENING NOW' : e.isUrgent ? 'COMING UP' : 'LEAGUE EVENT',
      headline: e.definition.name.toUpperCase(),
      accentWord: '',
      summary: e.definition.description,
      link: e.actionLinks[0]?.url ?? e.resultLinks[0]?.url,
      linkLabel: (e.actionLinks[0]?.label ?? e.resultLinks[0]?.label ?? 'LEARN MORE').toUpperCase(),
      icon: e.definition.icon,
      // The catch-all for a dated league event with no phase of its own.
      composite: { wordmark: 'EVENT', accent: 'gold', tone: null, scope: 'league' },
      accent: ACCENT_GOLD,
      glow: GLOW_GOLD,
      player: randomHeroPlayer(ctx.now),
    },
    resolvedBy: 'timeline',
  };
};

/** P5: Quiet offseason or ultimate fallback — the league's own card. */
const defaultStep: HeroStep = (ctx) => ({
  kind: 'default',
  priority: 'P5',
  content: isQuietOffseason(ctx.events, ctx.now)
    ? offseasonContent(ctx.profile, ctx.p)
    : defaultContent(ctx.profile, ctx.input.whatsNewEntries ?? [], ctx.p),
  view: ctx.profile.defaultView(ctx.now),
  resolvedBy: 'default',
});

/**
 * Every rung the shared ladder knows. A league's profile lists the ones it
 * climbs, in its order (`ladder`); a rung a league does not list is a hero it
 * does not have.
 */
export const HERO_STEPS = {
  'trade-deadline': tradeDeadlineStep,
  championship: championshipStep,
  'champion-crowned': championCrownedStep,
  playoffs: playoffsStep,
  'calendar-lead': calendarLeadStep,
  'regular-season': regularSeasonStep,
  'schedule-release': scheduleReleaseStep,
  'fresh-feature': freshFeatureStep,
  timeline: timelineStep,
  default: defaultStep,
  // Contract-league capabilities (./contract-steps.ts).
  auction: auctionStep,
  'rookie-draft': rookieDraftStep,
  'breaking-story': breakingStoryStep,
  'roster-deadlines': rosterDeadlinesStep,
  'offseason-ambient': offseasonAmbientStep,
  'whats-new-fallback': whatsNewFallbackStep,
} satisfies Record<string, HeroStep>;

export type HeroStepId = keyof typeof HERO_STEPS;

/**
 * A capability state carries a shared card view as well as its content, so a
 * league without that capability's bespoke component still renders it. The
 * bracket phases are the exception by design: no view is what routes them to
 * their bracket.
 */
function withSharedView(state: LeagueHeroState, env: ViewEnv): LeagueHeroState {
  if (state.kind === 'auction' || state.kind === 'rookie-draft' || state.kind === 'breaking-story' || state.kind === 'league-phase') {
    return state.view ? state : { ...state, view: eventSlotView(env, state.content) };
  }
  return state;
}

// ── Main resolver ────────────────────────────────────────────────────────────

export function resolveLeagueHeroState(input: LeagueHeroResolverInput): LeagueHeroState {
  const profile = getLeagueHeroProfile(input.league);
  const now = input.referenceDate;
  const p = heroPath(profile.league);
  const env: ViewEnv = { profile, now, tier: input.userTier, userPoolId: input.userPoolId, p };

  const raw = withRoles(profile, input.events ?? profile.loadEvents?.(now) ?? []);
  const events = dedupeEvents(raw);

  let fresh: WhatsNewEntry[] | null = null;
  let slot: SlotStateFields | null = null;
  const ctx: StepContext = {
    input,
    profile,
    env,
    now,
    p,
    raw,
    events,
    rng: input.rng ?? Math.random,
    fresh: () => (fresh ??= freshFeatureEntries(profile, input.whatsNewEntries ?? [], now)),
    isRegularSeason: () =>
      profile.clock?.isRegularSeason ? profile.clock.isRegularSeason(now) : isRegularSeasonActive(raw, now),
    isPlayoffs: () => (profile.clock?.isPlayoffs ? profile.clock.isPlayoffs(now) : isInPlayoffsPhase(raw, now)),
    slotState: () => {
      if (slot) return slot;
      const { slot: s, gameWindow } = slotFor(profile, now, {
        peckingOrder: !!input.peckingOrder,
        column: !!input.column,
      });
      const week = getCurrentNFLWeek(now) ?? undefined;
      const sctx: SlotContext = {
        env,
        slot: s,
        gameWindow,
        week,
        lineupSubmitted: input.lineupSubmitted ?? null,
        recap: input.recap,
        waiver: input.waiver,
        article: input.article,
      };
      return (slot = {
        slot: s,
        gameWindow,
        week,
        // The SLOT is not the WINDOW: Sunday's live-scoring slot runs to 11pm PT
        // and the games stop at 8:30. This is what stops the hero polling all
        // evening and badging finished games LIVE.
        isLive: isGameLive(now),
        content: regularSeasonContent(s, week, gameWindow, sctx),
        view: slotView(s, sctx, input),
      });
    },
  };

  for (const id of profile.ladder) {
    const state = HERO_STEPS[id](ctx);
    if (state) return withSharedView(state, env);
  }
  // Every ladder ends on a rung that always answers; this is the guard for one
  // that does not.
  return defaultStep(ctx)!;
}
