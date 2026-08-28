/**
 * OnTheClock — the broadcast board's resting state.
 *
 * This is what the TV shows between picks, which is most of draft night, so it
 * gets designed like a destination rather than a placeholder: whose turn it is,
 * what just went, and who's warming up. When nothing has been picked yet it
 * becomes the pre-draft screen instead — same furniture, different framing.
 */

import { useCallback, useMemo, useState } from 'react';
import type { DraftRoomPick, DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastConference, BroadcastPlayer } from '../../../types/draft-broadcast';
import {
  recentPicks,
  resolveBroadcastGradient,
  toBroadcastPair,
  upcomingPicks,
} from '../../../utils/draft-broadcast';
import { resolveSplashColors } from '../../../utils/pick-reveal';
import {
  DEFAULT_HEADSHOT_URL,
  getCollegeHeadshot,
  getPlayerHeadshot,
  getPlayerImageUrl,
} from '../../../constants/roster-constants';
import { normalizeTeamCode } from '../../../utils/nfl-logo';
import { resolveNflDarkLogoUrl } from '../../../utils/nfl-logo-dark-css';
import {
  getPlayerAvatarBackground,
  getPlayerAvatarBorder,
  getPlayerAvatarRingDark,
} from '../../../utils/nfl-team-colors';
// The rail avatars wear the site's shared player-cell chip (circle, team-color
// radial backdrop, the 1.18 fill scale, the DEF opt-out) rather than a
// broadcast-only copy of it — only the SIZE is retuned below, through the
// custom properties player-cell.css documents as the extension point.
import '../../../styles/player-cell.css';

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
 * Every image the rail avatar is willing to try, best first.
 *
 * The site-wide headshot cascade (see `buildHeadshotOnerror`, the inline-JS
 * twin of this chain): ESPN NFL cutout → ESPN college cutout → MFL's own photo
 * → the silhouette. A pre-draft rookie's `espnId` is a COLLEGE id, so the
 * second hop is the one that resolves him and the first is the 404 — which is
 * why the chain is walked rather than branched on.
 *
 * A team defense is a crest, not a person, so it opts out into its NFL logo.
 * The DARK cut, unconditionally: this board is dark in BOTH themes (see the
 * header of draft-broadcast.css), and the global `html.dark` logo swap only
 * fires for a viewer whose site theme is dark — a light-theme owner driving
 * the TV would otherwise get the dark-outlined marks (Raiders, Jets, Jaguars)
 * that swap exists to fix, invisible on a dark rail.
 */
