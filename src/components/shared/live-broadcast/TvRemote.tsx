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
import { useEffect, useState } from 'react';
import type { OverlayAction, OverlayCorner } from '../../../utils/broadcast-remote-commands';
import { tvLabel, usePairedTvs, useTvRemote, type PairedTv } from './useTvRemote';

export interface TvRemoteLeague {
  id: string;
  name: string;
}

interface Props {
  /** The leagues the owner's board watches — the ones a TV can focus. */
  leagues: readonly TvRemoteLeague[];
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

export default function TvRemote({ leagues, tvs: knownTvs }: Props) {
  const tvs = usePairedTvs(knownTvs);
  const [tvId, setTvId] = useState<string | null>(null);
  const [size, setSize] = useState<'small' | 'quarter' | null>(null);
  const [corner, setCorner] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const visible = usePageVisible();
  const activeId = tvId ?? tvs?.[0]?.id ?? null;
  const { send, note } = useTvRemote(activeId, visible);

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
        <a className="cta cta--primary" href="/live/broadcast/pair">
          Pair a TV
        </a>
      </div>
    );
  }

  const overlay = (action: OverlayAction) => ({ kind: 'overlay' as const, action });
  const pinnable = leagues.filter((l) => /^\d{1,12}$/.test(l.id));

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
              onClick={() => setTvId(tv.id)}
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

      <section className="tvr__group" aria-labelledby="tvr-board">
        <h2 id="tvr-board" className="tvr__heading">
          Full board
        </h2>
        {pinnable.length > 1 && (
          <div className="tvr__choices" role="group" aria-label="Show on the TV">
            <button
              type="button"
              className="tvr__choice"
              aria-pressed={focus === null}
              onClick={() => {
                setFocus(null);
                void send({ kind: 'reset' }, 'All leagues');
              }}
            >
              All leagues
            </button>
            {pinnable.map((l) => (
              <button
                key={l.id}
                type="button"
                className="tvr__choice"
                aria-pressed={focus === l.id}
                onClick={() => {
                  setFocus(l.id);
                  void send({ kind: 'pin-league', leagueId: l.id }, l.name);
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}
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
