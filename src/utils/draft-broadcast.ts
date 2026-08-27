/**
 * Pure helpers for the AFL live draft broadcast board.
 *
 * Split from the React components (same reason as `pick-reveal.ts`) so the
 * board-state derivation is unit-testable without a DOM. The components own
 * animation and layout; everything here is data → data.
 */

import type { DraftRoomPick, DraftRoomTeam } from '../types/draft-room';
import type { BroadcastPlayer } from '../types/draft-broadcast';

/**
 * Where a player stood among what was ACTUALLY still on the board when he was
 * taken — the number the reveal leads with.
 *
 * Replaces an earlier STEAL/REACH meter that compared the pick number straight
 * against redraft ADP. That was wrong twice over in a keeper league. The AFL
 * keeps 7 per franchise, so 84 players are gone before 1.01 is called and the
 * AFL's 1.01 is really the 85th pick of a from-scratch draft — which made the
 * whole first round read as a reach. And once that scale was corrected the
 * deeper problem showed: past round one the AFL does not draft to redraft ADP
 * at all (its median pick is the ~84th-best available by ADP), so no rescaling
 * makes a verdict honest. A rank is a fact and needs no calibration: taking the
 * top man left still reads as a win, and taking the 90th-best available is
 * visibly a reach without the screen having to say so.
 *
 * Counts only players carrying a `boardRank`, so keepers — who never had one —
 * cannot inflate the position. Returns undefined when the player himself is
 * unranked, which is the honest answer rather than a fabricated placing.
 */
export function bestAvailableAt(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  throughPickNumber: number,
  playerId: string
): number | undefined {
  const self = players.get(playerId);
  if (!self?.boardRank) return undefined;

  // Everyone taken BEFORE this pick is off the board. Anything at or after it
  // has not happened yet from this reveal's point of view — a queued reveal
  // must not be re-ranked by picks that landed while it waited its turn.
  const goneBefore = new Set(
    picks
      .filter((p) => p.playerId && p.overallPickNumber < throughPickNumber)
      .map((p) => p.playerId)
  );

  let better = 0;
  for (const p of players.values()) {
    if (!p.boardRank || p.id === playerId) continue;
    if (goneBefore.has(p.id)) continue;
    if (p.boardRank < self.boardRank) better += 1;
  }
  return better + 1;
}

/** English ordinal — 1st, 2nd, 3rd, 11th, 21st. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Room-facing copy. Short — it is read from ten feet away. */
export function formatBestAvailable(rank?: number): string | null {
  if (!rank || !Number.isFinite(rank) || rank < 1) return null;
  return rank === 1 ? 'BEST AVAILABLE' : `${ordinal(rank)} BEST AVAILABLE`;
}

/**
 * The next unfilled slot — who the room is waiting on.
 *
 * Scans for the first EMPTY slot rather than taking the last filled one + 1:
 * MFL lets a commissioner fill a slot out of order, and "one past the last
 * pick made" would then skip whoever is actually still on the clock.
 */
export function findOnTheClock(picks: DraftRoomPick[]): DraftRoomPick | null {
  return picks.find((p) => !p.playerId) ?? null;
}

/** The most recent selections, newest first, for the idle ticker. */
export function recentPicks(picks: DraftRoomPick[], limit = 4): DraftRoomPick[] {
  return picks
    .filter((p) => !!p.playerId)
    .sort((a, b) => b.overallPickNumber - a.overallPickNumber)
    .slice(0, limit);
}

/** The slots after the one on the clock — "next up" on the idle screen. */
export function upcomingPicks(picks: DraftRoomPick[], limit = 3): DraftRoomPick[] {
  const clock = findOnTheClock(picks);
  if (!clock) return [];
  return picks
    .filter((p) => !p.playerId && p.overallPickNumber > clock.overallPickNumber)
    .slice(0, limit);
}

/**
 * How many of `position` went in the last `window` picks — the "run" callout.
 *
 * Counts the window INCLUDING the pick just made, so the reveal can say "4th
 * RB in 6 picks" about itself. Returns 0 for an unknown position rather than
 * guessing.
 */
export function positionRunCount(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  throughPickNumber: number,
  position: string,
  window = 8
): number {
  if (!position) return 0;
  const target = position.toUpperCase();
  const lowBound = throughPickNumber - window;
  return picks.filter((p) => {
    if (!p.playerId) return false;
    if (p.overallPickNumber > throughPickNumber || p.overallPickNumber <= lowBound) return false;
    return (players.get(p.playerId)?.position || '').toUpperCase() === target;
  }).length;
}

