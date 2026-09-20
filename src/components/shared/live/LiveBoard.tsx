/**
 * The one hydrated island for every live-scoring surface.
 *
 * ── THE SHELL OUTLIVES THE SCREEN SWITCH ──────────────────────────────────
 * Opening a matchup replaces the BOARD, not the page (decided: drill-in
 * everywhere). The NFL games rail and the red-zone banner are rendered OUTSIDE
 * the `selected ? detail : board` branch, deliberately: red zone is a
 * persistent STATE, not an event, and a live drive that disappears because
 * somebody opened a matchup is the same mistake the broadcast board made one
 * level up, where the banner sat on the stage layer and the next reveal
 * preempted it.
 *
 * `selected` is island state, not a route, so going back returns to the same
 * scroll position on a 24-matchup AFL board or a six-league MFL Live one.
 *
 * ── POLLING IS NOT DONE HERE ──────────────────────────────────────────────
 * This renders what it is handed. The page assembles the first paint IN
 * PROCESS and the poller replaces it wholesale — a board that fetches its own
 * API to render itself puts our edge in the path of its first paint, which is
 * an outage this repo has already shipped.
 */
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { LiveBoard as Board, LiveMatchup, LivePanel } from '../../../types/live';
import type { NflGame } from '../../../types/live-scoring';
import LvMatchupCard from './LvMatchupCard';
import LvMatchupDetail from './LvMatchupDetail';
import LvRedZoneBanner from './LvRedZoneBanner';
import LvEmptyState from './LvEmptyState';
import LvFeedStatus from './LvFeedStatus';
import LvStaleNotice from './LvStaleNotice';
import LvWeekPicker from './LvWeekPicker';
import {
  nextHoldExpiry,
  resolvePanelViews,
  type PanelMemory,
} from '../../../utils/live/stale';
import { orderPanelMatchups, pairingKey, selectMatchupMoments } from '../../../utils/live/model';
import { buildLiveMoments } from '../../../utils/live/moments';
import { useNflGameDetail } from '../../../hooks/useNflGameDetail';
import type { FeedSnapshot } from '../../../utils/live-scoring-view';
import { shouldPollLive, useNflScoreboard } from '../../../hooks/useNflScoreboard';
import { fromMflLiveBoard } from '../../../utils/live/from-mfl-live';
import type { MflLiveBoard } from '../../../types/mfl-live';

/** Matches the cadence the board this replaces used. */
const POLL_LIVE_MS = 25_000;
const POLL_IDLE_MS = 90_000;

export interface LiveBoardProps {
  board: Board;
  /**
   * Where to re-read the board. Omitted, the island renders what it was handed
   * and never polls — which is right for a story or a bundled sample.
   */
  pollUrl?: string;
  /**
   * The shape that endpoint answers with.
   *
   * TRANSITIONAL. `/api/live-board` still answers MFL Live's viewer-relative
   * shape, so the island converts on arrival. It disappears when the assembler
   * emits the canonical model directly; until then an explicit, serializable
   * two-value prop beats guessing from the payload.
   */
  pollShape?: 'canonical' | 'mfl-live';
  /**
   * A game-day HINT, and nothing more. It may RAISE the cadence and may never
   * decide WHETHER to poll: it comes from a Thu/Sun/Mon hero schedule, and the
   * 2026 season opened on a WEDNESDAY — a board gated on it never asked for a
   * score all game. It is also fixed for the life of the page and stays open
   * long past the last whistle, so it is only good as the seed, which is
   * exactly what `shouldPollLive` uses it for.
   */
  isLive?: boolean;
  /** Put the viewer's own side first on a card. True for a cross-league board. */
  viewerFirst?: boolean;
  /** The NFL games rail, rendered by the page so it keeps its own poller. */
  rail?: ReactNode;
  /**
   * There is no NFL week yet — the pre-Week-1 window.
   *
   * Its own state, not a flavour of `not-played`. MFL serves no live scoring
   * before the Week 1 Thursday and `getCurrentNFLWeek` answers `null` until
   * then, so "this week hasn't kicked off" is the wrong sentence: the SEASON
   * has not started. `/live` has said so since it shipped; the league boards
   * clamped the week to 1 instead, so they could never reach it.
   */
  preSeason?: boolean;
  /** Page heading. */
  title?: string;
  /**
   * Bundled-sample mode. The label is shown as a badge and the pill is
   * suppressed, because with the pollers off there is no freshness to report
   * and a pill stuck on "Connecting…" would be a lie.
   */
  demoLabel?: string;
  /**
   * Feed snapshots from pollers this island does NOT own — the NFL scoreboard
   * one that the rail runs. Its own board poll is tracked internally, so the
   * pill reports every enabled feed without the page having to assemble them.
   */
  extraFeeds?: FeedSnapshot[];
  /** Hide the week selector. A story does; no production surface should. */
  hideWeekPicker?: boolean;
  /** Intercept the week change instead of navigating. For a story. */
  onSelectWeek?: (week: number) => void;
}

