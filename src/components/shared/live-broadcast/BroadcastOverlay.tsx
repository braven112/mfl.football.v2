/**
 * The score overlay the Google TV app draws over YouTube TV.
 *
 * Three views of the same games, and the TV app picks which:
 *
 *  - the BAR: the ticker strip, one line at the top or bottom of the screen
 *    (the owner picks, to dodge the network's own graphics). It rotates
 *    through the owner's games and announces his own starters' big plays. It
 *    never takes the remote, so YouTube TV keeps it;
 *  - EXPANDED: the strip opened into both starting lineups of one game, with
 *    whoever just scored lit up. The app holds the remote: Left/Right steps
 *    through the games, Up/Down moves the strip to the top or bottom, OK opens
 *    the panel, Back returns to the bar;
 *  - the PANEL: one game at a time down the left of the screen, score, win
 *    chance and both starting lineups. The app gives it the remote while it is
 *    up, Left/Right steps through the owner's games, Back drops to the bar.
 *
 * The panel also lists the NFL games the owner's starters are in (Watch).
 * Up/Down picks one and OK hands it to the app, which opens it on the TV; the
 * list ends with "Hide overlay", which closes the overlay altogether.
 *
 * The app talks to this page through `window.__mflOverlay` (`setMode`,
 * `setEdge`, `step`, `move`, `select`), because the keys reach the APP's window, not the
 * page; the page answers through `window.MflOverlayHost` (`watch`, `hide`).
 *
 * The owner's phone steers it too, through the board's TV remote: while a
 * show plays every key belongs to the show, so the phone is the only way to
 * open the lineups or move the strip mid-game. Its commands arrive on the
 * poll (and a one-second check while the phone has the remote open) and go
 * to the app as `lineups` and `moveTo`; on a build without them they do
 * nothing, since the app's window, not the page, sets the overlay's size.
 * Arrow keys and Enter are also read here so the page can be checked in a
 * desktop browser.
 *
 * Numbers come from the board's own poll (`/api/broadcast-live`) and the
 * board's own model, through `overlayGames`; nothing here computes a score.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BroadcastPollResponse, LiveBroadcastPageData } from '../../../types/live-broadcast';
import type { NflGame, PlayerMeta } from '../../../types/live-scoring';
import { parseRemoteCommand, type RemoteState } from '../../../utils/broadcast-remote-commands';
import { normalizeTeamCode } from '../../../utils/nfl-logo';
import {
  detectBigPlays,
  formatChance,
  overlayEdgeFrom,
  moveWatch,
  overlayGames,
  overlayWatchList,
  watchNote,
  overlayModeFrom,
  stepOverlay,
  type BigPlayAlert,
  type OverlayEdge,
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
/** How long the bar says how to move or turn it off (the main app's Back menu), the first time it shows. */
const BAR_HINT_MS = 12_000;
/** How long the ticker shows each of the owner's games before the next. */
const ROTATE_MS = 8_000;
/** How long a big-play banner covers the ticker. */
const ALERT_MS = 7_000;
/** How long a starter stays lit up in the expanded lineups after a big play. */
const JUST_SCORED_MS = 90_000;
/** While the phone has the remote open, how often to check for its next press. */
const REMOTE_CHECK_MS = 1000;
const REMOTE_CHECK_TIMEOUT_MS = 4000;
/** The app's own mark, light on dark: the overlay is always dark. */
const LOGO_SRC = '/assets/mfl-live/icon-v2.svg';

interface OverlayHost {
  setMode: (mode: OverlayMode) => void;
  /** Which edge the app has put the strip's window on. */
  setEdge: (edge: OverlayEdge) => void;
  step: (delta: number) => void;
  /** Up/Down through the Watch list. */
  move: (delta: number) => void;
  /** OK on the highlighted Watch row. */
  select: () => void;
  /** The lineups are open from the phone: the TV's remote is still the show's. */
  setPassive?: (passive: boolean) => void;
}

declare global {
  interface Window {
    __mflOverlay?: OverlayHost;
    /** The TV app's side of the bridge: which view its window is shaped for. */
    MflOverlayHost?: {
      mode: () => string;
      /** The strip's edge. Absent on app builds before the ticker. */
      edge?: () => string;
      /** Open a game on the TV, by what a search for it should ask. Absent on app builds before Watch. */
      watch?: (query: string) => void;
      /** Close the overlay. */
      hide?: () => void;
      /**
       * Open (true) or close the lineups for the phone remote, without taking
       * the TV's remote from the show. Absent before the phone remote.
       */
      lineups?: (show: boolean) => void;
      /** Move the strip to `'top'` or `'bottom'`. Absent before the phone remote. */
      moveTo?: (edge: string) => void;
    };
  }
}

