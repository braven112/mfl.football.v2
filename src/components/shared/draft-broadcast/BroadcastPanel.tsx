/**
 * BroadcastPanel — the screensaver's two non-reveal screens.
 *
 * The reel (see `replayIndex` in DraftBroadcast) answers "what happened
 * tonight". These answer the two questions an EMAIL draft actually leaves the
 * room asking, neither of which the idle board can fit:
 *
 *   roster    → what does the man on the clock already have, and what is he
 *               obviously still missing? Shown for the team on the clock and
 *               then the team on deck.
 *   positions → how many of each position are off the board, with the faces.
 *
 * Both are LIVE screens, not history — they are built from the board as it
 * stands — so neither wears the rewind flag the replayed cards do. They ride
 * the same layer as the reveal card and cross-fade the same way; the only thing
 * that decides when they are up is the playlist.
 *
 * They are painted in the franchise's own gradient (roster) or the board's
 * house dark (positions), through the same `--dbc-gradient` custom property the
 * reveal card and the idle board both set — one painting path for all four
 * screens, which is what stopped the idle board and the reveal disagreeing
 * about a franchise's colours (see `toBroadcastPair`).
 */

import { useCallback } from 'react';
import type { DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastPlayer } from '../../../types/draft-broadcast';
import {
  crestStrokeProps,
  resolveBroadcastGradient,
  toBroadcastPair,
  type PositionTally,
  type RosterRow,
} from '../../../utils/draft-broadcast';
import { resolveSplashColors } from '../../../utils/pick-reveal';
import { BroadcastFace } from './BroadcastFace';

/**
 * Faces per row before the rest becomes a "+N".
 *
 * A row is read at a glance from ten feet, and the count beside the label is
 * already the precise answer — the faces are there to make it a thing you
 * recognise rather than a number you parse. Eight fills a 16:9 row at this chip
 * size without shrinking the chips to the point where nobody can tell who they
 * are, which would defeat the entire purpose of drawing them.
 */
const FACES_PER_ROW = 8;

/**
 * The name under a chip.
 *
 * Surname only for a person: at chip width a first name costs the row a chip
 * and tells nobody anything they did not already get from the face. A team
 * DEFENSE has no surname — dropping the first token of "Kansas City Chiefs"
 * leaves "City Chiefs", which is the kind of small wrongness a room notices
 * immediately — so a defense wears its team code instead.
 *
 * Exported for the guard test: this is the one piece of copy here with a rule
 * behind it rather than a layout.
 */
export function faceLabel(name: string, position?: string, nflTeam?: string): string {
  if ((position || '').toUpperCase() === 'DEF') return (nflTeam || name || '').toUpperCase();
  const parts = (name || '').trim().split(/\s+/);
  // A single-token name is that token — "Ogunbowale" and, more to the point, a
  // pool entry we only half-resolved. Never return an empty string, which would
  // leave a chip with a caption-shaped gap under it.
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || '';
}

/** Franchise colours + gradient, resolved exactly as the reveal card does. */
function brandStyle(team?: DraftRoomTeam): React.CSSProperties {
  const brand = resolveSplashColors(team);
  const { primary, secondary } = toBroadcastPair(brand.primary, brand.secondary);
  const gradient = resolveBroadcastGradient(team);
  return {
    '--dbc-primary': primary,
    '--dbc-secondary': secondary,
    ...(gradient ? { '--dbc-gradient': gradient } : {}),
  } as React.CSSProperties;
}

/** One chip plus its caption. */
function FaceCell({
  player,
  label,
  tag,
}: {
  player?: Parameters<typeof BroadcastFace>[0]['player'];
  label: string;
  tag?: string;
}) {
  return (
    <li className={`dbc-panel__face${tag ? ' is-new' : ''}`}>
      <BroadcastFace player={player} className="dbc-panel__face-chip" />
      <span className="dbc-panel__face-name">{label}</span>
      {tag ? <span className="dbc-panel__face-tag">{tag}</span> : null}
    </li>
  );
}

/**
 * A franchise's roster, by position — the "what does he still need" screen.
 *
 * Tonight's picks are marked (`is-new`, plus their pick label), because the
 * whole point of showing this to a room mid-draft is the contrast between what
 * he walked in with and what he has done about it.
 */