/**
 * Every starter on both sides has no game-time left.
 *
 * Derived from the ROWS rather than from a flag, so it cannot disagree with
 * the numbers beside it — and `yetToPlay` alone is not enough, since a player
 * whose game is in progress has already started but has not finished.
 */
function isMatchupFinal(matchup: LiveMatchup): boolean {
  const rows = [...matchup.sides[0].players, ...matchup.sides[1].players];
  return rows.length > 0 && rows.every((r) => r.secondsRemaining <= 0);
}

/**
 * One panel's cards: the lead row, then the rest.
 *
 * A component rather than an inline block so the ordering is computed once per
 * panel per render and the empty arm above keeps `panel.status` narrowed —
 * branching on a derived `ordered ?? null` widened it back to including 'ok'.
 */
function PanelCards({
  panel,
  card,
}: {
  panel: LivePanel;
  card: (panel: LivePanel, matchup: LiveMatchup, lead: boolean) => JSX.Element;
}): JSX.Element {
  const ordered = orderPanelMatchups(panel.matchups);
  return (
    <>
      {ordered.featured.length > 0 && (
        <div className="lv-cards lv-cards--lead">
          {ordered.featured.map((m) => card(panel, m, true))}
        </div>
      )}
      {ordered.rest.length > 0 && (
        <div className="lv-cards">{ordered.rest.map((m) => card(panel, m, false))}</div>
      )}
    </>
  );
}

