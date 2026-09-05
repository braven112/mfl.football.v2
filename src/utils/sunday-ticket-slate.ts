/**
 * Sunday Ticket slate — which games go in the four multiview boxes, and why.
 *
 * PURE. Takes the week's NFL games and one "contribution" per fantasy league
 * the owner plays in (their starters, with that league's projections), and
 * returns the two Sunday windows as ranked boxes. Nothing here reads a feed,
 * a clock, a session or a league config — the page assembles those
 * (`sunday-ticket-sources.ts`) and the components render the result, which is
 * what lets the components story and this function unit-test directly.
 * The old spec's tests exercised a hand copy of the component's logic, so
 * they stayed green while the component itself rendered nowhere.
 *
 * Cross-league rules (docs/plans/sunday-ticket.md):
 *  - A game's rank is its STARTER COUNT summed across the enabled leagues,
 *    with summed projections as the tiebreak. Projections are not comparable
 *    across leagues (every league scores differently), so they never lead.
 *    A player rostered in two leagues counts once per league — that is two
 *    reasons to watch, not one.
 *  - The box rule: `min(N, 4)` relevant games per window, plus one RedZone
 *    box whenever fewer than four of your games are on. A game with none of
 *    your starters never fills a box; RedZone does.
 *  - Only Sunday-afternoon kickoffs are Sunday Ticket. Thursday, Saturday,
 *    the London morning game, SNF and MNF are national broadcasts — they are
 *    returned separately in `other` so the page can list them without
 *    claiming they are on the package.
 */

import { normalizeTeamCode } from './nfl-logo';

export type SundayWindow = 'early' | 'late';

/** One NFL game on the week's slate, codes already canonical. */
export interface SlateGame {
  /** `${away}@${home}` — stable across MFL and ESPN. */
  id: string;
  /** Kickoff, epoch seconds (MFL's `nflSchedule.matchup[].kickoff`). */
  kickoff: number;
  away: string;
  home: string;
  /** National network (CBS / FOX / NBC / …) from ESPN, when known. */
  broadcast?: string;
}

/** One of the owner's players, as one league sees him. */
export interface ContributionPlayer {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot?: string;
  /** That league's projection for the week; 0 when the league has none. */
  proj: number;
}

/** What one fantasy league adds to the board. */
export interface LeagueContribution {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  franchiseName: string;
  /**
   * True when `players` are starters — a submitted lineup, or a best-ball
   * roster (no lineups; everyone plays). False when no lineup could be read
   * and the whole roster stands in: those players are SHOWN but never RANK,
   * because an unreadable league's 20-man roster must not outrank a league
   * whose nine starters are known.
   */
  lineupResolved: boolean;
  players: ContributionPlayer[];
}

export interface BoxLeagueGroup {
  leagueId: string;
  leagueName: string;
  franchiseName: string;
  lineupResolved: boolean;
  /** Sorted by projection, high to low. */
  players: ContributionPlayer[];
  projTotal: number;
}

export interface GameBox {
  kind: 'game';
  game: SlateGame;
  /** Your STARTERS in this game, summed across the enabled leagues (resolved lineups and best-ball rosters only). */
  starterCount: number;
  /** Your players in this game from leagues whose lineup could not be read — shown, never ranked. */
  rosterCount: number;
  /** Projected points of the STARTERS only — the tiebreak when ranking by starters. */
  starterProjTotal: number;
  projTotal: number;
  byLeague: BoxLeagueGroup[];
}

export interface RedZoneBox {
  kind: 'redzone';
}

export type SlateBox = GameBox | RedZoneBox;

export interface WindowSlate {
  window: SundayWindow;
  label: string;
  /** Earliest kickoff scheduled in the window (epoch seconds) — what the header clocks show. */
  kickoff: number;
  /** How many NFL games kick off in this window at all. */
  scheduled: number;
  boxes: SlateBox[];
  /** Relevant games ranked below the boxes — the "also worth a flip" list. */
  overflow: GameBox[];
}

export interface SundayTicketSlate {
  /** Early then late; a window with nothing scheduled is omitted. */
  windows: WindowSlate[];
  /** Your games outside the Sunday-afternoon windows, chronological. */
  other: GameBox[];
  personalized: boolean;
  boxesPerWindow: number;
}

/** How the boxes rank: by your starters (personal) or by total points (league-wide). */
export type SlateRankBy = 'starters' | 'points';

export interface BuildSlateInput {
  games: SlateGame[];
  contributions: LeagueContribution[];
  /** Leagues whose chips are on. Omit for all. */
  enabledLeagueIds?: Iterable<string>;
  /** True when `contributions` are a real owner's; false for the league-wide fallback. */
  personalized: boolean;
  /** Defaults to 'starters' when personalized, else 'points'. */
  rankBy?: SlateRankBy;
  boxesPerWindow?: number;
}

export const DEFAULT_BOXES_PER_WINDOW = 4;

export const WINDOW_LABELS: Record<SundayWindow, string> = {
  early: '1:00 PM ET · 10:00 AM PT',
  late: '4:05 / 4:25 PM ET · 1:05 / 1:25 PM PT',
};

