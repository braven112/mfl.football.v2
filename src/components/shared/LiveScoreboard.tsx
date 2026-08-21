/**
 * LiveScoreboard — progressive live-scoring island (Direction C / Editorial).
 *
 * Scoreboard of every matchup (closest first, your matchup pinned), each with
 * team totals, projected finals, and a win-probability bar. Tap a matchup to
 * open the head-to-head detail: starter-by-starter rows with live points,
 * projected finals, NFL logo + REAL game state, the player's live box-score
 * line, and "yet to play" counts.
 *
 * Three data sources, two of them polled:
 *   - PlayerMeta (props)         — static identity + weekly projection.
 *   - /api/live-scoring          — MFL fantasy points + game-seconds remaining.
 *   - /api/nfl-scoreboard and    — ESPN. Real quarter/clock, red-zone and
 *     /api/nfl-game-detail         down-and-distance, per-player box scores,
 *                                  and athlete-attributed scoring plays.
 *
 * Both ESPN routes go through the SHARED pollers in src/hooks, which the NFL
 * games strip also subscribes to — that keeps the page at two poll loops
 * rather than one per island per feed.
 *
 * Two states this file is careful to keep apart, because merging them is the
 * repo's most-repeated bug: "ESPN has no stat line for him yet" and "we
 * couldn't reach ESPN". The first is silence; the second says so out loud.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LivePlayerRow,
  LiveScoringPageProps,
  LiveScoringResponse,
  MatchupPairing,
  NflGame,
  PlayerBoxScore,
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
import {
  assignLineupSlots,
  buildMoments,
  describeFeedFreshness,
  describeGameState,
  formatGameClock,
  isPlayerInRedZone,
  playerDownDistance,
  selectMatchupMoments,
  type FeedSnapshot,
  type LineupSlotRules,
  type LiveMoment,
} from '../../utils/live-scoring-view';
import { useNflScoreboard } from '../../hooks/useNflScoreboard';
import { useNflGameDetail } from '../../hooks/useNflGameDetail';
import type { PollStatus } from '../../utils/live-poll-store';
import { normalizeTeamCode } from '../../utils/nfl-logo';
import { nflLogoErrorHandler, nflLogoLoadHandler, nflLogoRefCallback } from '../../constants/roster-constants';
import { getPlayerAvatarBackground, getPlayerAvatarBorder, getPlayerAvatarRing, getPlayerAvatarRingDark } from '../../utils/nfl-team-colors';
import { resolveTeamColorPair } from '../../utils/team-color-contrast';

const POLL_LIVE = 60_000;
const POLL_STALE = 300_000;
/** Weeks offered in the week selector (regular season 1–18). */
const MAX_WEEK = 18;

// ── polling ──

