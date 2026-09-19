/**
 * Building and reading the canonical live-scoring model (`src/types/live.ts`).
 *
 * Pure. No fetching, no DOM, no Astro — everything here is testable without a
 * browser or a network, which is the same split that makes
 * `live-scoring-view.ts` and `broadcast-layout.ts` testable.
 *
 * The accessors exist so that no call site ever indexes `sides` by a literal.
 * A board with a viewer asks for `viewerTeam`/`opponentTeam` and gets what it
 * has today; a board without one renders `sides[0]`/`sides[1]` neutrally. See
 * `src/types/live.ts` for why the pairing itself carries no claim.
 */

import type { LivePlayerRow, PlayerMeta } from '../../types/live-scoring';
import type { LiveMatchup, LiveMoment, LiveTeam } from '../../types/live';
import type { TeamTotals } from '../live-scoring-view';
import { winProbability } from '../live-win-probability';
import { orderLineupRows } from '../mfl-live-lineup';
import {
  identityIconAlt,
  type FranchiseColorClaim,
  type FranchiseIdentity,
} from '../mfl-live-identity';
import { resolveTeamColorPair } from '../team-color-contrast';
import { groundsFor, type LiveSurface } from './surface';

/* ── reading a matchup ───────────────────────────────────────────────────── */

/**
 * Probability that `side` wins, 0-1.
 *
 * `p0` is stated for side 0, so side 1's is its complement. Going through this
 * rather than writing `1 - p0` at each call site is what stops a board
 * rendering one side's number under the other side's name — the two boards
 * this model replaces expressed the same quantity from three different
 * reference points between them.
 */
export function winProbabilityFor(matchup: LiveMatchup, side: 0 | 1): number {
  return side === 0 ? matchup.p0 : 1 - matchup.p0;
}

/** True when the viewer owns a side of this pairing. */
export function isViewerMatchup(matchup: LiveMatchup): boolean {
  return matchup.viewerSide !== null;
}

/** The viewer's team, or null when this pairing is nobody's. */
export function viewerTeam(matchup: LiveMatchup): LiveTeam | null {
  return matchup.viewerSide === null ? null : matchup.sides[matchup.viewerSide];
}

/** The team facing the viewer, or null when this pairing is nobody's. */
export function opponentTeam(matchup: LiveMatchup): LiveTeam | null {
  return matchup.viewerSide === null ? null : matchup.sides[matchup.viewerSide === 0 ? 1 : 0];
}

/** The viewer's own win probability, or null when this pairing is nobody's. */
export function viewerWinProbability(matchup: LiveMatchup): number | null {
  return matchup.viewerSide === null ? null : winProbabilityFor(matchup, matchup.viewerSide);
}

/**
 * The order a card renders its two sides in.
 *
 * A pure presentation choice, kept out of the data so the same payload serves
 * both boards: MFL Live puts the viewer's own team first (it is a board OF your
 * teams), while a league board keeps MFL's pairing order (most of its cards
 * are nobody's, and reordering only some of them reads as inconsistent).
 */
export function renderOrder(
  matchup: LiveMatchup,
  viewerFirst: boolean,
): [0 | 1, 0 | 1] {
  if (viewerFirst && matchup.viewerSide === 1) return [1, 0];
  return [0, 1];
}

/* ── board order ─────────────────────────────────────────────────────────── */

/** One panel's matchups, split into the ones that lead the board and the rest. */
export interface OrderedMatchups {
  /** Rendered large, at the top. The viewer's own, or one promoted filler. */
  featured: LiveMatchup[];
  /** Everything else, closest game first. */
  rest: LiveMatchup[];
  /**
   * Whether `featured` is genuinely the viewer's. Only a real one earns the
   * "YOUR MATCHUP" badge — a promoted closest-game filler must not claim it.
   */
  hasYours: boolean;
}

/**
 * A stable identity for a pairing, independent of the order MFL sent it in.
 *
 * MFL returns arrays in nondeterministic order, so the feed index is not a
 * tiebreak — two matchups at the same margin could swap places between two
 * polls of an unchanged board. The sorted franchise-id pair cannot.
 *
 * EXPORTED because it is also the board's SELECTION IDENTITY. A drill-in must
 * store what a matchup IS, never the matchup object: `LiveMatchup` carries its
 * own scores, projections and player rows, so a stored object freezes the
 * screen at the moment it was opened while the board keeps polling behind it.
 * `index` cannot serve either — it is a position in the feed's own order and
 * that order is nondeterministic, so it can point at a different matchup after
 * a poll. The franchise pair is the only thing that survives both.
 */
