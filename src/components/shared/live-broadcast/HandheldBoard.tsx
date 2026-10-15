/**
 * The handheld board — the same Sunday, for a phone or tablet beside the owner.
 *
 * A second RENDERING of the island's poll, not a second board: the island
 * still owns the poll, the carry, the reveal queue and every timer, and hands
 * this component the results. Nothing here fetches, and nothing here decides
 * what earns a moment.
 *
 * It is a separate component with its own root class (`.lbh`) and its own
 * stylesheet (`live-broadcast-handheld.css`) on purpose. The TV board must not
 * change, and the only way to make that a fact rather than a hope is for the
 * handheld layout to share no selector with it:
 * `tests/broadcast-handheld-isolation.test.ts` fails on any `.lbh` rule in the
 * TV stylesheet and any rule in this one outside `.lbh`.
 *
 * What a phone does NOT inherit from the television, and why:
 *  - No full-screen takeover. A glance at a phone should never land on a
 *    fourteen-second animation; every moment is a slide-in banner.
 *  - No screensaver and no burn-in drift. A phone is not on for eight hours
 *    at one brightness, and a quiet board is still the owner's scores.
 *  - No hidden cursor or chrome. There is no cursor, and this screen is
 *    touched.
 *
 * Props-only, so it renders under `renderToString` in tests.
 */

import { memo } from 'react';
import type {
  BroadcastLeaguePanel,
  BroadcastLeagueScore,
  BroadcastTeam,
} from '../../../types/live-broadcast';
import type { NflGame, PlayerMeta } from '../../../types/live-scoring';
import type { BroadcastMoment, RedZoneAlert } from '../../../utils/broadcast-moments';
import { matchupTimeLeft } from '../../../utils/broadcast-layout';
import { crestStrokeProps } from '../../../utils/draft-broadcast';