// ── Kickoff classification ───────────────────────────────────────────────

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Weekday + hour of a kickoff in Eastern time, which is how the NFL schedules windows. */
export function kickoffInEastern(kickoffEpoch: number): { weekday: string; hour: number } {
  const parts = ET_FORMAT.formatToParts(new Date(kickoffEpoch * 1000));
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  return { weekday, hour: Number.isFinite(hour) ? hour : -1 };
}

/**
 * Sunday 1pm ET block → early; Sunday 4pm ET block → late; everything else
 * (TNF, Saturday, the 9:30am ET London game, SNF, MNF) → other.
 */
export function classifyKickoff(kickoffEpoch: number): SundayWindow | 'other' {
  const { weekday, hour } = kickoffInEastern(kickoffEpoch);
  if (weekday !== 'Sun') return 'other';
  if (hour >= 13 && hour < 16) return 'early';
  if (hour >= 16 && hour < 20) return 'late';
  return 'other';
}

// ── Slate games from the MFL schedule (+ ESPN broadcast) ─────────────────

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export interface BroadcastLookup {
  away: string;
  home: string;
  broadcast?: string;
}

/**
 * Pick one week's matchups out of the committed `nflSchedule.json`, which
 * has TWO shapes: a live in-season feed carries only the current week under
 * `nflSchedule.matchup`, a synced/completed season only the full archive
 * under `fullNflSchedule.nflSchedule[week - 1].matchup`. The live shape may
 * carry `nflSchedule.week`; when it does and it is not the week asked for,
 * the answer is "no games", not another week's games wearing this week's
 * header. Same dual-source spine as MatchupPreviewHero.
 */
export function selectWeekMatchups(scheduleFeed: any, week: number): any[] {
  const feed = scheduleFeed?.default ?? scheduleFeed;
  const archive = feed?.fullNflSchedule?.nflSchedule;
  if (archive) {
    const weeks = asArray<any>(archive);
    const entry = weeks[week - 1];
    return asArray<any>(entry?.matchup);
  }
  const live = feed?.nflSchedule;
  if (!live) return [];
  const liveWeek = parseInt(live.week ?? '', 10);
  if (Number.isFinite(liveWeek) && liveWeek !== week) return [];
  return asArray<any>(live.matchup);
}

/**
 * MFL matchups → slate games, with the network merged in from ESPN by team
 * pair. Kickoff comes from MFL only (it is the game-lock clock everywhere
 * else on the site); ESPN is enrichment. A matchup without a kickoff is
 * dropped — it cannot be placed in a window.
 */
export function buildSlateGames(matchups: unknown, broadcasts: ReadonlyArray<BroadcastLookup> = []): SlateGame[] {
  const networkByPair = new Map<string, string>();
  for (const b of broadcasts) {
    if (!b.broadcast) continue;
    networkByPair.set(`${normalizeTeamCode(b.away)}@${normalizeTeamCode(b.home)}`, b.broadcast);
  }

  const games: SlateGame[] = [];
  for (const m of asArray<any>(matchups)) {
    const kickoff = parseInt(m?.kickoff ?? '', 10);
    if (!Number.isFinite(kickoff) || kickoff <= 0) continue;
    const teams = asArray<any>(m?.team);
    const homeRaw = teams.find((t) => t?.isHome === '1') ?? teams[1];
    const awayRaw = teams.find((t) => t?.isHome === '0') ?? teams[0];
    const home = normalizeTeamCode(homeRaw?.id ?? '');
    const away = normalizeTeamCode(awayRaw?.id ?? '');
    if (!home || !away) continue;
    const id = `${away}@${home}`;
    const broadcast = networkByPair.get(id);
    games.push(broadcast ? { id, kickoff, away, home, broadcast } : { id, kickoff, away, home });
  }
  return games.sort((a, b) => a.kickoff - b.kickoff || a.id.localeCompare(b.id));
}

// ── The slate ────────────────────────────────────────────────────────────