/** Index teams by franchise id for O(1) lookup during a reveal. */
export function teamMap(teams: DraftRoomTeam[]): Map<string, DraftRoomTeam> {
  return new Map(teams.map((t) => [t.franchiseId, t]));
}

/** Index players by MFL id. */
export function playerMap(players: BroadcastPlayer[]): Map<string, BroadcastPlayer> {
  return new Map(players.map((p) => [p.id, p]));
}

/**
 * Trim the board to the picks a rehearsal should have "already made".
 *
 * Used with `?rehearse=N` against a COMPLETED season so the page can be driven
 * end-to-end before draft night. Emptied slots keep their franchise and pick
 * numbers — only the player is cleared — so the board still knows who is on
 * the clock.
 */
export function applyRehearsal(picks: DraftRoomPick[], upTo: number): DraftRoomPick[] {
  return picks.map((p) =>
    p.overallPickNumber <= upTo ? p : { ...p, playerId: '', timestamp: '' }
  );
}

// ── Broadcast contrast ───────────────────────────────────────────────────────

/**
 * Minimum contrast ratio the reveal card's copy must hold against its own
 * background. 4.5 rather than the 3.0 WCAG allows for large text: this is read
 * from ten feet across a room, on a TV whose brightness and viewing angle we
 * do not control.
 */
const MIN_WHITE_CONTRAST = 4.5;

/** Relative luminance per WCAG 2.x, from a #rgb or #rrggbb string. */
function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHex(hex: string): [number, number, number] | null {
  const c = hex.trim().replace(/^#/, '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Contrast ratio of white against this colour. */
export function contrastWithWhite(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return MIN_WHITE_CONTRAST;
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/**
 * Darken a franchise colour just far enough that white copy stays legible on
 * it, leaving anything already dark enough completely untouched.
 *
 * Nine of the AFL's 24 franchises have at least one gradient stop that white
 * text cannot be read against — six of them use a near-white `#e9e9e9`, and
 * Midwestside's `#ffcd00` is worse still. On a laptop that is a squint; on the
 * TV it is an unreadable card in front of the whole league.
 *
 * Scales RGB toward black rather than mixing in grey, which holds the hue and
 * saturation — a light pink becomes a deeper pink, never a muddy one. Returns
 * the input unchanged when it cannot be parsed, so a malformed brand colour
 * degrades to today's behaviour instead of throwing on draft night.
 */
export function darkenForWhiteText(hex: string, minRatio = MIN_WHITE_CONTRAST): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  if (contrastWithWhite(hex) >= minRatio) return hex;

  // Binary search the scale factor, evaluating the ROUNDED colour at each step.
  // Searching on the float and rounding once at the end lands just under the
  // target (4.47 against a 4.5 bar) because the 8-bit round can only lighten;
  // scoring what we will actually emit makes the floor a real guarantee.
  const scaledHex = (f: number) => toHex(rgb.map((v) => v * f) as [number, number, number]);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastWithWhite(scaledHex(mid)) >= minRatio) lo = mid;
    else hi = mid;
  }
  return scaledHex(lo);
}


/** How much to push saturation before darkening. Dialled for a TV across a
 *  room, where a merely-correct colour reads as washed out. */
const TV_SATURATION_BOOST = 1.3;

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0))
    : max === gg ? (bb - rr) / d + 2
    : (rr - gg) / d + 4;
  return [h / 6, sat, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

/**
 * The colour treatment the broadcast card paints franchise brands with.
 *
 * Saturate, then floor the contrast. Both halves are for the same reason: a TV
 * across a lit room eats subtlety, so a merely-accurate colour reads washed
 * out, and a light one makes the copy unreadable outright. Saturating BEFORE
 * darkening matters — darkening a colour costs saturation, so boosting after
 * would be partly undone.
 *
 * A greyscale brand (saturation 0) is left un-saturated rather than being given
 * an arbitrary hue; it still gets the contrast floor.
 */
export function toBroadcastColor(hex: string, minRatio = MIN_WHITE_CONTRAST): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, sat, l] = rgbToHsl(rgb);
  const punched =
    sat === 0 ? rgb : hslToRgb([h, Math.min(1, sat * TV_SATURATION_BOOST), l]);
  return darkenForWhiteText(toHex(punched), minRatio);
}
