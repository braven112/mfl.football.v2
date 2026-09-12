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
 * asking the screen: the opponent's yet-to-play count goes before his own
 * (the real question is "how much is left for ME"), the win-probability
 * NUMBER goes before its bar (a split bar reads at ten feet; two digits do
 * not), and the projected final is last to go because it is the only thing on
 * the cell that says where the matchup is HEADING.
 *
 * My score, the opponent's score and the lead indicator are on no rung. If
 * those three cannot fit, the league does not belong on this television.
 */
export const DROP_LADDER = [
  'oppytp',
  'wplabel',
  'projword',
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
  ctx: { leagueId: string; leagueName: string; side: MomentSide; crest: string },
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

/**
 * The one real clock a matchup cell can honestly print.
 *
 * A fantasy matchup spans up to nine NFL games, so "the game clock" is not a
 * single fact about it. Rather than invent an average — the exact fabrication
 * `formatGameClock` exists to prevent — this names the game that most of the
 * viewer's starters are actually in RIGHT NOW, which is the one an owner
 * glancing up is watching.
 *
 * Returns '' when no starter is in a game being played: before kickoff and
 * after the last whistle there is no clock, and an empty string renders
 * nothing at all rather than a placeholder or a stale quarter.
 */
export function matchupGameClock(
  rows: readonly LivePlayerRow[],
  games: readonly NflGame[],
  meta: Record<string, PlayerMeta>,
): string {
  const live = games.filter((g) => g.state === 'in');
  if (live.length === 0 || rows.length === 0) return '';

  const counts = new Map<string, number>();
  for (const row of rows) {
    const team = meta[row.id]?.nflTeam;
    if (!team) continue;
    const game = live.find((g) => g.home.code === team || g.away.code === team);
    if (!game) continue;
    counts.set(game.id, (counts.get(game.id) ?? 0) + 1);
  }
  if (counts.size === 0) return '';

  // Most of my starters first; ties broken on the game id so two polls of
  // identical data never swap the cell's clock back and forth.
  const [bestId] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  )[0];
  const game = live.find((g) => g.id === bestId);
  // ESPN's own string ("8:12 - 3rd"), never one we assemble.
  return game?.shortDetail ?? '';
}
