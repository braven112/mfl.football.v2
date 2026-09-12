/**
 * The red-zone banner — a persistent STATE, not an event.
 *
 * It sits ABOVE the stage layer, reveals included. As a stage it would be
 * preempted by the next reveal and the drive would be invisible for fourteen
 * seconds, which is precisely the window it exists to cover: "your other guy's
 * team is at the 6" while a reveal is playing is the situation this whole
 * board is for.
 *
 * NEVER animated beyond its 400ms entrance. A persistent flasher for a whole
 * drive is intolerable to sit in front of, and anything near 3 Hz is a
 * photosensitivity hazard.
 */

import { memo } from 'react';
import type { RedZoneAlert } from '../../../utils/broadcast-moments';

interface Props {
  alerts: readonly RedZoneAlert[];
}

function RedZoneBanner({ alerts }: Props) {
  if (alerts.length === 0) return null;

  // One banner, however many drives — two red-zone drives at once is a real
  // Sunday occurrence and two stacked banners would eat the strip.
  const names = alerts.flatMap((a) =>
    a.players.map((p) => `${p.playerName}${p.side === 'opponent' ? ' (against you)' : ''}`),
  );
  const downDistance = alerts.find((a) => a.downDistance)?.downDistance ?? '';

  return (
    // Deliberately NOT a live region. It was `role="status" aria-live="polite"`
    // and its text includes down & distance, which changes every play — so a
    // screen reader re-read the whole banner every few seconds for the length
    // of a drive, competing with the reveal announcer. Entry and exit are
    // announced once each through the island's single announcer instead.
    <div className="lbc__redzone" aria-hidden="true">
      <span className="lbc__redzone-tag">Red zone</span>
      <span className="lbc__redzone-who">{names.join(' · ')}</span>
      {downDistance && <span className="lbc__redzone-dd">{downDistance}</span>}
    </div>
  );
}

/**
 * Memoised because the island ticks once a SECOND to age the freshness pill
 * and drive the screensaver clock, and this component depends on none of that.
 * Unmemoised, a 1 Hz heartbeat re-renders the whole visible board ~28,800
 * times over an eight-hour Sunday — on set-top hardware, and concurrently
 * with the reveal transitions that are the one thing on this screen allowed
 * to cost a frame budget. Props here are already memoised upstream, so the
 * bailout is free and changes no behaviour.
 */
export default memo(RedZoneBanner);