export function pairingKey(matchup: LiveMatchup): string {
  return [matchup.sides[0].franchiseId, matchup.sides[1].franchiseId].sort().join(':');
}

/**
 * Split a panel into featured and rest, closest game first.
 *
 * Three rules, each with a reason:
 *
 *  - **The viewer's matchups lead**, and a doubleheader puts them in several,
 *    so this is a FILTER rather than a find. Membership comes from
 *    `viewerSide`, never from comparing a franchise id — both leagues have a
 *    franchise `0001`, and the reader is the only layer that knows which
 *    league a side belongs to.
 *  - **With no matchup of the viewer's, the closest game is promoted** so the
 *    board still has a lead card, but `hasYours` stays false.
 *  - **The rest sort by live margin**, ascending — the closest game is the one
 *    worth looking at. Ties break on the pairing key, so an unchanged board
 *    never reshuffles between polls.
 */
export function orderPanelMatchups(matchups: readonly LiveMatchup[]): OrderedMatchups {
  const yours = matchups.filter(isViewerMatchup);
  const others = matchups
    .filter((m) => !isViewerMatchup(m))
    .sort((a, b) => {
      const ma = Math.abs(a.sides[0].live - a.sides[1].live);
      const mb = Math.abs(b.sides[0].live - b.sides[1].live);
      if (ma !== mb) return ma - mb;
      return pairingKey(a).localeCompare(pairingKey(b));
    });

  return yours.length > 0
    ? { featured: yours, rest: others, hasYours: true }
    : { featured: others.slice(0, 1), rest: others.slice(1), hasYours: false };
}

/* ── moments ─────────────────────────────────────────────────────────────── */

/**
 * The rows one matchup's ticker should render: newest first, one row per PLAY,
 * capped.
 *
 * ── TWO DEDUPES, OPPOSITE DIRECTIONS ──────────────────────────────────────
 * The board's `moments` are keyed `playId:leagueId:franchiseId`, which is what
 * lets a QB→WR touchdown reach BOTH owners' boards and what keeps my
 * TheLeague franchise `0001` apart from an AFL franchise `0001`. Here the two
 * franchises are merged into ONE list, and the AFL's conferences run duplicate
 * rosters, so both sides of a matchup legitimately start the same player — the
 * identical line then appears twice in a row with no attribution anywhere in
 * the ticker to tell them apart, carrying no information at all. That shipped
 * for five of 24 AFL matchups. So: `playId` dedupe for RENDER.
 *
 * ── THE LEAGUE IS PART OF THE MATCH, NOT DECORATION ───────────────────────
 * A moment belongs to a franchise IN A LEAGUE. On a cross-league board,
 * matching on `franchiseId` alone would pull another league's franchise `0001`
 * into this matchup's ticker.
 */
