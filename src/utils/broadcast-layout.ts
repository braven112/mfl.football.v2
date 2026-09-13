/**
 * How the board arranges itself — density, the drop ladder, and strip paging.
 *
 * PURE, so the arithmetic that decides what an owner can actually READ from
 * ten feet is testable without a DOM. The rule these functions enforce is the
 * design contract's floor: **nothing shrinks below legibility to fit**. When
 * there is not enough room, elements are DROPPED in a fixed order and the
 * survivors keep their size.
 */

import type { BroadcastLeaguePanel, BroadcastTeamScore } from '../types/live-broadcast';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../types/live-scoring';
import type { MomentSide } from './broadcast-moments';
import { NFL_GAME_SECONDS } from './live-win-probability';
import { resolveGameState } from './live-scoring-view';
import { nflGameStateFromSeconds } from './live-scoring-view';

/** Density tier, 1 (roomiest) to 5 (tightest). Drives the grid and type scale. */
export type DensityTier = 1 | 2 | 3 | 4 | 5;

/**
 * Tier from the number of MATCHUP CELLS — not leagues. A doubleheader league
 * contributes two cells to the count while occupying one panel, because two
 * matchups' worth of numbers is what has to fit whichever panel they share.
 */
export function densityTier(cellCount: number): DensityTier {
  if (cellCount <= 1) return 1;
  if (cellCount === 2) return 2;
  if (cellCount <= 4) return 3;
  if (cellCount <= 6) return 4;
  return 5;
}

/**
 * The drop ladder, in order. Each rung removes one element entirely rather
 * than shrinking it.
 *
 * The ordering is an editorial judgement about what an owner is actually
 * asking the screen: the win-probability NUMBER goes before its bar (a split
 * bar reads at ten feet; two digits do not), the word "Proj" goes before the
 * number it labels, and the projected final is last to go because it is the
 * only thing on the cell that says where the matchup is HEADING.
 *
 * `oppytp` used to be rung ONE, on the reasoning that the real question is
 * "how much is left for ME". It isn't: a lead means nothing without the other
 * side's count next to it, and a board at four cells — two leagues with a
 * doubleheader each, the ordinary Sunday — dropped it at tier 3 and printed a
 * bare "1 to play" that read as the MATCHUP's, not one team's (owner,
 * 2026-09-13). Both counts now ride their own team's row and the rung only
 * fires at tier 4, where the cell genuinely cannot carry two.
 *
 * My score, the opponent's score and the lead indicator are on no rung. If
 * those three cannot fit, the league does not belong on this television.
 */
export const DROP_LADDER = [
  'wplabel',
  'projword',
  'oppytp',
  'clock',
  'proj',
  'wpbar',
] as const;

export type DropRung = (typeof DROP_LADDER)[number];

/** Which rungs are dropped at a tier. */
export function dropsForTier(tier: DensityTier): DropRung[] {
  // Tier 1-2 drop nothing; each tier past that takes the next rungs.
  const counts: Record<DensityTier, number> = { 1: 0, 2: 0, 3: 2, 4: 4, 5: 6 };
  return DROP_LADDER.slice(0, counts[tier]);
}

/** The class list the header carries for a tier. */
export function dropClasses(tier: DensityTier): string {
  return dropsForTier(tier)
    .map((rung) => `is-drop-${rung}`)
    .join(' ');
}

/** Which name form survives at a tier. */
export function nameContext(tier: DensityTier): 'default' | 'short' | 'abbrev' {
  if (tier <= 2) return 'default';
  if (tier <= 4) return 'short';
  return 'abbrev';
}

/** Total matchup cells across every panel on the board. */
export function countCells(panels: readonly BroadcastLeaguePanel[]): number {
  return panels.reduce((n, p) => n + Math.max(1, p.matchups.length), 0);
}

// ── how many leagues get a full-size panel ─────────────────────────────────

/**
 * The most matchup CELLS the board draws at full size.
 *
 * Four, and it is a legibility number rather than a round one: the header is
 * 36% of the board and the grid gives five or six panels two rows of three, at
 * which point a cell's score is sized against a third of a third of the
 * screen. An owner in six leagues was getting six equally unreadable ones.
 *
 * CELLS, not leagues — the same distinction `densityTier` makes. A
 * doubleheader league is one panel and two games' worth of numbers, and it is
 * the numbers that have to fit.
 */
export const MAX_FEATURED_CELLS = 4;

/**
 * The most PANELS the header grid can lay out, expanded or not.
 *
 * The stylesheet declares columns and rows for one through eight and stops
 * there — deliberately, because the rows are explicit so a panel cannot grow
 * past the header's fixed height and paint over the strip beneath it. A ninth
 * panel therefore lands in an implicit row inside a fixed-height,
 * `overflow: hidden` box and is simply not drawn, which means "Show all
 * leagues" would quietly show eight of nine. Anything past this stays on the
 * compact row, where it is at least legible.
 *
 * A cap in CELLS (`MAX_FEATURED_CELLS`) and a cap in PANELS are different
 * limits answering different questions: the first is what a viewer can read
 * from ten feet, the second is what the grid can physically place.
 */