function boxFor(game: SlateGame, contributions: LeagueContribution[]): GameBox {
  const away = normalizeTeamCode(game.away);
  const home = normalizeTeamCode(game.home);
  const byLeague: BoxLeagueGroup[] = [];
  let starterCount = 0;
  let rosterCount = 0;
  let projTotal = 0;
  let starterProjTotal = 0;

  for (const c of contributions) {
    const players = c.players
      .filter((p) => {
        const team = normalizeTeamCode(p.nflTeam);
        return team === away || team === home;
      })
      .sort((a, b) => b.proj - a.proj || a.name.localeCompare(b.name));
    if (players.length === 0) continue;
    const leagueProj = players.reduce((sum, p) => sum + (Number.isFinite(p.proj) ? p.proj : 0), 0);
    byLeague.push({
      leagueId: c.leagueId,
      leagueName: c.leagueName,
      franchiseName: c.franchiseName,
      lineupResolved: c.lineupResolved,
      players,
      projTotal: round1(leagueProj),
    });
    if (c.lineupResolved) {
      starterCount += players.length;
      starterProjTotal += leagueProj;
    } else {
      rosterCount += players.length;
    }
    projTotal += leagueProj;
  }

  return {
    kind: 'game',
    game: { ...game, away, home },
    starterCount,
    rosterCount,
    projTotal: round1(projTotal),
    starterProjTotal: round1(starterProjTotal),
    byLeague,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function comparatorFor(rankBy: SlateRankBy) {
  return (a: GameBox, b: GameBox): number => {
    // Ranking by starters never lets a roster standing in for an unread
    // lineup steer the order — not even as the tiebreak.
    const primary = rankBy === 'starters'
      ? (b.starterCount - a.starterCount) || (b.starterProjTotal - a.starterProjTotal) || (b.rosterCount - a.rosterCount)
      : (b.projTotal - a.projTotal) || (b.starterCount - a.starterCount);
    return primary || (a.game.kickoff - b.game.kickoff) || a.game.id.localeCompare(b.game.id);
  };
}

export function buildSundayTicketSlate(input: BuildSlateInput): SundayTicketSlate {
  const boxesPerWindow = input.boxesPerWindow ?? DEFAULT_BOXES_PER_WINDOW;
  const rankBy: SlateRankBy = input.rankBy ?? (input.personalized ? 'starters' : 'points');
  const enabled = input.enabledLeagueIds ? new Set(input.enabledLeagueIds) : null;
  const contributions = enabled
    ? input.contributions.filter((c) => enabled.has(c.leagueId))
    : input.contributions;

  const byWindow: Record<SundayWindow | 'other', GameBox[]> = { early: [], late: [], other: [] };
  for (const game of input.games) {
    byWindow[classifyKickoff(game.kickoff)].push(boxFor(game, contributions));
  }

  const compare = comparatorFor(rankBy);
  const windows: WindowSlate[] = [];
  for (const window of ['early', 'late'] as const) {
    const all = byWindow[window];
    if (all.length === 0) continue;
    const relevant = all.filter((b) => b.starterCount + b.rosterCount > 0).sort(compare);
    const boxes: SlateBox[] = relevant.slice(0, boxesPerWindow);
    if (boxes.length < boxesPerWindow) boxes.push({ kind: 'redzone' });
    windows.push({
      window,
      label: WINDOW_LABELS[window],
      kickoff: Math.min(...all.map((b) => b.game.kickoff)),
      scheduled: all.length,
      boxes,
      overflow: relevant.slice(boxesPerWindow),
    });
  }

  const other = byWindow.other
    .filter((b) => b.starterCount + b.rosterCount > 0)
    .sort((a, b) => a.game.kickoff - b.game.kickoff || a.game.id.localeCompare(b.game.id));

  return { windows, other, personalized: input.personalized, boxesPerWindow };
}

// ── Kickoff display ──────────────────────────────────────────────────────

const timeIn = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
const dayIn = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/** "Sun · 1:00 PM ET · 10:00 AM PT" as parts. The league's clock is PT; the NFL's is ET; owners are in both. */
export function formatKickoff(kickoffEpoch: number): { day: string; et: string; pt: string } {
  const d = new Date(kickoffEpoch * 1000);
  return {
    day: dayIn.format(d),
    et: timeIn('America/New_York').format(d),
    pt: timeIn('America/Los_Angeles').format(d),
  };
}

// ── Kickoff in a viewer's own clocks ─────────────────────────────────────

export interface KickoffZoneSpec {
  zone: string;
  /** Fixed label (ET / PT) or 'auto' for Intl's short zone name (AEST / AEDT / AWST). */
  label: string;
  locale?: string;
}

export interface KickoffInZone {
  label: string;
  time: string;
  /** Short weekday in that zone — a Sunday 1pm ET kickoff is Monday morning in Sydney. */
  day: string;
  /** True when the zone's weekday differs from the game's own (Eastern) day — show it. */
  dayDiffers: boolean;
}

/**
 * One kickoff rendered in each of a country's clocks. Times are always
 * en-US (uppercase AM/PM, the site's style); only the AUTO zone label takes
 * the zone's own locale, because en-US spells Sydney as "GMT+10" and en-AU as
 * "AEST"/"AEDT" — and the DST flip is exactly the information the label carries.
 */
export function formatKickoffZones(kickoffEpoch: number, zones: readonly KickoffZoneSpec[]): KickoffInZone[] {
  const d = new Date(kickoffEpoch * 1000);
  const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
  return zones.map((z) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: z.zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).formatToParts(d);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = part('weekday');
    // Assembled from parts: ICU 72+ puts a NARROW no-break space before the
    // day period, so joining literals would either keep U+202F or drop the gap.
    const time = `${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim();
    let label = z.label;
    if (label === 'auto') {
      const named = new Intl.DateTimeFormat(z.locale ?? 'en-US', { timeZone: z.zone, timeZoneName: 'short' }).formatToParts(d);
      label = named.find((p) => p.type === 'timeZoneName')?.value ?? z.zone;
    }
    return { label, time, day, dayDiffers: day !== etDay };
  });
}
