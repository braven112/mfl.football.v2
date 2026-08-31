/**
 * OnTheClock — the broadcast board's resting state.
 *
 * This is what the TV shows between picks, which is most of draft night, so it
 * gets designed like a destination rather than a placeholder: whose turn it is,
 * what just went, and who's warming up. When nothing has been picked yet it
 * becomes the pre-draft screen instead — same furniture, different framing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftRoomPick, DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastConference, BroadcastPlayer } from '../../../types/draft-broadcast';
import {
  clockAnchorMs,
  formatElapsedClock,
  recentPicks,
  resolveBroadcastGradient,
  toBroadcastPair,
  upcomingPicks,
} from '../../../utils/draft-broadcast';
import { resolveSplashColors } from '../../../utils/pick-reveal';
// The rail avatars wear the site's shared player-cell chip through
// `BroadcastFace`, which the screensaver's panels use too — only the SIZE is
// retuned per surface, via the class handed to it.
import { BroadcastFace } from './BroadcastFace';

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

/** How often the count-up re-reads the wall clock. See `ClockElapsed`. */
const ELAPSED_TICK_MS = 250;

/**
 * How long the team on the clock has been on it — a count-up from the moment
 * MFL stamped the previous pick.
 *
 * The room's most-asked question between picks, and until now the board could
 * not answer it: the idle screen said WHO was up and said it identically at ten
 * seconds and at ten minutes. The number is what turns "is he even here?" into
 * something the TV settles by itself.
 *
 * Three things here are load-bearing:
 *
 * **It renders nothing until the BOARD has mounted, and `hydrated` is why that
 * is not the same as "until THIS component has mounted".** This screen is in
 * the SERVER-rendered HTML (the board is `prerender = false`, the island is
 * `client:load`), so a clock rendered during SSR ships a number baked at
 * response time — stale by however long the HTML sat in front of the browser,
 * and a hydration mismatch against the first client render besides. So the
 * first pass must emit nothing.
 *
 * The naive form of that — start at `null`, always — has a second-order bug
 * that shipped and was caught in review. This chip sits inside
 * `.dbc-idle__clock`, which is KEYED BY FRANCHISE so the crest's 404 walk
 * resets when the clock moves (see the row's own comment). A key on an ancestor
 * remounts everything under it, so `ClockElapsed` was remounted on every pick
 * that changed the team on the clock, went back to `null`, and painted a frame
 * with no chip before its effect refilled it — the exact blink the JSX comment
 * at the call site claimed the design avoided, on all but the snake turn.
 *
 * `hydrated` is a single boolean that `OnTheClock` — which is never keyed and
 * never remounts — flips once, after its own mount. Before it flips, this
 * component is on the SSR/hydration pass and must render nothing. After it,
 * every subsequent mount is a client-side remount where reading `Date.now()`
 * in the initialiser is both safe and correct, so a remounted chip is painted
 * with its number already in it.
 *
 * **It ticks four times a second, not once.** A one-second interval drifts —
 * the browser fires it late, the lateness accumulates, and the display skips a
 * second every minute or so, which on a stopwatch a room is watching is exactly
 * the artefact that makes people stop trusting it. Sampling faster than the
 * resolution it displays and recomputing from `Date.now()` each time means the
 * digits change within a frame or two of the true boundary no matter how far
 * the timer itself has slipped.
 *
 * **State holds the whole-second WALL CLOCK, not the elapsed count, and the
 * elapsed count is derived during render.** Two things fall out of that, and
 * both are the reason for it. Setting state to a value it already has bails
 * React out before rendering, so three of every four ticks cost one comparison
 * and nothing else — this thing is up for hours on a machine that is also
 * running the reveal animations. And because the anchor is read at render time
 * rather than captured into state, the pick that moves the clock to the next
 * team lands as `0:00` on the same frame as the new team's name, with no
 * remount and no frame of the previous team's number.
 *
 * `role="timer"` with `aria-live="off"`: this is a live region by nature, and a
 * screen reader announcing it every second would bury everything else on the
 * board. Implicit for the role, stated anyway so nobody "fixes" it into
 * `polite` later.
 */
