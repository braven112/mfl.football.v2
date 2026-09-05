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
   * True when `players` is a submitted lineup. False when no lineup could be
   * read and the whole roster stands in — the UI says so, because a bench
   * player is a weaker reason to watch than a starter.
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
  /** Your players in this game, summed across the enabled leagues. */
  starterCount: number;
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
  let projTotal = 0;

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
    starterCount += players.length;
    projTotal += leagueProj;
  }

  return { kind: 'game', game: { ...game, away, home }, starterCount, projTotal: round1(projTotal), byLeague };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function comparatorFor(rankBy: SlateRankBy) {
  return (a: GameBox, b: GameBox): number => {
    const primary = rankBy === 'starters'
      ? (b.starterCount - a.starterCount) || (b.projTotal - a.projTotal)
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
    const relevant = all.filter((b) => b.starterCount > 0).sort(compare);
    const boxes: SlateBox[] = relevant.slice(0, boxesPerWindow);
    if (boxes.length < boxesPerWindow) boxes.push({ kind: 'redzone' });
    windows.push({
      window,
      label: WINDOW_LABELS[window],
      scheduled: all.length,
      boxes,
      overflow: relevant.slice(boxesPerWindow),
    });
  }

  const other = byWindow.other
    .filter((b) => b.starterCount > 0)
    .sort((a, b) => a.game.kickoff - b.game.kickoff || a.game.id.localeCompare(b.game.id));

  return { windows, other, personalized: input.personalized, boxesPerWindow };
}
