/**
 * The drill-in behind an NFL game card: both clubs, and every fantasy-eligible
 * player on each, scored by the league on screen.
 *
 * ── THE SAME SCREEN AS A FANTASY MATCHUP ──────────────────────────────────
 * Owner's call (2026-11-19): tapping an NFL game opens the SAME drill-in a
 * fantasy matchup opens — it replaces the board in place, keeps the rail and
 * the red-zone banner around it, and pairs the two sides row by row with the
 * same `LvLineup` / `LvPlayerRow` the lineups use. Away on the left, home on
 * the right, the way the card lists them.
 *
 * ── WHOSE POINTS ──────────────────────────────────────────────────────────
 * A league's points, never a generic number: the page's league on a league
 * board, and on MFL Live's cross-league board a picker over the viewer's
 * leagues, since the same player is worth different points under each one's
 * rules. See `buildNflGamePlayers` for where each row's number comes from.
 *
 * ── THE ROW IS RE-READ EVERY POLL ─────────────────────────────────────────
 * The caller hands the CURRENT game, panels and box scores each render and
 * the lists are rebuilt from them, so the screen keeps moving with the game.
 */
import { useRef, useState, type JSX } from 'react';
import type { LivePanel } from '../../../types/live';
import type { LivePlayerRow, NflGame, PlayerBoxScore, PlayerMeta } from '../../../types/live-scoring';
import type { PositionRuleSet } from '../../../utils/live/scoring-rules';
import { buildNflGamePlayers, type NflGamePlayer } from '../../../utils/live/nfl-game-players';
import { useNflTeamPlayers } from '../../../hooks/useNflTeamPlayers';
import { nflLogoUrl } from '../../../utils/live/nfl-logo-url';
import { getNflTeamNickname } from '../../../utils/nfl-team-colors';
import {
  nflLogoErrorHandler,
  nflLogoLoadHandler,
  nflLogoRefCallback,
} from '../../../constants/roster-constants';
import { formatGameClock, resolveGameState, type KickoffClock } from '../../../utils/live-scoring-view';
import { ScorePrecisionContext } from './score-format';
import { DEFAULT_SCORE_PRECISION } from '../../../utils/live/score-precision';
import LvLineup, { type LvRowDecoration } from './LvLineup';
import LvBench from './LvBench';
import LvStatSheet from './LvStatSheet';

export interface LvNflGameDetailProps {
  game: NflGame;
  /** The board's panels AS DRAWN (held + overlaid), one per league. */
  panels: readonly LivePanel[];
  meta: Record<string, PlayerMeta>;
  gamesByTeam: Record<string, NflGame>;
  boxScore: Record<string, PlayerBoxScore>;
  detailStatus: 'ok' | 'error' | 'pending';
  /** Each league's MFL rules, by league id. Absent = not loaded (yet). */
  rules: ReadonlyMap<string, PositionRuleSet[]>;
  /** Every panel holds the whole league (a league board), so "no owner" means FA. */
  rostersComplete: boolean;
  year: number;
  /** Rows open the stat sheet. Off for a story or a bundled sample. */
  interactive: boolean;
  kickoffClock: KickoffClock | null;
  /** MFL Live's store build — no headshots. */
  storeBuild?: boolean;
  onBack: () => void;
}

