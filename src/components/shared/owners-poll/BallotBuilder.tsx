/**
 * The Owners' Poll — ballot builder island.
 *
 * Tap teams in order to build a top-`slots` ballot, reorder with the arrows,
 * submit. Server state (an existing ballot, last week's prefill, live turnout)
 * is fetched on mount from /api/owners-poll/ballot rather than rendered into
 * the page, so a cached HTML shell can never show one owner another's ballot.
 *
 * The interaction rules themselves are pure functions in
 * src/utils/owners-poll-builder.ts and are tested there.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  isComplete,
  moveTeam,
  sanitizeSelection,
  slotOf,
  toggleTeam,
} from '../../../utils/owners-poll-builder';

export interface BallotTeam {
  franchiseId: string;
  name: string;
  nameShort: string;
  colorPrimary: string;
  colorPrimaryDark: string;
  icon: string;
  /** Context shown on the card. Null when the week's issue has no row for them. */
  record: string | null;
  ppg: number | null;
}

interface Props {
  teams: BallotTeam[];
  slots: number;
  leagueParam: string;
  /** The viewer's own franchise, highlighted — self-voting is allowed. */
  ownFranchiseId: string;
  columnHref: string;
}

/**
 * Load status. 'error' is kept distinct from every empty state on purpose:
 * "we couldn't reach the poll" and "there is no ballot open" must never merge
 * — that conflation is the recurring bug class in this repo.
 */
type LoadState = 'loading' | 'ready' | 'error';
type WindowStatus = 'open' | 'pending' | 'closed' | 'none';

interface BallotResponse {
  status: WindowStatus;
  window: { year: number; week: number; opensAt: string; closesAt: string; slots: number } | null;
  ballot: { ranking: string[]; submittedAt: string | null; updatedAt: string | null } | null;
  prefill: string[] | null;
  turnout?: { ballotsIn: number; eligible: number };
}

