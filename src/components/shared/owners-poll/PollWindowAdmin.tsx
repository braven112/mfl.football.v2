/**
 * The Owners' Poll — commissioner EMERGENCY STOP.
 *
 * Rendered only for a commissioner, and only on the ballot page. It needs only
 * a session, where the CLI needs Upstash credentials on the operator's machine.
 *
 * Voting is always open now, so there is no window to open and none to close.
 * What is left is a pause: `pause` suspends voting for the whole league,
 * `resume` lifts it, and NEITHER touches a ballot. These two action names are
 * the ones /api/owners-poll/window accepts — it 400s anything else, which is
 * exactly what happened while this panel still sent the old 'open'/'close'.
 *
 * Deliberately NOT a tally button. Publishing a consensus is the close pass
 * that runs after Thursday's deadline, so a mis-click here cannot destroy a
 * vote or publish a result nobody checked.
 */

import { useCallback, useEffect, useState } from 'react';

interface Props {
  leagueParam: string;
  slots: number;
}

interface WindowState {
  /** The only two states left: voting is open, or a commissioner paused it. */
  status: 'open' | 'paused';
  window: { year: number; week: number; opensAt: string; closesAt: string; slots: number } | null;
  ballotsIn?: number;
  eligibleVoters?: number;
  pushCoverage?: { withPush: number; of: number; devices: number };
}

export default function PollWindowAdmin({ leagueParam, slots }: Props) {
  const [state, setState] = useState<WindowState | null>(null);
  // Hours are the pause's TTL, not a window length: leave it blank to suspend
  // voting until someone resumes it by hand.
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const endpoint = `/api/owners-poll/window?league=${encodeURIComponent(leagueParam)}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      if (!res.ok) return; // not a commissioner — the panel simply stays hidden
      setState(await res.json());
    } catch {
      // A failed status read is not worth an error banner on a control panel
      // the page works without.
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (action: 'pause' | 'resume') => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const parsedHours = Number(hours);
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action === 'pause' && Number.isFinite(parsedHours) && parsedHours > 0
              ? { action, hours: parsedHours }
              : { action },
          ),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? `Request failed (${res.status})`);
          return;
        }
        setMessage(data?.message ?? 'Done.');
        await load();
        // The ballot builder above reads its state on mount, so a change here
        // has to reload the page for it to be reflected rather than leaving
        // two panels disagreeing about whether voting is open.
        setTimeout(() => window.location.reload(), 900);
      } catch {
        setError('Could not reach the server.');
      } finally {
        setBusy(false);
      }
    },
    [endpoint, hours, load],
  );

  // No state means the status call failed or was refused — most likely this
  // viewer is not a commissioner, so render nothing at all.
  if (!state) return null;

  const paused = state.status === 'paused';

  return (
    <section className="op-admin">
      <button
        type="button"
        className="op-admin__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="op-admin__badge">Commissioner</span>
        {paused
          ? 'Voting is PAUSED — resume it'
          : `Voting open · ${state.ballotsIn ?? 0}/${state.eligibleVoters ?? 0} ballots on file`}
        <span aria-hidden="true">{open ? ' ▾' : ' ▸'}</span>
      </button>

      {open && (
        <div className="op-admin__body">
          <p className="op-admin__note">
            Voting is always open and a ballot stands until its owner changes
            it. This is the emergency stop only: pausing refuses new ballots for
            the whole league and resuming lifts it. Neither tallies, and neither
            touches a ballot already on file.
          </p>

          <div className="op-admin__row">
            {paused ? (
              <button type="button" onClick={() => act('resume')} disabled={busy}>
                {busy ? 'Working…' : 'Resume voting'}
              </button>
            ) : (
              <>
                <label>
                  Pause for (hours, blank = until resumed)
                  <input
                    type="number"
                    min="1"
                    max="336"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <button
                  type="button"
                  className="op-admin__close"
                  onClick={() => act('pause')}
                  disabled={busy}
                >
                  {busy ? 'Working…' : 'Pause voting'}
                </button>
              </>
            )}
          </div>

          {state.pushCoverage && (
            <p
              className={`op-admin__coverage ${
                state.pushCoverage.withPush * 2 < state.pushCoverage.of ? 'op-admin__coverage--low' : ''
              }`}
            >
              <strong>
                {state.pushCoverage.withPush} of {state.pushCoverage.of}
              </strong>{' '}
              owners have notifications on ({state.pushCoverage.devices} devices).
              {state.pushCoverage.withPush * 2 < state.pushCoverage.of && (
                <>
                  {' '}
                  The poll sends one chat post a day and everything else by push, so
                  under half the league is reachable for the reminder and the result.
                </>
              )}
            </p>
          )}

          <p className="op-admin__note">
            {slots} slots
            {!paused && state.window
              ? ` · next result ${new Date(state.window.closesAt).toLocaleString()}`
              : ''}
          </p>

          {message && <p className="op-admin__ok" role="status">{message}</p>}
          {error && <p className="op-admin__err" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
