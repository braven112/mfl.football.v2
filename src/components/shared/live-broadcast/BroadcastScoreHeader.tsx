/**
 * The fixed scoreboard header — the one thing on this board that never moves.
 *
 * Props-only, so it stories. Every colour, crest and name form was resolved
 * server-side; this component decides nothing about identity, only about
 * layout at the density it is handed.
 */

import type { BroadcastLeaguePanel, BroadcastLeagueScore, BroadcastTeam } from '../../../types/live-broadcast';
import type { DensityTier } from '../../../utils/broadcast-layout';
import { dropClasses, nameContext } from '../../../utils/broadcast-layout';

interface Props {
  panels: readonly BroadcastLeaguePanel[];
  scores: Record<string, BroadcastLeagueScore>;
  tier: DensityTier;
  hidden: boolean;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The name form this tier survives on — resolved server-side, picked here. */
function nameAt(team: BroadcastTeam, tier: DensityTier): string {
  const ctx = nameContext(tier);
  if (ctx === 'abbrev') return team.abbrev || team.nameShort || team.name;
  if (ctx === 'short') return team.nameShort || team.name;
  return team.name;
}

export default function BroadcastScoreHeader({ panels, scores, tier, hidden }: Props) {
  return (
    <section
      className={`lbc__header ${dropClasses(tier)}${hidden ? ' is-hidden' : ''}`}
      data-tier={tier}
      aria-label="Scoreboard"
      // `inert` flips the moment the handoff starts, not at the end of the
      // fade — otherwise anything focusable sits under an opacity-0 layer.
      {...(hidden ? { inert: '' as unknown as boolean } : {})}
    >
      {panels.map((panel) => {
        const leagueScore = scores[panel.leagueId];
        const games = Math.max(1, panel.matchups.length);

        return (
          <article
            key={panel.leagueId}
            className={`lbc__panel${panel.status === 'unavailable' ? ' is-unavailable' : ''}`}
            aria-label={`${panel.leagueName} matchup`}
          >
            <p className="lbc__panel-tag">{panel.leagueName}</p>

            {panel.matchups.length === 0 ? (
              <p className="lbc__panel-note">
                {panel.status === 'unavailable' ? 'Feed unavailable' : 'No matchup this week'}
              </p>
            ) : (
              <div className="lbc__cells" data-games={games}>
                {panel.matchups.map((matchup) => {
                  const mine = leagueScore?.teams[matchup.mine.franchiseId];
                  const theirs = matchup.opponent
                    ? leagueScore?.teams[matchup.opponent.franchiseId]
                    : undefined;
                  const wp = leagueScore?.winProbability[matchup.index] ?? 0.5;
                  const mineLive = mine?.live ?? 0;
                  const theirsLive = theirs?.live ?? 0;

                  return (
                    <div
                      key={matchup.index}
                      className="lbc__cell"
                      style={{
                        // Both franchises' legible pair, resolved server-side
                        // against --lbc-panel (NOT the live board's #262626 —
                        // the wrong background gives a confident wrong answer).
                        ['--lbc-mine' as string]: matchup.mine.primary,
                        ['--lbc-theirs' as string]: matchup.opponent?.primary ?? '#334155',
                        ['--wp-split' as string]: pct(wp),
                      }}
                    >
                      {/* A screen reader gets one sentence; the numerals and the
                          bar below are decoration it never has to assemble. */}
                      <p className="visually-hidden">
                        {matchup.mine.name} {fmt(mineLive)}, projected {fmt(mine?.projectedFinal ?? 0)},{' '}
                        {mine?.yetToPlay ?? 0} to play.{' '}
                        {matchup.opponent
                          ? `${matchup.opponent.name} ${fmt(theirsLive)}, projected ${fmt(theirs?.projectedFinal ?? 0)}, ${theirs?.yetToPlay ?? 0} to play. Win probability ${pct(wp)}.`
                          : 'No opponent this week.'}
                      </p>

                      <div aria-hidden="true">
                        {games > 1 && <p className="lbc__game-tag">Game {matchup.index + 1}</p>}

                        <div className={`lbc__side${mineLive >= theirsLive ? ' is-leading' : ''}`}>
                          {matchup.mine.iconSmall && (
                            <img className="lbc__crest" src={matchup.mine.iconSmall} alt="" />
                          )}
                          <span className="lbc__tn">{nameAt(matchup.mine, tier)}</span>
                          <span className="lbc__proj">
                            <span className="lbc__proj-word">Proj </span>
                            {fmt(mine?.projectedFinal ?? 0)}
                          </span>
                          <span className="lbc__score">{fmt(mineLive)}</span>
                        </div>

                        <div className="lbc__wp">
                          <div className="lbc__wp-fill" style={{ width: pct(wp) }} />
                        </div>

                        {matchup.opponent && (
                          <div className={`lbc__side${theirsLive > mineLive ? ' is-leading' : ''}`}>
                            {matchup.opponent.iconSmall && (
                              <img className="lbc__crest" src={matchup.opponent.iconSmall} alt="" />
                            )}
                            <span className="lbc__tn">{nameAt(matchup.opponent, tier)}</span>
                            <span className="lbc__proj">
                              <span className="lbc__proj-word">Proj </span>
                              {fmt(theirs?.projectedFinal ?? 0)}
                            </span>
                            <span className="lbc__score">{fmt(theirsLive)}</span>
                          </div>
                        )}

                        <div className="lbc__cell-foot">
                          <span className="lbc__wp-label">{pct(wp)} win</span>
                          <span>{mine?.yetToPlay ?? 0} to play</span>
                          <span className="lbc__ytp-opp">{theirs?.yetToPlay ?? 0} theirs</span>
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