export function BroadcastRosterPanel({
  team,
  role,
  rows,
}: {
  team?: DraftRoomTeam;
  role: 'clock' | 'deck';
  rows: RosterRow[];
}) {
  // A crest that 404s hides itself rather than leaving an alt-text stub on the
  // TV — the same rule the idle board and the reveal card follow.
  const hideOnError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
  }, []);

  const total = rows.reduce((n, row) => n + row.count, 0);
  const tonight = rows.reduce(
    (n, row) => n + row.players.filter((p) => !!p.pickLabel).length,
    0
  );

  return (
    <div className="dbc-panel dbc-panel--roster" style={brandStyle(team)}>
      <div className="dbc-panel__wash" aria-hidden="true" />
      <header className="dbc-panel__head">
        {/* `iconSmall`, not `icon`: this crest is ~14vh, small enough that a
            100x100 dark cut is not upscaled enough to show, so the franchise's
            own dark artwork beats the higher-resolution light one here. The
            reveal and idle crests make the opposite trade — see
            `resolveBroadcastCrest`. */}
        {team?.iconSmall ? (
          <img
            {...crestStrokeProps('dbc-panel__crest', team.iconSmallStroke)}
            src={team.iconSmall}
            alt=""
            onError={hideOnError}
          />
        ) : null}
        <div className="dbc-panel__title">
          <p className="dbc-panel__eyebrow">{role === 'clock' ? 'On the clock' : 'On deck'}</p>
          <h2 className="dbc-panel__team">{team?.nameMedium || team?.name || 'Franchise'}</h2>
          <p className="dbc-panel__sub">
            {total} on the roster
            {tonight > 0 ? ` · ${tonight} taken tonight` : ''}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        // Reachable, and not only in theory: a franchise whose keepers the feed
        // has not published yet and who has not picked has a genuinely empty
        // roster. Saying so beats a panel of blank rows.
        <p className="dbc-panel__empty">Nothing on the roster yet</p>
      ) : (
        <div className="dbc-panel__rows">
          {rows.map((row) => (
            <section className="dbc-panel__row" key={row.position}>
              <div className="dbc-panel__row-head">
                <span className="dbc-panel__pos">{row.position}</span>
                <span className="dbc-panel__count">{row.count}</span>
              </div>
              <ul className="dbc-panel__faces">
                {row.players.slice(0, FACES_PER_ROW).map((p) => (
                  <FaceCell
                    key={p.id}
                    player={p}
                    label={faceLabel(p.name, p.position, p.nflTeam)}
                    tag={p.pickLabel}
                  />
                ))}
                {row.players.length > FACES_PER_ROW ? (
                  <li className="dbc-panel__more">+{row.players.length - FACES_PER_ROW}</li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What is off the board, by position — the run nobody was keeping track of.
 *
 * In a draft that runs over days this is the fact the room genuinely cannot
 * reconstruct: the RB run happened on Tuesday and the only record of it is a
 * scrollback nobody is going to read on a television.
 */
export function BroadcastPositionPanel({
  tallies,
  madeCount,
  totalSlots,
}: {
  tallies: PositionTally[];
  madeCount: number;
  totalSlots: number;
}) {
  const most = Math.max(1, ...tallies.map((t) => t.count));

  return (
    <div className="dbc-panel dbc-panel--positions">
      <div className="dbc-panel__wash" aria-hidden="true" />
      <header className="dbc-panel__head">
        <div className="dbc-panel__title">
          <p className="dbc-panel__eyebrow">Off the board</p>
          <h2 className="dbc-panel__team">
            {madeCount} <span className="dbc-panel__team-of">of {totalSlots} picks</span>
          </h2>
          <p className="dbc-panel__sub">Every position taken tonight, newest first</p>
        </div>
      </header>

      <div className="dbc-panel__rows">
        {tallies.map((tally) => (
          <section className="dbc-panel__row" key={tally.position}>
            <div className="dbc-panel__row-head">
              <span className="dbc-panel__pos">{tally.position}</span>
              <span className="dbc-panel__count">{tally.count}</span>
            </div>
            {/* The bar is the only thing on this screen readable from across a
                room without reading a digit — it is what makes a run LOOK like
                a run. Width is a share of the biggest row, so the tallest bar
                always fills its track whatever the round. */}
            <div className="dbc-panel__bar" aria-hidden="true">
              <span style={{ width: `${(tally.count / most) * 100}%` }} />
            </div>
            <ul className="dbc-panel__faces">
              {tally.players.slice(0, FACES_PER_ROW).map((p: BroadcastPlayer) => (
                <FaceCell
                  key={p.id}
                  player={p}
                  label={faceLabel(p.name, p.position, p.nflTeam)}
                />
              ))}
              {tally.players.length > FACES_PER_ROW ? (
                <li className="dbc-panel__more">+{tally.players.length - FACES_PER_ROW}</li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
