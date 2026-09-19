/**
 * One matchup's scoring plays.
 *
 * ── THREE STATES, NEVER TWO ───────────────────────────────────────────────
 * Real plays, an honest "nothing yet", and an explicit "we could not read the
 * feed". Collapsing the last two shows an owner an empty ticker during an ESPN
 * outage and lets him believe his starters did nothing — the same split the
 * poll store keeps between `status` and `data`, carried all the way to the
 * pixel. A partial read says so rather than pretending to be complete.
 *
 * ── DERIVED EVERY POLL, NEVER ACCUMULATED ─────────────────────────────────
 * The whole slate's scoring plays arrive on every poll, so recomputing from
 * the current payload is idempotent: a play cannot be emitted twice and there
 * is no seen-set to drift. The ticker this replaces accumulated instead — it
 * inferred a fantasy "delta" by diffing each starter's points between two 60s
 * polls, so a stat correction could invent a scoring event and a point swing
 * spanning a poll boundary was attributed to the wrong moment in the game.
 *
 * Selection (and the per-play dedupe the AFL's duplicate rosters need) lives in
 * `selectMatchupMoments`; this renders what it returns.
 */
import type { JSX } from 'react';
import type { LiveMoment } from '../../../types/live';
import { nflLogoUrl } from '../../../utils/live/nfl-logo-url';
import {
  nflLogoErrorHandler,
  nflLogoLoadHandler,
  nflLogoRefCallback,
} from '../../../constants/roster-constants';

export interface LvMomentTickerProps {
  moments: LiveMoment[];
  /**
   * How the play feed is doing. `error` is NOT "no plays" — see the header.
   * `idle` means nothing has landed yet.
   */
  status?: 'idle' | 'ok' | 'error';
  /** Some games could not be expanded. Normal, and said out loud. */
  partial?: boolean;
}

export default function LvMomentTicker({
  moments,
  status = 'idle',
  partial = false,
}: LvMomentTickerProps): JSX.Element {
  return (
    <div className="lv-moments">
      <h3>Scoring plays</h3>

      {moments.length > 0 ? (
        <>
          {moments.map((m) => (
            <div className="lv-moment" key={m.key}>
              <span className="lv-moment__clock">{m.clock}</span>
              {m.team && (
                <img
                  className="lv-moment__nfl"
                  src={nflLogoUrl(m.team)}
                  alt=""
                  loading="lazy"
                  onError={nflLogoErrorHandler}
                  onLoad={nflLogoLoadHandler}
                  ref={nflLogoRefCallback}
                />
              )}
              <span className="lv-moment__txt">{m.text || m.playerName}</span>
            </div>
          ))}
          {partial && (
            <p className="lv-moments__note">
              Some games couldn’t be read — this list may be incomplete.
            </p>
          )}
        </>
      ) : status === 'error' ? (
        <p className="lv-moments__note lv-moments__note--error">
          Scoring plays are unavailable right now — we couldn’t reach the NFL feed.
        </p>
      ) : status === 'ok' ? (
        <p className="lv-moments__note">No scoring plays from these starters yet.</p>
      ) : (
        <p className="lv-moments__note">Loading scoring plays…</p>
      )}
    </div>
  );
}
