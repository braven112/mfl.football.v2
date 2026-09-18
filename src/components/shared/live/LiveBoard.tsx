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
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import type { LiveBoard as Board, LiveMatchup } from '../../../types/live';
import LvMatchupCard from './LvMatchupCard';
import LvMatchupDetail from './LvMatchupDetail';
import LvRedZoneBanner from './LvRedZoneBanner';
import LvEmptyState from './LvEmptyState';
import { shouldPollLive } from '../../../hooks/useNflScoreboard';
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
  /** The freshness pill, likewise. */
  status?: ReactNode;
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

export default function LiveBoard({
  board: initialBoard,
  pollUrl,
  pollShape = 'canonical',
  isLive = false,
  viewerFirst = false,
  rail,
  status,
}: LiveBoardProps): JSX.Element {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [selected, setSelected] = useState<LiveMatchup | null>(null);

  // Read inside the loop so the cadence follows the LATEST slate without the
  // effect re-subscribing on every poll.
  const boardRef = useRef(board);
  boardRef.current = board;

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
        }
      } catch {
        // Keep the last good board. A dropped poll must degrade to "numbers
        // from a minute ago", never to a blank screen.
      } finally {
        if (!cancelled) {
          const live = shouldPollLive(boardRef.current.games ?? [], isLive);
          timer = setTimeout(tick, live ? POLL_LIVE_MS : POLL_IDLE_MS);
        }
      }
    };

    // Polling is UNCONDITIONAL. A flag that can be wrong must never be able to
    // stop the board asking for a score; it only sets how often.
    timer = setTimeout(tick, shouldPollLive(board.games ?? [], isLive) ? POLL_LIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pollUrl, pollShape, board.week, isLive]);

  // A cross-league board names each league; a single-league board would just
  // repeat its own name over every card.
  const multiLeague = board.panels.length > 1;

  return (
    <div className="lv">
      {/* Outside the branch, on purpose — see the header. */}
      {rail}
      <LvRedZoneBanner alerts={board.redZone} showLeague={multiLeague} />

      {selected ? (
        <LvMatchupDetail
          matchup={selected}
          meta={board.playerMeta}
          viewerFirst={viewerFirst}
          isFinal={isMatchupFinal(selected)}
          status={status}
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          {board.panels.map((panel) => (
            <section key={panel.leagueId} className="lv-panel">
              {multiLeague && <h2 className="lv-panel__name">{panel.leagueName}</h2>}

              {panel.status === 'ok' ? (
                <div className="lv-cards">
                  {panel.matchups.map((matchup) => (
                    <LvMatchupCard
                      key={`${panel.leagueId}:${matchup.index}`}
                      matchup={matchup}
                      viewerFirst={viewerFirst}
                      isFinal={isMatchupFinal(matchup)}
                      onOpen={() => setSelected(matchup)}
                    />
                  ))}
                </div>
              ) : (
                // A league with nothing to show still gets its place in the
                // list, saying why. Dropping it would re-order the board
                // mid-afternoon and make an owner wonder where a team went.
                <LvEmptyState
                  reason={panel.status}
                  leagueName={multiLeague ? panel.leagueName : undefined}
                />
              )}
            </section>
          ))}
          {status && <div className="lv-foot">{status}</div>}
        </>
      )}
    </div>
  );
}
