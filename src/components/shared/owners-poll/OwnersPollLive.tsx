/**
 * The Owners' Poll — the OPEN-window strip inside the Pecking Order column.
 *
 * The issue page is prerendered, so nothing per-viewer and nothing live can
 * come from its HTML: turnout climbs during the window, and whether YOU have
 * voted is not a property of the page. Both are fetched here.
 *
 * It also self-corrects a stale build. The issue JSON is written Tuesday with
 * `status: "open"` and amended after Thursday's close; between the close and
 * the redeploy that carries the amendment, the prerendered page still says
 * "open".
 * The API is the authority, so when it reports closed this renders "results
 * publishing shortly" instead of a ballot CTA that would 409 on submit.
 */

import { useEffect, useState } from 'react';

interface Props {
  ballotHref: string;
  slots: number;
  quorum: number;
  eligibleVoters: number;
  leagueParam: string;
  /** Week from the rendered issue — used only to detect a stale build. */
  issueWeek: number;
}

type Phase = 'loading' | 'open' | 'voted' | 'closed' | 'unavailable' | 'signed-out';

interface BallotResponse {
  status: 'open' | 'pending' | 'closed' | 'none';
  window: { week: number; closesAt: string } | null;
  ballot: { ranking: string[] } | null;
  turnout?: { ballotsIn: number; eligible: number };
}

export default function OwnersPollLive({
  ballotHref,
  slots,
  quorum,
  eligibleVoters,
  leagueParam,
  issueWeek,
}: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [turnout, setTurnout] = useState<{ ballotsIn: number; eligible: number } | null>(null);
  const [closesAt, setClosesAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/owners-poll/ballot?league=${encodeURIComponent(leagueParam)}`,
          { credentials: 'same-origin' },
        );

        // A signed-out reader is not an error — they get the public turnout
        // meter and an invitation, not a broken panel.
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) {
            setPhase('signed-out');
            await loadPublicTurnout(leagueParam, cancelled, setTurnout, setClosesAt);
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as BallotResponse;
        if (cancelled) return;

        setTurnout(data.turnout ?? null);
        setClosesAt(data.window?.closesAt ?? null);

        if (data.status !== 'open') setPhase('closed');
        else if (data.ballot) setPhase('voted');
        else setPhase('open');
      } catch {
        // Distinct from every empty state: "we couldn't reach the poll" must
        // never render as "no ballot is open".
        if (!cancelled) setPhase('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueParam, issueWeek]);

  if (phase === 'loading') {
    return <p className="op-strip__note">Checking the ballot…</p>;
  }

  if (phase === 'unavailable') {
    return (
      <p className="op-strip__note" role="alert">
        Couldn’t reach the poll just now. <a href={ballotHref}>Open the ballot</a> to try directly.
      </p>
    );
  }

  if (phase === 'closed') {
    return (
      <p className="op-strip__note">
        Voting has closed for this week. Results publish with the column shortly.
      </p>
    );
  }

  return (
    <div className="op-strip__live">
      <Meter turnout={turnout} eligibleVoters={eligibleVoters} quorum={quorum} />

      {phase === 'voted' ? (
        <p className="op-strip__cta">
          <strong>Your ballot is in.</strong>{' '}
          <a href={ballotHref}>Change it</a> until the poll closes
          {closesAt ? <> · <Closes iso={closesAt} /></> : null}.
        </p>
      ) : phase === 'signed-out' ? (
        <p className="op-strip__cta">
          Owners can rank their top {slots}. <a href={ballotHref}>Sign in to cast a ballot</a>.
        </p>
      ) : (
        <p className="op-strip__cta">
          <a className="op-strip__button" href={ballotHref}>
            Rank your top {slots}
          </a>{' '}
          <span className="op-strip__tease">
            Cast your ballot to see where the room has you
            {closesAt ? <> · <Closes iso={closesAt} /></> : null}.
          </span>
        </p>
      )}
    </div>
  );
}

function Meter({
  turnout,
  eligibleVoters,
  quorum,
}: {
  turnout: { ballotsIn: number; eligible: number } | null;
  eligibleVoters: number;
  quorum: number;
}) {
  const total = turnout?.eligible ?? eligibleVoters;
  const inCount = turnout?.ballotsIn ?? 0;
  const pct = total > 0 ? Math.min(100, (inCount / total) * 100) : 0;
  const quorumPct = total > 0 ? Math.min(100, (quorum / total) * 100) : 0;
  const metQuorum = inCount >= quorum;

  return (
    <div className="op-meter">
      <div
        className="op-meter__track"
        role="progressbar"
        aria-valuenow={inCount}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${inCount} of ${total} ballots cast`}
      >
        <div className="op-meter__fill" style={{ width: `${pct}%` }} />
        {/* The quorum mark is the point of the meter: turnout is a collective
            stake, and a bar with no threshold on it is just decoration. */}
        <div
          className="op-meter__quorum"
          style={{ left: `${quorumPct}%` }}
          aria-hidden="true"
          title={`Quorum: ${quorum}`}
        />
      </div>
      <p className="op-meter__label">
        <strong>
          {inCount} of {total}
        </strong>{' '}
        ballots in ·{' '}
        {metQuorum ? (
          <span className="op-meter__ok">quorum met</span>
        ) : (
          <span className="op-meter__short">{quorum - inCount} more for quorum</span>
        )}
      </p>
    </div>
  );
}

/** Deadline in the viewer's own timezone — see BallotBuilder's ClosesAt. */
function Closes({ iso }: { iso: string }) {
  const [text, setText] = useState('');
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
  return <>closes {text || 'soon'}</>;
}

async function loadPublicTurnout(
  leagueParam: string,
  cancelled: boolean,
  setTurnout: (t: { ballotsIn: number; eligible: number } | null) => void,
  setClosesAt: (s: string | null) => void,
) {
  try {
    const res = await fetch(
      `/api/owners-poll/turnout?league=${encodeURIComponent(leagueParam)}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) return;
    const data = await res.json();
    if (cancelled) return;
    if (data.turnout) setTurnout(data.turnout);
    if (data.closesAt) setClosesAt(data.closesAt);
  } catch {
    // The meter simply stays at its server-rendered zero. A missing count is
    // not worth an error state next to a working invitation.
  }
}
