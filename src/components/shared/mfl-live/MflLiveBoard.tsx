import { useCallback, useEffect, useRef, useState } from 'react';
import type { MflLiveBoard as Board, MflLiveLeaguePanel, MflLiveMatchup, MflLiveTeam } from '../../../types/mfl-live';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../../../types/live-scoring';
import { positionLabel } from '../../../utils/mfl-live-lineup';
import { PlayerCell } from '../../theleague/PlayerCell';
import type { BroadcastMoment, RedZoneAlert } from '../../../utils/broadcast-moments';
import { shouldPollLive } from '../../../hooks/useNflScoreboard';

/**
 * MFL Live — every matchup from every league the account is in.
 *
 * Compact rows that OPEN. Expansion is pure client state over data the poll
 * already carries: the starter rows ride in the same payload as the totals, so
 * a tap costs nothing. On a phone a spinner on tap is worse than a slightly
 * larger payload, and the rows are needed anyway once the ticker lands.
 */

interface Props {
  initialBoard: Board;
  ownerName: string;
  /**
   * The server's "is it game day" hint. It may raise the poll CADENCE and may
   * never decide WHETHER to poll — the 2026 season opener was a Wednesday
   * night game, and a board gated on a Thu/Sun/Mon schedule never asked MFL
   * for a score all game.
   */
  isLive?: boolean;
}

const POLL_LIVE_MS = 25_000;
const POLL_IDLE_MS = 90_000;

type FeedStatus = 'ok' | 'error';

const fmt = (n: number) => n.toFixed(1);