interface Props {
  /** JSON of `LiveBroadcastPageData`, or null when this TV is not signed in. */
  pageData: string | null;
  /** Whether this TV (or browser) is signed in at all; null data then means a failed read. */
  signedIn: boolean;
  mode?: string | null;
  /** `?edge=`, the app's hint for the first paint. */
  edge?: string | null;
  /** The owner's answer on /live/settings; decides how a regional game is labeled. */
  sundayTicket?: boolean;
}

const points = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');
const onePlace = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

export default function BroadcastOverlay({
  pageData,
  signedIn,
  mode: initialMode,
  edge: initialEdge,
  sundayTicket = false,
}: Props) {
  const data = useMemo<LiveBroadcastPageData | null>(
    () => (pageData ? (JSON.parse(pageData) as LiveBroadcastPageData) : null),
    [pageData],
  );
  const [mode, setMode] = useState<OverlayMode>(overlayModeFrom(initialMode));
  const [edge, setEdge] = useState<OverlayEdge>(overlayEdgeFrom(initialEdge));
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [index, setIndex] = useState(0);
  const [poll, setPoll] = useState<BroadcastPollResponse | null>(data?.initial ?? null);
  const [meta, setMeta] = useState<Record<string, PlayerMeta>>(data?.playerMeta ?? {});
  const [stale, setStale] = useState(false);
  const [barHint, setBarHint] = useState(true);
  const [passive, setPassive] = useState(false);
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const takeRemote = useCallback((next: RemoteState | undefined) => {
    if (!next || typeof next.seq !== 'number') return;
    setRemote((prev) => (prev && prev.seq === next.seq && prev.active === next.active ? prev : next));
  }, []);

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
    const hostEdge = window.MflOverlayHost?.edge?.();
    if (hostEdge) setEdge(overlayEdgeFrom(hostEdge));
    window.__mflOverlay = {
      setMode: (next) => setMode(overlayModeFrom(next)),
      setEdge: (next) => setEdge(overlayEdgeFrom(next)),
      step: (delta) => step(delta > 0 ? 1 : -1),
      move,
      select,
      setPassive: (next) => setPassive(!!next),
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
      // Expanded: Up/Down is the strip's edge, as the app does it on a TV.
      else if (e.key === 'ArrowUp') modeRef.current === 'expanded' ? setEdge('top') : move(-1);
      else if (e.key === 'ArrowDown') modeRef.current === 'expanded' ? setEdge('bottom') : move(1);
      else if (e.key === 'Enter') modeRef.current === 'expanded' ? setMode('panel') : select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, move, select]);

  useEffect(() => {
    if (mode !== 'bar') return;
    const t = window.setTimeout(() => setBarHint(false), BAR_HINT_MS);
    return () => window.clearTimeout(t);
  }, [mode]);

  // The ticker rotates through the owner's games; expanded and the panel leave
  // that to Left/Right.
  useEffect(() => {
    if (mode !== 'bar' || games.length < 2) return;
    const t = window.setInterval(() => setIndex((i) => stepOverlay(i, 1, countRef.current)), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [mode, games.length]);

  // Big plays: each poll is measured against the highest score each starter
  // has shown, so the first poll only sets baselines.
  const seenRef = useRef<Map<string, number>>(new Map());
  const recentRef = useRef<Map<string, number>>(new Map());
  const [alerts, setAlerts] = useState<BigPlayAlert[]>([]);
  const [justScored, setJustScored] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!poll || games.length === 0) return;
    const now = Date.now();
    const found = detectBigPlays(seenRef.current, games, poll.moments ?? [], now, recentRef.current);
    seenRef.current = found.seen;
    recentRef.current = found.recent;
    if (found.alerts.length === 0) return;
    setAlerts((queue) => [...queue, ...found.alerts]);
    // The ticker turns to the game the play counted in.
    if (modeRef.current === 'bar') {
      const at = games.findIndex((g) => g.key === found.alerts[0].gameKey);
      if (at >= 0) setIndex(at);
    }
    setJustScored((lit) => {
      const next: Record<string, number> = {};
      for (const [id, at] of Object.entries(lit)) if (now - at < JUST_SCORED_MS) next[id] = at;
      for (const alert of found.alerts) next[alert.playerId] = now;
      return next;
    });
  }, [poll, games]);
  // A highlight ends on its own clock, not at the next big play.
  useEffect(() => {
    const times = Object.values(justScored);
    if (times.length === 0) return;
    const wait = Math.max(0, Math.min(...times) + JUST_SCORED_MS - Date.now());
    const t = window.setTimeout(() => {
      const now = Date.now();
      setJustScored((lit) => Object.fromEntries(Object.entries(lit).filter(([, at]) => now - at < JUST_SCORED_MS)));
    }, wait);
    return () => window.clearTimeout(t);
  }, [justScored]);
  const alert = alerts[0];
  useEffect(() => {
    if (!alert) return;
    const t = window.setTimeout(() => setAlerts((queue) => queue.slice(1)), ALERT_MS);
    return () => window.clearTimeout(t);
  }, [alert]);

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
        takeRemote(body.remote);
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
  }, [data, takeRemote]);

  // The phone remote. Each command is parsed again here and applied once, by
  // its sequence number; the first one this page sees is an old press, so it
  // only sets the mark.
  const lastRemoteSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!remote) return;
    const first = lastRemoteSeq.current === null;
    if (!first && remote.seq <= (lastRemoteSeq.current ?? 0)) return;
    lastRemoteSeq.current = remote.seq;
    const cmd = parseRemoteCommand(remote.command);
    if (first || !cmd) return;
    const host = window.MflOverlayHost;
    if (cmd.kind === 'page') step(cmd.dir === 'next' ? 1 : -1);
    else if (cmd.kind === 'overlay') {
      if (cmd.action === 'lineups') host?.lineups?.(true);
      else if (cmd.action === 'ticker') host?.lineups?.(false);
      else host?.moveTo?.(cmd.action);
    }
  }, [remote, step]);

  const remoteActive = !!remote?.active && !!data && !data.demo;
  useEffect(() => {
    if (!remoteActive) return;
    let stopped = false;
    let timer = 0;
    const check = async () => {
      try {
        const res = await fetch('/api/broadcast-tv/remote-poll', {
          signal: AbortSignal.timeout(REMOTE_CHECK_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        });
        if (res.ok && !stopped) takeRemote((await res.json()) as RemoteState);
      } catch {
        /* the next check, or the poll, carries it */
      }
      if (!stopped) timer = window.setTimeout(check, REMOTE_CHECK_MS);
    };
    timer = window.setTimeout(check, REMOTE_CHECK_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [remoteActive, takeRemote]);

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

  if (mode === 'bar' || mode === 'expanded') {
    const current = games[Math.min(index, games.length - 1)];
    return (
      <div className={`bov bov--strip bov--${mode}`} data-edge={edge} data-stale={stale || undefined}>
        <Ticker
          game={current}
          position={Math.min(index, games.length - 1)}
          count={games.length}
          week={data.week}
          alert={alert}
          focused={mode === 'expanded' && !passive}
          hint={mode === 'bar' && barHint}
        />
        {mode === 'expanded' && (
          <section className="bov__xp">
            <header className="bov__xp-head">
              {games.length > 1 && <span className="bov__xp-arrow">◀</span>}
              <XpSide side={current.mine} readable={current.readable} lead={current.mine.live > current.opponent.live} />
              <span className="bov__xp-mid">
                {current.leagueName}
                {games.length > 1 && ` · ${Math.min(index, games.length - 1) + 1} of ${games.length}`}
              </span>
              <XpSide
                side={current.opponent}
                readable={current.readable}
                lead={current.opponent.live > current.mine.live}
                end
              />
              {games.length > 1 && <span className="bov__xp-arrow">▶</span>}
            </header>
            <div className="bov__xp-cols">
              <XpLineup side={current.mine} slate={poll?.games ?? []} lit={justScored} />
              <XpLineup side={current.opponent} slate={poll?.games ?? []} lit={{}} />
            </div>
            {passive ? (
              <footer className="bov__keys bov__xp-keys">
                <span>Opened from your phone · Hide lineups or Next game there</span>
                {stale && <span className="bov__stale">Reconnecting</span>}
              </footer>
            ) : (
              <footer className="bov__keys bov__xp-keys">
                {games.length > 1 && <span>◀ ▶ Matchups</span>}
                <span>▲ ▼ Top or bottom</span>
                <span>OK Watch a game</span>
                <span>BACK Back to the game</span>
                {stale && <span className="bov__stale">Reconnecting</span>}
              </footer>
            )}
          </section>
        )}
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

/** The one line that stays on screen: the logo, one of the owner's games, and big plays sliding over it. */
function Ticker({
  game,
  position,
  count,
  week,
  alert,
  focused,
  hint,
}: {
  game: OverlayGame;
  position: number;
  count: number;
  week: number;
  alert: BigPlayAlert | undefined;
  focused: boolean;
  /** The first few seconds: how to open it up, in place of the projections. */
  hint: boolean;
}) {
  const mineLead = game.readable && game.mine.live > game.opponent.live;
  const theirLead = game.readable && game.opponent.live > game.mine.live;
  return (
    <div className="bov__strip" data-focused={focused || undefined}>
      <img className="bov__logo" src={LOGO_SRC} alt="MFL Football" />
      <div className="bov__now" key={game.key}>
        <span className="bov__now-league">{game.leagueName}</span>
        <span className="bov__chip-team" style={{ ['--bov-team' as string]: game.mine.swatch }}>
          {game.mine.abbrev}
        </span>
        <b data-lead={mineLead || undefined}>{game.readable ? onePlace(game.mine.live) : '–'}</b>
        <span className="bov__chip-dash">–</span>
        <b data-lead={theirLead || undefined}>{game.readable ? onePlace(game.opponent.live) : '–'}</b>
        <span className="bov__chip-team" style={{ ['--bov-team' as string]: game.opponent.swatch }}>
          {game.opponent.abbrev}
        </span>
        {hint ? (
          <span className="bov__now-proj">Move or turn off: MFL Football › Back</span>
        ) : game.readable && (
          <span className="bov__now-proj">
            Proj {onePlace(game.mine.projectedFinal)} – {onePlace(game.opponent.projectedFinal)}
          </span>
        )}
        {game.readable && <span className="bov__chip-chance">{formatChance(game.winChance)}</span>}
      </div>
      <span className="bov__week">
        {count > 1 && (
          <span className="bov__pips" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
              <i key={i} data-on={i === position || undefined} />
            ))}
          </span>
        )}
        Wk {week}
      </span>
      {alert && (
        <div className="bov__alert" key={alert.key} role="status">
          <span className="bov__alert-tag">Big play</span>
          <span className="bov__alert-who">{alert.playerName}</span>
          <span className="bov__alert-what">
            {[alert.text, `for ${alert.teamName}`, ...alert.alsoIn.map((l) => `also ${l}`)].filter(Boolean).join(' · ')}
          </span>
          <span className="bov__alert-pts">+{onePlace(alert.gained)}</span>
          <span className="bov__alert-now">
            {alert.mineAbbrev} {onePlace(alert.mineLive)} – {onePlace(alert.opponentLive)} {alert.opponentAbbrev}
          </span>
        </div>
      )}
    </div>
  );
}

function XpSide({ side, readable, lead, end = false }: { side: OverlaySide; readable: boolean; lead: boolean; end?: boolean }) {
  const name = <span className="bov__xp-name">{side.name}</span>;
  const pts = (
    <b className="bov__xp-pts" data-lead={lead || undefined}>
      {readable ? points(side.live) : '–'}
    </b>
  );
  return (
    <span className={`bov__xp-side${end ? ' bov__xp-side--end' : ''}`}>
      {end ? pts : name}
      {end ? name : pts}
    </span>
  );
}

/** ESPN's clock for the player's NFL game ("8:12 - 3rd"), "Final", or its kickoff. */
function gameNote(nflTeam: string, slate: readonly NflGame[]): { text: string; live: boolean } {
  if (!nflTeam) return { text: '', live: false };
  const game = slate.find((g) => normalizeTeamCode(g.away.code) === nflTeam || normalizeTeamCode(g.home.code) === nflTeam);
  if (!game) return { text: '', live: false };
  return { text: game.shortDetail, live: game.state === 'in' };
}

function XpLineup({ side, slate, lit }: { side: OverlaySide; slate: readonly NflGame[]; lit: Record<string, number> }) {
  return (
    <ol className="bov__xp-lineup">
      {side.lineup.map((player) => {
        const note = gameNote(player.nflTeam, slate);
        return (
          <li key={player.id} data-lit={lit[player.id] ? true : undefined}>
            <span className="bov__pos">{player.position}</span>
            <span className="bov__name">
              {player.name} <span className="bov__xp-team">{player.nflTeam}</span>
            </span>
            <span className="bov__xp-game" data-live={note.live || undefined}>
              {note.text}
            </span>
            <span className="bov__pts">{onePlace(player.live)}</span>
          </li>
        );
      })}
    </ol>
  );
}
