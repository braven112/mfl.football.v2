/**
 * The MFL Live app's Matchups board: the store-mode board, plus the answers
 * the web board computes in the browser.
 *
 * `/live` decides several things client-side, in site code the app may not
 * import (apps/mobile installs on its own and takes shared code as types
 * only): a player's game state from MFL's clock, his projected final, whether
 * a matchup is over, how many decimals a score shows, and when to poll again.
 * Re-deriving those on the phone would be a second copy of each rule, free to
 * drift from the web. So the server makes each decision with the web's OWN
 * function and ships the result — the contract is
 * `packages/shared-types/src/mfl-live-app-a.ts`.
 *
 * ── THE POLL HINT READS THE NFL SCHEDULE, NEVER ESPN ──────────────────────
 * The web board's cadence is `shouldPollLive` over ESPN's week slate. Store
 * mode may not fetch ESPN at all (`tests/mfl-live-board-store.test.ts`), so the
 * slate is rebuilt from MFL's own `nflSchedule` kickoffs, with a game assumed
 * live for `GAME_WINDOW_HOURS` after its kickoff — the same assumption the sync
 * cadence makes from the same feed. MFL's live clock then OVERRIDES that: a
 * starter whose game is in progress keeps the fast cadence through overtime,
 * whatever the schedule says.
 */

import type { MflLiveBoard, MflLiveLeaguePanel, MflLiveMatchup, MflLiveTeam } from '../../types/mfl-live';
import type { LivePlayerRow, NflGameState } from '../../types/live-scoring';
import { KICKOFF_SOON_MS, shouldPollLive } from '../../hooks/useNflScoreboard';
import { GAME_WINDOW_HOURS } from '../sync-cadence';
import { nflGameStateFromSeconds } from '../live-scoring-view';
import { projectPlayerFinal } from '../live-win-probability';
import { DEFAULT_SCORE_PRECISION } from './score-precision';
import { isMatchupFinal } from './standings-projection';
import { fromMflLiveBoard } from './from-mfl-live';
import { appLeagueLogo } from './app-league-logo';

/** The web board's own cadence (`LiveBoard.tsx`): a game on, or none. */
export const APP_POLL_LIVE_MS = 25_000;
export const APP_POLL_IDLE_MS = 90_000;
/**
 * The longest the app waits with no NFL week running. The offseason wait also
 * ends `KICKOFF_SOON_MS` before the next kickoff, so Week 1 is never missed.
 */
export const APP_POLL_OFFSEASON_MAX_MS = 60 * 60_000;

const GAME_WINDOW_MS = GAME_WINDOW_HOURS * 60 * 60_000;

export interface MflLiveAppRowView extends LivePlayerRow {
  gameState: NflGameState;
  projectedFinal?: number;
}

export interface MflLiveAppTeamView extends Omit<MflLiveTeam, 'players' | 'bench'> {
  players: MflLiveAppRowView[];
  bench: MflLiveAppRowView[];
}

export interface MflLiveAppMatchupView extends Omit<MflLiveMatchup, 'mine' | 'opponent'> {
  mine: MflLiveAppTeamView;
  opponent: MflLiveAppTeamView;
  isFinal: boolean;
}

export interface MflLiveAppPanelView extends Omit<MflLiveLeaguePanel, 'matchups'> {
  matchups: MflLiveAppMatchupView[];
  scorePrecision: number;
  /** The league's own logo, a site-relative PNG; '' for a league we do not run. */
  leagueLogo: string;
}

/** The board as `/api/live-board?source=mfl` answers it. */
export interface MflLiveAppBoardView extends Omit<MflLiveBoard, 'leagues'> {
  leagues: MflLiveAppPanelView[];
  preSeason?: boolean;
  live: boolean;
  pollAfterMs: number;
}

/** MFL's kickoff (epoch SECONDS, as its feed reports them) in milliseconds, or NaN. */
function kickoffMs(raw: string | number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : Number.NaN;
}

/**
 * The week's slate as `shouldPollLive` reads it, built from kickoff times
 * alone: before kickoff `pre`, inside the game window `in`, after it `post`.
 */
