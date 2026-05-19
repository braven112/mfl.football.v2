/**
 * AFL Hero Resolver
 *
 * Determines which hero to display on the AFL homepage based on the current
 * calendar position. Mirrors the priority structure of TheLeague's resolver
 * but tuned to AFL's cadence:
 *
 *   - No auction (TheLeague has one; AFL replaces it with a single draft per conference)
 *   - July 15 keeper deadline is the only public preseason date
 *   - Conference drafts run the weekend before Labor Day (AL Saturday live, NL Sunday email)
 *
 * Hero priority (high → low):
 *   P0++ Trade Deadline Day (24h override)
 *   P0   Championship Week, Champion Crowned, Conference Draft Window, In-Season
 *   P1   Keeper Deadline Day, Keeper Deadline Approaching (≤30 days out)
 *   P2   Fresh AFL-tagged What's New entry (≤7 days)
 *   P3   Urgent upcoming AFL event
 *   P4   Active / upcoming AFL event
 *   P5   Default offseason hero (no dates) or What's New fallback
 */

import type { WhatsNewEntry, HeroContent } from '../types/whats-new';
import { entryAppliesToLeague, WHATS_NEW_CATEGORY_LABELS } from '../types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent } from '../types/league-events';
import type { DailySlot, GameWindow } from '../types/hero-state';
import { getNthDayOfMonth } from './league-event-resolver';
import { getLaborDayForYear } from './league-year';
import { getDailySlot } from './hero-resolver';
import { getCurrentNFLWeek } from './current-week';

/** How long a fresh What's New entry stays in the hero. */
const FEATURE_HERO_DAYS = 7;

const CATEGORY_COLOR: Record<string, string> = {
  preseason: 'var(--cat-preseason, #60a5fa)',
  draft: 'var(--cat-draft, #7c3aed)',
  'regular-season': 'var(--cat-regular-season, #1c497c)',
  'free-agency': 'var(--cat-free-agency, #2e8743)',
};

/** AFL hero state — discriminated by `kind`. */
export type AflHeroState =
  | { kind: 'conference-draft'; priority: 'P0'; content: HeroContent; al: { date: Date; live: boolean }; nl: { date: Date; live: boolean }; userConference?: '00' | '01' }
  | { kind: 'keeper-deadline'; priority: 'P1'; content: HeroContent; deadline: Date; daysUntil: number }
  | { kind: 'trade-deadline'; priority: 'P0++'; content: HeroContent; deadlineMidnightPT: string }
  | { kind: 'championship'; priority: 'P0'; content: HeroContent }
  | { kind: 'champion-crowned'; priority: 'P0'; content: HeroContent }
  | { kind: 'playoffs'; priority: 'P0'; content: HeroContent; slot?: DailySlot; gameWindow?: GameWindow; week?: number }
  | { kind: 'regular-season'; priority: 'P0'; content: HeroContent; slot: DailySlot; gameWindow: GameWindow; week?: number }
  | { kind: 'event'; priority: 'P3' | 'P4'; content: HeroContent }
  | { kind: 'feature'; priority: 'P2'; content: HeroContent }
  | { kind: 'default'; priority: 'P5'; content: HeroContent };

