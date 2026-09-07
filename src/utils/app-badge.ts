/**
 * App icon badge — what the number on the installed app's icon means.
 *
 * `navigator.setAppBadge()` paints a count on the Home Screen / dock icon of an
 * INSTALLED app. It is one of the few things the installed app can do that a
 * browser tab cannot, and it is the only surface that reaches an owner who
 * never opens the app at all.
 *
 * Three things count, and the choice of three is the whole design: a badge is
 * a promise that something is waiting for YOU, so it may only ever count
 * things the owner can act on and clear.
 *
 *   trades  pending trade offers awaiting THIS owner's answer
 *   lineup  a broken or unsubmitted lineup, inside the pre-kickoff window
 *   poll    an open Owners' Poll ballot this owner has not cast
 *
 * Unread Schefter posts are deliberately NOT counted: it is the highest-volume
 * source in the league and a badge that is permanently lit is a badge people
 * stop seeing, which costs the other three their meaning.
 *
 * The pure half lives here so tests/app-badge.test.ts can pin the window
 * arithmetic and the fail-quiet rules without a network or a session.
 */

import { scheduleGames, mainSlate } from '../../scripts/lib/gameday-alerts.mjs';

/** The three things a badge may count, each already reduced to a number. */
export interface BadgeParts {
  /** Trade offers awaiting this owner's answer. */
  trades: number;
  /** 1 when this owner's lineup needs attention, else 0. */
  lineup: number;
  /** 1 when an open ballot has not been cast, else 0. */
  poll: number;
}

export const EMPTY_PARTS: BadgeParts = { trades: 0, lineup: 0, poll: 0 };

/**
 * How long before the week's first kickoff the lineup badge lights up.
 *
 * The existing Sunday-morning GroupMe warning fires at 9:15am PT, which is
 * useless to anyone starting a Thursday-night player. A day's lead covers the
 * Thursday game and still leaves the badge dark for most of the week.
 */
export const LINEUP_BADGE_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * The window in which a lineup problem is worth badging.
 *
 * Opens a day before the week's FIRST kickoff and closes when the main slate
 * kicks off — past that the lineup is locked and a badge is just a reminder of
 * something the owner can no longer fix.
 *
 * Both ends come from the schedule DATA rather than a weekday and a clock, the
 * same choice `scripts/lib/gameday-alerts.mjs` makes and for the same reason:
 * it needs no DST handling and it survives Thanksgiving, the Saturday slates
 * of Weeks 16-18, and a Christmas game with nobody remembering to special-case
 * them.
 *
 * Returns null when the schedule is unreadable or empty, which callers must
 * treat as "no badge" — see `isLineupBadgeWindow`.
 */
export function lineupBadgeWindow(
  nflSchedule: unknown,
): { opensAt: number; closesAt: number } | null {
  const games = scheduleGames(nflSchedule);
  if (games.length === 0) return null;

  const firstKickoff = Math.min(...games.map((g: { kickoffMs: number }) => g.kickoffMs));
  const slate = mainSlate(games);
  if (slate.length === 0) return null;
  const closesAt = slate[0].kickoffMs;

  const opensAt = firstKickoff - LINEUP_BADGE_LEAD_MS;
  // A main slate at or before the first kickoff means the week's biggest
  // window IS the opener (a Week 18 Saturday split, say). An inverted window
  // would badge nobody, which is the right outcome but reads as a bug at the
  // call site — so it is stated here instead.
  if (closesAt <= opensAt) return null;
  return { opensAt, closesAt };
}

/**
 * Is a lineup problem worth badging right now?
 *
 * Fails CLOSED. An unreadable schedule means no lineup badge: the cost of
 * staying dark is one owner checking their own lineup unprompted, and the cost
 * of guessing is a permanent badge nobody can clear.
 */
export function isLineupBadgeWindow(nflSchedule: unknown, now: number = Date.now()): boolean {
  const window = lineupBadgeWindow(nflSchedule);
  if (!window) return false;
  return now >= window.opensAt && now < window.closesAt;
}

/**
 * The badge number.
 *
 * Clamped at zero and floored to integers because `setAppBadge` treats a
 * negative or fractional value as an error in some engines and as a silent
 * no-op in others — neither of which is distinguishable from "no badge" at a
 * glance, and the difference matters when debugging a phone.
 */
export function resolveBadgeCount(parts: Partial<BadgeParts>): number {
  const safe = (n: unknown) => {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  return safe(parts.trades) + safe(parts.lineup) + safe(parts.poll);
}

/**
 * Does this owner's lineup need attention?
 *
 * `buildLineupWarnings` reports every flagged franchise in the league; the
 * badge is personal, so this reduces that to one bit for one franchise. Using
 * the same builder is the point — a badge that disagreed with the Sunday
 * GroupMe warning would be worse than no badge, because owners would learn
 * that one of the two lies.
 */
export function ownerLineupNeedsAttention(
  warnings: Array<{ franchiseId: string }>,
  franchiseId: string,
): number {
  return warnings.some((w) => w.franchiseId === franchiseId) ? 1 : 0;
}
