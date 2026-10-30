/**
 * The phone as a remote for the owner's paired TVs
 * (docs/plans/broadcast-handheld.md, Phase 4).
 *
 * A link in the handheld board's bar, drawn only when the signed-in owner has
 * a TV paired. It opens remote mode (`/live/broadcast/remote`, TvRemote.tsx):
 * the whole phone screen as big buttons for the TV's score overlay and board.
 *
 * The board also renders on each league's own host, where a bare `/live/...`
 * is rewritten under the league's prefix and 404s; remote mode lives on the
 * shared host only, so from a league host the link goes there.
 */
import { SHARED_APP_ORIGIN } from '../../../config/leagues';
import { resolveLeagueRewrite } from '../../../utils/league-host-map';
import { usePairedTvs } from './useTvRemote';

const REMOTE_PATH = '/live/broadcast/remote';

export default function BroadcastRemote() {
  const tvs = usePairedTvs();
  if (!tvs || tvs.length === 0) return null;
  // Rendered only after the TV list arrives, so `location` is always there.
  const rewritten = resolveLeagueRewrite(window.location.hostname, REMOTE_PATH) !== null;
  const href = rewritten ? `${SHARED_APP_ORIGIN}${REMOTE_PATH}` : REMOTE_PATH;
  return (
    <a className="cta cta--ghost lbh__remote-btn" href={href}>
      TV remote
    </a>
  );
}
