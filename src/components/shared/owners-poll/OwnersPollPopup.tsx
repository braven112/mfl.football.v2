/**
 * The Owners' Poll homepage pop-up — a quick-vote sheet for the owners the
 * poll actually needs: no ballot on file, or a ballot gone stale.
 *
 * Everyone else sees nothing. Signed out, a current ballot, a paused poll, a
 * failed read, or already shown on this device in the last week (see
 * `popupReason`) all render null, so the homepage is unchanged for almost
 * everyone almost always.
 *
 * The sheet IS the ballot: the same BallotBuilder the poll page renders, with
 * every team's record, points and all-play on the card, so an owner can rank,
 * adjust and send without leaving the homepage.
 *
 * MOUNT WITH client:idle, never client:visible — an island that renders null
 * until it has fetched has zero height and never hydrates (the same note as
 * OwnersPollHomeCardPrompt).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import BallotBuilder, { type BallotTeam } from './BallotBuilder';
import { popupReason, popupStorageKey, type PopupReason } from '../../../utils/owners-poll-popup';
import type { LeagueClock } from '../../../utils/viewer-preferences';

interface Props {
  leagueSlug: string;
  leagueParam: string;
  teams: BallotTeam[];
  slots: number;
  ownFranchiseId?: string;
  ballotHref: string;
  columnHref: string;
  officialClock?: LeagueClock;
  vapidPublicKey?: string;
}

function readStamp(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStamp(key: string) {
  try {
    window.localStorage.setItem(key, new Date().toISOString());
  } catch {
    // Blocked storage only means the pop-up may show again. Never an error.
  }
}

export default function OwnersPollPopup({
  leagueSlug,
  leagueParam,
  teams,
  slots,
  ownFranchiseId = '',
  ballotHref,
  columnHref,
  officialClock,
  vapidPublicKey,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<PopupReason | null>(null);
  const [weeksOld, setWeeksOld] = useState<number | null>(null);
  const [affirmed, setAffirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owners-poll/ballot?league=${encodeURIComponent(leagueParam)}`, {
          credentials: 'same-origin',
        });
        // Signed out, or not an owner in this league: the common case. Silence.
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const key = popupStorageKey(leagueSlug);
        const next = popupReason({
          status: data?.status,
          hasBallot: Boolean(data?.ballot),
          stale: Boolean(data?.stale),
          lastShownAt: readStamp(key),
          now: new Date(),
          force: new URLSearchParams(window.location.search).get('pollPopup'),
        });
        if (!next) return;
        // Another homepage dialog (Throwback Week's welcome) already has the
        // screen. Two stacked modals is worse than waiting a visit.
        if (document.querySelector('dialog[open]')) return;
        const updated = Date.parse(data?.ballot?.updatedAt ?? '');
        if (Number.isFinite(updated)) {
          setWeeksOld(Math.floor((Date.now() - updated) / (7 * 86400 * 1000)));
        }
        // Stamped on OPEN, like the Throwback modal: walking away without
        // dismissing it still counts as having been asked this week.
        writeStamp(key);
        setReason(next);
      } catch {
        // A bonus prompt on a page someone came to for something else. A
        // failed read must never put an error on the homepage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueParam, leagueSlug]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (reason && dialog && !dialog.open) dialog.showModal();
  }, [reason]);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setReason(null);
  }, []);

  const affirm = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/owners-poll/affirm?league=${encodeURIComponent(leagueParam)}`, {
        method: 'POST',
        credentials: 'same-origin',
        // Astro 403s a non-GET with no content type unless Origin matches
        // exactly (tests/origin-check-content-type.test.ts).
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) setAffirmed(true);
    } catch {
      // Failing to affirm changes nothing about the ballot; the sheet stays.
    } finally {
      setBusy(false);
    }
  }, [leagueParam]);

  const onSaved = useCallback(() => setSaved(true), []);

  if (!reason) return null;

  return (
    <dialog
      ref={dialogRef}
      className="op-popup"
      aria-labelledby="op-popup-title"
      onClose={() => setReason(null)}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialogRef.current) close();
      }}
    >
      <header className="op-popup__head">
        <div>
          <p className="op-popup__eyebrow">The Owners’ Poll</p>
          <h2 className="op-popup__title" id="op-popup-title">
            {affirmed || saved
              ? 'You’re in.'
              : reason === 'stale'
                ? 'Is your ballot still right?'
                : 'How do you rank the league?'}
          </h2>
        </div>
        <button type="button" className="op-popup__close" onClick={close} aria-label="Close">
          ×
        </button>
      </header>

      <div className="op-popup__body">
        {affirmed || saved ? (
          <div className="op-popup__done" role="status">
            <p>{saved ? 'Ballot saved. It stands until you change it.' : 'Thanks. Your ballot is confirmed.'}</p>
            <p className="op-popup__actions">
              <a className="cta cta--primary" href={`${ballotHref}#op-results`}>
                See the owners’ rankings
              </a>
              <button type="button" className="cta cta--ghost" onClick={close}>
                Done
              </button>
            </p>
          </div>
        ) : (
          <>
            <p className="op-popup__lede">
              {reason === 'stale'
                ? `You set your top ${slots} ${weeksOld && weeksOld >= 2 ? `${weeksOld} weeks ago` : 'a while ago'}. Keep it, or make a few changes and send.`
                : `Tap teams in the order you rate them, then send. Every team's record, points and all-play are on its card, and your own team counts.`}
            </p>
            {reason === 'stale' && (
              <p className="op-popup__actions">
                <button type="button" className="cta cta--primary" onClick={affirm} disabled={busy}>
                  {busy ? 'Saving…' : 'Still good'}
                </button>
              </p>
            )}
            <BallotBuilder
              teams={teams}
              slots={slots}
              leagueParam={leagueParam}
              ownFranchiseId={ownFranchiseId}
              columnHref={columnHref}
              vapidPublicKey={vapidPublicKey}
              officialClock={officialClock}
              onSaved={onSaved}
              compact
            />
          </>
        )}
      </div>

      {!(affirmed || saved) && (
        <footer className="op-popup__foot">
          <button type="button" className="cta-link" onClick={close}>
            Not now
          </button>
        </footer>
      )}
    </dialog>
  );
}