export const MAX_GRID_PANELS = 8;

/** The board's two shelves: full-size panels, and the compact overflow row. */
export interface PanelSplit {
  /** Drawn as full panels in the header grid. Never empty. */
  featured: BroadcastLeaguePanel[];
  /** Drawn as one thin row of scores beneath them. */
  compact: BroadcastLeaguePanel[];
}

/**
 * Split the enabled panels into the full-size grid and the compact row.
 *
 * Three rules, in order:
 *
 *  1. **A home league is never demoted.** TheLeague and the AFL are the
 *     leagues this site manages and the reason the board exists; an owner who
 *     adds four outside leagues must not push his own week into a 4vh row.
 *     Two home leagues on a doubleheader week is exactly four cells, so this
 *     rule can consume the budget but never exceed it.
 *  2. **The rest fill the remaining slots**, in board order, up to
 *     `maxCells`. A panel is never SPLIT across the two shelves: a
 *     doubleheader's two games are one league's week and they stay together.
 *  3. **Fill-in, not stop-at-first-miss.** A two-cell panel that does not fit
 *     is passed over for a later one-cell panel rather than stranding the last
 *     slot empty — the owner asked for four games and there are four to show.
 *
 * `featured` is never empty: the first panel is featured even when it alone
 * exceeds the budget, because a board whose whole header is a compact row has
 * nothing on it worth reading from ten feet.
 *
 * Pass `Number.POSITIVE_INFINITY` for the expanded view: the same home-first
 * ordering with nothing demoted for its SIZE — but `MAX_GRID_PANELS` still
 * holds, because that one is not a judgement about legibility, it is what the
 * grid can place at all.
 */
export function splitPanels(
  panels: readonly BroadcastLeaguePanel[],
  maxCells: number = MAX_FEATURED_CELLS,
): PanelSplit {
  // Home leagues first, each group keeping the board's own order.
  const ordered = [
    ...panels.filter((p) => p.home),
    ...panels.filter((p) => !p.home),
  ];

  const featured: BroadcastLeaguePanel[] = [];
  const compact: BroadcastLeaguePanel[] = [];
  let cells = 0;

  for (const panel of ordered) {
    const n = Math.max(1, panel.matchups.length);
    // The grid's own ceiling, checked before anything else — a home league is
    // never demoted for its size, but a ninth panel is not drawn at all.
    const fits = featured.length < MAX_GRID_PANELS;
    if (fits && (panel.home || featured.length === 0 || cells + n <= maxCells)) {
      featured.push(panel);
      cells += n;
    } else {
      compact.push(panel);
    }
  }

  return { featured, compact };
}

// ── the rotating strip ─────────────────────────────────────────────────────

/** One row of the strip, fully resolved for rendering. */
export interface StripRow {
  key: string;
  leagueId: string;
  leagueName: string;
  side: MomentSide;
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /** The owner's franchise crest in this league — which team he is on. */
  crest: string;
  /**
   * Outline colour for `crest`, set only when that art is a LIGHT cut.
   *
   * Easy to leave off, and the most expensive place to: the strip is the
   * crest surface VISIBLE MOST OF THE AFTERNOON, so a light franchise cut
   * with no ring is the failure showing the longest.
   */
  crestStroke?: string;
  points: number;
  /** Real ESPN clock where we have the game; MFL's state where we do not. */
  clock: string;
  state: 'not-started' | 'in-progress' | 'final';
}

/** A page of the strip. */
export interface StripPage {
  key: string;
  /** 'mine' pages mix every league; 'theirs' pages are one league's opponent. */
  kind: MomentSide;
  label: string;
  rows: StripRow[];
}

/**
 * Order within a page: what is happening NOW, then what is still to come, then
 * what is done.
 *
 * Page 0 is therefore always "the players that matter most right now", which
 * is the only ordering that makes a rotating strip useful rather than merely
 * complete — an owner who glances up once should not have to wait three pages
 * for the man whose game is in the fourth quarter.
 */