interface Props {
  week: number;
  /** Every enabled league — the handheld has no featured / compact split. */
  panels: readonly BroadcastLeaguePanel[];
  scores: Record<string, BroadcastLeagueScore>;
  games: readonly NflGame[];
  meta: Record<string, PlayerMeta>;
  /** Is any game being played right now? */
  live: boolean;
  /** The moment the queue is showing, or null. Rendered as a banner. */
  moment: BroadcastMoment | null;
  /** The franchise the moment belongs to, for its colours and crest. */
  momentTeam: BroadcastTeam | null;
  /** "84.2 – 79.8" — what the play did to the matchup. */
  momentScoreLine: string;
  redZone: readonly RedZoneAlert[];
  /** The freshness line, or '' when the scores are current. */
  statusText: string;
  statusError: boolean;
  demoText?: string;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
/** A number, or an em-dash when this league's feed could not be read. */
const score = (n: number | undefined, ok: boolean) => (ok ? fmt(n ?? 0) : '—');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const shortName = (t: BroadcastTeam) => t.nameShort || t.name;

function Crest({ team }: { team: BroadcastTeam }) {
  return (
    <span className="lbh__crest">
      {team.iconSmall && (
        <img {...crestStrokeProps('', team.iconSmallStroke, 'lbc')} src={team.iconSmall} alt="" />
      )}
    </span>
  );
}

function HandheldBoard({
  week,
  panels,
  scores,
  games,
  meta,
  live,
  moment,
  momentTeam,
  momentScoreLine,
  redZone,
  statusText,
  statusError,
  demoText,
}: Props) {
  const redZoneNames = redZone.flatMap((a) =>
    a.players.map((p) => `${p.playerName}${p.side === 'opponent' ? ' (against you)' : ''}`),
  );
  const redZoneDd = redZone.find((a) => a.downDistance)?.downDistance ?? '';

  return (
    <main className="lbh" data-mode="handheld" aria-label="Live scoring broadcast">
      <header className="lbh__bar">
        <span className={`lbh__live${live ? ' is-live' : ''}`}>{live ? 'Live' : 'Not live'}</span>
        <span className="lbh__week">Week {week}</span>
        {statusText && (
          <span className={`lbh__status${statusError ? ' is-error' : ''}`}>{statusText}</span>
        )}
        {demoText && <span className="lbh__status">{demoText}</span>}
      </header>

      {redZone.length > 0 && (
        <p className="lbh__redzone" aria-hidden="true">
          <span className="lbh__redzone-tag">Red zone</span>
          <span className="lbh__redzone-who">{redZoneNames.join(' · ')}</span>
          {redZoneDd && <span className="lbh__redzone-dd">{redZoneDd}</span>}
        </p>
      )}

      <ul className="lbh__cards">
        {panels.map((panel) => {
          const leagueScore = scores[panel.leagueId];
          const readable = panel.status !== 'unavailable';

          if (panel.matchups.length === 0) {
            return (
              <li key={panel.leagueId} className="lbh__card is-empty">
                <p className="lbh__tag">{panel.leagueName}</p>
                <p className="lbh__note">
                  {panel.status === 'unavailable' ? 'Feed unavailable' : 'No matchup this week'}
                </p>
              </li>
            );
          }

          // Every matchup is its own card — a doubleheader league is two real
          // games against two different opponents, never `matchups[0]`.
          return panel.matchups.map((matchup) => {
            const mine = leagueScore?.teams[matchup.mine.franchiseId];
            const theirs = matchup.opponent
              ? leagueScore?.teams[matchup.opponent.franchiseId]
              : undefined;
            const wp = leagueScore?.winProbability[matchup.index] ?? 0.5;
            const mineLive = mine?.live ?? 0;
            const theirsLive = theirs?.live ?? 0;
            const clock = matchupTimeLeft(
              [...(mine?.players ?? []), ...(theirs?.players ?? [])],
              games,
              meta,
            );
            const doubleheader = panel.matchups.length > 1;

            return (
              <li
                key={`${panel.leagueId}:${matchup.index}`}
                className={`lbh__card${readable ? '' : ' is-unavailable'}`}
                style={{
                  ['--lbh-mine' as string]: matchup.mine.swatch,
                  ['--lbh-theirs' as string]: matchup.opponent?.swatch ?? '#334155',
                }}
              >
                <p className="visually-hidden">
                  {panel.leagueName}: {matchup.mine.name} {score(mineLive, readable)}
                  {matchup.opponent
                    ? `, ${matchup.opponent.name} ${score(theirsLive, readable)}.${readable ? ` Win probability ${pct(wp)}.` : ''}`
                    : '. No opponent this week.'}
                  {readable ? '' : ' This league’s feed could not be read.'}
                </p>

                <div aria-hidden="true">
                  <p className="lbh__tag">
                    <span>
                      {panel.leagueName}
                      {doubleheader ? ` · Game ${matchup.index + 1}` : ''}
                    </span>
                    {clock && readable && <span className="lbh__clock">{clock}</span>}
                    {!readable && <span className="lbh__clock">Feed unavailable</span>}
                  </p>

                  <div className={`lbh__side is-mine${readable && mineLive >= theirsLive ? ' is-leading' : ''}`}>
                    <Crest team={matchup.mine} />
                    <span className="lbh__ident">
                      <span className="lbh__tn">{shortName(matchup.mine)}</span>
                      <span className="lbh__ytp">
                        {readable ? `${mine?.yetToPlay ?? 0} to play · Proj ${score(mine?.projectedFinal, readable)}` : ''}
                      </span>
                    </span>
                    <span className="lbh__score">{score(mineLive, readable)}</span>
                  </div>

                  {matchup.opponent && readable && (
                    <div className="lbh__wp">
                      <div className="lbh__wp-fill" style={{ width: pct(wp) }} />
                    </div>
                  )}

                  {matchup.opponent ? (
                    <div className={`lbh__side${readable && theirsLive > mineLive ? ' is-leading' : ''}`}>
                      <Crest team={matchup.opponent} />
                      <span className="lbh__ident">
                        <span className="lbh__tn">{shortName(matchup.opponent)}</span>
                        <span className="lbh__ytp">
                          {readable ? `${theirs?.yetToPlay ?? 0} to play · Proj ${score(theirs?.projectedFinal, readable)}` : ''}
                        </span>
                      </span>
                      <span className="lbh__score">{score(theirsLive, readable)}</span>
                    </div>
                  ) : (
                    <p className="lbh__note">Bye week</p>
                  )}

                  {matchup.opponent && readable && <p className="lbh__wp-label">{pct(wp)} win</p>}
                </div>
              </li>
            );
          });
        })}
      </ul>

      {/* Every moment is a banner here — the owner's own plays included. The
          colour asymmetry carries over from the TV: a field of MY colour for
          mine, a dark card with their colour as a rule for theirs. Keyed on
          the moment so each one slides in fresh. */}
      {moment && (
        <aside
          key={moment.key}
          className={`lbh__banner${moment.side === 'mine' ? ' is-mine' : ' is-theirs'}`}
          style={
            momentTeam
              ? ({ ['--lbh-banner' as string]: momentTeam.primary } as Record<string, string>)
              : undefined
          }
          aria-hidden="true"
        >
          {momentTeam && <Crest team={momentTeam} />}
          <span className="lbh__banner-who">
            <span className="lbh__banner-kicker">
              {moment.side === 'mine' ? 'Your player' : 'Against you'} · {moment.leagueName}
            </span>
            <span className="lbh__banner-name">{moment.playerName}</span>
            <span className="lbh__banner-play">{moment.text}</span>
          </span>
          <span className="lbh__banner-end">
            {moment.scoreValue > 0 && <span className="lbh__banner-pts">{`+${moment.scoreValue}`}</span>}
            {momentScoreLine && <span className="lbh__banner-line">{momentScoreLine}</span>}
          </span>
        </aside>
      )}
    </main>
  );
}

export default memo(HandheldBoard);
