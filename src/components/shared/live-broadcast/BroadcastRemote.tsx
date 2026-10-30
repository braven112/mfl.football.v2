/**
 * The phone as a remote for the owner's paired TVs
 * (docs/plans/broadcast-handheld.md, Phase 4).
 *
 * A button in the handheld board's bar, drawn only when the signed-in owner
 * has a TV paired. It opens a panel of DISPLAY commands — focus one league,
 * turn the strip a page, sound on or off, back to the full board, and the TV
 * app's score overlay (small or a quarter of the screen, which corner, next
 * game: mid-show the TV's own remote belongs to the show) — each a
 * closed-list string the server checks against the owner's own TV list and
 * the TV checks again before it applies it.
 *
 * What it cannot do, and says so: a browser grants full screen and starts
 * audio only after a tap ON that device, so the TV needs one touch of its
 * own. A button that silently did nothing would be worse than the sentence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BroadcastLeaguePanel } from '../../../types/live-broadcast';
import { formatRemoteCommand, type RemoteCommand } from '../../../utils/broadcast-remote-commands';

interface PairedTv {
  id: string;
  device: string;
  createdAt: number;
}

interface Props {
  /** The board's leagues — the ones a TV paired from this owner can focus. */
  panels: readonly BroadcastLeaguePanel[];
}

/** Re-announce an open remote well inside the TV's 3-minute listening window. */
const KEEPALIVE_MS = 90_000;
const NOTE_MS = 2500;

export default function BroadcastRemote({ panels }: Props) {
  const [tvs, setTvs] = useState<PairedTv[]>([]);
  const [open, setOpen] = useState(false);
  const [tvId, setTvId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast-tv/remote', { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const body = (await res.json()) as { tvs?: PairedTv[] };
        if (cancelled || !Array.isArray(body.tvs)) return;
        setTvs(body.tvs);
        setTvId((prev) => prev ?? body.tvs?.[0]?.id ?? null);
      } catch (_err) {
        /* no TVs to offer; the button simply does not appear */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const post = useCallback(
    async (command: string): Promise<number> => {
      if (!tvId) return 0;
      try {
        const res = await fetch('/api/broadcast-tv/remote', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ passId: tvId, command }),
        });
        return res.status;
      } catch (_err) {
        return 0;
      }
    },
    [tvId],
  );

  const send = useCallback(
    async (command: RemoteCommand, label: string) => {
      const status = await post(formatRemoteCommand(command));
      setNote(
        status === 200
          ? `${label} — sent`
          : status === 404
            ? 'That TV is no longer paired'
            : status === 429
              ? 'Too many presses, try again in a moment'
              : 'Could not reach the TV',
      );
    },
    [post],
  );

  // Opening the remote wakes the TV's fast check, and keeps it awake while
  // the panel stays open.
  useEffect(() => {
    if (!open || !tvId) return;
    void post('open');
    const id = window.setInterval(() => void post('open'), KEEPALIVE_MS);
    return () => window.clearInterval(id);
  }, [open, tvId, post]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(''), NOTE_MS);
    return () => window.clearTimeout(id);
  }, [note]);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (tvs.length === 0) return null;

  // Two TVs of one kind ("Fire TV", "Fire TV") read as a choice between
  // nothing, so a repeated name is numbered in pairing order.
  const tvLabel = (tv: PairedTv, i: number) => {
    const same = tvs.filter((t) => t.device === tv.device);
    return same.length > 1 ? `${tv.device} ${same.indexOf(tv) + 1}` : tvs[i].device;
  };

  // Only a league the TV can be told about: MFL ids are digits.
  const leagues = panels.filter((p) => /^\d{1,12}$/.test(p.leagueId));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lbh__remote-btn"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        TV remote
      </button>

      {open && (
        <>
          <div className="lbh__backdrop" onClick={close} aria-hidden="true" />
          <section className="lbh__sheet lbh__remote" role="dialog" aria-modal="true" aria-labelledby="lbh-remote-title">
            <header className="lbh__sheet-head">
              <span className="lbh__grabber" aria-hidden="true" />
              <h2 id="lbh-remote-title" className="lbh__sheet-title">TV remote</h2>
              <button ref={closeRef} type="button" className="lbh__sheet-close" onClick={close} aria-label="Close TV remote">
                ×
              </button>
            </header>

            <div className="lbh__remote-body">
              {tvs.length > 1 && (
                <div className="lbh__remote-row" role="group" aria-label="Which TV">
                  <span className="lbh__remote-label">TV</span>
                  {tvs.map((tv, i) => (
                    <button
                      key={tv.id}
                      type="button"
                      className="lbh__remote-chip"
                      aria-pressed={tv.id === tvId}
                      onClick={() => setTvId(tv.id)}
                    >
                      {tvLabel(tv, i)}
                    </button>
                  ))}
                </div>
              )}

              <div className="lbh__remote-row" role="group" aria-label="Show on the TV">
                <span className="lbh__remote-label">Show</span>
                <button
                  type="button"
                  className="lbh__remote-chip"
                  aria-pressed={focus === null}
                  onClick={() => {
                    setFocus(null);
                    void send({ kind: 'reset' }, 'All leagues');
                  }}
                >
                  All leagues
                </button>
                {leagues.map((p) => (
                  <button
                    key={p.leagueId}
                    type="button"
                    className="lbh__remote-chip"
                    aria-pressed={focus === p.leagueId}
                    onClick={() => {
                      setFocus(p.leagueId);
                      void send({ kind: 'pin-league', leagueId: p.leagueId }, p.leagueName);
                    }}
                  >
                    {p.leagueName}
                  </button>
                ))}
              </div>

              <div className="lbh__remote-row" role="group" aria-label="Score overlay size">
                <span className="lbh__remote-label">Overlay</span>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'overlay', action: 'small' }, 'Small score box')}>
                  Small
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'overlay', action: 'quarter' }, 'Quarter of the screen')}>
                  Quarter screen
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'page', dir: 'next' }, 'Next game')}>
                  Next game ›
                </button>
              </div>

              <div className="lbh__remote-row" role="group" aria-label="Score overlay corner">
                <span className="lbh__remote-label">Corner</span>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'overlay', action: 'top' }, 'Overlay at the top')}>
                  Top
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'overlay', action: 'bottom' }, 'Overlay at the bottom')}>
                  Bottom
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'overlay', action: 'left' }, 'Overlay on the left')}>
                  Left
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'overlay', action: 'right' }, 'Overlay on the right')}>
                  Right
                </button>
              </div>

              <div className="lbh__remote-row" role="group" aria-label="Player strip">
                <span className="lbh__remote-label">Players</span>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'page', dir: 'prev' }, 'Previous page')}>
                  ‹ Previous
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'page', dir: 'next' }, 'Next page')}>
                  Next ›
                </button>
              </div>

              <div className="lbh__remote-row" role="group" aria-label="Sound">
                <span className="lbh__remote-label">Sound</span>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'sound', on: true }, 'Sound on')}>
                  On
                </button>
                <button type="button" className="lbh__remote-chip" onClick={() => void send({ kind: 'sound', on: false }, 'Sound off')}>
                  Off
                </button>
              </div>

              <p className="lbh__remote-hint">
                Full screen, and the first sound, need one tap on the TV itself. Browsers only allow those from the
                screen they happen on.
              </p>
              <p className="lbh__remote-note" role="status" aria-live="polite">
                {note}
              </p>
            </div>
          </section>
        </>
      )}
    </>
  );
}