export default function BallotBuilder({
  teams,
  slots,
  leagueParam,
  ownFranchiseId,
  columnHref,
}: Props) {
  const [load, setLoad] = useState<LoadState>('loading');
  const [status, setStatus] = useState<WindowStatus>('none');
  const [window_, setWindow] = useState<BallotResponse['window']>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [submittedRanking, setSubmittedRanking] = useState<string[] | null>(null);
  const [fromPrefill, setFromPrefill] = useState(false);
  const [turnout, setTurnout] = useState<{ ballotsIn: number; eligible: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const eligibleIds = useMemo(() => teams.map((t) => t.franchiseId), [teams]);
  const endpoint = `/api/owners-poll/ballot?league=${encodeURIComponent(leagueParam)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as BallotResponse;
        if (cancelled) return;

        setStatus(data.status);
        setWindow(data.window);
        setTurnout(data.turnout ?? null);
        setSubmittedRanking(data.ballot?.ranking ?? null);

        const start = data.ballot?.ranking ?? data.prefill ?? null;
        setFromPrefill(!data.ballot && Boolean(data.prefill?.length));
        setSelection(sanitizeSelection(start, eligibleIds, slots));
        setLoad('ready');
      } catch {
        if (!cancelled) setLoad('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, eligibleIds, slots]);

  const onToggle = useCallback(
    (franchiseId: string) => {
      setJustSaved(false);
      setSelection((prev) => toggleTeam(prev, franchiseId, slots));
    },
    [slots],
  );

  const onMove = useCallback((franchiseId: string, delta: -1 | 1) => {
    setJustSaved(false);
    setSelection((prev) => moveTeam(prev, franchiseId, delta));
  }, []);

  const submit = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranking: selection }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveError(data?.error ?? 'Could not save your ballot. Try again.');
        // A 409 means the window moved under us — reflect that rather than
        // leaving the owner tapping Submit on a closed ballot.
        if (res.status === 409 && data?.status) setStatus(data.status as WindowStatus);
        return;
      }
      setSubmittedRanking(selection);
      setFromPrefill(false);
      setJustSaved(true);
      if (data?.turnout) setTurnout(data.turnout);
    } catch {
      setSaveError('Could not reach the poll. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [endpoint, selection]);

  const complete = isComplete(selection, slots);
  const dirty =
    submittedRanking === null ||
    submittedRanking.length !== selection.length ||
    submittedRanking.some((id, i) => id !== selection[i]);

  if (load === 'loading') {
    return <p className="op-note">Loading the ballot…</p>;
  }

  if (load === 'error') {
    return (
      <div className="op-callout op-callout--error" role="alert">
        <strong>Couldn’t load the ballot.</strong>
        <p>That’s a problem on our end, not a closed poll. Refresh to try again.</p>
      </div>
    );
  }

  if (status !== 'open') {
    return (
      <div className="op-callout">
        <strong>{closedHeadline(status)}</strong>
        <p>
          {closedBody(status)} <a href={columnHref}>Read The Pecking Order</a>.
        </p>
      </div>
    );
  }

  const selected = teams.filter((t) => selection.includes(t.franchiseId));
  const selectedInOrder = selection
    .map((id) => selected.find((t) => t.franchiseId === id))
    .filter((t): t is BallotTeam => Boolean(t));

  return (
    <div className="op-builder">
      <header className="op-builder__head">
        <div>
          <h2 className="op-builder__title">
            Rank your top {slots}
            {window_ ? ` · Week ${window_.week}` : ''}
          </h2>
          <p className="op-builder__sub">
            Tap teams in the order you rate them. You can rank your own team.
          </p>
        </div>
        {turnout && (
          <p className="op-turnout" aria-live="polite">
            <strong>
              {turnout.ballotsIn} of {turnout.eligible}
            </strong>{' '}
            ballots in
          </p>
        )}
      </header>

      {window_ && (
        <p className="op-deadline">
          Closes <ClosesAt iso={window_.closesAt} />
        </p>
      )}

      {fromPrefill && !submittedRanking && (
        <div className="op-callout op-callout--hint">
          Started from <strong>your Week {window_ ? window_.week - 1 : 'last'} ballot</strong>.
          Edit it or submit as-is.
        </div>
      )}

      <ol className="op-slots" aria-label={`Your top ${slots}`}>
        {Array.from({ length: slots }, (_, i) => {
          const team = selectedInOrder[i];
          if (!team) {
            return (
              <li key={`empty-${i}`} className="op-slot op-slot--empty">
                <span className="op-slot__rank">{i + 1}</span>
                <span className="op-slot__placeholder">Tap a team below</span>
              </li>
            );
          }
          return (
            <li
              key={team.franchiseId}
              className="op-slot"
              style={teamVars(team)}
            >
              <span className="op-slot__rank">{i + 1}</span>
              {team.icon && <img className="op-slot__crest" src={team.icon} alt="" loading="lazy" />}
              <span className="op-slot__name">{team.nameShort}</span>
              <span className="op-slot__actions">
                <button
                  type="button"
                  className="op-icon-btn"
                  onClick={() => onMove(team.franchiseId, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${team.nameShort} up to ${i}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="op-icon-btn"
                  onClick={() => onMove(team.franchiseId, 1)}
                  disabled={i === selectedInOrder.length - 1}
                  aria-label={`Move ${team.nameShort} down to ${i + 2}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="op-icon-btn op-icon-btn--remove"
                  onClick={() => onToggle(team.franchiseId)}
                  aria-label={`Remove ${team.nameShort} from your ballot`}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="op-actions">
        <button
          type="button"
          className="op-submit"
          onClick={submit}
          disabled={!complete || saving || !dirty}
        >
          {saving
            ? 'Saving…'
            : submittedRanking
              ? dirty
                ? 'Update ballot'
                : 'Ballot submitted'
              : `Submit ballot (${selection.length}/${slots})`}
        </button>
        {selection.length > 0 && (
          <button type="button" className="op-clear" onClick={() => setSelection([])}>
            Clear
          </button>
        )}
      </div>

      {justSaved && !dirty && (
        <p className="op-saved" role="status">
          Ballot saved. You can change it until the poll closes.
        </p>
      )}
      {saveError && (
        <p className="op-error" role="alert">
          {saveError}
        </p>
      )}

      <h3 className="op-pool__title">
        {selection.length >= slots ? 'Ballot full — remove one to swap' : 'Pick a team'}
      </h3>
      <ul className="op-pool">
        {teams.map((team) => {
          const slot = slotOf(selection, team.franchiseId);
          const isOwn = team.franchiseId === ownFranchiseId;
          const full = selection.length >= slots && slot === null;
          return (
            <li key={team.franchiseId}>
              <button
                type="button"
                className={[
                  'op-card',
                  slot !== null ? 'op-card--picked' : '',
                  isOwn ? 'op-card--own' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={teamVars(team)}
                onClick={() => onToggle(team.franchiseId)}
                disabled={full}
                aria-pressed={slot !== null}
              >
                {slot !== null && <span className="op-card__slot">{slot}</span>}
                {team.icon && <img className="op-card__crest" src={team.icon} alt="" loading="lazy" />}
                <span className="op-card__body">
                  <span className="op-card__name">
                    {team.nameShort}
                    {isOwn && <span className="op-card__you"> · you</span>}
                  </span>
                  <span className="op-card__meta">
                    {team.record ?? '—'}
                    {team.ppg != null ? ` · ${team.ppg.toFixed(1)} PPG` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Ship BOTH brand colours as custom properties and let CSS pick per theme.
 *
 * Passing only `colorPrimary` puts a colour chosen for light surfaces onto a
 * dark one — several teams' primaries are near-black and vanish against the
 * dark card. `colorPrimaryDark` is exactly the variant the config carries for
 * this, and league-team-brands already falls it back to the light primary for
 * teams that don't define one.
 */
function teamVars(team: BallotTeam): CSSProperties {
  return {
    '--op-team': team.colorPrimary,
    '--op-team-dark': team.colorPrimaryDark,
  } as CSSProperties;
}

/**
 * Render the deadline in the VIEWER's timezone.
 *
 * Client-side rather than server-formatted: the close time is stored as an
 * instant, and an owner in a different timezone reading a hardcoded "6pm PT"
 * has to do the math themselves at exactly the moment we want them not to
 * hesitate.
 */
function ClosesAt({ iso }: { iso: string }) {
  const [text, setText] = useState<string>('');
  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setText(
      d.toLocaleString(undefined, {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    );
  }, [iso]);
  return <>{text || 'soon'}</>;
}

function closedHeadline(status: WindowStatus): string {
  if (status === 'pending') return 'The ballot isn’t open yet.';
  if (status === 'closed') return 'This week’s ballot is closed.';
  return 'No ballot is open right now.';
}

function closedBody(status: WindowStatus): string {
  if (status === 'pending') return 'It opens with Tuesday morning’s column.';
  if (status === 'closed') return 'Results publish with the column.';
  return 'The poll runs weekly during the season.';
}
