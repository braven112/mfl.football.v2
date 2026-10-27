/**
 * The score overlay the Google TV app draws over YouTube TV.
 *
 * Two views of the same games, and the TV app picks which:
 *
 *  - the PANEL: one game at a time down the left of the screen, score, win
 *    chance and both starting lineups. The app gives it the remote while it is
 *    up, Left/Right steps through the owner's games, Back drops to the bar;
 *  - the BAR: a thin strip across the top with one chip per game, which never
 *    takes the remote, so YouTube TV keeps it.
 *
 * The panel also lists the NFL games the owner's starters are in (Watch).
 * Up/Down picks one and OK hands it to the app, which opens it on the TV; the
 * list ends with "Hide overlay", which closes the overlay altogether.
 *
 * The app talks to this page through `window.__mflOverlay` (`setMode`,
 * `step`, `move`, `select`), because the keys reach the APP's window, not the
 * page; the page answers through `window.MflOverlayHost` (`watch`, `hide`).
 * Arrow keys and Enter are also read here so the page can be checked in a
 * desktop browser.
 *
 * Numbers come from the board's own poll (`/api/broadcast-live`) and the
 * board's own model, through `overlayGames`; nothing here computes a score.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BroadcastPollResponse, LiveBroadcastPageData } from '../../../types/live-broadcast';
import type { PlayerMeta } from '../../../types/live-scoring';
import {
  formatChance,
  moveWatch,
  overlayGames,
  overlayWatchList,
  watchNote,
  overlayModeFrom,
  stepOverlay,
  type OverlayGame,
  type OverlayMode,
  type OverlaySide,
  type WatchGame,
} from '../../../utils/broadcast-overlay';

/** Same order of cadence as the board: live scoring moves every few seconds. */
const POLL_MS = 15_000;
const POLL_TIMEOUT_MS = 12_000;
/**
 * The overlay can sit on a TV for days. A reload re-reads the week and the
 * owner's leagues server-side, which the poll alone never does.
 */
const RELOAD_MS = 3 * 60 * 60_000;
/** A page that could not read the leagues at all tries again this soon. */
const RETRY_MS = 60_000;
/** How long the bar says how to open the panel, the first time it shows. */
const BAR_HINT_MS = 12_000;

interface OverlayHost {
  setMode: (mode: OverlayMode) => void;
  step: (delta: number) => void;
  /** Up/Down through the Watch list. */
  move: (delta: number) => void;
  /** OK on the highlighted Watch row. */
  select: () => void;
}

declare global {
  interface Window {
    __mflOverlay?: OverlayHost;
    /** The TV app's side of the bridge: which view its window is shaped for. */
    MflOverlayHost?: {
      mode: () => string;
      /** Open a game on the TV, by what a search for it should ask. Absent on app builds before Watch. */
      watch?: (query: string) => void;
      /** Close the overlay. */
      hide?: () => void;
    };
  }
}

interface Props {
  /** JSON of `LiveBroadcastPageData`, or null when this TV is not signed in. */
  pageData: string | null;
  /** Whether this TV (or browser) is signed in at all; null data then means a failed read. */
  signedIn: boolean;
  mode?: string | null;
  /** The owner's answer on /live/settings; decides how a regional game is labeled. */
  sundayTicket?: boolean;
}

const points = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');
const onePlace = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

