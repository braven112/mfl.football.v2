/**
 * The "What's Next" calendar for a package league (archies first).
 *
 * TheLeague and the AFL hand-author their events (src/data/<league>/
 * league-events.*) because their constitutions define dates MFL does not
 * know about. A package league's calendar is whatever its commissioner set in
 * MFL, so it is READ, not authored:
 *
 *   1. MFL's calendar export (`calendar.json`) — draft, trade deadline,
 *      keeper window, auction, and the commissioner's CUSTOM events. That
 *      export is owner/commissioner-gated: it syncs only once the sync
 *      account (MFL_USER_ID) belongs to the league, and until then the file
 *      is simply absent.
 *   2. Facts every league has, derived so the calendar is never empty:
 *      NFL kickoff (the real week-1 start, src/utils/nfl-week-starts.mjs),
 *      playoffs and championship week (from MFL's playoff-bracket
 *      definitions), and the league-year rollover (registry).
 *
 * Waiver lock/unlock and injured-reserve events are not calendar-worthy for
 * owners and are skipped.
 */
import type { LeagueEventDefinition, LinkTemplateVars, ResolvedLeagueEvent, WhatsNextTimeline } from '../types/league-events';
import type { LeagueDefinition } from '../config/leagues';
import { compareResolved, resolveConcreteEvent, selectWhatsNextTimeline } from './league-event-resolver';
import { nflWeekStartInstant } from './nfl-week-starts.mjs';

export interface MflCalendarEvent {
  type?: string;
  title?: string;
  start_time?: string;
  end_time?: string;
  id?: string;
}

type Category = LeagueEventDefinition['category'];

/** What an MFL calendar type means to an owner. Types not listed are skipped. */
const MFL_TYPES: Record<string, { name: string; icon: string; category: Category; description: string }> = {
  DRAFT_START: { name: 'Draft', icon: 'draft-podium', category: 'draft', description: 'The league draft opens.' },
  AUCTION_START: { name: 'Auction opens', icon: 'gavel', category: 'free-agency', description: 'The free-agent auction opens.' },
  TRADE: { name: 'Trade deadline', icon: 'exchange', category: 'regular-season', description: 'Last chance to make a trade this season.' },
  KEEPERS: { name: 'Keeper window', icon: 'bookmark', category: 'preseason', description: 'Name your keepers before the window closes.' },
  CUSTOM: { name: '', icon: 'star', category: 'regular-season', description: '' },
};

/** MFL writes a calendar time either as a unix timestamp or as an NFL week number. */
function mflTime(value: string | undefined, seasonYear: number): Date | null {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0) return null;
  if (n <= 25) return nflWeekStartInstant(seasonYear, n);
  return new Date(n * 1000);
}

function typeInfo(type: string) {
  if (MFL_TYPES[type]) return MFL_TYPES[type];
  // DRAFT_START_CONFERENCE00, DRAFT_START_DIVISION03, … — per-unit drafts.
  if (type.startsWith('DRAFT_START')) return MFL_TYPES.DRAFT_START;
  return null;
}

interface Bracket {
  startWeek?: string;
  teamsInvolved?: string;
}

/** The main bracket: the one with the most teams (MFL's championship). */
function championshipWeeks(playoffBrackets: unknown): { start: number; final: number } | null {
  const raw = (playoffBrackets as { playoffBrackets?: { playoffBracket?: Bracket | Bracket[] } } | null)?.playoffBrackets?.playoffBracket;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let best: { start: number; teams: number } | null = null;
  for (const b of list) {
    const start = Number(b.startWeek);
    const teams = Number(b.teamsInvolved);
    if (!Number.isFinite(start) || !Number.isFinite(teams) || teams < 2) continue;
    if (!best || teams > best.teams) best = { start, teams };
  }
  if (!best) return null;
  return { start: best.start, final: best.start + Math.ceil(Math.log2(best.teams)) - 1 };
}

