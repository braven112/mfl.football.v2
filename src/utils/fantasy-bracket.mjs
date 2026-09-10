/**
 * Which NFL weeks the fantasy bracket occupies — DERIVED from the NFL's
 * regular-season length, never written down as 15/16/17.
 *
 * Both leagues end their season the week BEFORE the NFL's final regular-season
 * week, because that last week is when NFL teams with nothing to play for rest
 * their starters. So the title game is `FINAL_REGULAR_SEASON_WEEK - 1` and the
 * bracket counts back from there.
 *
 * This is not hypothetical bookkeeping. The bracket has already moved once for
 * exactly this reason, and had to be hand-corrected in several files when it
 * did — the AFL resolver still carried the note: "The bracket shifted +1 with
 * the 2021 move to a 17-game / 18-week NFL season: QF Week 15, SF Week 16,
 * World Championship Week 17." Before 2021 the NFL played 17 weeks and the
 * title game was week 16; after it, 18 weeks and week 17. The formula below
 * reproduces both eras, so the next expansion is one constant, not a hunt.
 *
 * Both leagues run the same three-round shape (TheLeague: playoffs open week
 * 15, title week 17; the AFL: conference semifinals 15, conference finals 16,
 * World Championship 17), which is why this is one module and not two.
 */

import { REGULAR_SEASON_WEEKS } from './nfl-week-starts.mjs';

/** The NFL's last regular-season week — 18 today, 17 before 2021. */
export const FINAL_REGULAR_SEASON_WEEK = REGULAR_SEASON_WEEKS;

/** The title game: the week before the NFL's last regular-season week. */
export const CHAMPIONSHIP_WEEK = FINAL_REGULAR_SEASON_WEEK - 1;

/** Round two — TheLeague's semifinals, the AFL's conference finals. */
export const SEMIFINAL_WEEK = CHAMPIONSHIP_WEEK - 1;

/** Round one, and therefore the first week the fantasy regular season is over. */
export const PLAYOFFS_START_WEEK = CHAMPIONSHIP_WEEK - 2;

/** The last week of the fantasy regular season. */
export const FINAL_FANTASY_REGULAR_SEASON_WEEK = PLAYOFFS_START_WEEK - 1;