/** "8s ago" / "3m ago" — the freshness pill's whole vocabulary. */
function ago(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function Crest({ team }: { team: MflLiveTeam }) {
  if (team.icon) {
    return (
      <span className="mlb-crest">
        {/* Sized by CSS, not attributes — the crest box is a fixed square and
            the marks arrive at wildly different intrinsic sizes. */}
        <img src={team.icon} alt={team.iconAlt} loading="lazy" decoding="async" />
      </span>
    );
  }
  // Rung 3: a text LABEL, not a fabricated crest. One shared neutral, nothing
  // derived from the name.
  return (
    <span className="mlb-crest mlb-crest--text" aria-hidden="true">
      {team.initials}
    </span>
  );
}

/**
 * The NFL slate.
 *
 * ESPN's scoreboard is a WEEK, so this is Thursday through Monday in one rail
 * — which is why it scrolls rather than wraps, and why the finished games are
 * not filtered out: on a Sunday evening the finals ARE most of the week.
 */
function GamesStrip({ games }: { games: NflGame[] }) {
  if (games.length === 0) return null;
  return (
    <div className="mlb-strip" role="list" aria-label="NFL games this week">
      {games.map((g) => {
        const live = g.state === 'in';
        const pre = g.state === 'pre';
        return (
          <div className="mlb-game" role="listitem" key={g.id}>
            <div className="mlb-game__row">
              <span className="mlb-game__tm">{g.away.code}</span>
              <span className="mlb-game__sc">{pre ? '—' : g.away.score}</span>
            </div>
            <div className="mlb-game__row">
              <span className="mlb-game__tm">{g.home.code}</span>
              <span className="mlb-game__sc">{pre ? '—' : g.home.score}</span>
            </div>
            {/*
              `shortDetail` is ESPN's one string for all three states — "Sun 1:00 PM
              ET", "8:12 - 3rd", "Final" — so the strip needs no per-state
              formatting. The clock fallback is for the rare live game ESPN
              serves with the detail blank.
            */}
            <div className={`mlb-game__st${live ? ' is-live' : ''}`}>
              {g.shortDetail || (live ? `Q${g.period} ${g.clock}` : '')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A team of the viewer's with the ball inside the 20.
 *
 * A persistent STATE, not an event: it sits above the board for as long as the
 * drive lasts rather than being preempted by the next thing to happen. It is
 * also derived fresh each poll, never latched, so a drive that ends in a score,
 * a turnover or a punt simply stops producing an alert and this disappears by
 * itself.
 */
function RedZoneBanner({ alerts }: { alerts: RedZoneAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mlb-rz" role="status">
      {alerts.map((a) => (
        <div className="mlb-rz__row" key={a.team}>
          <span className="mlb-rz__pulse" aria-hidden="true" />
          <div className="mlb-rz__body">
            <div className="mlb-rz__title">
              Red zone · {a.team}
              {a.downDistance ? ` · ${a.downDistance}` : ''}
            </div>
            <div className="mlb-rz__who">
              {a.players.map((p) => (
                <span className={`mlb-rz__p${p.side === 'mine' ? ' is-mine' : ''}`} key={`${p.leagueId}-${p.playerId}`}>
                  {p.playerName}
                  <span className="mlb-rz__lg">{p.leagueName}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Scoring across every league at once.
 *
 * A play can appear MORE THAN ONCE and that is correct, not a duplicate: the
 * same NFL player is routinely started in several of an owner's leagues, and
 * in the AFL — whose rosters duplicate players — by both sides of one matchup.
 * One touchdown really is several pieces of news. Every row therefore names
 * its league AND its franchise, which is what makes the repetition read as
 * information; collapsing them would silently drop the credit from every
 * league but one.
 *
 * Yours in colour, your opponents' in grey.
 */
function Ticker({ moments }: { moments: BroadcastMoment[] }) {
  if (moments.length === 0) return null;
  return (
    <section className="mlb-tick" aria-label="Scoring across your leagues">
      <header className="mlb-tick__head">
        <span>Scoring</span>
        <span className="mlb-tick__all">All your leagues</span>
      </header>
      <ul className="mlb-tick__list">
        {moments.map((m) => (
          <li className={`mlb-tick__row${m.side === 'mine' ? ' is-mine' : ''}`} key={m.key}>
            <span className="mlb-tick__stripe" aria-hidden="true" />
            <div className="mlb-tick__body">
              <div className="mlb-tick__text">{m.text}</div>
              <div className="mlb-tick__meta">
                {m.leagueName} · {m.franchiseName}
                {m.clock ? ` · ${m.clock}` : ''}
              </div>
            </div>
            {m.scoreValue > 0 && <span className="mlb-tick__pts">+{m.scoreValue}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamRow({ team, leading }: { team: MflLiveTeam; leading: boolean }) {
  return (
    <div className={`mlb-team${leading ? ' is-leading' : ''}`}>
      <Crest team={team} />
      <div className="mlb-team__id">
        <div className="mlb-team__name">{team.name}</div>
        <div className="mlb-team__sub">
          Proj {fmt(team.projectedFinal)}
          {team.yetToPlay > 0 ? ` · ${team.yetToPlay} to play` : ''}
        </div>
      </div>
      <div className="mlb-team__score">{fmt(team.live)}</div>
    </div>
  );
}

function PlayerRows({
  rows,
  team,
  meta,
  bench,
}: {
  rows: LivePlayerRow[];
  team: MflLiveTeam;
  meta: Record<string, PlayerMeta>;
  bench?: boolean;
}) {
  return (
    <ul className={`mlb-players${bench ? ' mlb-players--bench' : ''}`}>
      {rows.map((row) => {
        const who = meta[row.id];
        const final = row.secondsRemaining === 0;
        return (
          <li className="mlb-player" key={`${team.franchiseId}-${row.id}`}>
            {/*
              `positionLabel`, not the raw meta: MFL calls a kicker PK, which
              is an MFL-ism no owner uses. The ORDER these rows arrive in is
              the server's (orderLineupRows) — nothing here re-sorts, so the
              two sides of a matchup cannot drift apart.

              The chip stays on the LEFT even though PlayerCell prints the
              position in its own meta row (which this list hides in CSS): the
              lineup is GROUPED by position, and a left-hand column is what
              makes the grouping scannable. `position` is still handed to
              PlayerCell because that is what selects the DEF lockup.
            */}
            <span className="mlb-player__pos">{positionLabel(who?.position) || '—'}</span>

            {/*
              The SHARED cell, not a hand-rolled one. It already carries the
              team-colour avatar, the DEF lockup (a bare full-bleed crest, no
              chip — the same lockup the roster and lineup pages use), the
              headshot fallback chain, and the dark-mode logo swap. A second
              implementation here would be the fifth on the site and the first
              to get DEF wrong.
            */}
            <PlayerCell
              size="compact"
              className="mlb-player__cell"
              name={who?.name || `Player ${row.id}`}
              headshot={who?.headshot}
              position={who?.position}
              nflTeam={who?.nflTeam}
              mflId={row.id}
              metaSlot={
                <span className={`mlb-player__state${final ? '' : ' is-live'}`}>
                  {final ? 'Final' : 'In progress'}
                </span>
              }
            />

            <span className="mlb-player__pts">{fmt(row.live)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One team's lineup: starters, then bench, both in position order.
 *
 * The bench is LABELLED and visually recessed rather than merely listed
 * after. An unlabelled second list reads as more starters, which on this board
 * would be a lie about the score — the whole reason bench rows are kept in a
 * map of their own upstream is that they cannot count.
 */
function PlayerList({ team, meta }: { team: MflLiveTeam; meta: Record<string, PlayerMeta> }) {
  if (team.players.length === 0 && team.bench.length === 0) {
    return <p className="mlb-empty-note">No lineup for this team.</p>;
  }
  return (
    <>
      {team.players.length === 0 ? (
        <p className="mlb-empty-note">No starters in this lineup.</p>
      ) : (
        <PlayerRows rows={team.players} team={team} meta={meta} />
      )}

      {team.bench.length > 0 && (
        <>
          <div className="mlb-bench-head">
            <span>Bench</span>
            <span className="mlb-bench-head__pts">{fmt(benchTotal(team.bench))}</span>
          </div>
          <PlayerRows rows={team.bench} team={team} meta={meta} bench />
        </>
      )}
    </>
  );
}

/**
 * What the bench scored — shown so the owner can see it, never added to
 * anything. It is the answer to "how much did I leave on it", which is only
 * a question because these points did NOT count.
 */
function benchTotal(rows: LivePlayerRow[]): number {
  return rows.reduce((sum, r) => sum + (Number.isFinite(r.live) ? r.live : 0), 0);
}

function MatchupCard({
  matchup,
  meta,
  open,
  onToggle,
}: {
  matchup: MflLiveMatchup;
  meta: Record<string, PlayerMeta>;
  open: boolean;
  onToggle: () => void;
  }) {
  const { mine, opponent } = matchup;
  const mineLeads = mine.live >= opponent.live;
  const split = Math.round(matchup.winProbability * 100);
  const panelId = `mlb-detail-${matchup.mine.franchiseId}-${matchup.index}`;

  return (
    <div className="mlb-card" style={matchup.colorVars as React.CSSProperties}>
      {/* The split bar encodes MY win share, so it is read from the left. */}
      <div className="mlb-card__bar" style={{ ['--wp-split' as string]: `${split}%` }} />

      <button type="button" className="mlb-card__head" onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
        <div className="mlb-teams">
          <TeamRow team={mine} leading={mineLeads} />
          <TeamRow team={opponent} leading={!mineLeads} />
        </div>

        <div className="mlb-wp">
          <div className="mlb-wp__track">
            <span className="mlb-wp__mine" style={{ width: `${split}%` }} />
            <span className="mlb-wp__theirs" style={{ width: `${100 - split}%` }} />
            <span className="mlb-wp__seam" style={{ left: `${split}%` }} />
          </div>
          <div className="mlb-wp__labels">
            <span className="mlb-wp__mine-label">{split}%</span>
            <span className="mlb-wp__open">{open ? 'Hide detail' : 'Tap for detail'}</span>
            <span className="mlb-wp__theirs-label">{100 - split}%</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="mlb-detail" id={panelId}>
          <div className="mlb-detail__side">
            <h4 className="mlb-detail__title">{mine.nameShort}</h4>
            <PlayerList team={mine} meta={meta} />
          </div>
          <div className="mlb-detail__side">
            <h4 className="mlb-detail__title">{opponent.nameShort}</h4>
            <PlayerList team={opponent} meta={meta} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The four honest states, each said in its own words.
 *
 * `not-played` and `unavailable` are deliberately different sentences: "the
 * feed says nothing" and "we could not reach the feed" are different facts,
 * and merging them is how an outage renders as an offseason.
 */
function LeagueEmpty({ status }: { status: MflLiveLeaguePanel['status'] }) {
  if (status === 'not-played') {
    return <p className="mlb-empty">No games yet this week.</p>;
  }
  if (status === 'no-matchup') {
    return <p className="mlb-empty">No matchup this week — you&rsquo;re on a bye.</p>;
  }
  return (
    <p className="mlb-empty mlb-empty--err">
      Couldn&rsquo;t read this league just now. Still trying.
    </p>
  );
}

export default function MflLiveBoard({ initialBoard, ownerName, isLive = false }: Props) {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [status, setStatus] = useState<FeedStatus>('ok');
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  /**
   * NULL until mounted, deliberately.
   *
   * `Date.now()` in a useState initializer runs TWICE — once on the server
   * during SSR, once on the client at hydration — at different wall-clock
   * times. The pill rendered "Live · 0s ago" into the HTML and "Live · 1s ago"
   * on hydration, and React responded by discarding the ENTIRE server-rendered
   * board and rebuilding it on the client. One character's difference threw
   * away the whole point of server-rendering the scores.
   *
   * "How long ago" is a client-only fact, so the server renders the pill
   * without it and the effect below fills it in on mount.
   */
  const [now, setNow] = useState<number | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  const toggle = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/live-board?week=${board.week}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const data = (await res.json()) as Board;
        if (cancelled) return;
        // `res.ok` is NOT "the data is good" and `{}` is truthy, so neither is
        // a guard. Gate on the FLAG: a failed poll keeps the last good board
        // and flips the pill, so "the feed says nothing" and "we could not
        // reach the feed" stay separate all the way to the screen.
        if (data && data.ok !== false) {
          setBoard(data);
          setStatus('ok');
        } else {
          setStatus('error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        if (!cancelled) {
          setNow(Date.now());
          // Cadence off the REAL NFL clock now that a slate is loaded.
          // `isLive` is `getDailySlot`, fixed for the life of the page and
          // open long past the last whistle, so trusting it once data exists
          // is what pins a board to the fast cadence for hours after the
          // slate goes final. It is only good as the seed, which is exactly
          // what `shouldPollLive` uses it for.
          //
          // Polling itself stays unconditional either way — a flag that can
          // be wrong must never be able to stop the board asking for a score.
          const live = shouldPollLive(boardRef.current.games ?? [], isLive);
          timer = setTimeout(tick, live ? POLL_LIVE_MS : POLL_IDLE_MS);
        }
      }
    };

    timer = setTimeout(tick, shouldPollLive(board.games ?? [], isLive) ? POLL_LIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [board.week, isLive]);

  // The pill counts up between polls, so a stalled feed looks stalled rather
  // than frozen at whatever the last successful poll said.
  useEffect(() => {
    // Immediately, then on a cadence: the first call is what replaces the
    // server's bare "Live" with a real age, and it must not wait 5s.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const withMatchups = board.leagues.filter((l) => l.matchups.length > 0).length;

  return (
    <section className="mlb" aria-label="Live scoring across your leagues">
      <header className="mlb-head">
        <h1 className="mlb-head__wk">Week {board.week}</h1>
        <span className={`mlb-pill${status === 'error' ? ' is-err' : ''}`}>
          <span className="mlb-dot" />
          {status === 'error'
            ? 'Reconnecting'
            : now === null
              ? 'Live'
              : `Live · ${ago(board.fetchedAt, now)}`}
        </span>
      </header>

      <RedZoneBanner alerts={board.redZone ?? []} />
      <GamesStrip games={board.games ?? []} />

      {board.leagues.length === 0 ? (
        <p className="mlb-empty">
          No leagues found for {ownerName}. If you have just joined one, it can take MFL a
          few minutes to list it.
        </p>
      ) : (
        board.leagues.map((league) => (
          <section className="mlb-league" key={league.leagueId}>
            <header className="mlb-league__head">
              <h2 className="mlb-league__name">{league.leagueName}</h2>
              {!league.registered && <span className="mlb-tag">Not on this site</span>}
            </header>

            {league.status === 'ok' ? (
              league.matchups.map((m) => {
                const key = `${league.leagueId}:${m.index}`;
                return (
                  <MatchupCard
                    key={key}
                    matchup={m}
                    meta={board.playerMeta}
                    open={openKeys.has(key)}
                    onToggle={() => toggle(key)}
                  />
                );
              })
            ) : (
              <LeagueEmpty status={league.status} />
            )}
          </section>
        ))
      )}

      <Ticker moments={board.moments ?? []} />

      {board.leagues.length > 0 && withMatchups === 0 && (
        <p className="mlb-foot-note">
          Nothing is scoring yet. This board updates on its own — no need to refresh.
        </p>
      )}
    </section>
  );
}