export default function LiveBoard({
  board: initialBoard,
  pollUrl,
  pollShape = 'canonical',
  isLive = false,
  viewerFirst = false,
  rail,
  preSeason = false,
  title = 'Live Scoring',
  demoLabel,
  extraFeeds,
  hideWeekPicker = false,
  onSelectWeek,
}: LiveBoardProps): JSX.Element {
  const [board, setBoard] = useState<Board>(initialBoard);
  /**
   * WHAT IS OPEN, AS AN IDENTITY — never the matchup object itself.
   *
   * `LiveMatchup` carries its own scores, projections, yet-to-play counts and
   * player rows, and every poll REPLACES the board with fresh objects. So
   * storing the object that was clicked freezes the drill-in at the moment it
   * was opened: the reader watches a dead screen while the rail, the pill and
   * the ticker beside it keep updating. That is the worst version of this bug,
   * because everything around it proves the page is live.
   *
   * The island this replaced stored `{ home, away }` — two franchise ids — and
   * passed the LIVE `teams`/`players`/`bench` maps alongside it, so its detail
   * stayed current. The canonical model moved the data inside the matchup, and
   * carrying the old pattern across without noticing is what broke it.
   *
   * `leagueId` is not redundant with the pairing: both leagues have a
   * franchise `0001`, so a cross-league board needs the league to resolve the
   * right panel AND to select the ticker's rows.
   */
  const [selected, setSelected] = useState<{ leagueId: string; pairing: string } | null>(null);
  /**
   * This island's own poll, as the pill reads it. `fetchedAt` stays 0 until a
   * poll SUCCEEDS — treating 0 as a timestamp prints "56 years ago" — and a
   * failure raises the status without clearing the last good time, which is
   * what lets the pill say "we could not confirm these" while the scores from
   * a minute ago stay on screen.
   */
  const [feed, setFeed] = useState<FeedSnapshot>({ status: 'idle', fetchedAt: 0 });

  // Read inside the loop so the cadence follows the LATEST slate without the
  // effect re-subscribing on every poll.
  const boardRef = useRef(board);
  boardRef.current = board;
  /**
   * The slate the cadence is judged against, read inside the loop so it
   * follows the LATEST games without the effect re-subscribing every poll.
   *
   * SEEDED from `board.games` and then REWRITTEN every render from the live
   * `useNflScoreboard` slate (below). The seed is the server's copy, which
   * never moves after the first paint — judging the cadence on it was the bug
   * this ref exists to fix, so do not read the seed as "this ref is stable".
   */
  const slateRef = useRef<NflGame[]>(board.games ?? []);

  useEffect(() => {
    if (!pollUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`${pollUrl}${pollUrl.includes('?') ? '&' : '?'}week=${board.week}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const data = await res.json();
        if (cancelled) return;
        // `res.ok` is NOT "the data is good" and `{}` is truthy, so neither is
        // a guard. Gate on the FLAG: a failed poll keeps the last good board
        // rather than wiping a live screen, so "the feed says nothing" and "we
        // could not reach the feed" stay separate all the way to the screen.
        if (data && data.ok !== false) {
          setBoard(pollShape === 'mfl-live' ? fromMflLiveBoard(data as MflLiveBoard) : (data as Board));
          setFeed({ status: 'ok', fetchedAt: Date.now() });
        } else {
          // A payload that arrived but says it is not ok is a FAILURE, not
          // silence. `res.ok` and a truthy `{}` are both worthless as guards.
          setFeed((prev) => ({ status: 'error', fetchedAt: prev.fetchedAt }));
        }
      } catch {
        // Keep the last good board. A dropped poll must degrade to "numbers
        // from a minute ago", never to a blank screen.
        if (!cancelled) setFeed((prev) => ({ status: 'error', fetchedAt: prev.fetchedAt }));
      } finally {
        if (!cancelled) {
          const live = shouldPollLive(slateRef.current, isLive);
          timer = setTimeout(tick, live ? POLL_LIVE_MS : POLL_IDLE_MS);
        }
      }
    };

    // Polling is UNCONDITIONAL. A flag that can be wrong must never be able to
    // stop the board asking for a score; it only sets how often.
    timer = setTimeout(tick, shouldPollLive(slateRef.current, isLive) ? POLL_LIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pollUrl, pollShape, board.week, isLive]);

  // A cross-league board names each league; a single-league board would just
  // repeat its own name over every card.
  const multiLeague = board.panels.length > 1;

  /**
   * The last panel we could CONFIRM, per (week, league).
   *
   * This is the second half of the "a failed read never wipes a live screen"
   * rule, and the half that was missing. The poller above keeps the last good
   * BOARD when the poll fails — but the failure owners actually hit is a poll
   * that SUCCEEDS carrying panels that could not be read, so that guard never
   * fired and live scores were replaced by an error card while the pill beside
   * them still said "Live · updated just now". `resolvePanelViews` owns the
   * decision; see its header for what is held and what deliberately is not.
   *
   * A ref, not state: it is memory about renders, not an input to one, and
   * setting state from the render that reads it is a loop. It is also why the
   * hold is session-scoped — a first paint whose server-side assembly failed
   * has nothing to hold, which is accepted.
   */
  const panelMemory = useRef<Map<string, PanelMemory>>(new Map());
  /** Retires a held panel at its exact expiry — see `holdExpiry` below. */
  const [, setHoldTick] = useState(0);
  const panelViews = resolvePanelViews({
    panels: board.panels,
    week: board.week,
    memory: panelMemory.current,
    now: Date.now(),
  });
  /**
   * The oldest confirmation still on screen, or 0 when nothing is held.
   *
   * The OLDEST rather than the newest: it is the age the board can honestly
   * claim for everything it is showing, and it is what the pill reports.
   */
  const heldSince = panelViews.reduce(
    (oldest, v) => (v.heldSince === null ? oldest : oldest === 0 ? v.heldSince : Math.min(oldest, v.heldSince)),
    0,
  );

  /**
   * Re-render exactly when the hold runs out.
   *
   * Without this the expiry is only ever evaluated by the next POLL, and the
   * idle cadence is 90 seconds — so the five minutes this feature states out
   * loud would in fact be up to six and a half, which is the one number it
   * cannot afford to be wrong about. Terminates by construction: the tick
   * re-renders, `resolvePanelViews` drops the expired panel, and `holdExpiry`
   * goes to 0.
   */
  const holdExpiry = nextHoldExpiry(panelViews);
  useEffect(() => {
    if (!holdExpiry) return;
    const ms = holdExpiry - Date.now();
    if (ms <= 0) {
      setHoldTick((n) => n + 1);
      return;
    }
    const t = setTimeout(() => setHoldTick((n) => n + 1), ms);
    return () => clearTimeout(t);
  }, [holdExpiry]);

  /**
   * The NFL slate.
   *
   * Through `useNflScoreboard` rather than off `board.games`, for three
   * reasons: it SHARES the poll store with the games rail, so there is no
   * second poller; it keeps the slate current between board polls, which a
   * board payload carrying `games: []` would otherwise blank; and it supplies
   * `byTeam` and the live count the rows and the pill both need.
   *
   * The server-rendered slate rides in on `board.games` as the fallback, which
   * is what puts it in the markup — the store is empty during SSR.
   */
  const slate = useNflScoreboard(board.week, board.year, {
    enabled: !demoLabel && !!pollUrl,
    live: isLive,
    fallbackGames: board.games,
  });

  /**
   * "Live" is claimed from the NFL SLATE, never from a franchise still having
   * seconds left — that is true all week and says nothing about right now.
   */
  const gamesLive = slate.liveCount;
  // Kept current for the poll loop's cadence, which reads it at tick time.
  slateRef.current = slate.games;

  /**
   * ESPN box scores and scoring plays.
   *
   * Off in bundled-sample mode so a live fetch cannot overwrite the replay,
   * and off when the board itself is not polling — a static render (a story, a
   * server snapshot) has no business opening a second poller, and `pollUrl` is
   * the one prop that already says "this board is live".
   *
   * Everything it returns is keyed by MFL PLAYER ID. The join to ESPN athlete
   * ids happens server-side, deliberately: `PlayerMeta.espnId` can hold a
   * COLLEGE athlete id and both are plain digits, so a bad join resolves the
   * wrong person instead of failing.
   */
  const detail = useNflGameDetail(board.week, board.year, {
    enabled: !demoLabel && !!pollUrl,
    anyLive: gamesLive > 0,
  });

  /**
   * This island's own feed, as the pill should read it.
   *
   * A HELD PANEL OVERRIDES A SUCCESSFUL POLL. The poll genuinely succeeded —
   * that is why `feed` says so — but what it carried was a league we could not
   * read, and a pill reporting the transport while the panel reports the data
   * is exactly the contradiction an owner screenshotted: "Live · updated just
   * now" over two error cards. The scores on screen were last confirmed at
   * `heldSince`, so that is the timestamp, and the status is `error` because
   * we cannot currently confirm them.
   */
  const boardFeed: FeedSnapshot = heldSince
    ? { status: 'error', fetchedAt: heldSince }
    : feed;

  /**
   * Only the pollers actually RUNNING for this render. In bundled-sample mode
   * there are none, so `LvFeedStatus` renders nothing rather than a pill that
   * can never age — a disabled poller neither fails nor goes stale, so
   * including one would pin the pill at "Connecting…" forever.
   */
  const feeds: FeedSnapshot[] = demoLabel || !pollUrl
    ? (extraFeeds ?? [])
    : [
        boardFeed,
        { status: slate.status, fetchedAt: slate.fetchedAt },
        { status: detail.status, fetchedAt: detail.fetchedAt },
        ...(extraFeeds ?? []),
      ];

  const pill = (
    <LvFeedStatus feeds={feeds} anyLive={gamesLive > 0} gamesLive={gamesLive} />
  );

  /** A row's real NFL game, by club code. `byTeam` already holds both sides. */
  const gamesByTeam = useMemo(
    () => Object.fromEntries(slate.byTeam) as Record<string, NflGame>,
    [slate.byTeam],
  );

  /**
   * `error` SUPPRESSES the stat-line slot rather than rendering every starter
   * as though he had done nothing. Silence must mean "no stats yet", never
   * "feed down".
   */
  const detailStatus: 'ok' | 'error' | 'pending' =
    detail.status === 'error' ? 'error' : detail.loaded ? 'ok' : 'pending';

  /**
   * Derived from the CURRENT payload every poll, never accumulated.
   *
   * The board's own `moments` are the server's (MFL Live's assembler fills
   * them; a league read leaves them empty, because ESPN is per-NFL-GAME and is
   * read client-side). Once the play feed has landed the client list is the
   * better one — it covers every franchise on the board rather than only the
   * viewer's — so it wins, and both are keyed `playId:leagueId:franchiseId`,
   * which is what makes the swap invisible.
   */
  const moments = useMemo(
    () =>
      detail.loaded
        ? buildLiveMoments(detail.plays, board.panels, board.playerMeta)
        : board.moments,
    [detail.loaded, detail.plays, board.panels, board.playerMeta, board.moments],
  );

  /**
   * Resolve what is open against the LATEST board, every render.
   *
   * This is the half that makes the identity above worth storing: the drill-in
   * renders from `open.matchup`, which is re-found in the current payload each
   * poll, so scores, projections, the win-probability bar and both lineups
   * move exactly as the cards behind it do.
   *
   * THE FALLBACK IS DELIBERATE. A poll can legitimately arrive without this
   * matchup in it — on a cross-league board one league's panel can come back
   * `unavailable` while the rest are fine — and throwing the reader back out
   * to the board mid-read would be a worse answer than briefly holding the
   * last good screen. That is the same posture the poller already takes with
   * `data.ok !== false`: a feed we could not read never wipes what is on
   * screen. `openRef` lags one render behind by construction (an effect
   * writes it after commit), which is exactly the previous good resolution.
   *
   * Resolved against the VIEWS, not the raw payload: a drill-in is the one
   * screen where a dropped league is most obvious — the reader is watching one
   * game — so it holds the same confirmed scores the cards behind it do, and
   * says so with the same strip.
   */
  const openRef = useRef<{ matchup: LiveMatchup; panel: LivePanel; heldSince: number | null } | null>(
    null,
  );
  let open: { matchup: LiveMatchup; panel: LivePanel; heldSince: number | null } | null = null;
  if (selected) {
    const view = panelViews.find((v) => v.panel.leagueId === selected.leagueId) ?? null;
    const matchup = view?.panel.matchups.find((m) => pairingKey(m) === selected.pairing) ?? null;
    open = view && matchup ? { matchup, panel: view.panel, heldSince: view.heldSince } : openRef.current;
  }
  useEffect(() => {
    openRef.current = open;
  });

  const card = (panel: LivePanel, matchup: LiveMatchup, lead: boolean) => (
    <LvMatchupCard
      key={`${panel.leagueId}:${matchup.index}:${matchup.sides[0].franchiseId}`}
      matchup={matchup}
      viewerFirst={viewerFirst}
      isFinal={isMatchupFinal(matchup)}
      lead={lead}
      onOpen={() =>
        setSelected({ leagueId: panel.leagueId, pairing: pairingKey(matchup) })
      }
    />
  );

  return (
    <div className="lv">
      <div className="lv-head">
        <h1>
          {title}
          {demoLabel && <span className="lv-sample">{demoLabel}</span>}
        </h1>
        <div className="lv-head__right">
          {!hideWeekPicker && <LvWeekPicker week={board.week} onSelect={onSelectWeek} />}
          {pill}
        </div>
      </div>

      {/* Outside the branch, on purpose — see the header. */}
      {rail}
      <LvRedZoneBanner alerts={board.redZone} showLeague={multiLeague} />

      {open ? (
        <LvMatchupDetail
          matchup={open.matchup}
          meta={board.playerMeta}
          gamesByTeam={gamesByTeam}
          boxScore={detail.boxScore}
          detailStatus={detailStatus}
          moments={selectMatchupMoments(moments, open.panel.leagueId, open.matchup)}
          momentStatus={
            detail.status === 'error' ? 'error' : detail.loaded ? 'ok' : 'idle'
          }
          momentPartial={detail.partial}
          viewerFirst={viewerFirst}
          isFinal={isMatchupFinal(open.matchup)}
          status={
            <LvFeedStatus
              feeds={feeds}
              anyLive={gamesLive > 0}
              gamesLive={gamesLive}
              compact
            />
          }
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          {panelViews.map(({ panel, heldSince: panelHeld }) => (
            <section key={panel.leagueId} className="lv-panel">
              {multiLeague && <h2 className="lv-panel__name">{panel.leagueName}</h2>}

              {/* A held panel renders as an ordinary one, so the strip is the
                  only thing telling the reader these numbers have stopped
                  moving. It sits ABOVE the cards rather than replacing them —
                  that is the whole point of holding them. */}
              {panelHeld !== null && <LvStaleNotice heldSince={panelHeld} />}

              {panel.status === 'ok' ? (
                // Featured first, then the closest game. Ordered per PANEL, so
                // a cross-league board leads each league with that league's own
                // matchup rather than picking one winner for the whole page.
                // The branch is on `panel.status` itself and not on a derived
                // value, so the empty arm keeps its narrowed reason type.
                <PanelCards panel={panel} card={card} />
              ) : (
                // A league with nothing to show still gets its place in the
                // list, saying why. Dropping it would re-order the board
                // mid-afternoon and make an owner wonder where a team went.
                <LvEmptyState
                  reason={preSeason ? 'pre-season' : panel.status}
                  leagueName={multiLeague ? panel.leagueName : undefined}
                />
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
