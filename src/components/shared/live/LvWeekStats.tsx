/**
 * The Live Scoring header's two stat cards: the week's top scorer and its
 * closest matchup.
 *
 * Year-round they are Player of the Week and Nail-Biter (owner's call, Nov
 * 2026). A seasonal theme renames them and nothing else: Halloween's Monster
 * of the Week and Scariest Game came first and keep their names while that
 * window is open; Christmas's are Star of the Week and Naughty or Nice. The
 * picks come from `weekStats`, which derives both from the panels the board
 * already shows, so a theme can never change WHO is named.
 *
 * A card with no answer yet (a week that has not kicked off) still renders,
 * saying when it will have one: the seasonal scenes are sized to hold these
 * cards, and with neither drawn the header read as a big blank spot (reported
 * on a phone the night before Week 7, Oct 2026).
 */
import type { JSX } from 'react';
import type { WeekCloseGame, WeekStats } from '../../../utils/live/week-stats';

export interface LvWeekStatsProps {
  stats: WeekStats;
  /** The open seasonal theme's id, or omitted for the year-round names. */
  season?: string;
  /** Opens the closest game's matchup, the same drill-in its card opens. */
  onOpenClosest?: (game: WeekCloseGame) => void;
}

interface CardCopy {
  label: string;
  /** What the card says before it has an answer. */
  waiting: string;
  /** What the card is, under the waiting line. */
  hint: string;
}

export interface WeekStatsCopy {
  star: CardCopy;
  closest: CardCopy;
}

const YEAR_ROUND: WeekStatsCopy = {
  star: { label: 'Player of the Week', waiting: 'Named at kickoff', hint: "The week's top scorer" },
  closest: { label: 'Nail-Biter', waiting: 'Picked once scores move', hint: 'The closest matchup' },
};

/** Seasonal names, keyed by seasonal theme id (src/config/seasonal-themes.mjs). */
const SEASONAL: Record<string, WeekStatsCopy> = {
  halloween: {
    star: { label: 'Monster of the Week', waiting: 'Rises at kickoff', hint: "The week's top scorer" },
    closest: { label: 'Scariest Game', waiting: 'Picked once scores move', hint: 'The closest matchup' },
  },
  christmas: {
    star: { label: 'Star of the Week', waiting: 'Shines at kickoff', hint: "The week's top scorer" },
    closest: { label: 'Naughty or Nice', waiting: 'Picked once scores move', hint: 'The closest matchup' },
  },
};

/** The names the cards wear for a season, falling back to the year-round ones. */
export function weekStatsCopy(season?: string): WeekStatsCopy {
  return (season && SEASONAL[season]) || YEAR_ROUND;
}

function fmt(points: number): string {
  return points.toFixed(1);
}

export default function LvWeekStats({ stats, season, onOpenClosest }: LvWeekStatsProps): JSX.Element {
  const { star, closest } = stats;
  const copy = weekStatsCopy(season);

  return (
    <div className="lv-wstats">
      {!star && (
        <div className="lv-wstats__card lv-wstats__card--waiting">
          <span className="lv-wstats__label">{copy.star.label}</span>
          <span className="lv-wstats__main">{copy.star.waiting}</span>
          <span className="lv-wstats__sub">{copy.star.hint}</span>
        </div>
      )}
      {!closest && (
        <div className="lv-wstats__card lv-wstats__card--waiting">
          <span className="lv-wstats__label">{copy.closest.label}</span>
          <span className="lv-wstats__main">{copy.closest.waiting}</span>
          <span className="lv-wstats__sub">{copy.closest.hint}</span>
        </div>
      )}
      {star && (
        <div className="lv-wstats__card">
          <span className="lv-wstats__label">{copy.star.label}</span>
          <span className="lv-wstats__main">{star.name}</span>
          <span className="lv-wstats__sub">
            {fmt(star.points)} pts{star.owners ? ` · ${star.owners}` : ''}
          </span>
        </div>
      )}
      {closest &&
        (() => {
          const body = (
            <>
              <span className="lv-wstats__label">{copy.closest.label}</span>
              <span className="lv-wstats__main">
                {closest.names[0]} vs {closest.names[1]}
              </span>
              <span className="lv-wstats__sub">
                {fmt(closest.margin)} pts apart
                {closest.final ? ' · final' : closest.yetToPlay > 0 ? ` · ${closest.yetToPlay} to play` : ''}
                {onOpenClosest && <span aria-hidden="true"> →</span>}
              </span>
            </>
          );
          // A button, not a link: an open matchup is the board's own state,
          // not a route, exactly as the matchup cards below open it.
          return onOpenClosest ? (
            <button
              type="button"
              className="lv-wstats__card lv-wstats__card--link"
              onClick={() => onOpenClosest(closest)}
            >
              {body}
            </button>
          ) : (
            <div className="lv-wstats__card">{body}</div>
          );
        })()}
    </div>
  );
}
