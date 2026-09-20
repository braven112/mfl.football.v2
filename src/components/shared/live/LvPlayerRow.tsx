/**
 * One starter (or bench) row.
 *
 * ── POSITION, NEVER A SLOT ────────────────────────────────────────────────
 * The label names the player's POSITION. It used to name his lineup SLOT, with
 * `FLEX` for the leftovers — and that had to be derived, because MFL's
 * `liveScoring` says WHO is starting and never WHERE. Since MFL returns arrays
 * in nondeterministic order, the derivation makes "the flex" whichever back the
 * feed happened to list second, so the label could swap between two polls of an
 * unchanged lineup. Position comes free with `PlayerMeta` and cannot flicker.
 *
 * ── AND IT RIDES THE META LINE, NOT A COLUMN OF ITS OWN ───────────────────
 * It used to hold a `pos` grid area sized `--lv-slot-w` — a fixed 1.6rem plus
 * the row gap, 32px on EACH side of the pair, taken out of the two name
 * columns for the sake of two characters. On a 390px phone that is 64px, and
 * it is why "Jahmyr Gibbs" and "Chris Olave" wrapped to two lines when both
 * fit comfortably on one (owner, 2026-09-19).
 *
 * The label now joins the row that already carries the clock — `RB · DET`
 * ahead of the game state — which costs no geometry at all and buys the row
 * the NFL team it never printed anywhere. The two live behind ONE wrapper
 * (`.lv-pwho`) so the meta line's `flex-wrap` can never separate a position
 * from its team, or strand the separator at the head of a wrapped line.
 *
 * What is deliberately NOT done: a shared centre column, or a position group
 * header spanning the pair. Both can only name ONE of the two paired
 * positions and mislabel the other the moment the sides run different lineup
 * shapes — a WR opposite an RB is an ordinary row, not an edge case. See
 * `tests/live-scoring-layout-css.test.ts`.
 *
 * ── THE STAT LINE IS A SIBLING, NOT A CHILD ───────────────────────────────
 * Everything here is flattened into the row's own grid (`.lv-pid` is
 * `display: contents`), so the box-score line spans the whole row rather than
 * the narrow name column. Nested, a real line wrapped to two rows on a desktop
 * card and SIX on a 390px phone.
 */
import type { JSX } from 'react';
import type { LivePlayerRow, NflGame, PlayerBoxScore, PlayerMeta } from '../../../types/live-scoring';
import {
  describeGameState,
  formatGameClock,
  isPlayerInRedZone,
  nflGameStateFromSeconds,
  playerDownDistance,
  resolveGameState,
} from '../../../utils/live-scoring-view';
import { projectPlayerFinal } from '../../../utils/live-win-probability';
import { positionLabel } from '../../../utils/mfl-live-lineup';
import { nflLogoUrl } from '../../../utils/live/nfl-logo-url';
import {
  nflLogoErrorHandler,
  nflLogoLoadHandler,
  nflLogoRefCallback,
} from '../../../constants/roster-constants';
import {
  getPlayerAvatarBackground,
  getPlayerAvatarBorder,
  getPlayerAvatarRing,
  getPlayerAvatarRingDark,
} from '../../../utils/nfl-team-colors';

/** One decimal, always — a score that gains a digit must not shift the column. */
const fmt = (n: number) => n.toFixed(1);

export interface LvPlayerRowProps {
  row: LivePlayerRow;
  meta?: PlayerMeta;
  /** Which side of the pair. The mirrored side reverses its columns. */
  side: 'left' | 'right';
  /** His real NFL game, when the ESPN scoreboard resolved one. */
  game?: NflGame;
  /** His box-score line; undefined means ESPN has no line for him yet. */
  box?: PlayerBoxScore;
  /**
   * Whether the box-score feed is readable at all. On `'error'` the stat slot
   * is suppressed entirely rather than rendering every starter as though he
   * had done nothing — silence must mean "no stats yet", never "feed down".
   */
  detailStatus?: 'ok' | 'error' | 'pending';
}

