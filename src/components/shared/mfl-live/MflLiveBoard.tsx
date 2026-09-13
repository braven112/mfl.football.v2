import { useCallback, useEffect, useRef, useState } from 'react';
import type { MflLiveBoard as Board, MflLiveLeaguePanel, MflLiveMatchup, MflLiveTeam } from '../../../types/mfl-live';
import type { PlayerMeta } from '../../../types/live-scoring';

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

function PlayerList({ team, meta }: { team: MflLiveTeam; meta: Record<string, PlayerMeta> }) {
  if (team.players.length === 0) {
    return <p className="mlb-empty-note">No starters in this lineup.</p>;
  }
  return (
    <ul className="mlb-players">
      {team.players.map((row) => {
        const who = meta[row.id];
        const final = row.secondsRemaining === 0;
        return (
          <li className="mlb-player" key={`${team.franchiseId}-${row.id}`}>
            <span className="mlb-player__pos">{who?.position || '—'}</span>
            <span className="mlb-player__name">
              {who?.name || `Player ${row.id}`}
              <span className="mlb-player__meta">
                {who?.nflTeam || ''}
                {who?.nflTeam ? ' · ' : ''}
                {final ? 'Final' : 'In progress'}
              </span>
            </span>
            <span className="mlb-player__pts">{fmt(row.live)}</span>
          </li>
        );
      })}
    </ul>
  );
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
  const [now, setNow] = useState(() => Date.now());
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
          // The hint may only RAISE the cadence. Polling itself is
          // unconditional — a flag that can be wrong must never be able to
          // stop the board asking for a score.
          timer = setTimeout(tick, isLive ? POLL_LIVE_MS : POLL_IDLE_MS);
        }
      }
    };

    timer = setTimeout(tick, isLive ? POLL_LIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [board.week, isLive]);

  // The pill counts up between polls, so a stalled feed looks stalled rather
  // than frozen at whatever the last successful poll said.
  useEffect(() => {
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
          {status === 'error' ? 'Reconnecting' : `Live · ${ago(board.fetchedAt, now)}`}
        </span>
      </header>

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

      {board.leagues.length > 0 && withMatchups === 0 && (
        <p className="mlb-foot-note">
          Nothing is scoring yet. This board updates on its own — no need to refresh.
        </p>
      )}
    </section>
  );
}
