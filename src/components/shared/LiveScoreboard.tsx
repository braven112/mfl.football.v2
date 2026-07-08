/**
 * LiveScoreboard — progressive live-scoring island (Direction C / Editorial).
 *
 * Scoreboard of every matchup (closest first, your matchup pinned), each with
 * team totals, projected finals, and a win-probability bar. Tap a matchup to
 * open the head-to-head detail: starter-by-starter rows with live points,
 * projected finals, NFL logo + live game state, and "yet to play" counts.
 *
 * Static identity/projection arrives as props (PlayerMeta); the live numbers
 * are polled from /api/live-scoring and merged by player id.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LivePlayerRow,
  LiveScoringPageProps,
  LiveScoringResponse,
  MatchupPairing,
  PlayerMeta,
  TeamInfo,
  NflGameState,
} from '../../types/live-scoring';
import {
  NFL_GAME_SECONDS,
  projectPlayerFinal,
  projectPlayerRemaining,
  winProbability,
} from '../../utils/live-win-probability';
import { normalizeTeamCode } from '../../utils/nfl-logo';
import { getNflTeamColors } from '../../utils/nfl-team-colors';
import NflGamesStrip from './NflGamesStrip';

const POLL_LIVE = 60_000;
const POLL_STALE = 300_000;
/** Weeks offered in the week selector (regular season 1–18). */
const MAX_WEEK = 18;

/** A scoring update derived from a player's live-point jump between polls. */
interface Moment {
  key: string;
  fid: string;
  name: string;
  team: string;
  delta: number;
  clock: string;
}

// ── polling ──

function useLiveScoring(props: LiveScoringPageProps) {
  const { week, year, leagueId, host, isLive } = props;
  const [scores, setScores] = useState<Record<string, number>>(props.initialScores ?? {});
  const [remaining, setRemaining] = useState<Record<string, number>>(props.initialRemaining ?? {});
  const [matchups, setMatchups] = useState<MatchupPairing[]>(props.matchups ?? []);
  const [players, setPlayers] = useState<Record<string, LivePlayerRow[]>>(props.initialPlayers ?? {});
  const [ytp, setYtp] = useState<Record<string, number>>(props.initialYetToPlay ?? {});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const url = new URL('/api/live-scoring', window.location.origin);
      url.searchParams.set('week', String(week));
      url.searchParams.set('year', String(year));
      url.searchParams.set('L', leagueId);
      url.searchParams.set('host', `https://${host}`);
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data: LiveScoringResponse = await res.json();
      setScores(data.scores ?? {});
      setRemaining(data.remaining ?? {});
      if (data.matchups?.length) setMatchups(data.matchups);
      if (data.players) setPlayers(data.players);
      if (data.playersYetToPlay) setYtp(data.playersYetToPlay);
    } catch {
      /* retry next tick */
    }
  }, [week, year, leagueId, host]);

  useEffect(() => {
    if (!isLive) return;
    poll();
    intervalRef.current = setInterval(poll, POLL_LIVE);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, poll]);

  useEffect(() => {
    if (!isLive) return;
    const allDone = Object.keys(remaining).length > 0 && Object.values(remaining).every((r) => r === 0);
    if (allDone && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(poll, POLL_STALE);
    }
  }, [remaining, isLive, poll]);

  return { scores, remaining, matchups, players, ytp };
}

// ── helpers ──

function nflGameState(secondsRemaining: number): NflGameState {
  if (secondsRemaining <= 0) return 'final';
  if (secondsRemaining >= NFL_GAME_SECONDS) return 'not-started';
  return 'in-progress';
}

function clockLabel(state: NflGameState, sec: number): string {
  if (state === 'final') return 'Final';
  if (state === 'not-started') return 'Yet to play';
  const quartersLeftFull = Math.floor(sec / 900);
  const quarter = Math.min(4, Math.max(1, 4 - quartersLeftFull));
  const inQuarter = sec % 900;
  const mm = Math.floor(inQuarter / 60);
  const ss = inQuarter % 60;
  return `Q${quarter} ${mm}:${String(ss).padStart(2, '0')}`;
}

const POS_COLORS: Record<string, string> = {
  QB: '#e0517a', RB: '#3fb98a', WR: '#4aa3e0', TE: '#e08a3f',
  PK: '#9b7fd0', K: '#9b7fd0', DEF: '#7a8694', FLEX: '#c0a04a',
};
const posColor = (pos: string) => POS_COLORS[pos] ?? '#7a8694';

