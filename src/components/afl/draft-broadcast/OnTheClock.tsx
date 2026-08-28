/**
 * OnTheClock — the broadcast board's resting state.
 *
 * This is what the TV shows between picks, which is most of draft night, so it
 * gets designed like a destination rather than a placeholder: whose turn it is,
 * what just went, and who's warming up. When nothing has been picked yet it
 * becomes the pre-draft screen instead — same furniture, different framing.
 */

import { useCallback, useMemo } from 'react';
import type { DraftRoomPick, DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastConference, BroadcastPlayer } from '../../../types/draft-broadcast';
import { recentPicks, toBroadcastPair, upcomingPicks } from '../../../utils/draft-broadcast';
import { resolveSplashColors } from '../../../utils/pick-reveal';

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
  /** True when this page is replaying a completed season rather than polling. */
  rehearsing: boolean;
  /** Conference code → most recent season that conference actually finished. */
  rehearsalYears?: Record<string, number>;
  /** Season currently on the board — the replayed year while rehearsing. */
  leagueYear: number;
}

function pickLabel(pick: DraftRoomPick): string {
  return `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;
}

/**
 * Build a link to this page in either mode. Passing `year` produces a
 * rehearsal href (replay that season from pick 1); omitting it produces the
 * live href. Always emits `conference` so neither control can strand the
 * operator on the other conference's board.
 */
function modeHref(conferenceCode: string, year?: number): string {
  const params = new URLSearchParams({ conference: conferenceCode });
  if (year !== undefined) {
    params.set('year', String(year));
    // 0, not 1: `rehearse=N` means "start with N picks ALREADY made", so
    // rehearse=1 seeds 1.01 onto the board and the first thing the room sees
    // revealed is 1.02. Starting at 0 replays the season from its first pick.
    params.set('rehearse', '0');
  }
  return `?${params}`;
}

export function OnTheClock({
  conference,
  conferences,
  rehearsing,
  rehearsalYears,
  leagueYear,
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

  /** This conference's own most recent finished season, if it has one. */
  const ownRehearsalYear = rehearsalYears?.[conference.code];

  const notStarted = madeCount === 0;
  const complete = !onTheClock && picks.length > 0;
  /**
   * No slots at all means the feed was missing, unreadable, or `?conference=`
   * named a unit that isn't on the board — never a real draft. Rendering the
   * ordinary furniture then produced "Pick 0 of 0 · 1 rounds × 1", which is
   * the same failure this feature already fixed once at the API layer: a
   * broken board that looks like a valid one.
   */
  const boardMissing = picks.length === 0;

  /** A crest that 404s hides itself — an alt-text stub in a logo slot reads as
   *  broken on a TV, and the pick number and player name already identify the
   *  row without it. */
  const hideOnError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
    // `display: none` is invisible to CSS selectors — the hidden <img> is still
    // the copy block's sibling — so the on-the-clock row has to be told the
    // crest is gone or the copy stays left-aligned against nothing. `closest`
    // is null for the rail crests, which have no such row and want no flag.
    e.currentTarget.closest('.dbc-idle__clock')?.classList.add('is-crestless');
  }, []);

  // The clock team's colors and crest own the screen the same way the drafting
  // team owns a reveal — so the room can tell whose turn it is from across the
  // room without reading a word. Colors and crest ONLY: franchise banners were
  // tried and cut, since a banner is mostly its own wordmark and fights the
  // team name sitting on top of it.
  // Through the SAME treatment the reveal card uses, or this screen contradicts
  // the one it hands off to: the idle board is up between every pick, so a
  // franchise whose brand is light showed a washed-out card here and a deep,
  // saturated one a second later. toBroadcastPair saturates for the TV, floors
  // white-text contrast, and keeps a greyscale stop in the franchise's hue.
  // resolveSplashColors FIRST, then the same treatment — the reveal card resolves
  // its pair exactly this way. Hand-rolling the fallbacks here instead left the
  // two screens able to disagree: this one fell back to navy for a missing
  // secondary while the reveal falls back to the franchise's own primary, so a
  // franchise defining only one colour would have flipped between them. No AFL
  // franchise does today; going through the shared resolver makes that
  // unreachable by construction rather than by luck.
  const brand = resolveSplashColors(team);
  const { primary, secondary } = toBroadcastPair(brand.primary, brand.secondary);

  return (
    <div
      className="dbc-idle"
      style={{ '--dbc-primary': primary, '--dbc-secondary': secondary } as React.CSSProperties}
    >
      <div className="dbc-idle__wash" aria-hidden="true" />

      <header className="dbc-idle__header">
        <span className="dbc-idle__league">{conference.name}</span>
        <span className="dbc-idle__progress">
          {boardMissing
            ? 'Waiting for the draft board'
            : complete
              ? 'Draft complete'
              : `Pick ${Math.min(madeCount + 1, picks.length)} of ${picks.length} · ${totalRounds} rounds × ${picksPerRound}`}
        </span>
      </header>

      <div className="dbc-idle__stage">
        {boardMissing ? (
          <>
            <p className="dbc-idle__kicker">Nothing to show yet</p>
            <h1 className="dbc-idle__team">No draft board</h1>
            <p className="dbc-idle__pick">
              MFL hasn't published this conference's board — check the
              conference below.
            </p>
          </>
        ) : complete ? (
          <>
            <p className="dbc-idle__kicker">That's a wrap</p>
            <h1 className="dbc-idle__team">Every pick is in</h1>
          </>
        ) : (
          /* Crest BESIDE the copy, not above it. Stacked, the crest had to
             stay small enough to leave the name room underneath, and from
             across a room the thing that identifies the team on the clock
             fastest is its logo. Side by side the two stop competing for the
             same vertical budget, so the crest doubles and the copy left-aligns
             off its edge — one unit that reads as "this team is up".

             Keyed by franchise so React remounts the whole row when the clock
             moves to another team. Without it the same DOM nodes are reused and
             one 404 sticks: the img keeps its inline `display: none` and the row
             keeps its `is-crestless` flag, hiding the crest and centring the copy
             for every team that follows. */
          <div className="dbc-idle__clock" key={team?.franchiseId ?? 'no-team'}>
            {team?.icon ? (
              <img
                className="dbc-idle__crest"
                src={team.icon}
                alt=""
                onError={hideOnError}
              />
            ) : null}
            <div className="dbc-idle__clock-copy">
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
            </div>
          </div>
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
                    {/* The drafting team reads as its CREST, not its abbrev.
                        Every AFL franchise has an icon, the room knows the
                        logos on sight, and "Up next" was already showing them —
                        a text abbrev here made the two rails inconsistent and
                        put some very MFL-era shorthand on a TV in front of
                        everyone. Text only survives as the no-icon fallback. */}
                    <span className="dbc-idle__row-team">
                      {by?.icon ? (
                        <img
                          className="dbc-idle__row-icon"
                          src={by.icon}
                          alt={by.nameShort || by.name || ''}
                          onError={hideOnError}
                        />
                      ) : (
                        by?.nameShort || by?.abbrev || ''
                      )}
                    </span>
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
                      {/* nameMedium in the RAIL: this row nowrap-ellipsises, so
                          "Midwestside Connection" truncates while "Midwestside"
                          fits whole. The two headline positions keep the full
                          name — there it IS the content, and it was measured
                          unclipped at every size. */}
                      <strong>{by?.nameMedium || by?.name || 'TBD'}</strong>
                    </span>
                    {by?.icon ? (
                      <img
                        className="dbc-idle__row-icon"
                        src={by.icon}
                        alt=""
                        onError={hideOnError}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {conferences.length > 1 || rehearsing || ownRehearsalYear !== undefined ? (
        <footer className="dbc-idle__footer">
          {conferences.map((c) => (
            <a
              key={c.code}
              className={`dbc-idle__conf${c.code === conference.code ? ' is-active' : ''}`}
              /* Stays a rehearsal across a conference switch — but on THAT
                 conference's own most recent finished season, not this one's.
                 A conference that has never finished one goes live instead. */
              href={modeHref(c.code, rehearsing ? rehearsalYears?.[c.code] : undefined)}
            >
              {c.name}
            </a>
          ))}

          {rehearsing ? (
            <>
              <span className="dbc-idle__rehearsal-flag">
                Rehearsal · replaying {leagueYear}
              </span>
              <a className="dbc-idle__mode" href={modeHref(conference.code)}>
                Go live
              </a>
            </>
          ) : ownRehearsalYear !== undefined ? (
            <a
              className="dbc-idle__mode"
              href={modeHref(conference.code, ownRehearsalYear)}
            >
              Rehearse {ownRehearsalYear}
            </a>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