export default function LvPlayerRow({
  row,
  meta,
  side,
  game,
  box,
  detailStatus = 'ok',
}: LvPlayerRowProps): JSX.Element {
  const position = meta?.position ?? '';
  const team = meta?.nflTeam ?? '';
  const isDef = position === 'DEF';

  // ESPN decides whether his game is under way; MFL's seconds are the
  // fallback. Reading the dot from MFL and the clock from ESPN is what put a
  // "not kicked off" ring beside a running clock.
  const state = resolveGameState(nflGameStateFromSeconds(row.secondsRemaining), game);

  const projected = meta?.projected ?? 0;
  const projFinal = projectPlayerFinal({
    live: row.live,
    projected,
    secondsRemaining: row.secondsRemaining,
  });
  const boom = state !== 'not-started' && projected > 0 && row.live >= projected;

  // Possession, not the game: `isRedZone` belongs to the team WITH THE BALL,
  // so gating on the game alone flags a receiver while his team is on defense.
  const redZone = isPlayerInRedZone(game, team);
  const downDistance = playerDownDistance(game, team);

  /**
   * DEF/ST gets no stat line, deliberately. ESPN's box score is athlete-keyed
   * and MFL's 32 defences carry no ESPN athlete id, so there is no join key
   * even in principle — and a plausible wrong number beside a real MFL score
   * is worse than a blank.
   */
  const statLine = detailStatus === 'error' || isDef ? '' : (box?.statLine ?? '');

  /**
   * No club code beside a team defence. `DEF · SEA` sits next to a player
   * literally named "Seattle Seahawks" — the position already says which of
   * the 32 he is, so the code is the same fact a third time in one row.
   */
  const teamLabel = isDef ? '' : team;

  return (
    <div
      className={`lv-prow${side === 'right' ? ' lv-prow--right' : ''}${
        redZone ? ' lv-prow--redzone' : ''
      }`}
    >
      <span
        className={`lv-headshot${isDef ? ' lv-headshot--def' : ''}`}
        style={
          isDef
            ? undefined
            : {
                // All FOUR, together. The ring pair is theme-specific, so
                // setting the backdrop without it gives the chip a team
                // colour in one theme and a bare default in the other —
                // pinned by tests/team-color-backdrop-guard.test.ts.
                ['--player-avatar-bg' as string]: getPlayerAvatarBackground(team),
                ['--player-avatar-border' as string]: getPlayerAvatarBorder(team),
                ['--player-avatar-ring' as string]: getPlayerAvatarRing(team),
                ['--player-avatar-ring-dark' as string]: getPlayerAvatarRingDark(team),
              }
        }
      >
        {isDef
          ? team && (
              <img
                src={nflLogoUrl(team)}
                alt=""
                loading="lazy"
                onError={nflLogoErrorHandler}
                onLoad={nflLogoLoadHandler}
                ref={nflLogoRefCallback}
              />
            )
          : meta?.headshot && <img src={meta.headshot} alt="" loading="lazy" />}
      </span>

      <span className="lv-pid">
        <span className="lv-pname">{meta?.name ?? `Player ${row.id}`}</span>
        <span className="lv-pmeta">
          {/* ONE wrapper, so `flex-wrap` on the meta line can never break
              "RB · DET" across two lines or leave the separator heading one.
              The separator is `aria-hidden` — a screen reader reading
              "RB middle dot DET" is worse than reading "RB DET". */}
          <span className="lv-pwho">
            <span className="lv-ppos">{positionLabel(position) || '—'}</span>
            {teamLabel && (
              <>
                <span className="lv-pdiv" aria-hidden="true">
                  ·
                </span>
                <span className="lv-pteam">{teamLabel}</span>
              </>
            )}
          </span>
          <span
            className={`lv-pclock${
              state === 'in-progress'
                ? ' lv-pclock--live'
                : state === 'not-started'
                  ? ' lv-pclock--pre'
                  : ''
            }`}
            title={describeGameState(state)}
          >
            <span
              className={`lv-dot lv-dot--${
                state === 'in-progress' ? 'live' : state === 'not-started' ? 'pre' : 'final'
              }`}
            />
            {/* Never fabricated: with no ESPN game this prints the STATE and
                no numbers. The old helper divided MFL's seconds by 900 and
                printed a confident "Q3 7:24" that drifted all afternoon,
                because the NFL clock stops and that number does not. */}
            {formatGameClock(state, game)}
          </span>
          {redZone && <span className="lv-rz">RED ZONE</span>}
          {!redZone && downDistance && <span className="lv-dd">{downDistance}</span>}
        </span>
        <span
          className={`lv-pscore${state === 'not-started' ? ' lv-pscore--pre' : ''}${
            boom ? ' lv-pscore--boom' : ''
          }`}
        >
          <span className="lv-plive">{fmt(row.live)}</span>
          <span className="lv-pproj">proj {fmt(projFinal)}</span>
        </span>
        {statLine && <span className="lv-pstat">{statLine}</span>}
      </span>
    </div>
  );
}
