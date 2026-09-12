/**
 * The fixed scoreboard header — the one thing on this board that never moves.
 *
 * Props-only, so it stories. Every colour, crest and name form was resolved
 * server-side; this component decides nothing about identity, only about
 * layout at the density it is handed.
 */

import { memo } from 'react';
import type { BroadcastLeaguePanel, BroadcastLeagueScore, BroadcastTeam } from '../../../types/live-broadcast';
import type { NflGame, PlayerMeta } from '../../../types/live-scoring';
import { matchupGameClock } from '../../../utils/broadcast-layout';
import type { DensityTier } from '../../../utils/broadcast-layout';
import { dropClasses, nameContext } from '../../../utils/broadcast-layout';

interface Props {
  panels: readonly BroadcastLeaguePanel[];
  scores: Record<string, BroadcastLeagueScore>;
  tier: DensityTier;
  hidden: boolean;
  /**
   * The live NFL slate. Used ONLY to name a real clock for a cell; a franchise
   * with nobody in a game being played gets no clock rather than a placeholder.
   */
  games: readonly NflGame[];
  /** Player identity, for mapping a starter to the NFL game he is in. */
  meta: Record<string, PlayerMeta>;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

/**
 * A number, or an em-dash when this league's feed could not be read.
 *
 * `0.0` is a real score. Printing it for a league whose upstream read FAILED
 * says "nobody has scored yet", which is the same "no games" / "couldn't read
 * it" merge the whole live-scoring rule set exists to prevent — and on this
 * board it is worse than elsewhere, because a dimmed panel of zeros is exactly
 * what a pre-kickoff Sunday morning looks like.
 */
const score = (n: number | undefined, ok: boolean) => (ok ? fmt(n ?? 0) : '—');
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The name form this tier survives on — resolved server-side, picked here. */
function nameAt(team: BroadcastTeam, tier: DensityTier): string {
  const ctx = nameContext(tier);
  if (ctx === 'abbrev') return team.abbrev || team.nameShort || team.name;
  if (ctx === 'short') return team.nameShort || team.name;
  return team.name;
}

function BroadcastScoreHeader({ panels, scores, tier, hidden, games, meta }: Props) {
  return (
    <section
      className={`lbc__header ${dropClasses(tier)}${hidden ? ' is-hidden' : ''}`}
      data-tier={tier}
      aria-label="Scoreboard"
      // `inert` flips the moment the handoff starts, not at the end of the
      // fade — otherwise anything focusable sits under an opacity-0 layer for
      // the 930ms `visibility` delay.
      //
      // Must be a real boolean: React treats `inert=""` as FALSE and logs a
      // warning, so the empty-string spelling silently never applied.
      inert={hidden}
    >
      {panels.map((panel) => {
        const leagueScore = scores[panel.leagueId];
        // How many matchup cells share this league's panel — 2 on a doubleheader.
        const cellCount = Math.max(1, panel.matchups.length);

        return (
          <article
            key={panel.leagueId}
            className={`lbc__panel${panel.status === 'unavailable' ? ' is-unavailable' : ''}`}
            aria-label={`${panel.leagueName} matchup`}
          >
            <p className="lbc__panel-tag">{panel.leagueName}</p>

            {/* A failed read says so even when it HAS pairings to draw. The
                panel keeps its full height either way — removing one
                mid-afternoon re-lays out every other panel. */}
            {panel.status === 'unavailable' && panel.matchups.length > 0 && (
              <p className="lbc__panel-note is-inline">Feed unavailable</p>
            )}

            {panel.matchups.length === 0 ? (
              <p className="lbc__panel-note">
                {panel.status === 'unavailable' ? 'Feed unavailable' : 'No matchup this week'}
              </p>
            ) : (
              <div className="lbc__cells" data-games={cellCount}>
                {panel.matchups.map((matchup) => {
                  const mine = leagueScore?.teams[matchup.mine.franchiseId];
                  const theirs = matchup.opponent
                    ? leagueScore?.teams[matchup.opponent.franchiseId]
                    : undefined;
                  const wp = leagueScore?.winProbability[matchup.index] ?? 0.5;
                  const mineLive = mine?.live ?? 0;
                  const theirsLive = theirs?.live ?? 0;
                  const clock = matchupGameClock(mine?.players ?? [], games, meta);
                  const readable = panel.status !== 'unavailable';

                  return (
                    <div
                      key={matchup.index}
                      className="lbc__cell"
                      style={{
                        // The SWATCH, resolved server-side against
                        // `--lbc-panel` — not `primary`, which is the
                        // takeover's full-screen field and is judged against
                        // the darker ground. A 0.7vh bar and a 100vh field are
                        // different legibility problems.
                        ['--lbc-mine' as string]: matchup.mine.swatch,
                        ['--lbc-theirs' as string]: matchup.opponent?.swatch ?? '#334155',
                        ['--wp-split' as string]: pct(wp),
                      }}
                    >
                      {/* A screen reader gets one sentence; the numerals and the
                          bar below are decoration it never has to assemble. */}
                      <p className="visually-hidden">
                        {matchup.mine.name} {score(mineLive, readable)}, projected{' '}
                        {score(mine?.projectedFinal, readable)},{' '}
                        {mine?.yetToPlay ?? 0} to play.{' '}
                        {matchup.opponent
                          ? `${matchup.opponent.name} ${score(theirsLive, readable)}, projected ${score(theirs?.projectedFinal, readable)}, ${theirs?.yetToPlay ?? 0} to play. Win probability ${pct(wp)}.`
                          : 'No opponent this week.'}
                        {readable ? '' : ' This league’s feed could not be read.'}
                      </p>

                      <div aria-hidden="true">
                        {cellCount > 1 && <p className="lbc__game-tag">Game {matchup.index + 1}</p>}

                        <div className={`lbc__side${readable && mineLive >= theirsLive ? ' is-leading' : ''}`}>
                          {matchup.mine.iconSmall && (
                            <img className="lbc__crest" src={matchup.mine.iconSmall} alt="" />
                          )}
                          <span className="lbc__tn">{nameAt(matchup.mine, tier)}</span>
                          <span className="lbc__proj">
                            <span className="lbc__proj-word">Proj </span>
                            {score(mine?.projectedFinal, readable)}
                          </span>
                          <span className="lbc__score">{score(mineLive, readable)}</span>
                        </div>

                        {/* No opponent means no probability to state. A 50/50
                            bar against nobody asserts a coin flip that is not
                            happening — the visually-hidden sentence already
                            says "no opponent this week". */}
                        {matchup.opponent && readable && (
                          <div className="lbc__wp">
                            <div className="lbc__wp-fill" style={{ width: pct(wp) }} />
                          </div>
                        )}

                        {matchup.opponent && (
                          <div className={`lbc__side${readable && theirsLive > mineLive ? ' is-leading' : ''}`}>
                            {matchup.opponent.iconSmall && (
                              <img className="lbc__crest" src={matchup.opponent.iconSmall} alt="" />
                            )}
                            <span className="lbc__tn">{nameAt(matchup.opponent, tier)}</span>
                            <span className="lbc__proj">
                              <span className="lbc__proj-word">Proj </span>
                              {score(theirs?.projectedFinal, readable)}
                            </span>
                            <span className="lbc__score">{score(theirsLive, readable)}</span>
                          </div>
                        )}

                        <div className="lbc__cell-foot">
                          {matchup.opponent && readable && (
                            <span className="lbc__wp-label">{pct(wp)} win</span>
                          )}
                          <span>{mine?.yetToPlay ?? 0} to play</span>
                          <span className="lbc__ytp-opp">{theirs?.yetToPlay ?? 0} theirs</span>
                          {/* The real ESPN clock, or NOTHING. Never a number
                              derived from MFL's `gameSecondsRemaining`, which
                              does not tick and drifts all afternoon into a
                              confident-looking lie. */}
                          {clock && <span className="lbc__gameclock">{clock}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

/**
 * Memoised because the island ticks once a SECOND to age the freshness pill
 * and drive the screensaver clock, and this component depends on none of that.
 * Unmemoised, a 1 Hz heartbeat re-renders the whole visible board ~28,800
 * times over an eight-hour Sunday — on set-top hardware, and concurrently
 * with the reveal transitions that are the one thing on this screen allowed
 * to cost a frame budget. Props here are already memoised upstream, so the
 * bailout is free and changes no behaviour.
 */
export default memo(BroadcastScoreHeader);
