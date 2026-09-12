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

import type { RedZoneAlert } from '../../../utils/broadcast-moments';

interface Props {
  alerts: readonly RedZoneAlert[];
}

export default function RedZoneBanner({ alerts }: Props) {
  if (alerts.length === 0) return null;

  // One banner, however many drives — two red-zone drives at once is a real
  // Sunday occurrence and two stacked banners would eat the strip.
  const names = alerts.flatMap((a) =>
    a.players.map((p) => `${p.playerName}${p.side === 'opponent' ? ' (against you)' : ''}`),
  );
  const downDistance = alerts.find((a) => a.downDistance)?.downDistance ?? '';

  return (
    <div className="lbc__redzone" role="status" aria-live="polite">
      <span className="lbc__redzone-tag">Red zone</span>
      <span className="lbc__redzone-who">{names.join(' · ')}</span>
      {downDistance && <span className="lbc__redzone-dd">{downDistance}</span>}
    </div>
  );
}
