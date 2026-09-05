/**
 * The Owners' Poll — commissioner control for the ballot window.
 *
 * Rendered only for a commissioner, and only on the ballot page. It is the
 * browser twin of scripts/owners-poll-window.mjs: the CLI needs Upstash
 * credentials on the operator's machine, this needs only a session, and the
 * deployment already holds the credentials.
 *
 * Deliberately NOT a tally button. Closing here stops voting and nothing else;
 * publishing a consensus is the close pass that runs after Thursday's
 * deadline. Keeping them apart means a
 * mis-click cannot destroy a vote or publish a result nobody checked.
 */

import { useCallback, useEffect, useState } from 'react';

interface Props {
  leagueParam: string;
  quorum: number;
  slots: number;
}

interface WindowState {
  status: 'open' | 'pending' | 'closed' | 'none';
  window: { year: number; week: number; opensAt: string; closesAt: string; slots: number } | null;
  ballotsIn?: number;
  eligibleVoters?: number;
  pushCoverage?: { withPush: number; of: number; devices: number };
}

export default function PollWindowAdmin({ leagueParam, quorum, slots }: Props) {
  const [state, setState] = useState<WindowState | null>(null);
  const [week, setWeek] = useState('1');
  const [hours, setHours] = useState('48');
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
    async (action: 'open' | 'close') => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action === 'open'
              ? { action, week: Number(week), hours: Number(hours) }
              : { action },
          ),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? `Request failed (${res.status})`);
          return;
        }
        if (action === 'open') {
          setMessage(
            `Ballot open for Week ${data.window.week} — closes in ${data.hours}h. ` +
              `${data.ballotsIn} of ${data.eligibleVoters} ballots in, quorum ${data.quorum}.` +
              (data.shortWindow ? ' (Short window.)' : ''),
          );
        } else {
          setMessage(data.message);
        }
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
    [endpoint, week, hours, load],
  );

  // No state means the status call failed or was refused — most likely this
  // viewer is not a commissioner, so render nothing at all.
  if (!state) return null;

  const live = state.status === 'open' && state.window;

  return (
    <section className="op-admin">
      <button
        type="button"
        className="op-admin__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="op-admin__badge">Commissioner</span>
        {live
          ? `Ballot open · Week ${state.window!.week} · ${state.ballotsIn ?? 0}/${state.eligibleVoters ?? 0} in`
          : 'No ballot open — open one'}
        <span aria-hidden="true">{open ? ' ▾' : ' ▸'}</span>
      </button>

      {open && (
        <div className="op-admin__body">
          <p className="op-admin__note">
            The Tuesday column opens the ballot automatically in season. Use this
            to open one now — for a preview, or to recover from a failed run.
            Closing stops voting only; it never tallies and never deletes a
            ballot, so re-opening the same week picks them all back up.
          </p>

          <div className="op-admin__row">
            <label>
              Week
              <input
                type="number"
                min="1"
                max="25"
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Open for (hours)
              <input
                type="number"
                min="1"
                max="336"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={busy}
              />
            </label>
            <button type="button" onClick={() => act('open')} disabled={busy}>
              {busy ? 'Working…' : live ? 'Replace window' : 'Open ballot'}
            </button>
            {live && (
              <button
                type="button"
                className="op-admin__close"
                onClick={() => act('close')}
                disabled={busy}
              >
                Stop voting
              </button>
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
            {slots} slots · quorum {quorum}
            {live && state.window ? ` · closes ${new Date(state.window.closesAt).toLocaleString()}` : ''}
          </p>

          {message && <p className="op-admin__ok" role="status">{message}</p>}
          {error && <p className="op-admin__err" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
