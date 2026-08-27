/**
 * OnTheClock — the broadcast board's resting state.
 *
 * This is what the TV shows between picks, which is most of draft night, so it
 * gets designed like a destination rather than a placeholder: whose turn it is,
 * what just went, and who's warming up. When nothing has been picked yet it
 * becomes the pre-draft screen instead — same furniture, different framing.
 */

import { useMemo } from 'react';
import type { DraftRoomPick, DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastConference, BroadcastPlayer } from '../../../types/draft-broadcast';
import { recentPicks, upcomingPicks } from '../../../utils/draft-broadcast';

interface Props {
  conference: BroadcastConference;
  conferences: BroadcastConference[];
  onTheClock: DraftRoomPick | null;
  team?: DraftRoomTeam;
  picks: DraftRoomPick[];
  teams: ReadonlyMap<string, DraftRoomTeam>;
  players: ReadonlyMap<string, BroadcastPlayer>;
  totalRounds: number;
  picksPerRound: number;
  madeCount: number;
}

function pickLabel(pick: DraftRoomPick): string {
  return `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;
}

export function OnTheClock({
  conference,
  conferences,
  onTheClock,
  team,
  picks,
  teams,
  players,
  totalRounds,
  picksPerRound,
  madeCount,
}: Props) {
  const recent = useMemo(() => recentPicks(picks, 4), [picks]);
  const upcoming = useMemo(() => upcomingPicks(picks, 3), [picks]);

  const notStarted = madeCount === 0;
  const complete = !onTheClock && picks.length > 0;

  // The clock team's colors and crest own the screen the same way the drafting
  // team owns a reveal — so the room can tell whose turn it is from across the
  // room without reading a word. Colors and crest ONLY: franchise banners were
  // tried and cut, since a banner is mostly its own wordmark and fights the
  // team name sitting on top of it.
  const primary = team?.colorPrimary || '#1c497c';
  const secondary = team?.colorSecondary || '#0e2440';

  return (
    <div
      className="dbc-idle"
      style={{ '--dbc-primary': primary, '--dbc-secondary': secondary } as React.CSSProperties}
    >
      <div className="dbc-idle__wash" aria-hidden="true" />

      <header className="dbc-idle__header">
        <span className="dbc-idle__league">{conference.name}</span>
        <span className="dbc-idle__progress">
          {complete
            ? 'Draft complete'
            : `Pick ${Math.min(madeCount + 1, picks.length)} of ${picks.length} · ${totalRounds} rounds × ${picksPerRound}`}
        </span>
      </header>

      <div className="dbc-idle__stage">
        {complete ? (
          <>
            <p className="dbc-idle__kicker">That's a wrap</p>
            <h1 className="dbc-idle__team">Every pick is in</h1>
          </>
        ) : (
          <>
            {team?.icon ? (
              <img className="dbc-idle__crest" src={team.icon} alt="" />
            ) : null}
            <p className="dbc-idle__kicker">
              {notStarted ? 'First on the clock' : 'On the clock'}
            </p>
            <h1 className="dbc-idle__team">{team?.name || 'Waiting for MFL'}</h1>
            {onTheClock ? (
              <p className="dbc-idle__pick">
                Pick {pickLabel(onTheClock)}
                {onTheClock.isTraded && onTheClock.originalTeamName
                  ? ` · via ${onTheClock.originalTeamName}`
                  : ''}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="dbc-idle__rails">
        <section className="dbc-idle__rail">
          <h2 className="dbc-idle__rail-title">Just off the board</h2>
          {recent.length === 0 ? (
            <p className="dbc-idle__empty">No picks yet — the room is still filling up.</p>
          ) : (
            <ol className="dbc-idle__list">
              {recent.map((p) => {
                const player = players.get(p.playerId);
                const by = teams.get(p.franchiseId);
                return (
                  <li key={p.overallPickNumber} className="dbc-idle__row">
                    <span className="dbc-idle__row-pick">{pickLabel(p)}</span>
                    <span className="dbc-idle__row-main">
                      <strong>{player?.name || 'Selection in'}</strong>
                      <em>
                        {player?.position || ''}
                        {player?.nflTeam ? ` · ${player.nflTeam}` : ''}
                      </em>
                    </span>
                    <span className="dbc-idle__row-team">{by?.abbrev || by?.nameShort || ''}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="dbc-idle__rail">
          <h2 className="dbc-idle__rail-title">Up next</h2>
          {upcoming.length === 0 ? (
            <p className="dbc-idle__empty">
              {complete ? 'Nothing left to call.' : 'Last pick of the board.'}
            </p>
          ) : (
            <ol className="dbc-idle__list">
              {upcoming.map((p) => {
                const by = teams.get(p.franchiseId);
                return (
                  <li key={p.overallPickNumber} className="dbc-idle__row">
                    <span className="dbc-idle__row-pick">{pickLabel(p)}</span>
                    <span className="dbc-idle__row-main">
                      <strong>{by?.name || 'TBD'}</strong>
                    </span>
                    {by?.icon ? (
                      <img className="dbc-idle__row-icon" src={by.icon} alt="" />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {conferences.length > 1 ? (
        <footer className="dbc-idle__footer">
          {conferences.map((c) => (
            <a
              key={c.code}
              className={`dbc-idle__conf${c.code === conference.code ? ' is-active' : ''}`}
              href={`?conference=${c.code}`}
            >
              {c.name}
            </a>
          ))}
        </footer>
      ) : null}
    </div>
  );
}