function ClockElapsed({ sinceMs, hydrated }: { sinceMs: number; hydrated: boolean }) {
  // Lazy initialiser, so `Date.now()` is read only on the mounts where it is
  // allowed to be — see `hydrated` in the header. On the first pass this is
  // `null` and the effect below fills it a frame later; on a remount it is
  // already the answer.
  const [nowSec, setNowSec] = useState<number | null>(() =>
    hydrated ? Math.floor(Date.now() / 1000) : null
  );

  useEffect(() => {
    const tick = () => {
      const next = Math.floor(Date.now() / 1000);
      setNowSec((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, ELAPSED_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const elapsedSec = nowSec === null ? null : Math.max(0, nowSec - Math.floor(sinceMs / 1000));

  if (elapsedSec === null) return null;

  return (
    <p className="dbc-idle__elapsed" role="timer" aria-live="off">
      <span className="dbc-idle__elapsed-label">Elapsed</span>
      <span className="dbc-idle__elapsed-value">{formatElapsedClock(elapsedSec)}</span>
    </p>
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

  /**
   * When this board started watching — the floor a rehearsal's count-up sits
   * on, so a dry run's seeded history cannot anchor the clock to a finished
   * season. See `clockAnchorMs`. A ref, not state: it is fixed for the life of
   * the board and nothing should re-render when it is read.
   */
  const openedAtRef = useRef(Date.now());

  /**
   * False on the SSR pass and on the hydrating render, true forever after.
   *
   * `ClockElapsed` reads it to decide whether it may seed itself from
   * `Date.now()` — see its header. It lives HERE because this component is the
   * one that never remounts: the chip's own row is keyed by franchise, so any
   * "have we mounted" state kept inside the chip resets every time the clock
   * moves, which is precisely the bug this flag exists to fix. Flips once, so
   * it costs exactly one extra render for the life of the board.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  /**
   * When the previous pick landed — the origin of the on-the-clock count-up.
   *
   * Derived from the board rather than passed in, like `recent` and `upcoming`
   * beside it, so the clock can only ever be reading the same snapshot the
   * rails are. It moves the instant a poll is accepted, which is what resets
   * the timer to zero the moment the next team is up.
   *
   * Null on a board with nothing picked yet — that screen says "First on the
   * clock" and has no last pick to count from — and null on a board whose picks
   * carry no usable stamp, where a timer would be an invention.
   */
  const clockAnchor = useMemo(
    () => clockAnchorMs(picks, rehearsing, openedAtRef.current),
    [picks, rehearsing]
  );

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
  const hideCrest = useCallback((img: HTMLImageElement) => {
    img.style.display = 'none';
    // `display: none` is invisible to CSS selectors — the hidden <img> is still
    // the copy block's sibling — so the on-the-clock row has to be told the
    // crest is gone or the copy stays left-aligned against nothing. `closest`
    // is null for the rail crests, which have no such row and want no flag.
    img.closest('.dbc-idle__clock')?.classList.add('is-crestless');
  }, []);

  const hideOnError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => hideCrest(e.currentTarget),
    [hideCrest]
  );

  /**
   * ...and the hide has to be undoable, because these <img> nodes outlive the
   * franchise in them.
   *
   * A rail row is keyed by pick SLOT, not by team, so a draft-day trade of an
   * upcoming pick swaps the crest inside a node React reuses — and an inline
   * `display: none` is imperative state React will never reset on its own. A
   * franchise with a dead crest URL trading a pick would leave the incoming
   * franchise's perfectly good crest hidden, permanently blanking the column
   * this change added to carry identity. `roster-constants` pairs
   * NFL_LOGO_ONERROR with NFL_LOGO_ONLOAD for exactly this; so does PlayerCell.
   */
  const showOnLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = '';
    e.currentTarget.closest('.dbc-idle__clock')?.classList.remove('is-crestless');
  }, []);

  /**
   * ...but only if it is still loading when React arrives, and on this page it
   * usually is not.
   *
   * Every crest is in the SERVER-rendered HTML, so the browser can finish
   * failing one before the island hydrates, and React never replays an error
   * event it wasn't mounted for. Measured by stubbing the group-me art to 404:
   * all six crests sat at `complete && naturalWidth === 0`, still
   * `display: block`, `onError` never fired — a broken-image glyph on the TV,
   * and the on-the-clock copy left-aligned against a crest that wasn't there,
   * which is the exact failure the `is-crestless` flag above exists to prevent.
   *
   * A ref runs at mount, after the browser has had its go, so it catches the
   * failure the event dropped. Same shape as `nflLogoRefCallback`
   * (`roster-constants.ts`), which closes this gap for the site's NFL logos.
   */
  const crestRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0) hideCrest(img);
    },
    [hideCrest]
  );

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
                ref={crestRef}
                onError={hideOnError}
                onLoad={showOnLoad}
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
              {/* Below the pick line, not above it: the lockup answers "who",
                  "what" and "which pick" before it answers "how long", and the
                  count-up is the only line here that moves — at the bottom of
                  the stack it can change every second without shifting anything
                  above it.

                  Deliberately NOT keyed by the anchor — but note that it is
                  remounted anyway, because `.dbc-idle__clock` above is keyed by
                  franchise and a key remounts the whole subtree. `hydrated` is
                  what makes that harmless: it lets a remounted chip paint with
                  its number already in it instead of blinking through a null
                  render. Both halves are needed — dropping the key here does
                  not save it from the key up there. */}
              {clockAnchor !== null ? (
                <ClockElapsed sinceMs={clockAnchor} hydrated={hydrated} />
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
                        transaction log rather than as a board.

                        Keyed by PLAYER, not by the pick — the same reason and
                        the same fix as the on-the-clock lockup's
                        `key={franchiseId}` below. The <li> around it is keyed
                        by pick slot, so a commissioner undoing a pick and
                        re-entering it changes this row's player while the same
                        instance stays mounted: the 404-walk index and any
                        `display: none` from the last walk would carry over, and
                        the new man would show up as the previous one's
                        silhouette or as an empty disc. The rail is the ONLY
                        place that correction appears, too — `collectFreshPicks`
                        filters on the slot already being filled, so a re-picked
                        slot never re-enters the reveal queue. */}
                    <BroadcastFace
                    key={player?.id ?? p.playerId}
                    player={player}
                    className="dbc-idle__row-avatar"
                  />
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
                          ref={crestRef}
                          onError={hideOnError}
                          onLoad={showOnLoad}
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
                          ref={crestRef}
                          onError={hideOnError}
                          onLoad={showOnLoad}
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