function useLiveScoring(props: LiveScoringPageProps) {
  const { week, year, leagueId, host, isLive } = props;
  const [scores, setScores] = useState<Record<string, number>>(props.initialScores ?? {});
  const [remaining, setRemaining] = useState<Record<string, number>>(props.initialRemaining ?? {});
  const [matchups, setMatchups] = useState<MatchupPairing[]>(props.matchups ?? []);
  const [players, setPlayers] = useState<Record<string, LivePlayerRow[]>>(props.initialPlayers ?? {});
  const [ytp, setYtp] = useState<Record<string, number>>(props.initialYetToPlay ?? {});
  // Freshness of the MFL half of the board, on the same contract the shared
  // ESPN store uses: `fetchedAt` only ever advances on a SUCCESSFUL poll, and
  // a failure flips `status` without touching the data we already hold.
  const [feed, setFeed] = useState<FeedSnapshot>({ status: 'idle', fetchedAt: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const url = new URL('/api/live-scoring', window.location.origin);
      url.searchParams.set('week', String(week));
      url.searchParams.set('year', String(year));
      url.searchParams.set('L', leagueId);
      url.searchParams.set('host', `https://${host}`);
      const res = await fetch(url.toString());
      if (!res.ok) {
        setFeed((f) => ({ ...f, status: 'error' }));
        return;
      }
      const data: LiveScoringResponse = await res.json();
      setScores(data.scores ?? {});
      setRemaining(data.remaining ?? {});
      if (data.matchups?.length) setMatchups(data.matchups);
      if (data.players) setPlayers(data.players);
      if (data.playersYetToPlay) setYtp(data.playersYetToPlay);
      setFeed({ status: 'ok', fetchedAt: Date.now() });
    } catch {
      /* retry next tick — keep the last good scores, say we're reconnecting */
      setFeed((f) => ({ ...f, status: 'error' }));
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

  return { scores, remaining, matchups, players, ytp, feed };
}

// ── helpers ──

function nflGameState(secondsRemaining: number): NflGameState {
  if (secondsRemaining <= 0) return 'final';
  if (secondsRemaining >= NFL_GAME_SECONDS) return 'not-started';
  return 'in-progress';
}

const nflLogoUrl = (team: string) => (team ? `/assets/nfl-logos/${normalizeTeamCode(team)}.svg` : '');

const fmt = (n: number) => n.toFixed(1);

/**
 * Predictor-chart colors for a home/away pair, resolved once per theme so the
 * win-probability bar + dynamic top border always read as two distinct,
 * legible colors. Home keeps its brand primary; away steps primary → secondary
 * → chart color for contrast (see team-color-contrast). Fallbacks A–C are all
 * on: A pins both colors legible against the card surface for the theme; B
 * force-adjusts a shade when no brand color clears the bar; C lets a home team
 * whose primary vanishes on the surface fall to a visible brand color. The CSS
 * derives --th/--ta from the theme-matched pair; D (the seam) lives in CSS.
 */
const LS_LIGHT_BG = '#ffffff'; // --card-surface (light)
const LS_DARK_BG = '#262626'; // --card-surface (dark)
/**
 * Map a team to the color set for a theme. Dark mode prefers the explicit
 * `colorPrimaryDark`/`colorSecondaryDark` brand colors (config) so teams whose
 * light primary is a near-black or dark navy — invisible on the dark card —
 * light up with a hand-picked vivid hue instead of an auto-nudged mud. Each
 * dark field falls back to its light counterpart when a team hasn't defined one.
 */
function themeColors(t: TeamInfo | undefined, dark: boolean) {
  if (!t) return undefined;
  if (!dark) return t;
  return {
    ...t,
    colorPrimary: t.colorPrimaryDark ?? t.colorPrimary,
    colorSecondary: t.colorSecondaryDark ?? t.colorSecondary,
  };
}
function teamColorVars(home?: TeamInfo, away?: TeamInfo): Record<string, string> {
  const opts = { forceAdjust: true, homeVisibilityFallback: true } as const;
  const light = resolveTeamColorPair(home, away, { ...opts, background: LS_LIGHT_BG });
  const dark = resolveTeamColorPair(
    themeColors(home, true), themeColors(away, true), { ...opts, background: LS_DARK_BG },
  );
  return {
    '--th-light': light.home, '--ta-light': light.away,
    '--th-dark': dark.home, '--ta-dark': dark.away,
  };
}

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

function ScoreCard({ matchup, teams, calc, featured, variant = 'faceoff', isYours, onOpen }: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  calc: { home: TeamCalc; away: TeamCalc; homeWinProb: number; isFinal: boolean };
  featured: boolean;
  /** 'row' = single-game full-width row; 'faceoff' = stacked column (doubleheader). */
  variant?: 'row' | 'faceoff';
  isYours: boolean;
  onOpen: () => void;
}) {
  const H = teams[matchup.home];
  const A = teams[matchup.away];
  const homeLead = calc.home.live >= calc.away.live;
  // Theme-aware, contrast-guaranteed predictor colors (home primary / away
  // adjusted). CSS derives --th/--ta from these per theme.
  // Top border + win-prob bar split at the away team's win share (measured
  // from the left, which is the away side).
  const awaySplit = `${100 - Math.round(calc.homeWinProb * 100)}%`;
  const cardStyle = { ...teamColorVars(H, A), ['--wp-split' as any]: awaySplit };

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

  const foot = (
    <div className="ls-card-foot">
      <span>Proj {fmt(calc.away.projectedFinal)} – {fmt(calc.home.projectedFinal)}</span>
      <span className="ls-open">Open matchup →</span>
    </div>
  );

  // Single game (your matchup, one game this week): full-width horizontal row.
  if (featured && variant === 'row') {
    const teamBlock = (team: TeamInfo | undefined, c: TeamCalc, lead: boolean, sideCls: string) => (
      <div className={`ls-fr-team ${sideCls}${lead ? ' lead' : ''}`}>
        <span className="ls-fr-id">
          <span className="ls-fr-crest">{team?.icon && <img src={team.icon} alt="" loading="lazy" />}</span>
          <span className="ls-fr-name">{team?.nameShort ?? team?.name ?? 'TBD'}</span>
        </span>
        <span className="ls-fr-nums">
          <span className="ls-fr-score">{fmt(c.live)}</span>
          <span className="ls-fr-proj"><span className="ls-fr-lbl">Proj </span>{fmt(c.projectedFinal)}</span>
        </span>
      </div>
    );
    return (
      <button className="ls-card feat row" style={cardStyle} onClick={onOpen}
              aria-label={`Open ${A?.name} at ${H?.name}`}>
        {head}
        <div className="ls-faceoff-row">
          {teamBlock(A, calc.away, !homeLead, 'away')}
          <span className="ls-fr-vs">@</span>
          {teamBlock(H, calc.home, homeLead, 'home')}
        </div>
        {!calc.isFinal && <WinProbBar home={calc.homeWinProb} homeLabel={H?.name} awayLabel={A?.name} />}
        {foot}
      </button>
    );
  }

  // Featured faceoff (used side-by-side for doubleheaders): stacked columns,
  // away on the left, home on the right.
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
        {foot}
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

// ── feed status ──

/**
 * The pill that proves the page is still working.
 *
 * It replaced a static "Live" badge that was true-by-assertion: it lit up from
 * the game-day clock and then never changed again, so a board sitting at
 * 0.0–0.0 (preseason, pre-kickoff, an MFL feed that has not opened) looked
 * exactly like a dead page. Owner report, 2026-08-21.
 *
 * Three deliberate choices:
 *
 *  - **A relative age, ticking.** "updated 14s ago" counts up every second and
 *    snaps to "just now" when a poll lands, so the element itself is the
 *    evidence. An absolute clock time reads as a caption; this reads as a
 *    heartbeat.
 *  - **The tick is local to this component.** A 1s interval one level up would
 *    re-render every starter row on the board once a second.
 *  - **It renders nothing when no feed is enabled.** In bundled-sample mode
 *    both pollers are off, so there is no freshness to report and a pill
 *    stuck on "Connecting…" would be a lie in the other direction.
 */
function LiveFeedStatus({ feeds, anyLive, gamesLive, compact }: {
  /** ONLY the pollers actually running for this render. Empty → no pill. */
  feeds: FeedSnapshot[];
  anyLive: boolean;
  /** How many NFL games are being played right now. 0 hides the clause. */
  gamesLive: number;
  /** Detail view: drop the games clause, the header there is already tight. */
  compact?: boolean;
}) {
  const [now, setNow] = useState(0);
  const newest = feeds.reduce((max, f) => Math.max(max, f.fetchedAt), 0);

  useEffect(() => {
    // Start ticking only once something has landed. Before that the pill says
    // "Connecting…" and has no age to age, so a timer would be pure churn —
    // and it keeps the first client render byte-identical to the server's.
    if (!newest) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [newest]);

  if (feeds.length === 0) return null;
  const fresh = describeFeedFreshness(feeds, anyLive, now || newest);
  const games = !compact && gamesLive > 0
    ? `${gamesLive} game${gamesLive === 1 ? '' : 's'} live`
    : '';

  return (
    <span
      className={`ls-status ${fresh.tone}`}
      role="status"
      title={
        fresh.tone === 'error'
          ? 'The live feed did not answer the last poll — these numbers are the last we could confirm.'
          : 'Live feed check-in. The page re-reads the feeds automatically.'
      }
    >
      <span className={`ls-dot ${fresh.tone === 'live' ? 'live' : fresh.tone === 'error' ? 'err' : 'pre'}`} />
      <span className="ls-status-lbl">{fresh.label}</span>
      {games && <span className="ls-status-sub">{games}</span>}
      {fresh.age && <span className="ls-status-age">updated {fresh.age}</span>}
    </span>
  );
}

// ── player row ──

interface PlayerRowProps {
  row: LivePlayerRow;
  meta?: PlayerMeta;
  side: 'left' | 'right';
  /** Lineup slot he is filling — 'QB' … 'DEF', or 'FLEX'. Falls back to position. */
  slot?: string;
  /** The player's real NFL game, when the ESPN scoreboard resolved one. */
  game?: NflGame;
  /** His box-score line; undefined = ESPN has no line for him (yet). */
  box?: PlayerBoxScore;
  /**
   * Whether the box-score feed is readable at all. 'error' suppresses the
   * stat-line slot entirely rather than rendering every starter as though he
   * had done nothing — silence must mean "no stats yet", never "feed down".
   */
  detailStatus: PollStatus;
}

function PlayerRow({ row, meta, side, slot, game, box, detailStatus }: PlayerRowProps) {
  const pos = meta?.position ?? '';
  const team = meta?.nflTeam ?? '';
  const state = nflGameState(row.secondsRemaining);
  const projected = meta?.projected ?? 0;
  const projFinal = projectPlayerFinal({ live: row.live, projected, secondsRemaining: row.secondsRemaining });
  const boom = state !== 'not-started' && projected > 0 && row.live >= projected;
  const isDef = pos === 'DEF';
  const redZone = isPlayerInRedZone(game, team);
  const downDistance = playerDownDistance(game, team);
  // DEF/ST intentionally has no stat line: ESPN's box score is athlete-keyed
  // and MFL's 32 defenses carry no ESPN athlete id, so there is nothing to
  // join. See DEF_STAT_LINE in espn-game-detail.ts for why we don't synthesize
  // one from the opposing team's totals.
  const statLine = detailStatus === 'error' || isDef ? '' : box?.statLine ?? '';

  // DEF uses the SAME lockup as the roster and lineup pages: a bare, full-bleed
  // team logo — no circle, no team-color chip (player-cell.css
  // `.player-cell__avatar--def`). This board used to put the logo inside the
  // player headshot chip, which made a defense the only row on the site that
  // looked different from everywhere else it appears.
  const face = (
    <span
      className={`ls-headshot${isDef ? ' def' : ''}`}
      style={isDef ? undefined : {
        ['--player-avatar-bg' as any]: getPlayerAvatarBackground(team),
        ['--player-avatar-border' as any]: getPlayerAvatarBorder(team),
        ['--player-avatar-ring' as any]: getPlayerAvatarRing(team),
        ['--player-avatar-ring-dark' as any]: getPlayerAvatarRingDark(team),
      }}
    >
      {meta?.headshot && !isDef && (
        <img src={meta.headshot} alt="" loading="lazy"
             onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      )}
      {isDef && team && <img className="ls-def-logo" src={nflLogoUrl(team)} alt="" loading="lazy" onError={nflLogoErrorHandler} onLoad={nflLogoLoadHandler} ref={nflLogoRefCallback} />}
    </span>
  );

  const id = (
    <span className="ls-pid">
      <span className="ls-pname">{meta?.name ?? 'Player'}</span>
      <span className="ls-pmeta">
        {/* DEF hides the meta-row logo — the avatar IS that logo, so showing it
            twice on one row is the duplicate PlayerCell already suppresses. */}
        {team && !isDef && <img src={nflLogoUrl(team)} alt="" loading="lazy" />}
        {/* Classed so the phone breakpoint can drop it: the headshot's
            team-color backdrop already says which club he plays for, and the
            three characters are what pushed the meta line into a second wrap. */}
        <span className="ls-pteam">{team}</span>
        <span
          className={`ls-pclock ${state === 'in-progress' ? 'live' : state === 'not-started' ? 'pre' : ''}`}
          title={describeGameState(state)}
        >
          <span className={`ls-dot ${state === 'in-progress' ? 'live' : state === 'not-started' ? 'pre' : 'final'}`} />
          {formatGameClock(state, game)}
        </span>
        {redZone && <span className="ls-rz" title="His team is in the red zone">RED ZONE</span>}
        {!redZone && downDistance && <span className="ls-dd">{downDistance}</span>}
      </span>
    </span>
  );

  // The stat line is a SIBLING of the identity block, not a child of it, so it
  // spans the whole row rather than the narrow name column. Nested, a real
  // line ("18 car, 169 yds, 2 TD · 1 rec (1 tgt), 13 yds · 1 FUM lost") wrapped
  // to two lines on a desktop card and to SIX on a 390px phone, which tripled
  // the row height and squeezed the player's name to "Derric…".
  const stat = statLine ? <span className="ls-pstat">{statLine}</span> : null;

  const score = (
    <span className={`ls-pscore${state === 'not-started' ? ' pre' : ''}${boom ? ' boom' : ''}`}>
      <span className="ls-plive">{fmt(row.live)}</span>
      <span className="ls-pproj">proj {fmt(projFinal)}</span>
    </span>
  );

  // The chip names the SLOT, not the player's position — three of nine
  // starters are flex, and an owner reads his lineup by slot.
  const slotLabel = slot ?? pos;
  const posChip = (
    <span className="ls-ppos" data-pos={slotLabel || undefined}>
      {slotLabel === 'FLEX' ? 'Flex' : slotLabel || '—'}
    </span>
  );

  const cls = `ls-prow${redZone ? ' redzone' : ''}`;
  return side === 'left'
    ? <div className={cls}>{posChip}{face}{id}{score}{stat}</div>
    : <div className={`${cls} right`}>{score}{id}{face}{posChip}{stat}</div>;
}

// ── matchup detail ──

function MatchupDetail({
  matchup, teams, players, meta, calc, moments, gamesByTeam, boxScore, detailStatus,
  detailLoaded, detailPartial, starterRules, feeds, nflAnyLive, nflLiveCount, onBack,
}: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  players: Record<string, LivePlayerRow[]>;
  meta: Record<string, PlayerMeta>;
  calc: { home: TeamCalc; away: TeamCalc; homeWinProb: number; isFinal: boolean };
  moments: LiveMoment[];
  /** Canonical NFL team code → that team's real game. */
  gamesByTeam: Map<string, NflGame>;
  /** MFL player id → box-score line. */
  boxScore: Record<string, PlayerBoxScore>;
  detailStatus: PollStatus;
  /** Has a box-score/plays payload landed at least once? */
  detailLoaded: boolean;
  /** Did some games in the slate fail to expand? */
  detailPartial: boolean;
  /** League starting requirements, for slot labels. */
  starterRules: LineupSlotRules;
  /** Enabled pollers, for the freshness pill. */
  feeds: FeedSnapshot[];
  nflAnyLive: boolean;
  nflLiveCount: number;
  onBack: () => void;
}) {
  const H = teams[matchup.home];
  const A = teams[matchup.away];
  // Derive each side's lineup slots and sort into reading order. Both sides
  // must agree on order for the single position label between them to mean
  // anything — see assignLineupSlots.
  const homeRows = assignLineupSlots(players[matchup.home] ?? [], meta, starterRules);
  const awayRows = assignLineupSlots(players[matchup.away] ?? [], meta, starterRules);
  const rowCount = Math.max(homeRows.length, awayRows.length);
  const matchupMoments = selectMatchupMoments(moments, matchup.home, matchup.away);
  const gameFor = (row: LivePlayerRow | undefined) =>
    row ? gamesByTeam.get(meta[row.id]?.nflTeam ?? '') : undefined;
  const slotName = (s: string | undefined) => (s === 'FLEX' ? 'Flex' : s ?? '');

  const awaySplit = `${100 - Math.round(calc.homeWinProb * 100)}%`;
  return (
    <div className="ls-detail" style={{ ...teamColorVars(H, A), ['--wp-split' as any]: awaySplit }}>
      <div className="ls-detail-top">
        <button className="ls-back" onClick={onBack}>← All matchups</button>
        <LiveFeedStatus feeds={feeds} anyLive={nflAnyLive} gamesLive={nflLiveCount} compact />
      </div>
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
          const h = homeRows[i]?.row;
          const a = awayRows[i]?.row;
          const slot = slotName(awayRows[i]?.slot ?? homeRows[i]?.slot);
          return (
            <div className="ls-mx-row" key={i}>
              <div>{a && (
                <PlayerRow row={a} meta={meta[a.id]} side="left" slot={awayRows[i]?.slot}
                           game={gameFor(a)} box={boxScore[a.id]} detailStatus={detailStatus} />
              )}</div>
              <div className="ls-mx-pos">{slot}</div>
              <div>{h && (
                <PlayerRow row={h} meta={meta[h.id]} side="right" slot={homeRows[i]?.slot}
                           game={gameFor(h)} box={boxScore[h.id]} detailStatus={detailStatus} />
              )}</div>
            </div>
          );
        })}
      </div>

      {/* Scoring plays. Three distinct states, deliberately: real plays, an
          honest "nothing yet", and an explicit "we couldn't read the feed".
          Collapsing the last two would show an owner an empty ticker during an
          ESPN outage and let him believe his starters did nothing. */}
      <div className="ls-moments">
        <h3>Scoring plays</h3>
        {matchupMoments.length > 0 ? (
          <>
            {matchupMoments.map((m) => (
              <div className="ls-moment" key={m.key}>
                <span className="ls-m-clock">{m.clock}</span>
                {m.team && <img className="ls-m-nfl" src={nflLogoUrl(m.team)} alt="" loading="lazy" />}
                <span className="ls-m-txt">{m.text || m.playerName}</span>
                {m.typeAbbrev && <span className="ls-m-type">{m.typeAbbrev}</span>}
              </div>
            ))}
            {detailPartial && (
              <p className="ls-moments-note">Some games couldn’t be read — this list may be incomplete.</p>
            )}
          </>
        ) : detailStatus === 'error' ? (
          <p className="ls-moments-note error">Scoring plays are unavailable right now — we couldn’t reach the NFL feed.</p>
        ) : detailLoaded ? (
          <p className="ls-moments-note">No scoring plays from these starters yet.</p>
        ) : (
          <p className="ls-moments-note">Loading scoring plays…</p>
        )}
      </div>
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
  // Both our leagues start one of each position plus three flex; the page
  // supplies the league's real config, this is only a floor for older callers.
  const starterRules: LineupSlotRules = props.starterRules ?? {
    required: { QB: 1, RB: 1, WR: 1, TE: 1, PK: 1, DEF: 1 },
    total: 9,
  };
  const { scores, remaining, matchups, players, ytp, feed: mflFeed } = useLiveScoring(props);
  const [selected, setSelected] = useState<MatchupPairing | null>(null);

  // ── real NFL context (ESPN) ──
  // Demo mode ships its own sample, so both pollers stay off and the bundled
  // data is used verbatim — a live fetch would overwrite the replay.
  // `demoLiveNfl` is the sample-fantasy / live-NFL variant: keep the ESPN
  // pollers running so the real slate drives clocks, red zone and box scores.
  const espnEnabled = !props.demo || !!props.demoLiveNfl;
  const {
    byTeam: gamesByTeam, anyLive: anyNflGameLive, espnSlot,
    status: nflStatus, fetchedAt: nflFetchedAt, liveCount: nflLiveCount,
  } = useNflScoreboard(props.week, props.year, {
    enabled: espnEnabled,
    live: props.isLive,
    fallbackGames: props.initialNflGames,
  });
  const detail = useNflGameDetail(props.week, props.year, {
    enabled: espnEnabled,
    anyLive: anyNflGameLive,
    fallback: props.initialDetail,
  });

  // Only the pollers that are actually RUNNING. A disabled poller can never go
  // stale or fail, so listing one would pin the status pill at "Connecting…"
  // (bundled-sample mode turns both ESPN feeds off; ?demo=live turns the MFL
  // one off, because MFL serves nothing before the season starts).
  const feeds = useMemo<FeedSnapshot[]>(() => {
    const out: FeedSnapshot[] = [];
    if (props.isLive) out.push(mflFeed);
    if (espnEnabled) {
      out.push({ status: nflStatus, fetchedAt: nflFetchedAt });
      out.push({ status: detail.status, fetchedAt: detail.fetchedAt });
    }
    return out;
  }, [props.isLive, mflFeed, espnEnabled, nflStatus, nflFetchedAt, detail.status, detail.fetchedAt]);

  // Scoring plays, DERIVED rather than accumulated: /api/nfl-game-detail
  // returns the whole slate's scoring plays on every poll, so recomputing is
  // idempotent — a play can't be emitted twice and there is no seen-set to
  // drift. This replaced a ticker that inferred each "moment" by diffing a
  // starter's fantasy points between two 60s polls (a stat correction invented
  // scoring events) and labelled it with a clock the page made up.
  const moments = useMemo(
    () => buildMoments(detail.plays, players, playerMeta),
    [detail.plays, players, playerMeta],
  );

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
    // Only the user's own matchup earns the "YOUR MATCHUP" badge — a promoted
    // closest-game filler must not claim it.
    return { featured, rest, hasYours: yours.length > 0 };
  }, [matchups, scores, userFranchiseId]);

  if (selected) {
    return (
      <div className="ls-root">
        <MatchupDetail
          matchup={selected} teams={teams} players={players}
          meta={playerMeta} calc={calcFor(selected)} moments={moments}
          gamesByTeam={gamesByTeam} boxScore={detail.boxScore}
          detailStatus={detail.status} detailLoaded={detail.loaded} detailPartial={detail.partial}
          starterRules={starterRules}
          feeds={feeds} nflAnyLive={anyNflGameLive} nflLiveCount={nflLiveCount}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="ls-root">
      <div className="ls-head">
        <h1>
          Live Scoring
          {props.demo && <span className="ls-sample-badge">{props.demoLabel ?? 'Sample data'}</span>}
          {/* A validation override points the NFL half of the board at another
              slate (see resolveEspnTarget). Say so on the page: these URLs are
              shareable, and NFL games that don't belong to the week in the
              header are indistinguishable from a bug otherwise. */}
          {espnSlot?.overridden && (
            <span className="ls-sample-badge" title="NFL games are being read from a different ESPN slate for validation">
              NFL games: {espnSlot.seasonType === 1 ? 'preseason' : espnSlot.seasonType === 3 ? 'postseason' : 'regular'} wk {espnSlot.week} {espnSlot.year}
            </span>
          )}
        </h1>
        <div className="ls-head-right">
          <label className="ls-weeksel">
            <span className="ls-weeksel-lbl">Week</span>
            <select value={week} onChange={(e) => goToWeek(Number(e.target.value))} aria-label="Select week">
              {Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </label>
          {/* "Live" is claimed from the NFL slate alone — a franchise still having
              seconds left is true all week and says nothing about right now. */}
          <LiveFeedStatus feeds={feeds} anyLive={anyNflGameLive} gamesLive={nflLiveCount} />
        </div>
      </div>

      {matchups.length === 0 ? (
        <div className="ls-card"><div className="ls-empty">Scores will appear here when games begin.</div></div>
      ) : (
        <div className="ls-board" aria-live="polite">
          {/* Doubleheader (2 games): side by side in the faceoff format.
              Single game: one full-width row. */}
          {ordered.featured.length > 1 ? (
            <div className="ls-dh">
              {ordered.featured.map((m, i) => (
                <ScoreCard key={`f-${m.home}-${m.away}`} matchup={m} teams={teams} calc={calcFor(m)}
                           featured variant="faceoff" isYours={i === 0 && ordered.hasYours}
                           onOpen={() => setSelected(m)} />
              ))}
            </div>
          ) : (
            ordered.featured.map((m) => (
              <ScoreCard key={`f-${m.home}-${m.away}`} matchup={m} teams={teams} calc={calcFor(m)}
                         featured variant="row" isYours={ordered.hasYours}
                         onOpen={() => setSelected(m)} />
            ))
          )}
          {ordered.rest.map((m) => (
            <ScoreCard key={`${m.home}-${m.away}`} matchup={m} teams={teams} calc={calcFor(m)}
                       featured={false} isYours={false} onOpen={() => setSelected(m)} />
          ))}
        </div>
      )}
    </div>
  );
}