export default function BroadcastOverlay({ pageData, signedIn, mode: initialMode, sundayTicket = false }: Props) {
  const data = useMemo<LiveBroadcastPageData | null>(
    () => (pageData ? (JSON.parse(pageData) as LiveBroadcastPageData) : null),
    [pageData],
  );
  const [mode, setMode] = useState<OverlayMode>(overlayModeFrom(initialMode));
  const [index, setIndex] = useState(0);
  const [poll, setPoll] = useState<BroadcastPollResponse | null>(data?.initial ?? null);
  const [meta, setMeta] = useState<Record<string, PlayerMeta>>(data?.playerMeta ?? {});
  const [stale, setStale] = useState(false);
  const [barHint, setBarHint] = useState(true);

  const games = useMemo<OverlayGame[]>(
    () => (data && poll ? overlayGames(data.panels, poll, meta) : []),
    [data, poll, meta],
  );
  const countRef = useRef(games.length);
  countRef.current = games.length;

  const watch = useMemo<WatchGame[]>(() => overlayWatchList(games, poll?.games ?? []), [games, poll]);
  // The highlighted Watch row; `watch.length` is the closing "Hide overlay" row.
  const [pick, setPick] = useState(0);
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const pickRef = useRef(pick);
  pickRef.current = Math.min(pick, watch.length);

  const move = useCallback((delta: number) => {
    setPick((i) => moveWatch(Math.min(i, watchRef.current.length), delta > 0 ? 1 : -1, watchRef.current.length));
  }, []);

  const select = useCallback(() => {
    const host = window.MflOverlayHost;
    const row = watchRef.current[pickRef.current];
    if (row) host?.watch?.(row.query);
    else host?.hide?.();
  }, []);

  const step = useCallback((delta: number) => {
    setIndex((i) => stepOverlay(i, delta, countRef.current));
  }, []);

  // The TV app's handle on the page. The app's own answer wins over `?mode=`:
  // a page that reloaded itself keeps the URL it first loaded with, while the
  // window may since have changed shape.
  useEffect(() => {
    const hostMode = window.MflOverlayHost?.mode();
    if (hostMode) setMode(overlayModeFrom(hostMode));
    window.__mflOverlay = {
      setMode: (next) => setMode(overlayModeFrom(next)),
      step: (delta) => step(delta > 0 ? 1 : -1),
      move,
      select,
    };
    return () => {
      delete window.__mflOverlay;
    };
  }, [step, move, select]);

  // A desktop browser has no app around the page; the arrows still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowUp') move(-1);
      else if (e.key === 'ArrowDown') move(1);
      else if (e.key === 'Enter') select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, move, select]);

  useEffect(() => {
    if (mode !== 'bar') return;
    const t = window.setTimeout(() => setBarHint(false), BAR_HINT_MS);
    return () => window.clearTimeout(t);
  }, [mode]);

  // A page that could not read the leagues tries again soon; a working one
  // still reloads now and then to pick up a new week.
  useEffect(() => {
    const t = window.setTimeout(() => window.location.reload(), data ? RELOAD_MS : RETRY_MS);
    return () => window.clearTimeout(t);
  }, [data]);

  // The poll. A failed one keeps the last good numbers and marks them stale,
  // the board's rule: an empty overlay mid-game reads as "nothing happening".
  useEffect(() => {
    if (!data || data.demo) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const params = new URLSearchParams({ leagues: data.enabled.join(','), week: String(data.week) });
        const testDate = new URLSearchParams(window.location.search).get('testDate');
        if (testDate) params.set('testDate', testDate);
        const res = await fetch(`/api/broadcast-live?${params}`, {
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        });
        const body = (await res.json()) as BroadcastPollResponse;
        if (!res.ok || body?.ok === false) throw new Error('poll not ok');
        if (cancelled) return;
        setPoll(body);
        if (body.playerMeta) setMeta((prev) => ({ ...prev, ...body.playerMeta }));
        setStale(false);
      } catch {
        if (!cancelled) setStale(true);
      }
      if (!cancelled) timer = window.setTimeout(run, POLL_MS);
    };
    timer = window.setTimeout(run, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data]);

  if (!data) {
    return (
      <div className={`bov bov--${mode}`}>
        <p className="bov__note">
          {signedIn
            ? 'Can’t reach your leagues right now. Trying again in a minute.'
            : 'Open MFL Football on this TV to sign it in, then start the overlay again.'}
        </p>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className={`bov bov--${mode}`}>
        <p className="bov__note">No games this week.</p>
      </div>
    );
  }

  if (mode === 'bar') {
    return (
      <div className="bov bov--bar" data-stale={stale || undefined}>
        <ul className="bov__chips">
          {games.map((game) => (
            <li className="bov__chip" key={game.key}>
              <span className="bov__chip-league">{game.leagueName}</span>
              <span className="bov__chip-team" style={{ ['--bov-team' as string]: game.mine.swatch }}>
                {game.mine.abbrev}
              </span>
              <b>{game.readable ? onePlace(game.mine.live) : '–'}</b>
              <span className="bov__chip-dash">–</span>
              <b>{game.readable ? onePlace(game.opponent.live) : '–'}</b>
              <span className="bov__chip-team" style={{ ['--bov-team' as string]: game.opponent.swatch }}>
                {game.opponent.abbrev}
              </span>
              {game.readable && <span className="bov__chip-chance">{formatChance(game.winChance)}</span>}
            </li>
          ))}
        </ul>
        {barHint && <p className="bov__hint">Open Score overlay again for the full panel</p>}
      </div>
    );
  }

  const game = games[Math.min(index, games.length - 1)];
  return (
    <div className="bov bov--panel" data-stale={stale || undefined}>
      <header className="bov__head">
        <span>{game.leagueName}</span>
        <span>Week {data.week}</span>
        {games.length > 1 && (
          <span>
            {Math.min(index, games.length - 1) + 1} / {games.length}
          </span>
        )}
      </header>

      <div className="bov__score">
        <Side side={game.mine} readable={game.readable} chance={game.winChance} />
        <span className="bov__vs">vs</span>
        <Side side={game.opponent} readable={game.readable} chance={1 - game.winChance} />
      </div>
      <div
        className="bov__bar"
        style={{
          ['--bov-split' as string]: `${(game.winChance * 100).toFixed(1)}%`,
          ['--bov-mine' as string]: game.mine.swatch,
          ['--bov-theirs' as string]: game.opponent.swatch,
        }}
        aria-hidden="true"
      />

      <p className="bov__label">Starting lineup</p>
      <div className="bov__lineups">
        <Lineup side={game.mine} />
        <Lineup side={game.opponent} />
      </div>

      <p className="bov__label">Watch</p>
      <ul className="bov__watch">
        {watch.length === 0 && <li className="bov__watch-empty">None of your starters are playing right now.</li>}
        {watch.map((row, i) => (
          <li key={row.id} className="bov__watch-row" data-picked={pickRef.current === i || undefined}>
            <span className="bov__watch-game">
              {row.live && <span className="bov__live">Live</span>}
              {row.label}
            </span>
            <span className="bov__watch-detail">{[row.detail, watchNote(row, sundayTicket)].filter(Boolean).join(' · ')}</span>
            <span className="bov__watch-players">{row.players.join(', ')}</span>
          </li>
        ))}
        <li className="bov__watch-row bov__watch-row--hide" data-picked={pickRef.current === watch.length || undefined}>
          Hide overlay
        </li>
      </ul>

      <footer className="bov__keys">
        <span>▲ ▼ OK Pick</span>
        {games.length > 1 && <span>◀ ▶ Next matchup</span>}
        <span>BACK Score bar</span>
        {stale && <span className="bov__stale">Reconnecting</span>}
      </footer>
    </div>
  );
}

function Side({ side, readable, chance }: { side: OverlaySide; readable: boolean; chance: number }) {
  return (
    <div className="bov__side">
      <p className="bov__team">{side.name}</p>
      <p className="bov__points">{readable ? points(side.live) : '–'}</p>
      <p className="bov__proj">Proj {readable ? points(side.projectedFinal) : '–'}</p>
      {readable && <p className="bov__chance">Win chance {formatChance(chance)}</p>}
    </div>
  );
}

function Lineup({ side }: { side: OverlaySide }) {
  return (
    <ol className="bov__lineup">
      {side.lineup.map((player) => (
        <li key={player.id}>
          <span className="bov__pos">{player.position}</span>
          <span className="bov__name">{player.name}</span>
          <span className="bov__pts">{onePlace(player.live)}</span>
          <span className="bov__pproj">{onePlace(player.projected)}</span>
        </li>
      ))}
    </ol>
  );
}
