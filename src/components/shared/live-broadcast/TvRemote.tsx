/**
 * Remote mode: the whole phone screen as a remote for the owner's paired TV
 * (`/live/broadcast/remote`). The same closed command list as the board's
 * TV remote sheet, laid out as big buttons for a thumb in a dark room, with
 * the score overlay first because mid-game the TV's own remote belongs to
 * the show underneath.
 *
 * The corner is picked on a drawing of the screen: one tap sends ONE command
 * naming both halves (`overlay:top-right`), because the server keeps only the
 * latest command and an edge and a side sent apart could lose the edge.
 *
 * What it cannot do, and says so: a browser grants full screen and starts
 * audio only after a tap ON that device, so the TV needs one touch of its own.
 */
import { useEffect, useRef, useState } from 'react';
import type { OverlayAction, OverlayCorner } from '../../../utils/broadcast-remote-commands';
import {
  defaultTvId,
  readChosenTv,
  rememberChosenTv,
  tvLabel,
  usePairedTvs,
  useTvRemote,
  type PairedTv,
} from './useTvRemote';

export interface TvRemoteLeague {
  id: string;
  name: string;
}

interface Props {
  /** Every league the owner is in — the ones a TV can be told to show. */
  leagues: readonly TvRemoteLeague[];
  /** The leagues a TV shows when nobody has picked (the full-management ones). */
  defaults?: readonly string[];
  /** The paired TVs, when already known; otherwise they are fetched. */
  tvs?: PairedTv[];
}

const CORNERS: { key: OverlayCorner; label: string }[] = [
  { key: 'top-left', label: 'Upper left' },
  { key: 'top-right', label: 'Upper right' },
  { key: 'bottom-left', label: 'Lower left' },
  { key: 'bottom-right', label: 'Lower right' },
];