const nflLogoUrl = (team: string) => (team ? `/assets/nfl-logos/${normalizeTeamCode(team)}.svg` : '');
const teamColor = (team: string) => getNflTeamColors(team).primary;

const fmt = (n: number) => n.toFixed(1);

interface TeamCalc {
  live: number;
  projectedFinal: number;
  remainingPoints: number;
  yetToPlay: number;
}

function computeTeam(
  fid: string,
  scores: Record<string, number>,
  players: Record<string, LivePlayerRow[]>,
  ytp: Record<string, number>,
  meta: Record<string, PlayerMeta>,
): TeamCalc {
  const rows = players[fid] ?? [];
  const live = scores[fid] ?? rows.reduce((s, r) => s + r.live, 0);
  let remainingPoints = 0;
  let notStarted = 0;
  for (const r of rows) {
    const projected = meta[r.id]?.projected ?? 0;
    remainingPoints += projectPlayerRemaining({ live: r.live, projected, secondsRemaining: r.secondsRemaining });
    if (nflGameState(r.secondsRemaining) === 'not-started') notStarted += 1;
  }
  return {
    live,
    projectedFinal: live + remainingPoints,
    remainingPoints,
    // Prefer the count we derive from each starter's game clock — it uses the
    // same gameSecondsRemaining the scores do and doesn't depend on MFL's
    // franchise-level `playersYetToPlay` attribute (name unverified). Fall back
    // to the feed value only when we have no per-player rows to count.
    yetToPlay: rows.length ? notStarted : (ytp[fid] ?? 0),
  };
}

// ── win-probability bar ──

function WinProbBar({ home, mini, homeLabel, awayLabel }: {
  home: number; mini?: boolean; homeLabel?: string; awayLabel?: string;
}) {
  const homePct = Math.round(home * 100);
  const awayPct = 100 - homePct;
  return (
    <div className={`ls-wp${mini ? ' mini' : ''}`} role="img"
         aria-label={`Win probability: ${homeLabel ?? 'home'} ${homePct}%, ${awayLabel ?? 'away'} ${awayPct}%`}>
      <div className="ls-wp-track">
        <div className="ls-wp-away" style={{ width: `${awayPct}%` }} />
        <div className="ls-wp-home" style={{ width: `${homePct}%` }} />
        <span className="ls-wp-mid" />
      </div>
      {!mini && (
        <div className="ls-wp-labels">
          <span className="ls-wp-l">{awayPct}%</span>
          <span className="ls-wp-tag">WIN PROBABILITY</span>
          <span className="ls-wp-r">{homePct}%</span>
        </div>
      )}
    </div>
  );
}

// ── scoreboard card ──