export function slateFromKickoffs(
  kickoffs: readonly (string | number)[],
  now: number,
): Array<{ state: 'pre' | 'in' | 'post'; date: string }> {
  return kickoffs
    .map(kickoffMs)
    .filter((at) => Number.isFinite(at))
    .map((at) => ({
      state: at > now ? ('pre' as const) : now - at < GAME_WINDOW_MS ? ('in' as const) : ('post' as const),
      date: new Date(at).toISOString(),
    }));
}

/** A starter on the board whose game MFL says is being played right now. */
function boardHasGameInProgress(board: Pick<MflLiveBoard, 'leagues'>): boolean {
  return board.leagues.some((panel) =>
    panel.matchups.some((m) =>
      [m.mine, m.opponent].some((team) =>
        team.players.some((p) => nflGameStateFromSeconds(p.secondsRemaining) === 'in-progress'),
      ),
    ),
  );
}

/**
 * Is football on, and when should the app ask again?
 *
 * `week` 0 is "no NFL week is running" (the route's pre-season answer). Then
 * nothing can score until the next kickoff, so the wait runs up to it, capped
 * at an hour so a schedule the feed has not published yet costs at most that.
 */
export function mflLiveAppCadence(
  board: Pick<MflLiveBoard, 'leagues' | 'week'>,
  kickoffs: readonly (string | number)[],
  now: number,
): { live: boolean; pollAfterMs: number } {
  const live = boardHasGameInProgress(board) || shouldPollLive(slateFromKickoffs(kickoffs, now), false, now);
  if (live) return { live: true, pollAfterMs: APP_POLL_LIVE_MS };
  if (board.week) return { live: false, pollAfterMs: APP_POLL_IDLE_MS };

  const next = kickoffs
    .map(kickoffMs)
    .filter((at) => Number.isFinite(at) && at > now)
    .reduce((min, at) => Math.min(min, at), Number.POSITIVE_INFINITY);
  const untilSoon = next - KICKOFF_SOON_MS - now;
  const wait = Number.isFinite(untilSoon) ? untilSoon : APP_POLL_OFFSEASON_MAX_MS;
  return {
    live: false,
    pollAfterMs: Math.min(APP_POLL_OFFSEASON_MAX_MS, Math.max(APP_POLL_IDLE_MS, wait)),
  };
}

function toRow(row: LivePlayerRow): MflLiveAppRowView {
  const gameState = nflGameStateFromSeconds(row.secondsRemaining);
  return {
    ...row,
    gameState,
    // Only when the league projects him: "no projection" is not "projects 0".
    ...(row.projected !== undefined
      ? {
          projectedFinal: projectPlayerFinal({
            live: row.live,
            projected: row.projected,
            secondsRemaining: row.secondsRemaining,
          }),
        }
      : {}),
  };
}

function toTeam(team: MflLiveTeam): MflLiveAppTeamView {
  return { ...team, players: team.players.map(toRow), bench: team.bench.map(toRow) };
}

/**
 * The store-mode board, decorated for the app.
 *
 * `isFinal` is the web's own `isMatchupFinal`, asked through the same adapter
 * `/live` renders with, so a card the web calls Final is Final on the phone.
 * The precision is what `/live` prints: a cross-league panel carries no
 * league setting, so the web falls back to `DEFAULT_SCORE_PRECISION`.
 */
export function toMflLiveAppBoard(
  board: MflLiveBoard,
  kickoffs: readonly (string | number)[],
  now: number = Date.now(),
): MflLiveAppBoardView {
  const canonical = fromMflLiveBoard(board);
  const leagues: MflLiveAppPanelView[] = board.leagues.map((panel, p) => ({
    ...panel,
    scorePrecision: canonical.panels[p]?.scorePrecision ?? DEFAULT_SCORE_PRECISION,
    leagueLogo: appLeagueLogo(panel.slug),
    matchups: panel.matchups.map((m, i) => {
      const twin = canonical.panels[p]?.matchups[i];
      return {
        ...m,
        mine: toTeam(m.mine),
        opponent: toTeam(m.opponent),
        isFinal: twin ? isMatchupFinal(twin) : false,
      };
    }),
  }));
  return { ...board, leagues, ...mflLiveAppCadence(board, kickoffs, now) };
}