/** Whether the page is on screen: a phone in a pocket should let the TV rest. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export default function TvRemote({ leagues, defaults = [], tvs: knownTvs }: Props) {
  const tvs = usePairedTvs(knownTvs);
  const [tvId, setTvId] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    // Arriving from a fresh pairing: the TV just paired, not a remembered one.
    const newest = new URLSearchParams(window.location.search).get('tv') === 'newest';
    setRemembered(newest ? null : readChosenTv());
  }, []);
  const [size, setSize] = useState<'small' | 'quarter' | null>(null);
  const [shownOnTv, setShownOnTv] = useState<boolean | null>(null);
  const [corner, setCorner] = useState<string | null>(null);
  // The league set being edited, per TV: null until touched, so it starts
  // from what that TV shows now.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const visible = usePageVisible();
  const activeId = tvId ?? (tvs ? defaultTvId(tvs, remembered) : null);
  // A fresh pairing becomes this phone's TV from now on, not just this visit.
  useEffect(() => {
    if (!tvs?.length || new URLSearchParams(window.location.search).get('tv') !== 'newest') return;
    rememberChosenTv(tvs[tvs.length - 1].id);
  }, [tvs]);
  const { send, sendLeagues, note } = useTvRemote(activeId, visible);
  // A tap on a league goes to the TV by itself, a moment later, so a few
  // quick taps reload the TV once. There used to be a separate "Show these
  // leagues" button, and a tap that looked done never reached the TV.
  const leagueTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leagueTimer.current), []);

  if (tvs === null) {
    return <p className="tvr__status">Finding your TVs…</p>;
  }

  if (tvs.length === 0) {
    return (
      <div className="tvr__empty">
        <p className="tvr__empty-title">No TV paired yet</p>
        <p className="tvr__empty-body">
          Open MFL Football on your TV, or go to mfl.football/tv in the TV's browser, then scan the code it shows.
        </p>
        <p className="tvr__empty-body">
          Already paired one? A TV belongs to the team you were signed in as when you paired it, so sign in as that
          team, or pair it again here.
        </p>
        <a className="cta cta--primary" href="/live/broadcast/pair">
          Pair a TV
        </a>
      </div>
    );
  }

  const overlay = (action: OverlayAction) => ({ kind: 'overlay' as const, action });
  const pickable = leagues.filter((l) => /^\d{1,12}$/.test(l.id));
  const activeTv = tvs.find((t) => t.id === activeId) ?? null;
  const shown = activeId ? (picked[activeId] ?? tvShows(activeTv, pickable, defaults)) : [];
  const toggle = (id: string) => {
    if (!activeId) return;
    const next = shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id];
    // Board order, so the TV's panels keep their usual order. The last league
    // stays on: an empty board is never what a tap means.
    const ordered = pickable.map((l) => l.id).filter((x) => next.includes(x));
    if (ordered.length === 0) return;
    setPicked((prev) => ({ ...prev, [activeId]: ordered }));
    window.clearTimeout(leagueTimer.current);
    leagueTimer.current = window.setTimeout(
      () => void sendLeagues(ordered, `${ordered.length} league${ordered.length === 1 ? '' : 's'} on the TV`),
      LEAGUE_SEND_DELAY_MS,
    );
  };

  return (
    <div className="tvr">
      {tvs.length > 1 && (
        <div className="tvr__tvs" role="group" aria-label="Which TV">
          {tvs.map((tv) => (
            <button
              key={tv.id}
              type="button"
              className="tvr__choice"
              aria-pressed={tv.id === activeId}
              onClick={() => {
                setTvId(tv.id);
                rememberChosenTv(tv.id);
              }}
            >
              {tvLabel(tvs, tv)}
            </button>
          ))}
        </div>
      )}

      <section className="tvr__group" aria-labelledby="tvr-overlay">
        <h2 id="tvr-overlay" className="tvr__heading">
          Score overlay
        </h2>
        <div className="tvr__pair" role="group" aria-label="Overlay on or off">
          <button
            type="button"
            className="tvr__big"
            aria-pressed={shownOnTv === true}
            onClick={() => {
              setShownOnTv(true);
              void send(overlay('show'), 'Overlay on');
            }}
          >
            Overlay on
          </button>
          <button
            type="button"
            className="tvr__big"
            aria-pressed={shownOnTv === false}
            onClick={() => {
              setShownOnTv(false);
              void send(overlay('hide'), 'Overlay off');
            }}
          >
            Overlay off
          </button>
        </div>
        <p className="tvr__hint">
          Off hides the scores and keeps the overlay ready. If you turned it off from the TV, start it again on the
          TV.
        </p>

        <p className="tvr__sub">Size</p>
        <div className="tvr__pair" role="group" aria-label="Overlay size">
          <button
            type="button"
            className="tvr__big"
            aria-pressed={size === 'small'}
            onClick={() => {
              setSize('small');
              void send(overlay('small'), 'Small score box');
            }}
          >
            <span className="tvr__glyph tvr__glyph--small" aria-hidden="true" />
            Small
          </button>
          <button
            type="button"
            className="tvr__big"
            aria-pressed={size === 'quarter'}
            onClick={() => {
              setSize('quarter');
              void send(overlay('quarter'), 'Quarter of the screen');
            }}
          >
            <span className="tvr__glyph tvr__glyph--quarter" aria-hidden="true" />
            Quarter screen
          </button>
        </div>

        <p className="tvr__sub">Corner</p>
        <div className="tvr__screen" role="group" aria-label="Overlay corner">
          {CORNERS.map(({ key, label }) => {
            return (
              <button
                key={key}
                type="button"
                className={`tvr__corner tvr__corner--${key}`}
                aria-pressed={corner === key}
                aria-label={label}
                onClick={() => {
                  setCorner(key);
                  void send(overlay(key), label);
                }}
              >
                <span className="tvr__corner-mark" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <button type="button" className="tvr__big tvr__big--wide" onClick={() => void send({ kind: 'page', dir: 'next' }, 'Next game')}>
          Next game ›
        </button>
      </section>

      {pickable.length > 1 && (
        <section className="tvr__group" aria-labelledby="tvr-leagues">
          <h2 id="tvr-leagues" className="tvr__heading">
            Leagues on the TV
          </h2>
          <div className="tvr__choices" role="group" aria-label="Leagues on the TV">
            {pickable.map((l) => (
              <button
                key={l.id}
                type="button"
                className="tvr__choice"
                aria-pressed={shown.includes(l.id)}
                onClick={() => toggle(l.id)}
              >
                {l.name}
              </button>
            ))}
          </div>
          <p className="tvr__hint">Tap to add or remove a league. The board and the score overlay reload to match.</p>
        </section>
      )}

      <section className="tvr__group" aria-labelledby="tvr-board">
        <h2 id="tvr-board" className="tvr__heading">
          Full board
        </h2>
        <div className="tvr__pair" role="group" aria-label="Player pages">
          <button type="button" className="tvr__big" onClick={() => void send({ kind: 'page', dir: 'prev' }, 'Previous page')}>
            ‹ Previous
          </button>
          <button type="button" className="tvr__big" onClick={() => void send({ kind: 'page', dir: 'next' }, 'Next page')}>
            Next ›
          </button>
        </div>
        <div className="tvr__pair" role="group" aria-label="Sound">
          <button type="button" className="tvr__big" onClick={() => void send({ kind: 'sound', on: true }, 'Sound on')}>
            Sound on
          </button>
          <button type="button" className="tvr__big" onClick={() => void send({ kind: 'sound', on: false }, 'Sound off')}>
            Sound off
          </button>
        </div>
        <p className="tvr__hint">
          Full screen, and the first sound, need one tap on the TV itself. Browsers only allow those from the screen
          they happen on.
        </p>
      </section>

      <p className="tvr__note" role="status" aria-live="polite">
        {note}
      </p>
    </div>
  );
}

/**
 * The leagues a TV shows now, as ids among the owner's leagues: its stored
 * set when one survives, else the default set.
 */
/** Long enough for a few quick taps to become one reload on the TV. */
const LEAGUE_SEND_DELAY_MS = 1200;

export function tvShows(
  tv: Pick<PairedTv, 'leagues'> | null,
  leagues: readonly TvRemoteLeague[],
  defaults: readonly string[],
): string[] {
  const ids = leagues.map((l) => l.id);
  const stored = (tv?.leagues ?? '').split(',').filter((id) => ids.includes(id));
  if (stored.length) return ids.filter((id) => stored.includes(id));
  return ids.filter((id) => defaults.includes(id));
}