function ScoreCard({ matchup, teams, calc, featured, isYours, onOpen }: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  calc: { home: TeamCalc; away: TeamCalc; homeWinProb: number; isFinal: boolean };
  featured: boolean;
  isYours: boolean;
  onOpen: () => void;
}) {
  const H = teams[matchup.home];
  const A = teams[matchup.away];
  const homeLead = calc.home.live >= calc.away.live;
  const th = H?.color ?? '#1c497c'; // home → right / win-prob right
  const ta = A?.color ?? '#8a94a0'; // away → left / win-prob left
  // Top border + win-prob bar split at the away team's win share (measured
  // from the left, which is the away side).
  const awaySplit = `${100 - Math.round(calc.homeWinProb * 100)}%`;
  const cardStyle = { ['--th' as any]: th, ['--ta' as any]: ta, ['--wp-split' as any]: awaySplit };

  const head = (
    <div className="ls-card-head">
      {calc.isFinal
        ? <span className="ls-badge final">Final</span>
        : <span className="ls-badge live"><span className="ls-dot live" />Live</span>}
      {!calc.isFinal && (calc.home.yetToPlay + calc.away.yetToPlay > 0) && (
        <span className="ls-rem">{calc.home.yetToPlay + calc.away.yetToPlay} yet to play</span>
      )}
      {isYours && <span className="ls-your">YOUR MATCHUP</span>}
    </div>
  );

  // Featured (your) matchup: horizontal faceoff, away on the left, home on the right.
  if (featured) {
    const foTeam = (team: TeamInfo | undefined, c: TeamCalc, lead: boolean, sideCls: string) => (
      <div className={`ls-fo-team ${sideCls}${lead ? ' lead' : ''}`}>
        <span className="ls-fo-crest">{team?.icon && <img src={team.icon} alt="" loading="lazy" />}</span>
        <span className="ls-fo-name">{team?.nameShort ?? team?.name ?? 'TBD'}</span>
        <span className="ls-fo-score">{fmt(c.live)}</span>
        <span className="ls-fo-proj">Proj {fmt(c.projectedFinal)}</span>
      </div>
    );
    return (
      <button className="ls-card feat" style={cardStyle} onClick={onOpen}
              aria-label={`Open ${A?.name} at ${H?.name}`}>
        {head}
        <div className="ls-faceoff">
          {foTeam(A, calc.away, !homeLead, 'away')}
          <span className="ls-fo-vs">@</span>
          {foTeam(H, calc.home, homeLead, 'home')}
        </div>
        {!calc.isFinal && <WinProbBar home={calc.homeWinProb} homeLabel={H?.name} awayLabel={A?.name} />}
        <div className="ls-card-foot">
          <span>Proj {fmt(calc.away.projectedFinal)} – {fmt(calc.home.projectedFinal)}</span>
          <span className="ls-open">Open matchup →</span>
        </div>
      </button>
    );
  }

  // Other matchups: compact stacked rows (away on top, home below).
  const row = (team: TeamInfo | undefined, c: TeamCalc, lead: boolean) => (
    <div className={`ls-team${lead ? ' lead' : ''}`}>
      <span className="ls-crest">{team?.icon && <img src={team.icon} alt="" loading="lazy" />}</span>
      <span className="ls-tname">{team?.nameShort ?? team?.name ?? 'TBD'}</span>
      <span className="ls-proj">{fmt(c.projectedFinal)}</span>
      <span className="ls-score">{fmt(c.live)}</span>
    </div>
  );
  return (
    <button className="ls-card" style={cardStyle} onClick={onOpen}
            aria-label={`Open ${A?.name} at ${H?.name}`}>
      {head}
      <div className="ls-teams">
        {row(A, calc.away, !homeLead)}
        {row(H, calc.home, homeLead)}
      </div>
      {!calc.isFinal && <WinProbBar home={calc.homeWinProb} mini homeLabel={H?.name} awayLabel={A?.name} />}
      <div className="ls-card-foot">
        <span>Proj {fmt(calc.away.projectedFinal)} – {fmt(calc.home.projectedFinal)}</span>
      </div>
    </button>
  );
}

// ── player row ──

function PlayerRow({ row, meta, side }: { row: LivePlayerRow; meta?: PlayerMeta; side: 'left' | 'right' }) {
  const pos = meta?.position ?? '';
  const team = meta?.nflTeam ?? '';
  const state = nflGameState(row.secondsRemaining);
  const projected = meta?.projected ?? 0;
  const projFinal = projectPlayerFinal({ live: row.live, projected, secondsRemaining: row.secondsRemaining });
  const boom = state !== 'not-started' && projected > 0 && row.live >= projected;
  const isDef = pos === 'DEF';

  const face = (
    <span className="ls-headshot" style={{ ['--team' as any]: teamColor(team) }}>
      {meta?.headshot && !isDef && (
        <img src={meta.headshot} alt="" loading="lazy"
             onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      )}
      {team && !isDef && <img className="ls-nflchip" src={nflLogoUrl(team)} alt="" loading="lazy" />}
      {isDef && team && <img src={nflLogoUrl(team)} alt="" loading="lazy"
             style={{ position: 'absolute', inset: '18%', width: '64%', height: '64%', objectFit: 'contain' }} />}
    </span>
  );

  const id = (
    <span className="ls-pid">
      <span className="ls-pname">{meta?.name ?? 'Player'}</span>
      <span className="ls-pmeta">
        {team && <img src={nflLogoUrl(team)} alt="" loading="lazy" />}
        <span>{team}</span>
        <span className={`ls-pclock ${state === 'in-progress' ? 'live' : state === 'not-started' ? 'pre' : ''}`}>
          <span className={`ls-dot ${state === 'in-progress' ? 'live' : state === 'not-started' ? 'pre' : 'final'}`} />
          {clockLabel(state, row.secondsRemaining)}
        </span>
      </span>
    </span>
  );

  const score = (
    <span className={`ls-pscore${state === 'not-started' ? ' pre' : ''}${boom ? ' boom' : ''}`}>
      <span className="ls-plive">{fmt(row.live)}</span>
      <span className="ls-pproj">proj {fmt(projFinal)}</span>
    </span>
  );

  const posChip = <span className="ls-ppos" style={{ ['--posc' as any]: posColor(pos) }}>{pos || '—'}</span>;

  return side === 'left'
    ? <div className="ls-prow">{posChip}{face}{id}{score}</div>
    : <div className="ls-prow right">{score}{id}{face}{posChip}</div>;
}

