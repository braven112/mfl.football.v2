/**
 * The phone as a remote for the owner's paired TVs
 * (docs/plans/broadcast-handheld.md, Phase 4).
 *
 * A link in the handheld board's bar, drawn only when the signed-in owner has
 * a TV paired. It opens remote mode (`/live/broadcast/remote`, TvRemote.tsx):
 * the whole phone screen as big buttons for the TV's score overlay and board.
 */
import { usePairedTvs } from './useTvRemote';

export default function BroadcastRemote() {
  const tvs = usePairedTvs();
  if (!tvs || tvs.length === 0) return null;
  return (
    <a className="cta cta--ghost lbh__remote-btn" href="/live/broadcast/remote">
      TV remote
    </a>
  );
}