export interface AflHeroResolverInput {
  referenceDate: Date;
  testMode?: boolean;
  whatsNewEntries?: WhatsNewEntry[];
  timeline?: WhatsNextTimeline;
  /** User's conference id from AFL cookie/auth ("00"=AL, "01"=NL) — for conference-aware draft hero. */
  userConferenceId?: '00' | '01';
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.ceil((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / (1000 * 60 * 60 * 24));
}

function getKeeperDeadline(year: number): Date {
  // July 15 @ 8pm PT (treated as local 20:00 to match the calendar entry)
  return new Date(year, 6, 15, 20, 0, 0, 0);
}

/** Days before the keeper deadline at which the urgency hero kicks in. */
const KEEPER_URGENCY_DAYS = 30;

function getAlDraftDate(year: number): Date {
  const labor = getLaborDayForYear(year);
  const sat = new Date(labor);
  sat.setDate(sat.getDate() - 2);
  sat.setHours(9, 0, 0, 0);
  return sat;
}

function getNlDraftDate(year: number): Date {
  const labor = getLaborDayForYear(year);
  const sun = new Date(labor);
  sun.setDate(sun.getDate() - 1);
  sun.setHours(9, 0, 0, 0);
  return sun;
}

function getNflKickoff(year: number): Date {
  const labor = getLaborDayForYear(year);
  const thu = new Date(labor);
  thu.setDate(thu.getDate() + 3);
  return thu;
}

function getTradeDeadline(year: number): Date {
  // AFL: Wednesday between Week 10 and Week 11 (per the constitution).
  const labor = getLaborDayForYear(year);
  const kickoff = new Date(labor);
  kickoff.setDate(kickoff.getDate() + 3);
  const wed = new Date(kickoff);
  wed.setDate(wed.getDate() + 10 * 7 - 1); // Wed of the Week 10/11 transition
  return wed;
}

function getPlayoffStart(year: number): Date {
  // AFL playoffs begin Week 14 (one week earlier than TheLeague).
  const kickoff = getNflKickoff(year);
  const start = new Date(kickoff);
  start.setDate(start.getDate() + 13 * 7);
  return start;
}

function getChampionshipStart(year: number): Date {
  // AFL World Championship is Week 16 (one week earlier than TheLeague).
  const kickoff = getNflKickoff(year);
  const start = new Date(kickoff);
  start.setDate(start.getDate() + 15 * 7);
  return start;
}

function getChampionshipEnd(year: number): Date {
  const start = getChampionshipStart(year);
  const end = new Date(start);
  end.setDate(end.getDate() + 4);
  end.setHours(23, 59, 59, 999);
  return end;
}

// ── Phase detectors ──────────────────────────────────────────────────────────

function isConferenceDraftWindow(now: Date): boolean {
  const year = now.getFullYear();
  // Window: 7 days before AL Saturday → end of NL Sunday
  const al = getAlDraftDate(year);
  const start = new Date(al);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  const nl = getNlDraftDate(year);
  const end = endOfDay(nl);
  return now >= start && now <= end;
}

function isKeeperDeadlineApproaching(now: Date): boolean {
  const deadline = getKeeperDeadline(now.getFullYear());
  if (now >= deadline) return false;
  return daysBetween(deadline, now) <= KEEPER_URGENCY_DAYS;
}

function isKeeperDeadlineDay(now: Date): boolean {
  return now.getMonth() === 6 && now.getDate() === 15;
}

function isTradeDeadlineDay(now: Date): boolean {
  const year = now.getFullYear();
  const td = getTradeDeadline(year);
  return now.getFullYear() === td.getFullYear() && now.getMonth() === td.getMonth() && now.getDate() === td.getDate();
}

function isChampionshipWeek(now: Date): boolean {
  const yearStart = getChampionshipStart(now.getFullYear());
  const yearEnd = getChampionshipEnd(now.getFullYear());
  if (now >= yearStart && now <= yearEnd) return true;
  // Span across calendar year boundary (Dec → Jan)
  const prevStart = getChampionshipStart(now.getFullYear() - 1);
  const prevEnd = getChampionshipEnd(now.getFullYear() - 1);
  return now >= prevStart && now <= prevEnd;
}

function isChampionCrownedWindow(now: Date): boolean {
  for (const seasonYear of [now.getFullYear(), now.getFullYear() - 1]) {
    const end = getChampionshipEnd(seasonYear);
    const start = new Date(end);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const crownedEnd = new Date(start);
    crownedEnd.setDate(crownedEnd.getDate() + 7);
    crownedEnd.setHours(23, 59, 59, 999);
    if (now >= start && now <= crownedEnd) return true;
  }
  return false;
}

function isPlayoffs(now: Date): boolean {
  const year = now.getFullYear();
  const start = getPlayoffStart(year);
  const champStart = getChampionshipStart(year);
  return now >= start && now < champStart;
}

function isRegularSeason(now: Date): boolean {
  const year = now.getFullYear();
  const kickoff = getNflKickoff(year);
  const playoffsStart = getPlayoffStart(year);
  return now >= kickoff && now < playoffsStart;
}

function isQuietOffseason(now: Date): boolean {
  // Feb 15 through the moment the keeper-deadline urgency window kicks in.
  // We intentionally don't surface any specific date during this stretch —
  // July 15 is the only date the site advertises.
  const year = now.getFullYear();
  const start = new Date(year, 1, 15); // Feb 15
  const deadline = getKeeperDeadline(year);
  return now >= start && now < deadline && !isKeeperDeadlineApproaching(now);
}

// ── Content builders ─────────────────────────────────────────────────────────

function formatKickerDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function featureToHero(entry: WhatsNewEntry): HeroContent {
  return {
    source: 'feature',
    title: entry.title,
    summary: entry.summary,
    link: entry.link,
    linkLabel: entry.linkLabel ?? 'Check it out',
    icon: entry.icon,
    accentColor: 'var(--color-secondary, #2e8743)',
    image: entry.image,
    imageAlt: entry.imageAlt,
    kicker: WHATS_NEW_CATEGORY_LABELS[entry.category],
    kickerDate: formatKickerDate(new Date(entry.date + 'T00:00:00')),
  };
}

function eventToHero(event: ResolvedLeagueEvent): HeroContent {
  const link = event.actionLinks[0] ?? event.resultLinks[0];
  const accent = CATEGORY_COLOR[event.definition.category] ?? 'var(--color-primary, #1c497c)';
  return {
    source: 'event',
    title: event.definition.name,
    summary: event.definition.description,
    link: link?.url,
    linkLabel: link?.label ?? 'Learn more',
    icon: event.definition.icon,
    accentColor: accent,
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

function buildKeeperDeadlineHero(deadline: Date, daysUntil: number): HeroContent {
  const summary =
    daysUntil === 0
      ? 'Today is the day — declare your 7 keepers before 8pm PT or the league picks for you.'
      : daysUntil === 1
        ? 'Tomorrow at 8pm PT — declare your 7 keepers. Anyone left undeclared hits the draft pool.'
        : `${daysUntil} days until the keeper deadline. Lock in your 7 protected players before July 15 @ 8pm PT.`;
  return {
    source: 'event',
    title: 'Keeper Deadline',
    summary,
    link: '/afl-fantasy/keepers',
    linkLabel: 'Manage Keepers',
    icon: 'bookmark',
    accentColor: 'var(--cat-preseason, #60a5fa)',
    isUrgent: true,
    isActive: daysUntil === 0,
    kicker: daysUntil === 0 ? 'Deadline — Today' : 'Keeper Deadline',
    kickerDate: formatKickerDate(deadline),
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

function buildConferenceDraftHero(input: {
  now: Date;
  al: Date;
  nl: Date;
  userConferenceId?: '00' | '01';
}): HeroContent {
  const { now, al, nl, userConferenceId } = input;
  const alLive = now >= al && now < new Date(al.getTime() + 24 * 60 * 60 * 1000);
  const nlLive = now >= nl && now < new Date(nl.getTime() + 24 * 60 * 60 * 1000);
  const isUserAl = userConferenceId === '00';
  const isUserNl = userConferenceId === '01';

  // Conference-aware copy
  let title = 'Conference Drafts';
  let summary: string;
  let kicker = 'Draft Weekend';
  if (alLive) {
    kicker = 'AL Draft Under Way';
    title = isUserAl ? 'Your Draft Is Live' : 'AL Draft Under Way';
    summary = isUserAl
      ? 'The American League live draft is happening right now. Make your picks before the timer expires.'
      : 'The American League is drafting live. NL draft starts Sunday at 9am PT.';
  } else if (nlLive) {
    kicker = 'NL Draft Under Way';
    title = isUserNl ? 'Your Draft Is Live' : 'NL Draft Under Way';
    summary = isUserNl
      ? 'The National League email draft is open. Submit your queue and watch the clock — picks tick through one at a time.'
      : `The National League is drafting now. ${isUserAl ? 'Your AL draft wrapped yesterday — check the results.' : 'Conference Drafts are in full swing.'}`;
  } else {
    const daysToAl = daysBetween(al, now);
    const daysToNl = daysBetween(nl, now);
    if (isUserAl) {
      summary = `Your live draft is ${daysToAl === 0 ? 'today' : daysToAl === 1 ? 'tomorrow' : `in ${daysToAl} days`} — Saturday at 9am PT. Scout the board and finalize your queue.`;
      title = 'AL Draft Day Is Coming';
    } else if (isUserNl) {
      summary = `Your email draft starts ${daysToNl === 0 ? 'today' : daysToNl === 1 ? 'tomorrow' : `in ${daysToNl} days`} — Sunday at 9am PT. Set your queue before the first pick is on the clock.`;
      title = 'NL Draft Is Coming';
    } else {
      summary = `AL drafts live Saturday at 9am PT, NL email draft opens Sunday at 9am PT. Conference Drafts kick off in ${daysToAl} days.`;
    }
  }

  return {
    source: 'draft',
    title,
    summary,
    icon: 'draft-podium',
    accentColor: 'var(--cat-draft, #7c3aed)',
    kicker,
    isActive: alLive || nlLive,
    isUrgent: !alLive && !nlLive,
    kickerDate: formatKickerDate(isUserNl ? nl : al),
  };
}

function buildRegularSeasonHero(slot: DailySlot, week: number | undefined, gameWindow: GameWindow): HeroContent {
  const weekLabel = week ? `Week ${week}` : 'Regular Season';
  switch (slot) {
    case 'live-scoring': {
      const windowName: Record<NonNullable<GameWindow>, string> = {
        tnf: 'Thursday Night Football',
        sunday: 'Sunday slate',
        snf: 'Sunday Night Football',
        mnf: 'Monday Night Football',
      };
      const label = gameWindow && gameWindow in windowName ? windowName[gameWindow as NonNullable<GameWindow>] : 'live games';
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
        summary: 'Waiver claims run Wednesday at 9pm PT. After that, free agents go first-come, first-served through Sunday kickoff.',
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
    kicker: 'Playoffs',
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

function buildChampionCrownedHero(): HeroContent {
  return {
    source: 'event',
    title: 'A New Champion',
    summary: 'The season has wrapped. View the bracket and savor the result before keeper math takes over.',
    link: '/afl-fantasy/playoffs',
    linkLabel: 'View Recap',
    icon: 'trophy',
    accentColor: 'var(--color-warning, #d97706)',
    kicker: 'Champion Crowned',
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
    summary: 'Two conferences, 24 teams, one champion. Welcome to the American Football League.',
    link: '/afl-fantasy/standings',
    linkLabel: 'View Standings',
    icon: 'star',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: 'AFL',
  };
}

// ── Main resolver ────────────────────────────────────────────────────────────

export function resolveAflHeroState(input: AflHeroResolverInput): AflHeroState {
  const now = input.referenceDate;
  const whatsNew = input.whatsNewEntries ?? [];
  const timeline = input.timeline;

  // P0++: Trade deadline day
  if (isTradeDeadlineDay(now)) {
    const year = now.getFullYear();
    return {
      kind: 'trade-deadline',
      priority: 'P0++',
      content: buildTradeDeadlineHero(),
      deadlineMidnightPT: `${year}-${String(getTradeDeadline(year).getMonth() + 1).padStart(2, '0')}-${String(getTradeDeadline(year).getDate() + 1).padStart(2, '0')}T00:00:00-08:00`,
    };
  }

  // P0: Championship week
  if (isChampionshipWeek(now)) {
    return { kind: 'championship', priority: 'P0', content: buildChampionshipHero() };
  }

  // P0: Champion crowned (7-day window after championship)
  if (isChampionCrownedWindow(now)) {
    return { kind: 'champion-crowned', priority: 'P0', content: buildChampionCrownedHero() };
  }

  // P0: Playoffs
  if (isPlayoffs(now)) {
    return { kind: 'playoffs', priority: 'P0', content: buildPlayoffsHero() };
  }

  // P0: Conference Draft window
  if (isConferenceDraftWindow(now)) {
    const year = now.getFullYear();
    const al = getAlDraftDate(year);
    const nl = getNlDraftDate(year);
    const content = buildConferenceDraftHero({ now, al, nl, userConferenceId: input.userConferenceId });
    return {
      kind: 'conference-draft',
      priority: 'P0',
      content,
      al: { date: al, live: now >= al && now < new Date(al.getTime() + 24 * 60 * 60 * 1000) },
      nl: { date: nl, live: now >= nl && now < new Date(nl.getTime() + 24 * 60 * 60 * 1000) },
      userConference: input.userConferenceId,
    };
  }

  // P1: Keeper deadline day (today is July 15) or approaching (≤30 days out)
  if (isKeeperDeadlineDay(now) || isKeeperDeadlineApproaching(now)) {
    const deadline = getKeeperDeadline(now.getFullYear());
    const daysUntil = isKeeperDeadlineDay(now) ? 0 : daysBetween(deadline, now);
    return {
      kind: 'keeper-deadline',
      priority: 'P1',
      content: buildKeeperDeadlineHero(deadline, daysUntil),
      deadline,
      daysUntil,
    };
  }

  // P0: Regular season — route through the daily slot rotation
  if (isRegularSeason(now)) {
    const { slot, gameWindow } = getDailySlot(now);
    const week = getCurrentNFLWeek(now) ?? undefined;
    return {
      kind: 'regular-season',
      priority: 'P0',
      slot,
      gameWindow,
      week,
      content: buildRegularSeasonHero(slot, week, gameWindow),
    };
  }

  // P2: Fresh AFL-tagged What's New (≤7 days)
  const fresh = whatsNew
    .filter((e) => entryAppliesToLeague(e, 'afl') && !e.excludeFromHero)
    .filter((e) => {
      const age = daysBetween(now, new Date(e.date + 'T00:00:00'));
      return age >= 0 && age <= FEATURE_HERO_DAYS;
    });
  if (fresh.length > 0) {
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    return { kind: 'feature', priority: 'P2', content: featureToHero(pick) };
  }

  // P3/P4: Urgent or active timeline event
  if (timeline) {
    if (timeline.next?.isUrgent) return { kind: 'event', priority: 'P3', content: eventToHero(timeline.next) };
    if (timeline.current?.isActive) return { kind: 'event', priority: 'P4', content: eventToHero(timeline.current) };
    if (timeline.next && !timeline.next.isPast && timeline.next.daysUntilStart <= 14) {
      return { kind: 'event', priority: 'P4', content: eventToHero(timeline.next) };
    }
  }

  // P5: Quiet offseason — no specific dates surfaced, just a "review rosters" nudge
  if (isQuietOffseason(now)) {
    return { kind: 'default', priority: 'P5', content: buildOffseasonHero() };
  }

  // P5: Ultimate fallback (e.g., between champion-crowned and Feb 15)
  return { kind: 'default', priority: 'P5', content: buildDefaultHero(whatsNew) };
}
