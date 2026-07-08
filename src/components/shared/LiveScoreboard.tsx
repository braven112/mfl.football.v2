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

const POLL_LIVE = 60_000;
const POLL_STALE = 300_000;

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
    yetToPlay: ytp[fid] ?? notStarted,
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
        <div className="ls-wp-home" style={{ width: `${homePct}%` }} />
        <div className="ls-wp-away" style={{ width: `${awayPct}%` }} />
        <span className="ls-wp-mid" />
      </div>
      {!mini && (
        <div className="ls-wp-labels">
          <span className="ls-wp-l">{homePct}%</span>
          <span className="ls-wp-tag">WIN PROBABILITY</span>
          <span className="ls-wp-r">{awayPct}%</span>
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
  const th = H?.color ?? '#1c497c';
  const ta = A?.color ?? '#8a94a0';

  const row = (team: TeamInfo | undefined, c: TeamCalc, lead: boolean) => (
    <div className={`ls-team${lead ? ' lead' : ''}`}>
      <span className="ls-crest">{team?.icon && <img src={team.icon} alt="" loading="lazy" />}</span>
      <span className="ls-tname">{team?.nameShort ?? team?.name ?? 'TBD'}</span>
      <span className="ls-proj">{fmt(c.projectedFinal)}</span>
      <span className="ls-score">{fmt(c.live)}</span>
    </div>
  );

  return (
    <button className={`ls-card${featured ? ' feat' : ''}`} style={{ ['--th' as any]: th, ['--ta' as any]: ta }}
            onClick={onOpen} aria-label={`Open ${H?.name} vs ${A?.name}`}>
      <div className="ls-card-head">
        {calc.isFinal
          ? <span className="ls-badge final">Final</span>
          : <span className="ls-badge live"><span className="ls-dot live" />Live</span>}
        {!calc.isFinal && (calc.home.yetToPlay + calc.away.yetToPlay > 0) && (
          <span className="ls-rem">{calc.home.yetToPlay + calc.away.yetToPlay} yet to play</span>
        )}
        {isYours && <span className="ls-your">YOUR MATCHUP</span>}
      </div>
      <div className="ls-teams">
        {row(H, calc.home, homeLead)}
        {row(A, calc.away, !homeLead)}
      </div>
      {!calc.isFinal && <WinProbBar home={calc.homeWinProb} mini homeLabel={H?.name} awayLabel={A?.name} />}
      <div className="ls-card-foot">
        <span>Proj {fmt(calc.home.projectedFinal)} – {fmt(calc.away.projectedFinal)}</span>
        {featured && <span className="ls-open">Open matchup →</span>}
      </div>
    </button>
  );
}

// ── player row ──

function PlayerRow({ row, meta, side }: { row: LivePlayerRow; meta?: PlayerMeta; side: 'home' | 'away' }) {
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

  return side === 'home'
    ? <div className="ls-prow">{posChip}{face}{id}{score}</div>
    : <div className="ls-prow away">{score}{id}{face}{posChip}</div>;
}

// ── matchup detail ──

function MatchupDetail({ matchup, teams, players, meta, calc, onBack }: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  players: Record<string, LivePlayerRow[]>;
  meta: Record<string, PlayerMeta>;
  calc: { home: TeamCalc; away: TeamCalc; homeWinProb: number; isFinal: boolean };
  onBack: () => void;
}) {
  const H = teams[matchup.home];
  const A = teams[matchup.away];
  const th = H?.color ?? '#1c497c';
  const ta = A?.color ?? '#8a94a0';
  const homeRows = players[matchup.home] ?? [];
  const awayRows = players[matchup.away] ?? [];
  const rowCount = Math.max(homeRows.length, awayRows.length);

  return (
    <div className="ls-detail" style={{ ['--th' as any]: th, ['--ta' as any]: ta }}>
      <button className="ls-back" onClick={onBack}>← All matchups</button>
      <div className="ls-scorehead">
        <div className="ls-mx-team home">
          <span className="ls-mx-crest">{H?.icon && <img src={H.icon} alt="" />}</span>
          <span className="ls-mx-tn"><b>{H?.nameShort ?? H?.name}</b><em>{fmt(calc.home.projectedFinal)} proj</em></span>
          <span className="ls-mx-total">{fmt(calc.home.live)}</span>
        </div>
        <div className="ls-mx-center">
          <span className="ls-mx-live">
            {!calc.isFinal && <span className="ls-dot live" />}{calc.isFinal ? 'FINAL' : 'LIVE'}
          </span>
          <span className="ls-mx-projline">Proj {fmt(calc.home.projectedFinal)} – {fmt(calc.away.projectedFinal)}</span>
        </div>
        <div className="ls-mx-team away">
          <span className="ls-mx-total">{fmt(calc.away.live)}</span>
          <span className="ls-mx-tn"><b>{A?.nameShort ?? A?.name}</b><em>{fmt(calc.away.projectedFinal)} proj</em></span>
          <span className="ls-mx-crest">{A?.icon && <img src={A.icon} alt="" />}</span>
        </div>
      </div>

      {!calc.isFinal && <WinProbBar home={calc.homeWinProb} homeLabel={H?.name} awayLabel={A?.name} />}
      <div className="ls-ytp">
        <span>{calc.home.yetToPlay} yet to play</span>
        <span>{calc.away.yetToPlay} yet to play</span>
      </div>

      <div className="ls-mx-body">
        {rowCount === 0 && <div className="ls-empty">Player breakdown appears once lineups lock and games begin.</div>}
        {Array.from({ length: rowCount }).map((_, i) => {
          const h = homeRows[i];
          const a = awayRows[i];
          const pos = (h && meta[h.id]?.position) || (a && meta[a.id]?.position) || '';
          return (
            <div className="ls-mx-row" key={i}>
              <div>{h && <PlayerRow row={h} meta={meta[h.id]} side="home" />}</div>
              <div className="ls-mx-pos">{pos}</div>
              <div>{a && <PlayerRow row={a} meta={meta[a.id]} side="away" />}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── main ──

export default function LiveScoreboard(props: LiveScoringPageProps) {
  const { teams, playerMeta, userFranchiseId, week } = props;
  const { scores, remaining, matchups, players, ytp } = useLiveScoring(props);
  const [selected, setSelected] = useState<MatchupPairing | null>(null);

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
          meta={playerMeta} calc={calcFor(selected)} onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  const anyLive = Object.values(remaining).some((r) => r > 0);

  return (
    <div className="ls-root">
      <div className="ls-head">
        <h1>Live Scoring</h1>
        <span className={`ls-status${anyLive ? ' live' : ''}`}>
          {matchups.length > 0 && (anyLive ? <><span className="ls-dot live" />Live</> : <span className="ls-week-tab">Week {week}</span>)}
        </span>
      </div>

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