export function selectMatchupMoments(
  moments: readonly LiveMoment[],
  leagueId: string,
  matchup: LiveMatchup,
  limit = 8,
): LiveMoment[] {
  const sides = new Set([matchup.sides[0].franchiseId, matchup.sides[1].franchiseId]);
  const seenPlays = new Set<string>();
  const out: LiveMoment[] = [];

  for (const moment of moments) {
    if (moment.leagueId !== leagueId) continue;
    if (!sides.has(moment.franchiseId)) continue;
    if (seenPlays.has(moment.playId)) continue;
    seenPlays.add(moment.playId);
    out.push(moment);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── colours ─────────────────────────────────────────────────────────────── */

/** A colour claim with its hand-picked dark variants swapped in. */
function darkClaim(claim: FranchiseColorClaim): FranchiseColorClaim {
  // A franchise that declared a dark variant gets it; everyone else keeps
  // their light value and relies on the legibility nudge inside
  // resolveTeamColorPair.
  return {
    ...claim,
    colorPrimary: claim.colorPrimaryDark ?? claim.colorPrimary,
    colorSecondary: claim.colorSecondaryDark ?? claim.colorSecondary,
  };
}

/**
 * Both franchises' colours for one matchup, as CSS custom properties, resolved
 * once per theme against THIS SURFACE's card.
 *
 * Keyed by SIDE INDEX (`--t0-*`, `--t1-*`), not by mine/theirs or home/away —
 * the same reason `sides` is. A viewer-relative alias, if a component wants
 * one, is a one-line assignment in CSS off `viewerSide`.
 *
 * `forceAdjust` + `homeVisibilityFallback` match what the live-scoring board
 * and MFL Live already pass: two franchises in one cell must be separable even
 * when their brand colours are neighbours, and a colour that cannot be made
 * visible has to fall back rather than be drawn invisible.
 */
export function resolveMatchupColorVars(
  side0: FranchiseColorClaim,
  side1: FranchiseColorClaim,
  surface: LiveSurface,
): Record<string, string> {
  const grounds = groundsFor(surface);
  const opts = { forceAdjust: true, homeVisibilityFallback: true } as const;
  const light = resolveTeamColorPair(side0, side1, { ...opts, background: grounds.light });
  const dark = resolveTeamColorPair(darkClaim(side0), darkClaim(side1), {
    ...opts,
    background: grounds.dark,
  });
  return {
    '--t0-light': light.home,
    '--t1-light': light.away,
    '--t0-dark': dark.home,
    '--t1-dark': dark.away,
  };
}

/* ── building ────────────────────────────────────────────────────────────── */

export interface BuildLiveTeamInput {
  identity: FranchiseIdentity;
  totals: TeamTotals;
  /** STARTERS, unordered as they came off the feed. */
  players: readonly LivePlayerRow[];
  /** The bench, unordered. Absent is fine — a franchise may have none. */
  bench?: readonly LivePlayerRow[];
  meta: Record<string, PlayerMeta>;
}

/**
 * One side of a matchup.
 *
 * Both lists are ordered HERE, by the same rule, so no caller can order one
 * and forget the other — and the ordering's last tiebreak is the player id
 * rather than the row's index in the feed, because MFL returns arrays in
 * nondeterministic order. Without that, an all-zero lineup (every Sunday
 * morning before kickoff) reshuffles itself between polls having changed
 * nothing.
 */
export function buildLiveTeam(input: BuildLiveTeamInput): LiveTeam {
  const { identity, totals, meta } = input;
  return {
    franchiseId: identity.franchiseId,
    name: identity.name,
    nameShort: identity.nameShort,
    initials: identity.initials,
    icon: identity.icon,
    iconAlt: identityIconAlt(identity),
    rung: identity.rung,
    live: totals.live,
    projectedFinal: totals.projectedFinal,
    remainingPoints: totals.remainingPoints,
    yetToPlay: totals.yetToPlay,
    players: orderLineupRows(input.players, meta),
    bench: orderLineupRows(input.bench ?? [], meta),
  };
}

export interface BuildLiveMatchupInput {
  index: number;
  side0: LiveTeam;
  side1: LiveTeam;
  side0Colors: FranchiseColorClaim;
  side1Colors: FranchiseColorClaim;
  surface: LiveSurface;
  /**
   * The viewer's franchise in THIS league, or null.
   *
   * League-scoped by the caller, and that is load-bearing: franchise ids
   * collide across leagues, so a session from one league must never mark a
   * side in another league's matchup as the viewer's.
   */
  viewerFranchiseId: string | null;
}

export function buildLiveMatchup(input: BuildLiveMatchupInput): LiveMatchup {
  const { side0, side1, viewerFranchiseId } = input;

  let viewerSide: 0 | 1 | null = null;
  if (viewerFranchiseId) {
    if (side0.franchiseId === viewerFranchiseId) viewerSide = 0;
    else if (side1.franchiseId === viewerFranchiseId) viewerSide = 1;
  }

  return {
    index: input.index,
    sides: [side0, side1],
    viewerSide,
    // Stated for side 0. The spread is BOTH sides' remaining projection — the
    // uncertainty left in the matchup, not in one lineup.
    p0: winProbability(
      side0.projectedFinal,
      side1.projectedFinal,
      side0.remainingPoints + side1.remainingPoints,
    ),
    colorVars: resolveMatchupColorVars(input.side0Colors, input.side1Colors, input.surface),
  };
}
