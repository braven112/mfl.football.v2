/**
 * The offseason auction window — one definition, two consumers.
 *
 * TheLeague replaces free agency with a live auction from the third Thursday
 * of March to the third Sunday of August. While it is open, waiver claims are
 * not the mechanism: the free-agent page deep-links to MFL's own Place Bid
 * page instead of offering its in-place claim form.
 *
 * This lived only in `theleague/players.astro`, which was fine while that page
 * was the only surface that could acquire a player. It no longer is — the
 * player modal offers the claim on every page it opens on, from a claim
 * context resolved on the SERVER — so the window has to be answerable away
 * from that page. Extracted rather than re-ported, because a duplicated date
 * formula is this repo's most reliable way to ship two surfaces disagreeing
 * about what season it is.
 *
 * Gated on the registry's `offseasonAuction` feature, never on a league slug:
 * a league without an auction has no window and is never blocked.
 */

import { getNthDayOfMonth } from './league-event-resolver';
import { getCurrentLeagueYear } from './league-year';
import { leagueHasFeature } from '../config/leagues';

export interface AuctionWindow {
  /** The league runs an offseason auction at all. */
  applies: boolean;
  open: boolean;
  start: Date | null;
  end: Date | null;
  /**
   * The league year the window belongs to — the same year MFL deep links must
   * use, so a cross-year `?testDate` cannot show one year's auction while
   * linking another.
   */
  year: number;
}

/**
 * Resolve the auction window for a league at a moment in time.
 *
 * `now` is a parameter, not `new Date()` inline, because every date-dependent
 * surface in this repo has to be testable through `?testDate=YYYY-MM-DD`.
 */
export function resolveAuctionWindow(slug: string, now: Date = new Date()): AuctionWindow {
  const year = getCurrentLeagueYear(now);
  if (!leagueHasFeature(slug, 'offseasonAuction')) {
    return { applies: false, open: false, start: null, end: null, year };
  }
  // 3rd Thursday of March (month 2) → 3rd Sunday of August (month 7), 8:45 PM PT.
  const start = getNthDayOfMonth(year, 2, 4, 3);
  const end = getNthDayOfMonth(year, 7, 0, 3);
  end.setHours(20, 45, 0, 0);
  return {
    applies: true,
    open: now.getTime() >= start.getTime() && now.getTime() < end.getTime(),
    start,
    end,
    year,
  };
}

/** Shorthand for the only question most callers have. */
export function isAuctionSeason(slug: string, now: Date = new Date()): boolean {
  return resolveAuctionWindow(slug, now).open;
}
