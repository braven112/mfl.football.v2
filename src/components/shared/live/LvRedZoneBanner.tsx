/**
 * Whose players are in a red-zone drive, right now.
 *
 * ── IT IS A STATE, NOT AN EVENT ───────────────────────────────────────────
 * Which is why it lives in the board SHELL, outside the
 * `selected ? <Detail/> : <Board/>` branch: drilling into a matchup must not
 * make a live drive disappear. The broadcast board learned the same thing the
 * hard way at one level up — put on its stage layer, the banner was preempted
 * by the next reveal and a whole drive vanished for fourteen seconds.
 *
 * ── NEVER ANIMATED, AT ANY RATE ───────────────────────────────────────────
 * No blink, no pulse. A persistent flasher for the length of a drive is
 * intolerable to look at, and anything near 3 Hz is a photosensitivity
 * hazard. The stylesheet gives it a single 400ms entrance fade and nothing
 * that repeats; `prefers-reduced-motion` removes even that.
 *
 * ── THE ALERTS ARE DERIVED, NOT LATCHED ───────────────────────────────────
 * The caller recomputes them every poll, so a drive that ends in a score, a
 * turnover or a punt simply stops producing an alert and this unmounts itself.
 * Nothing here needs to know a drive ended.
 *
 * Possession is already decided upstream (`selectRedZoneAlerts`): `isRedZone`
 * belongs to the team WITH THE BALL, not to the game, so a receiver is never
 * flagged while his team is on defense. This component does not re-derive it.
 */
import type { JSX } from 'react';
import type { RedZoneAlert } from '../../../utils/broadcast-moments';

export interface LvRedZoneBannerProps {
  alerts: readonly RedZoneAlert[];
  /**
   * Name each player's league. True on a cross-league board, where "your
   * players" span several leagues and the row is ambiguous without it; false
   * on a league board, where it would repeat the same name on every row.
   */
  showLeague?: boolean;
}

export default function LvRedZoneBanner({
  alerts,
  showLeague = false,
}: LvRedZoneBannerProps): JSX.Element | null {
  // No drive, no banner. Rendering an empty shell would assert "nothing is
  // happening", which is a different claim from not asserting anything.
  if (alerts.length === 0) return null;

  return (
    <div className="lv-redzone" role="status" aria-live="polite">
      <span className="lv-redzone__tag">RED ZONE</span>
      {alerts.map((alert) => (
        <span key={alert.team} className="lv-redzone__drive">
          <span className="lv-redzone__who">
            {alert.players
              .map((p) =>
                showLeague
                  ? `${p.playerName} (${p.position}, ${p.leagueName})`
                  : `${p.playerName} (${p.position})`,
              )
              .join(', ')}
          </span>
          {/* ESPN omits down & distance often enough that it has to be
              optional — and a fabricated one would be a claim about a real
              game's state that can be wrong. Absent means absent. */}
          {alert.downDistance && (
            <span className="lv-redzone__where"> — {alert.downDistance}</span>
          )}
        </span>
      ))}
    </div>
  );
}
