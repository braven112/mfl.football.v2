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
import { clockZonesFromCookie, formatMomentOrDevice } from '../../../utils/viewer-clock';
import type { LeagueClock } from '../../../utils/viewer-preferences';

interface Props {
  ballotHref: string;
  slots: number;
  eligibleVoters: number;
  leagueParam: string;
  /** Week from the rendered issue — used only to detect a stale build. */
  issueWeek: number;
  /**
   * This league's official clock, from the registry. A browser has no
   * registry to ask, so the page hands it down; absent, the deadline falls
   * back to the site's own clock.
   */
  officialClock?: LeagueClock;
}

/**
 * `paused` replaced `closed`. Voting never closes any more, so the only state
 * that refuses a ballot is a commissioner suspending the poll.
 */
type Phase = 'loading' | 'open' | 'voted' | 'paused' | 'unavailable' | 'signed-out';

interface BallotResponse {
  status: 'open' | 'paused';
  window: { week: number; closesAt: string } | null;
  ballot: { ranking: string[]; updatedAt: string | null } | null;
  stale?: boolean;
  turnout?: { ballotsIn: number; eligible: number };
}

export default function OwnersPollLive({
  ballotHref,
  slots,
  eligibleVoters,
  leagueParam,
  issueWeek,
  officialClock,
}: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [turnout, setTurnout] = useState<{ ballotsIn: number; eligible: number } | null>(null);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [affirming, setAffirming] = useState(false);
  const [affirmed, setAffirmed] = useState(false);

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
        // Staleness is computed SERVER-side against one clock, so this island,
        // the homepage card and the push builder cannot disagree about whose
        // ballot has gone stale.
        setStale(Boolean(data.stale));
        setUpdatedAt(data.ballot?.updatedAt ?? null);

        if (data.status !== 'open') setPhase('paused');
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

  if (phase === 'paused') {
    return (
      <p className="op-strip__note">
        Voting is paused by the commissioner. Every standing ballot is untouched.
      </p>
    );
  }

  const weeksOld = weeksSince(updatedAt);

  async function affirm() {
    setAffirming(true);
    try {
      const res = await fetch(`/api/owners-poll/affirm?league=${encodeURIComponent(leagueParam)}`, {
        method: 'POST',
        credentials: 'same-origin',
        // Astro 403s a non-GET with no content type unless Origin matches
        // exactly, and some browsers omit Origin — without this the affirm
        // silently fails for those viewers. Pinned by
        // tests/origin-check-content-type.test.ts.
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setAffirmed(true);
        setStale(false);
      }
    } catch {
      // Silent. Failing to re-affirm changes nothing about the ballot, so an
      // error banner would be louder than the consequence.
    } finally {
      setAffirming(false);
    }
  }

  return (
    <div className="op-strip__live">
      <Coverage turnout={turnout} eligibleVoters={eligibleVoters} />

      {phase === 'voted' ? (
        <>
          <p className="op-strip__cta">
            <strong>Your ballot stands.</strong>{' '}
            <a href={ballotHref}>Change it</a> any time
            {closesAt ? <> · next result <Closes iso={closesAt} league={officialClock} /></> : null}.
          </p>
          {/* The one thing standing votes genuinely need. A ballot nobody has
              revisited is republished every week as though its owner
              re-affirmed it, so this turns standing pat back into a choice. */}
          {stale && !affirmed && (
            <p className="op-strip__stale">
              {weeksOld != null && weeksOld >= 2
                ? `Your ballot is ${weeksOld} weeks old.`
                : 'Your ballot has been sitting a while.'}{' '}
              Still how you see it?{' '}
              <button
                type="button"
                className="op-strip__affirm"
                onClick={affirm}
                disabled={affirming}
              >
                {affirming ? 'Saving…' : 'Still good'}
              </button>
            </p>
          )}
          {affirmed && (
            <p className="op-strip__stale" role="status">
              Thanks — your ballot is confirmed for this week.
            </p>
          )}
        </>
      ) : phase === 'signed-out' ? (
        <p className="op-strip__cta">
          Owners rank their top {slots}, and the ballot stands until they change it.{' '}
          <a href={ballotHref}>Sign in to vote</a>.
        </p>
      ) : (
        <p className="op-strip__cta">
          <a className="op-strip__button" href={ballotHref}>
            Rank your top {slots}
          </a>{' '}
          <span className="op-strip__tease">
            Voting is always open — your ballot stands until you change it
            {closesAt ? <> · next result <Closes iso={closesAt} league={officialClock} /></> : null}.
          </span>
        </p>
      )}
    </div>
  );
}

/** Whole weeks since an edit, for the staleness line. */
function weeksSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / (7 * 86400 * 1000)));
}

/**
 * Coverage, not turnout — and deliberately not a bar any more.
 *
 * Under standing votes this number only ever grows and settles near the whole
 * league by midseason, so presenting a climbing count as "this week's
 * participation" would be false. What it honestly answers is how much of the
 * league has an opinion on file.
 *
 * The progress bar went with the quorum mark. The mark's own comment said it
 * "is the point of the meter: a bar with no threshold on it is just
 * decoration" — which, once there is no threshold, is an argument for removing
 * the bar rather than keeping an empty one.
 */
function Coverage({
  turnout,
  eligibleVoters,
}: {
  turnout: { ballotsIn: number; eligible: number } | null;
  eligibleVoters: number;
}) {
  const total = turnout?.eligible ?? eligibleVoters;
  const inCount = turnout?.ballotsIn ?? 0;

  return (
    <p className="op-coverage">
      <strong>
        {inCount} of {total}
      </strong>{' '}
      owners have a ballot on file
    </p>
  );
}

/** Deadline in the viewer's chosen clock, else the device's — see BallotBuilder's ClosesAt. */
function Closes({ iso, league }: { iso: string; league?: LeagueClock }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setText(formatMomentOrDevice(d, clockZonesFromCookie(document.cookie, league), { weekday: true }));
  }, [iso, league]);
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