function def(
  id: string,
  name: string,
  description: string,
  icon: string,
  category: Category,
  sortOrder: number,
): LeagueEventDefinition {
  // startDate/endDate are required by the schema but unused for a concrete
  // event: the dates are passed to resolveConcreteEvent directly.
  return { id, name, description, icon, category, sortOrder, startDate: { type: 'fixed', month: 1, day: 1 } };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every calendar event for a package league across the given season(s).
 *
 * @param seasons  Each season year with the feeds that belong to it; pass the
 *                 current season and the next so the calendar keeps looking
 *                 forward through the offseason.
 */
export function buildPackageLeagueEvents(input: {
  league: Pick<LeagueDefinition, 'slug' | 'id' | 'mflHost' | 'leagueYearRollover'>;
  seasons: Array<{ seasonYear: number; calendar?: MflCalendarEvent[] | null; playoffBrackets?: unknown }>;
  referenceDate: Date;
}): ResolvedLeagueEvent[] {
  const { league, seasons, referenceDate } = input;
  const out: ResolvedLeagueEvent[] = [];
  const seen = new Set<string>();

  for (const { seasonYear, calendar, playoffBrackets } of seasons) {
    const vars: LinkTemplateVars = {
      mflHost: league.mflHost,
      year: String(seasonYear),
      prevYear: String(seasonYear - 1),
      leagueId: league.id,
    };
    const push = (d: LeagueEventDefinition, start: Date, end: Date) => {
      const key = `${d.id}:${start.getTime()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(resolveConcreteEvent(d, start, end, referenceDate, vars));
    };

    // 1. MFL's own calendar.
    for (const ev of calendar ?? []) {
      const type = String(ev.type ?? '');
      const info = typeInfo(type);
      if (!info) continue;
      const name = type === 'CUSTOM' ? String(ev.title ?? '').trim() : info.name;
      if (!name) continue;
      const start = mflTime(ev.start_time, seasonYear);
      if (!start) continue;
      const end = mflTime(ev.end_time, seasonYear) ?? start;
      push(
        def(`${league.slug}-mfl-${ev.id ?? type}-${seasonYear}`, name, info.description || name, info.icon, info.category, 10),
        start,
        end >= start ? end : start,
      );
    }

    // 2. Facts every league has.
    const kickoff = nflWeekStartInstant(seasonYear, 1);
    push(def(`${league.slug}-kickoff-${seasonYear}`, 'Week 1 kicks off', `The ${seasonYear} NFL season starts.`, 'nfl', 'regular-season', 20), kickoff, kickoff);

    const bracket = championshipWeeks(playoffBrackets);
    if (bracket) {
      const po = nflWeekStartInstant(seasonYear, bracket.start);
      push(def(`${league.slug}-playoffs-${seasonYear}`, 'Playoffs begin', `Week ${bracket.start}: the playoff bracket opens.`, 'playoff', 'regular-season', 30), po, po);
      const champ = nflWeekStartInstant(seasonYear, bracket.final);
      push(
        def(`${league.slug}-championship-${seasonYear}`, 'Championship week', `Week ${bracket.final}: the title is decided.`, 'champ', 'regular-season', 40),
        champ,
        new Date(champ.getTime() + 6 * DAY_MS),
      );
    }

    const roll = league.leagueYearRollover;
    if (roll) {
      const newYear = new Date(seasonYear + 1, roll.month - 1, roll.day);
      push(def(`${league.slug}-new-league-year-${seasonYear + 1}`, 'New league year', `The ${seasonYear + 1} league year begins on MFL.`, 'star', 'preseason', 0), newYear, newYear);
    }
  }
  return out.sort(compareResolved);
}

/** The homepage's three-slot timeline from those events. */
export function packageWhatsNext(events: ResolvedLeagueEvent[], referenceDate: Date, leagueYear: number): WhatsNextTimeline {
  return selectWhatsNextTimeline(events, referenceDate, leagueYear);
}