export default function LvNflGameDetail({
  game,
  panels,
  meta,
  gamesByTeam,
  boxScore,
  detailStatus,
  rules,
  rostersComplete,
  year,
  interactive,
  kickoffClock,
  storeBuild = false,
  onBack,
}: LvNflGameDetailProps): JSX.Element {
  // A Sleeper league has no MFL rules to score a free agent with, and its
  // player ids are not always MFL's — it can still be picked, but MFL leagues
  // lead.
  const scorable = panels.filter((p) => p.status === 'ok');
  const ordered = [
    ...scorable.filter((p) => p.provider !== 'sleeper'),
    ...scorable.filter((p) => p.provider === 'sleeper'),
  ];
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const panel = ordered.find((p) => p.leagueId === leagueId) ?? ordered[0] ?? null;

  const pool = useNflTeamPlayers([game.away.code, game.home.code], year, { storeBuild });

  const built = panel
    ? buildNflGamePlayers({
        game,
        panel,
        meta,
        pool: pool.players,
        boxScore,
        rules: panel.provider === 'sleeper' ? undefined : rules.get(panel.leagueId),
        rostersComplete,
      })
    : null;
  const allMeta: Record<string, PlayerMeta> = built ? { ...built.meta, ...meta } : meta;

  // Per-row extras, looked up by player id from the lists just built.
  const byId = new Map<string, NflGamePlayer>();
  if (built) {
    for (const side of [built.away, built.home]) {
      for (const p of [...side.players, ...side.quiet]) byId.set(p.row.id, p);
    }
  }
  const decorate = (row: LivePlayerRow): LvRowDecoration | undefined => {
    const p = byId.get(row.id);
    if (!p) return undefined;
    return { owners: p.owners, freeAgent: p.freeAgent, hideProjection: !p.hasProjection };
  };

  /**
   * The open stat sheet, as an IDENTITY — the row is re-found in the current
   * lists every render so the sheet moves with each poll, and a poll that
   * briefly drops him holds the last good row (same as the matchup drill-in).
   */
  const [sheetId, setSheetId] = useState<string | null>(null);
  const lastSheet = useRef<NflGamePlayer | null>(null);
  let sheet: NflGamePlayer | null = null;
  if (sheetId) {
    sheet = byId.get(sheetId) ?? lastSheet.current;
    lastSheet.current = sheet;
  }
  const canSheet = interactive && panel !== null && panel.provider !== 'sleeper';
  const onOpenPlayer = canSheet ? (row: LivePlayerRow) => setSheetId(row.id) : undefined;

  const state = resolveGameState('not-started', game);
  const status = formatGameClock(state, game, kickoffClock);
  const live = game.state === 'in';
  const downDistance = live ? game.situation?.shortDownDistanceText ?? '' : '';

  const club = (side: 'away' | 'home') => {
    const t = game[side];
    const hasBall = live && game.possession === t.code;
    return (
      <div className={`lv-scorehead__side${side === 'home' ? ' lv-scorehead__side--right' : ''}`}>
        <span className="lv-scorehead__crest">
          {t.code && (
            <img
              src={nflLogoUrl(t.code)}
              alt=""
              loading="lazy"
              onError={nflLogoErrorHandler}
              onLoad={nflLogoLoadHandler}
              ref={nflLogoRefCallback}
            />
          )}
        </span>
        <div className="lv-scorehead__text">
          <div className="lv-scorehead__name">
            {getNflTeamNickname(t.code) || t.code}
            {hasBall && (
              <span className="lv-nflgame__poss" aria-label="has the ball">
                {' '}
                ●
              </span>
            )}
          </div>
          <div className="lv-scorehead__current">{t.code}</div>
          <div className="lv-scorehead__score">{game.state === 'pre' ? '–' : t.score}</div>
        </div>
      </div>
    );
  };

  const awayRows = built?.away.players.map((p) => p.row) ?? [];
  const homeRows = built?.home.players.map((p) => p.row) ?? [];
  const awayQuiet = built?.away.quiet.map((p) => p.row) ?? [];
  const homeQuiet = built?.home.quiet.map((p) => p.row) ?? [];
  const awayName = getNflTeamNickname(game.away.code) || game.away.code;
  const homeName = getNflTeamNickname(game.home.code) || game.home.code;
  const multiLeague = ordered.length > 1;

  return (
    <div className="lv-detail lv-nflgame">
      <div className="lv-detail__top">
        <button type="button" className="lv-back" onClick={onBack}>
          ← All matchups
        </button>
      </div>

      <div className="lv-scorehead">
        {club('away')}
        <span className="lv-scorehead__at">@</span>
        {club('home')}
      </div>

      <p className={`lv-nflgame__status${live ? ' lv-nflgame__status--live' : ''}`}>
        {live && <span className="lv-dot lv-dot--live" aria-hidden="true" />}
        <span>{status}</span>
        {downDistance && (
          <>
            <span className="lv-pdiv" aria-hidden="true">
              ·
            </span>
            <span>{downDistance}</span>
          </>
        )}
      </p>

      {multiLeague && (
        <div className="ui-pills lv-groups lv-nflgame__leagues" role="group" aria-label="Score with league">
          {ordered.map((p) => (
            <button
              key={p.leagueId}
              type="button"
              className={`ui-pill lv-groups__chip${p === panel ? ' lv-groups__chip--on' : ''}`}
              aria-pressed={p === panel}
              onClick={() => {
                setSheetId(null);
                setLeagueId(p.leagueId);
              }}
            >
              {p.leagueName}
            </button>
          ))}
        </div>
      )}

      <p className="lv-nflgame__scoring">
        {panel ? (
          <>
            Fantasy points in <strong>{panel.leagueName}</strong>
            {rostersComplete ? ' · FA = free agent' : ''}
          </>
        ) : (
          'Fantasy points will appear when a league is scoring this week.'
        )}
      </p>

      {panel && (
        <ScorePrecisionContext.Provider value={panel.scorePrecision ?? DEFAULT_SCORE_PRECISION}>
          <div className="lv-mx-body">
            <div className="lv-bench__caps lv-nflgame__caps">
              <span className="lv-bench__cap">{awayName}</span>
              <span className="lv-bench__cap lv-bench__cap--right">{homeName}</span>
            </div>
            {awayRows.length + homeRows.length > 0 ? (
              <LvLineup
                side0={awayRows}
                side1={homeRows}
                meta={allMeta}
                gamesByTeam={gamesByTeam}
                boxScore={boxScore}
                detailStatus={detailStatus}
                onOpenPlayer={onOpenPlayer}
                decorate={decorate}
              />
            ) : (
              <p className="lv-nflgame__empty">
                {pool.status === 'loading' ? 'Loading players…' : 'No fantasy points in this game yet.'}
              </p>
            )}
            <LvBench
              label="No stats yet"
              side0={awayQuiet}
              side1={homeQuiet}
              side0Name={awayName}
              side1Name={homeName}
              meta={allMeta}
              gamesByTeam={gamesByTeam}
              boxScore={boxScore}
              detailStatus={detailStatus}
              onOpenPlayer={onOpenPlayer}
              decorate={decorate}
            />
          </div>
          {built?.freeAgentsPending && (
            <p className="lv-nflgame__note">Free agents appear once this league’s scoring rules load.</p>
          )}
          {pool.status === 'error' && (
            <p className="lv-nflgame__note">Couldn’t load the free agents in this game. Rostered players are shown.</p>
          )}

          {sheet && canSheet && (
            <LvStatSheet
              row={sheet.row}
              meta={allMeta[sheet.row.id]}
              box={boxScore[sheet.row.id]}
              detailStatus={detailStatus}
              leagueId={panel.leagueId}
              year={year}
              franchiseName={
                sheet.owners.length > 0
                  ? sheet.owners.map((o) => o.nameShort || o.name).join(' and ')
                  : sheet.freeAgent
                    ? 'Free agent'
                    : undefined
              }
              onClose={() => setSheetId(null)}
            />
          )}
        </ScorePrecisionContext.Provider>
      )}
    </div>
  );
}