function compareRows(a: StripRow, b: StripRow): number {
  const rank = (r: StripRow) => (r.state === 'in-progress' ? 0 : r.state === 'not-started' ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.points !== b.points) return b.points - a.points;
  // Stable tail: an all-zero pre-kickoff strip must not reorder itself between
  // polls purely on sort instability.
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export interface BuildStripInput {
  panels: readonly BroadcastLeaguePanel[];
  scores: Record<string, Record<string, BroadcastTeamScore>>;
  meta: Record<string, PlayerMeta>;
  games: readonly NflGame[];
  rowsPerPage: number;
}

/** Resolve one franchise's starters into strip rows. */
function rowsFor(
  rows: readonly LivePlayerRow[],
  meta: Record<string, PlayerMeta>,
  games: readonly NflGame[],
  ctx: { leagueId: string; leagueName: string; side: MomentSide; crest: string; crestStroke?: string },
): StripRow[] {
  const byTeam = new Map<string, NflGame>();
  for (const g of games) {
    byTeam.set(g.home.code, g);
    byTeam.set(g.away.code, g);
  }

  return rows.map((row) => {
    const who = meta[row.id];
    const game = who?.nflTeam ? byTeam.get(who.nflTeam) : undefined;
    const state = resolveGameState(nflGameStateFromSeconds(row.secondsRemaining), game);
    return {
      key: `${ctx.leagueId}:${ctx.side}:${row.id}`,
      leagueId: ctx.leagueId,
      leagueName: ctx.leagueName,
      side: ctx.side,
      playerId: row.id,
      name: who?.name ?? `Player ${row.id}`,
      position: who?.position ?? '',
      nflTeam: who?.nflTeam ?? '',
      headshot: who?.headshot ?? '',
      crest: ctx.crest,
      ...(ctx.crestStroke ? { crestStroke: ctx.crestStroke } : {}),
      points: row.live,
      // The clock is ESPN's or it is a STATE word. Never a number derived from
      // MFL's `gameSecondsRemaining`, which does not tick and drifts all
      // afternoon into a confident-looking lie.
      clock: game
        ? game.state === 'post'
          ? 'Final'
          : game.state === 'pre'
            ? 'Yet to play'
            : game.shortDetail || 'In progress'
        : state === 'final'
          ? 'Final'
          : state === 'not-started'
            ? 'Yet to play'
            : 'In progress',
      state,
    };
  });
}

/**
 * Build the strip's pages.
 *
 * `mine` pages come first and are interleaved with a `theirs` page every
 * third, so the board spends most of its time on the owner's own players
 * without ever letting him forget what is happening to him.
 */
export function buildStripPages(input: BuildStripInput): StripPage[] {
  const { panels, scores, meta, games, rowsPerPage } = input;
  if (rowsPerPage <= 0) return [];

  const mine: StripRow[] = [];
  const theirs: { label: string; rows: StripRow[] }[] = [];

  for (const panel of panels) {
    const leagueScores = scores[panel.leagueId] ?? {};
    const mineScore = leagueScores[panel.franchiseId];
    if (mineScore) {
      mine.push(
        ...rowsFor(mineScore.players, meta, games, {
          leagueId: panel.leagueId,
          leagueName: panel.leagueName,
          side: 'mine',
          crest: panel.matchups[0]?.mine.iconSmall ?? '',
          crestStroke: panel.matchups[0]?.mine.iconSmallStroke,
        }),
      );
    }

    for (const matchup of panel.matchups) {
      const opp = matchup.opponent;
      if (!opp) continue;
      const oppScore = leagueScores[opp.franchiseId];
      if (!oppScore) continue;
      theirs.push({
        label: `${panel.leagueName} · ${opp.nameShort || opp.name}`,
        rows: rowsFor(oppScore.players, meta, games, {
          leagueId: panel.leagueId,
          leagueName: panel.leagueName,
          side: 'opponent',
          crest: opp.iconSmall,
          crestStroke: opp.iconSmallStroke,
        }),
      });
    }
  }

  mine.sort(compareRows);

  const minePages: StripPage[] = [];
  for (let i = 0; i < mine.length; i += rowsPerPage) {
    minePages.push({
      key: `mine:${i}`,
      kind: 'mine',
      label: 'Your players',
      rows: mine.slice(i, i + rowsPerPage),
    });
  }

  const theirsPages: StripPage[] = theirs.flatMap((block, b) => {
    const sorted = [...block.rows].sort(compareRows);
    const out: StripPage[] = [];
    for (let i = 0; i < sorted.length; i += rowsPerPage) {
      out.push({
        key: `theirs:${b}:${i}`,
        kind: 'opponent',
        label: block.label,
        rows: sorted.slice(i, i + rowsPerPage),
      });
    }
    return out;
  });

  // Interleave: two of mine, then one of theirs.
  const pages: StripPage[] = [];
  let m = 0;
  let t = 0;
  while (m < minePages.length || t < theirsPages.length) {
    for (let k = 0; k < 2 && m < minePages.length; k += 1, m += 1) pages.push(minePages[m]);
    if (t < theirsPages.length) {
      pages.push(theirsPages[t]);
      t += 1;
    }
    // Nothing of mine left and nothing of theirs left — done.
    if (m >= minePages.length && t >= theirsPages.length) break;
  }

  return pages;
}

/**
 * Pad a page to a fixed row count so the strip never changes height.
 *
 * A strip that grows and shrinks between pages reads as the layout breaking,
 * which on an unattended television is indistinguishable from the board
 * actually breaking.
 */
export function padPage(page: StripPage, rowsPerPage: number): (StripRow | null)[] {
  const out: (StripRow | null)[] = [...page.rows];
  while (out.length < rowsPerPage) out.push(null);
  return out.slice(0, rowsPerPage);
}

/** One quarter, in seconds. */
const QUARTER_SECONDS = 900;

/**
 * ESPN's `displayClock` ("4:08", "0:47") as seconds.
 *
 * Anything that does not parse is 0 rather than a guess — a missing clock on a
 * live game means we know the QUARTER and not the time inside it, and counting
 * the quarter as untouched would overstate what is left.
 */
export function parseDisplayClock(clock: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(clock ?? '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Real NFL seconds still to be played in ONE game.
 *
 * ESPN's `period` + `displayClock` is the only source that ticks. `fallback`
 * is MFL's `gameSecondsRemaining`, used ONLY for a player whose game did not
 * resolve at all (a bye, an unmapped team code, a failed scoreboard fetch) —
 * it lags all afternoon, which is why it is never allowed to print a clock on
 * its own.
 *
 * Overtime returns only what OT has left: a 5th period is not a 5th quarter,
 * and treating it as one hands the matchup fifteen minutes that cannot exist.
 */
export function gameSecondsLeft(game: NflGame | undefined, fallback: number): number {
  if (!game) return Math.min(NFL_GAME_SECONDS, Math.max(0, fallback));
  if (game.state === 'post') return 0;
  if (game.state === 'pre') return NFL_GAME_SECONDS;
  const inQuarter = parseDisplayClock(game.clock);
  if (game.period >= 5) return inQuarter;
  const quartersAfter = Math.max(0, 4 - Math.max(1, game.period));
  return quartersAfter * QUARTER_SECONDS + inQuarter;
}

/** "1st" … "4th". */
function ordinal(quarter: number): string {
  return ['1st', '2nd', '3rd', '4th'][Math.min(3, Math.max(0, quarter - 1))];
}

/**
 * A fraction of one game still to play, printed as a position on ONE game clock.
 *
 * Half the matchup's football left reads "2nd 15:00 left"; a quarter of it,
 * "4th 15:00 left". Nothing left is "Final".
 */
export function progressClockLabel(fractionLeft: number): string {
  const secs = Math.round(Math.min(1, Math.max(0, fractionLeft)) * NFL_GAME_SECONDS);
  if (secs <= 0) return 'Final';
  const quarter = 5 - Math.ceil(secs / QUARTER_SECONDS);
  const inQuarter = secs - (4 - quarter) * QUARTER_SECONDS;
  const mm = Math.floor(inQuarter / 60);
  const ss = String(inQuarter % 60).padStart(2, '0');
  return `${ordinal(quarter)} ${mm}:${ss} left`;
}

/**
 * How much football this matchup has left, as one clock.
 *
 * A fantasy matchup spans up to eighteen NFL games, so "the game clock" is not
 * a single fact about it. This used to name the ONE game most of the viewer's
 * starters were in — which late on a Sunday is whichever game kicked off last,
 * so a board whose owner had a single starter left in the night game printed
 * "1:33 - 1st" while every other game on it was over (owner, 2026-09-13). The
 * string was ESPN's and it was true of that game; it was not true of anything
 * the cell was showing.
 *
 * So: SUM the real seconds left across every starter in the matchup, divide by
 * the seconds those starters started with, and print that fraction as a
 * position on one 60-minute clock. It is a MATCHUP meter, not a game clock,
 * and it is spelled so it cannot be read as one — ESPN prints "4:08 - 3rd",
 * this prints "3rd 4:08 left".
 *
 * The rule this does NOT break: the numbers come from ESPN's `period` and
 * `displayClock`, which tick. MFL's `gameSecondsRemaining` is the per-player
 * fallback for a game that did not resolve, never the source of the clock.
 */
export function matchupTimeLeft(
  rows: readonly LivePlayerRow[],
  games: readonly NflGame[],
  meta: Record<string, PlayerMeta>,
): string {
  if (rows.length === 0) return '';

  const byTeam = new Map<string, NflGame>();
  for (const g of games) {
    byTeam.set(g.home.code, g);
    byTeam.set(g.away.code, g);
  }

  let left = 0;
  for (const row of rows) {
    const team = meta[row.id]?.nflTeam;
    left += gameSecondsLeft(team ? byTeam.get(team) : undefined, row.secondsRemaining);
  }
  return progressClockLabel(left / (rows.length * NFL_GAME_SECONDS));
}