// ── matchup detail ──

function MatchupDetail({ matchup, teams, players, meta, calc, moments, onBack }: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  players: Record<string, LivePlayerRow[]>;
  meta: Record<string, PlayerMeta>;
  calc: { home: TeamCalc; away: TeamCalc; homeWinProb: number; isFinal: boolean };
  moments: Moment[];
  onBack: () => void;
}) {
  const H = teams[matchup.home];
  const A = teams[matchup.away];
  const th = H?.color ?? '#1c497c';
  const ta = A?.color ?? '#8a94a0';
  const homeRows = players[matchup.home] ?? [];
  const awayRows = players[matchup.away] ?? [];
  const rowCount = Math.max(homeRows.length, awayRows.length);
  const matchupMoments = moments.filter((m) => m.fid === matchup.home || m.fid === matchup.away).slice(0, 8);

  const awaySplit = `${100 - Math.round(calc.homeWinProb * 100)}%`;
  return (
    <div className="ls-detail" style={{ ['--th' as any]: th, ['--ta' as any]: ta, ['--wp-split' as any]: awaySplit }}>
      <button className="ls-back" onClick={onBack}>← All matchups</button>
      <div className="ls-scorehead">
        <div className="ls-mx-team away">
          <span className="ls-mx-crest">{A?.icon && <img src={A.icon} alt="" />}</span>
          <span className="ls-mx-tn"><b>{A?.nameShort ?? A?.name}</b><em>{fmt(calc.away.projectedFinal)} proj</em></span>
          <span className="ls-mx-total">{fmt(calc.away.live)}</span>
        </div>
        <div className="ls-mx-center">
          <span className="ls-mx-live">
            {!calc.isFinal && <span className="ls-dot live" />}{calc.isFinal ? 'FINAL' : 'LIVE'}
          </span>
          <span className="ls-mx-projline">Proj {fmt(calc.away.projectedFinal)} – {fmt(calc.home.projectedFinal)}</span>
        </div>
        <div className="ls-mx-team home">
          <span className="ls-mx-total">{fmt(calc.home.live)}</span>
          <span className="ls-mx-tn"><b>{H?.nameShort ?? H?.name}</b><em>{fmt(calc.home.projectedFinal)} proj</em></span>
          <span className="ls-mx-crest">{H?.icon && <img src={H.icon} alt="" />}</span>
        </div>
      </div>

      {!calc.isFinal && <WinProbBar home={calc.homeWinProb} homeLabel={H?.name} awayLabel={A?.name} />}
      <div className="ls-ytp">
        <span>{calc.away.yetToPlay} yet to play</span>
        <span>{calc.home.yetToPlay} yet to play</span>
      </div>

      <div className="ls-mx-body">
        {rowCount === 0 && <div className="ls-empty">Player breakdown appears once lineups lock and games begin.</div>}
        {Array.from({ length: rowCount }).map((_, i) => {
          const h = homeRows[i];
          const a = awayRows[i];
          const pos = (a && meta[a.id]?.position) || (h && meta[h.id]?.position) || '';
          return (
            <div className="ls-mx-row" key={i}>
              <div>{a && <PlayerRow row={a} meta={meta[a.id]} side="left" />}</div>
              <div className="ls-mx-pos">{pos}</div>
              <div>{h && <PlayerRow row={h} meta={meta[h.id]} side="right" />}</div>
            </div>
          );
        })}
      </div>

      {matchupMoments.length > 0 && (
        <div className="ls-moments">
          <h3>Scoring updates</h3>
          {matchupMoments.map((m) => (
            <div className="ls-moment" key={m.key}>
              <span className="ls-m-clock">{m.clock}</span>
              {m.team && <img className="ls-m-nfl" src={nflLogoUrl(m.team)} alt="" loading="lazy" />}
              <span className="ls-m-txt">{m.name}</span>
              <span className="ls-m-pts">+{fmt(m.delta)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── main ──

function goToWeek(w: number) {
  const u = new URL(window.location.href);
  u.searchParams.set('week', String(w));
  window.location.href = u.toString();
}

export default function LiveScoreboard(props: LiveScoringPageProps) {
  const { teams, playerMeta, userFranchiseId, week } = props;
  const { scores, remaining, matchups, players, ytp } = useLiveScoring(props);
  const [selected, setSelected] = useState<MatchupPairing | null>(null);

  // Scoring moments: diff each starter's live points across polls and surface
  // notable jumps. Self-contained — no play-by-play feed needed. In demo mode
  // they're seeded from the sample so the feed is visible without polling.
  const prevLives = useRef<Record<string, number>>({});
  const [moments, setMoments] = useState<Moment[]>(props.initialMoments ?? []);
  useEffect(() => {
    const prev = prevLives.current;
    const fresh: Moment[] = [];
    for (const [fid, rows] of Object.entries(players)) {
      for (const r of rows) {
        const before = prev[r.id];
        if (before !== undefined && r.live - before >= 1.5) {
          const m = playerMeta[r.id];
          fresh.push({
            key: `${r.id}-${r.live.toFixed(1)}`,
            fid,
            name: m?.name ?? 'Player',
            team: m?.nflTeam ?? '',
            delta: r.live - before,
            clock: clockLabel(nflGameState(r.secondsRemaining), r.secondsRemaining),
          });
        }
        prev[r.id] = r.live;
      }
    }
    if (fresh.length) setMoments((cur) => [...fresh, ...cur].slice(0, 24));
  }, [players, playerMeta]);

  const calcFor = useCallback((m: MatchupPairing) => {
    const home = computeTeam(m.home, scores, players, ytp, playerMeta);
    const away = computeTeam(m.away, scores, players, ytp, playerMeta);
    const homeWinProb = winProbability(home.projectedFinal, away.projectedFinal, home.remainingPoints + away.remainingPoints);
    const isFinal = home.remainingPoints + away.remainingPoints <= 0
      && (remaining[m.home] ?? 0) <= 0 && (remaining[m.away] ?? 0) <= 0;
    return { home, away, homeWinProb, isFinal };
  }, [scores, players, ytp, playerMeta, remaining]);

  const ordered = useMemo(() => {
    const yours = matchups.filter((m) => m.home === userFranchiseId || m.away === userFranchiseId);
    const others = matchups
      .filter((m) => !yours.includes(m))
      .sort((a, b) => {
        const ma = Math.abs((scores[a.home] ?? 0) - (scores[a.away] ?? 0));
        const mb = Math.abs((scores[b.home] ?? 0) - (scores[b.away] ?? 0));
        return ma - mb;
      });
    // No user matchup → promote the closest game to featured.
    const featured = yours.length ? yours : others.slice(0, 1);
    const rest = yours.length ? others : others.slice(1);
    return { featured, rest };
  }, [matchups, scores, userFranchiseId]);

  if (selected) {
    return (
      <div className="ls-root">
        <MatchupDetail
          matchup={selected} teams={teams} players={players}
          meta={playerMeta} calc={calcFor(selected)} moments={moments} onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  const anyLive = Object.values(remaining).some((r) => r > 0);

  return (
    <div className="ls-root">
      <div className="ls-head">
        <h1>Live Scoring{props.demo && <span className="ls-sample-badge">Sample data</span>}</h1>
        <div className="ls-head-right">
          <label className="ls-weeksel">
            <span className="ls-weeksel-lbl">Week</span>
            <select value={week} onChange={(e) => goToWeek(Number(e.target.value))} aria-label="Select week">
              {Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </label>
          {(anyLive || props.demo) && <span className="ls-status live"><span className="ls-dot live" />Live</span>}
        </div>
      </div>

      <NflGamesStrip week={week} year={props.year} isLive={props.isLive} demo={props.demo} initialGames={props.initialNflGames} />

      {matchups.length === 0 ? (
        <div className="ls-card"><div className="ls-empty">Scores will appear here when games begin.</div></div>
      ) : (
        <div className="ls-board" aria-live="polite">
          {ordered.featured.map((m, i) => (
            <ScoreCard key={`f-${m.home}-${m.away}`} matchup={m} teams={teams} calc={calcFor(m)}
                       featured isYours={i === 0 && !!userFranchiseId} onOpen={() => setSelected(m)} />
          ))}
          {ordered.rest.map((m) => (
            <ScoreCard key={`${m.home}-${m.away}`} matchup={m} teams={teams} calc={calcFor(m)}
                       featured={false} isYours={false} onOpen={() => setSelected(m)} />
          ))}
        </div>
      )}
    </div>
  );
}