function avatarChain(player?: BroadcastPlayer): string[] {
  if (!player) return [DEFAULT_HEADSHOT_URL];

  const code = player.nflTeam ? normalizeTeamCode(player.nflTeam) : '';
  const mflId = player.mflId ?? player.id;
  const candidates =
    player.position?.toUpperCase() === 'DEF' && code && code !== 'NFL'
      ? [resolveNflDarkLogoUrl(code), `/assets/nfl-logos/${code}.svg`]
      : [
          // Server-resolved already (`build-draft-players`), so this is
          // normally the only entry that gets requested.
          player.headshot || getPlayerHeadshot(mflId, player.espnId),
          player.espnId ? getCollegeHeadshot(player.espnId) : '',
          mflId ? getPlayerImageUrl(mflId) : '',
          DEFAULT_HEADSHOT_URL,
        ];

  const seen = new Set<string>();
  return candidates.filter((url): url is string => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

/**
 * The drafted player's face on a "Just off the board" row, in the site's
 * shared player-cell chip — the same lockup a roster table, the trade builder
 * and the custom-rankings board all use, so a player looks like himself
 * everywhere. Only the size is retuned (in vh, like the rest of this surface).
 *
 * The 404 walk is React state rather than reassigning `img.onerror`, matching
 * `BroadcastRevealCard`'s cutout cascade: the row is remounted per pick, so
 * state is the shorter-lived thing, and it can't race the synthetic handler.
 *
 * Ring colour is the DARK-mode one on every viewer, for the same reason the
 * DEF logo is: the board is dark whatever the site theme says. Both halves of
 * player-cell.css's theme-split ring pair are set to it — the stylesheet reads
 * `--player-avatar-ring` for a light-theme viewer and `--player-avatar-ring-dark`
 * under `html.dark`, and this surface wants the light-on-dark echo in either
 * case. Setting only one is the silent-gray-ring failure
 * `tests/team-color-backdrop-guard.test.ts` exists to catch.
 */
function RailAvatar({ player }: { player?: BroadcastPlayer }) {
  const chain = useMemo(() => avatarChain(player), [player]);
  const [step, setStep] = useState(0);
  const isDef = player?.position?.toUpperCase() === 'DEF';

  // Clamped rather than indexed raw: the last entry is the silhouette (or the
  // light SVG for a defense), and a 404 on it must not blank the chip.
  const index = Math.min(step, chain.length - 1);
  const atEnd = index >= chain.length - 1;

  return (
    <span
      className={`dbc-idle__row-avatar player-cell__avatar${
        isDef ? ' player-cell__avatar--def' : ''
      }`}
      style={
        isDef || !player
          ? undefined
          : ({
              '--player-avatar-bg': getPlayerAvatarBackground(player.nflTeam ?? ''),
              '--player-avatar-border': getPlayerAvatarBorder(player.nflTeam ?? ''),
              '--player-avatar-ring': getPlayerAvatarRingDark(player.nflTeam ?? ''),
              '--player-avatar-ring-dark': getPlayerAvatarRingDark(player.nflTeam ?? ''),
            } as React.CSSProperties)
      }
    >
      <img
        src={chain[index]}
        alt=""
        decoding="async"
        onError={atEnd ? undefined : () => setStep((n) => n + 1)}
      />
    </span>
  );
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

  // And when the franchise declares its own `broadcastGradient`, this screen
  // paints THAT — the same string, on the same franchise, as the reveal card it
  // hands off to (Brandon, 2026-08-28). Same reasoning as the treatment above,
  // carried to its conclusion: matching the COLOURS but composing them
  // differently still let the two screens disagree, and Midwestside proved it —
  // a gold-dominant idle board handing off to a near-black reveal, twice a
  // minute, for the same team. The pair above stays as the fallback for a
  // franchise with no gradient of its own.
  const gradient = resolveBroadcastGradient(team);

  return (
    <div
      className="dbc-idle"
      style={
        {
          '--dbc-primary': primary,
          '--dbc-secondary': secondary,
          ...(gradient ? { '--dbc-gradient': gradient } : {}),
        } as React.CSSProperties
      }
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
              {conferences.length > 1
                ? "MFL hasn't published this conference's board — check the conference below."
                : "MFL hasn't published the draft board yet."}
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
              {/* Name small and on top, status big underneath — the inverse of
                  the other two stage states, and of what this screen used to
                  do. With the crest at double size the logo already answers
                  "which team", so spending the headline on the name repeated
                  what the room could see; the headline now answers "what is
                  happening" instead. The name stays directly above it so the
                  two still read as one sentence.

                  h1 remains on the NAME, not on the bigger line: it is what
                  identifies this screen, and "On the clock" reads identically on
                  every one of the 108 picks. Visual weight and
                  document structure disagree here on purpose. */}
              <h1 className="dbc-idle__clock-team">{team?.name || 'Waiting for MFL'}</h1>
              <p className="dbc-idle__clock-status">
                {notStarted ? 'First on the clock' : 'On the clock'}
              </p>
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
                  <li key={p.overallPickNumber} className="dbc-idle__row dbc-idle__row--recent">
                    <span className="dbc-idle__row-pick">{pickLabel(p)}</span>
                    {/* The face, not just the name. This rail is the only
                        place the room sees a player after his 18 seconds of
                        reveal are over, and four rows of pure type read as a
                        transaction log rather than as a board. */}
                    <RailAvatar player={player} />
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
                  <li key={p.overallPickNumber} className="dbc-idle__row dbc-idle__row--next">
                    <span className="dbc-idle__row-pick">{pickLabel(p)}</span>
                    {/* Crest ahead of the name, so this rail reads the same way
                        round as the one beside it — pick, who, then the copy —
                        and the three logos stack into one scannable column
                        instead of hanging off ragged name lengths.

                        Always rendered, even with no icon to put in it: it is
                        what holds the column open. A franchise with no icon (or
                        one whose crest 404s into `hideOnError`'s display:none)
                        would otherwise pull its own name left out of line with
                        the rows above it. */}
                    <span className="dbc-idle__row-crest">
                      {by?.icon ? (
                        <img
                          className="dbc-idle__row-icon"
                          src={by.icon}
                          alt=""
                          onError={hideOnError}
                        />
                      ) : null}
                    </span>
                    <span className="dbc-idle__row-main">
                      {/* nameMedium in the RAIL: this row nowrap-ellipsises, so
                          "Midwestside Connection" truncates while "Midwestside"
                          fits whole. The two headline positions keep the full
                          name — there it IS the content, and it was measured
                          unclipped at every size. */}
                      <strong>{by?.nameMedium || by?.name || 'TBD'}</strong>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {conferences.length > 1 || rehearsing || ownRehearsalYear !== undefined ? (
        <footer className="dbc-idle__footer">
          {/* A league that drafts as ONE unit (TheLeague's rookie draft) has
              nothing to switch to — a lone pill of the board you are already
              on is a dead control. The AFL's two conferences still get theirs. */}
          {conferences.length > 1 &&
            conferences.map((c) => (
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
