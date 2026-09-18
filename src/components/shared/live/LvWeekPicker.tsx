/**
 * Week selector for the board.
 *
 * MFL Live has none today, which is why you cannot look back at last week
 * there; decision 3 (full feature union) gives it one.
 *
 * ── THE CEILING IS THE REGULAR SEASON, NOT `MAX_WEEK` ─────────────────────
 * `REGULAR_SEASON_WEEKS` (18) comes from `nfl-week-starts.mjs`, the one place
 * this repo is allowed to answer a week question. Its `MAX_WEEK` is 22 —
 * regular season plus the four NFL playoff weeks — and that is the WRONG
 * ceiling here: MFL has no fantasy matchup for an NFL playoff week, so those
 * four options would each navigate to an empty board. The board this ports
 * from hardcoded `18`; naming the constant says WHY it is 18 and moves with
 * the schedule if the league ever adds a week.
 *
 * ── IT NAVIGATES, IT DOES NOT FETCH ──────────────────────────────────────
 * The week is a URL parameter on all four routes, and the page assembles its
 * own first paint in process. So changing weeks is a navigation, not a
 * client-side refetch — which also makes the resulting view shareable, and
 * keeps `?week=` the single source of which week is on screen.
 *
 * `onSelect` exists for a story and for a caller that wants to intercept;
 * unset, it rewrites `?week=` on the current URL. Reading `window` is deferred
 * into the handler so this renders on the server.
 */
import type { JSX } from 'react';
import { REGULAR_SEASON_WEEKS } from '../../../utils/nfl-week-starts.mjs';

export interface LvWeekPickerProps {
  /** The week currently on screen. */
  week: number;
  /** Highest selectable week. Defaults to the NFL regular season. */
  maxWeek?: number;
  /** Override the navigation — a story passes this; production does not. */
  onSelect?: (week: number) => void;
}

function navigateToWeek(week: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('week', String(week));
  window.location.href = url.toString();
}

export default function LvWeekPicker({
  week,
  maxWeek = REGULAR_SEASON_WEEKS,
  onSelect,
}: LvWeekPickerProps): JSX.Element {
  return (
    <label className="lv-weeksel">
      <span className="lv-weeksel__lbl">Week</span>
      <select
        value={week}
        aria-label="Select week"
        onChange={(e) => (onSelect ?? navigateToWeek)(Number(e.target.value))}
      >
        {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
          <option key={w} value={w}>
            Week {w}
          </option>
        ))}
      </select>
    </label>
  );
}
