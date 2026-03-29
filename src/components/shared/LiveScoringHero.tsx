/**
 * LiveScoringHero — React island for real-time fantasy scoring during game windows.
 *
 * Rendered by SeasonDailyHero when slot === 'live-scoring' during regular season,
 * playoffs, and championship phases. Polls /api/live-scoring every 60s when live.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LiveScoringHeroProps, LiveScoringResponse, MatchupPairing, TeamInfo } from '../../types/live-scoring';
import type { GameWindow } from '../../types/hero-state';
import { chooseTeamName } from '../../utils/team-names';

// ── Polling ──

const POLL_INTERVAL_LIVE = 60_000;    // 60s during live games
const POLL_INTERVAL_STALE = 300_000;  // 5min when all games finished

function useLiveScoring(
  week: number,
  isLive: boolean,
  initialScores?: Record<string, number>,
  initialRemaining?: Record<string, number>,
  initialMatchups?: MatchupPairing[],
) {
  const [scores, setScores] = useState<Record<string, number>>(initialScores ?? {});
  const [remaining, setRemaining] = useState<Record<string, number>>(initialRemaining ?? {});
  const [matchups, setMatchups] = useState<MatchupPairing[]>(initialMatchups ?? []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/live-scoring?week=${week}`);
      if (!res.ok) return;
      const data: LiveScoringResponse = await res.json();
      setScores(data.scores);
      setRemaining(data.remaining);
      if (data.matchups?.length) setMatchups(data.matchups);
    } catch {
      // Silently fail — will retry on next interval
    }
  }, [week]);

  useEffect(() => {
    if (!isLive) return;

    // Immediate first fetch
    poll();

    intervalRef.current = setInterval(poll, POLL_INTERVAL_LIVE);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, poll]);

  // Slow down polling when all games are finished
  useEffect(() => {
    if (!isLive) return;

    const allDone = Object.keys(remaining).length > 0 &&
      Object.values(remaining).every(r => r === 0);

    if (allDone && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(poll, POLL_INTERVAL_STALE);
    }
  }, [remaining, isLive, poll]);

  return { scores, remaining, matchups };
}

// ── Helpers ──

function getTeamDisplayName(team: TeamInfo | undefined, context: 'default' | 'short' = 'default'): string {
  if (!team) return 'TBD';
  return chooseTeamName({
    fullName: team.name,
    nameMedium: team.nameMedium,
    nameShort: team.nameShort,
    abbrev: team.abbrev,
  }, context);
}

function formatScore(score: number | undefined): string {
  if (score == null) return '0.00';
  return score.toFixed(2);
}

function getGameWindowLabel(gameWindow: GameWindow): string {
  switch (gameWindow) {
    case 'tnf': return 'Thursday Night';
    case 'sunday': return 'Sunday Games';
    case 'snf': return 'Sunday Night';
    case 'mnf': return 'Monday Night';
    default: return 'This Week';
  }
}

function getNextGameText(gameWindow: GameWindow): string {
  switch (gameWindow) {
    case 'tnf': return 'Next: Sunday 1pm ET';
    case 'sunday': return 'Next: Sunday Night 8:20pm ET';
    case 'snf': return 'Next: Monday 8:15pm ET';
    case 'mnf': return 'Next: Thursday 8:15pm ET';
    default: return 'Next: Thursday 8:15pm ET';
  }
}

/** Sort matchups by closeness (tightest margin first), then by total score desc */
function sortByInterest(
  matchups: MatchupPairing[],
  scores: Record<string, number>,
): MatchupPairing[] {
  return [...matchups].sort((a, b) => {
    const marginA = Math.abs((scores[a.home] ?? 0) - (scores[a.away] ?? 0));
    const marginB = Math.abs((scores[b.home] ?? 0) - (scores[b.away] ?? 0));
    if (marginA !== marginB) return marginA - marginB;
    const totalA = (scores[a.home] ?? 0) + (scores[a.away] ?? 0);
    const totalB = (scores[b.home] ?? 0) + (scores[b.away] ?? 0);
    return totalB - totalA;
  });
}

// ── Sub-components ──

function StatusBadge({ isLive, remaining, gameWindow }: {
  isLive: boolean;
  remaining: Record<string, number>;
  gameWindow: GameWindow;
}) {
  const hasRemaining = Object.keys(remaining).length > 0;
  const allDone = hasRemaining && Object.values(remaining).every(r => r === 0);

  if (isLive && !allDone) {
    return (
      <span className="lsh__badge lsh__badge--live">
        <span className="lsh__pulse" aria-hidden="true" />
        LIVE
      </span>
    );
  }

  if (isLive && allDone) {
    return <span className="lsh__badge lsh__badge--final">FINAL</span>;
  }

  return (
    <span className="lsh__badge lsh__badge--next">
      {getNextGameText(gameWindow)}
    </span>
  );
}

function TeamRow({ team, score, isLeading, isWinner, compact }: {
  team: TeamInfo | undefined;
  score: number | undefined;
  isLeading: boolean;
  isWinner: boolean;
  compact?: boolean;
}) {
  const nameContext = compact ? 'short' as const : 'default' as const;
  return (
    <div className="lsh__matchup-row">
      <div className="lsh__team">
        {team?.icon && (
          <img
            className="lsh__team-icon"
            src={team.icon}
            alt=""
            loading="lazy"
          />
        )}
        <span className={`lsh__team-name${isWinner ? ' lsh__team-name--winner' : ''}`}>
          {getTeamDisplayName(team, nameContext)}
        </span>
      </div>
      <span className={`lsh__score${isLeading ? ' lsh__score--leading' : ''}`}>
        {formatScore(score)}
      </span>
    </div>
  );
}

function MatchupCard({ matchup, teams, scores, isFeatured, userFranchiseId }: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  scores: Record<string, number>;
  isFeatured: boolean;
  userFranchiseId?: string;
}) {
  const homeScore = scores[matchup.home] ?? 0;
  const awayScore = scores[matchup.away] ?? 0;
  const homeLeading = homeScore > awayScore;
  const awayLeading = awayScore > homeScore;

  const className = isFeatured ? 'lsh__featured' : 'lsh__compact';

  return (
    <div className={className}>
      {isFeatured && userFranchiseId && (
        <span className="lsh__featured-badge" aria-label="Your matchup">
          &#9733; Your Matchup
        </span>
      )}
      <TeamRow
        team={teams[matchup.home]}
        score={homeScore}
        isLeading={homeLeading}
        isWinner={homeLeading && homeScore > 0}
        compact={!isFeatured}
      />
      <TeamRow
        team={teams[matchup.away]}
        score={awayScore}
        isLeading={awayLeading}
        isWinner={awayLeading && awayScore > 0}
        compact={!isFeatured}
      />
    </div>
  );
}

function ChampionshipLayout({ matchup, teams, scores }: {
  matchup: MatchupPairing;
  teams: Record<string, TeamInfo>;
  scores: Record<string, number>;
}) {
  const homeTeam = teams[matchup.home];
  const awayTeam = teams[matchup.away];
  const homeScore = scores[matchup.home] ?? 0;
  const awayScore = scores[matchup.away] ?? 0;
  const homeLeading = homeScore > awayScore;
  const awayLeading = awayScore > homeScore;

  return (
    <div className="lsh__championship">
      <div className="lsh__champ-team">
        {homeTeam?.icon && (
          <img className="lsh__champ-icon" src={homeTeam.icon} alt="" loading="lazy" />
        )}
        <span className="lsh__champ-name">{getTeamDisplayName(homeTeam)}</span>
        <span className={`lsh__champ-score${homeLeading ? ' lsh__champ-score--leading' : ''}`}>
          {formatScore(homeScore)}
        </span>
      </div>
      <span className="lsh__champ-vs">VS</span>
      <div className="lsh__champ-team">
        {awayTeam?.icon && (
          <img className="lsh__champ-icon" src={awayTeam.icon} alt="" loading="lazy" />
        )}
        <span className="lsh__champ-name">{getTeamDisplayName(awayTeam)}</span>
        <span className={`lsh__champ-score${awayLeading ? ' lsh__champ-score--leading' : ''}`}>
          {formatScore(awayScore)}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function LiveScoringHero(props: LiveScoringHeroProps) {
  const {
    week,
    phase,
    gameWindow,
    isLive,
    userFranchiseId,
    teams,
    initialScores,
    initialRemaining,
  } = props;

  const { scores, remaining, matchups } = useLiveScoring(
    week, isLive, initialScores, initialRemaining, props.matchups,
  );

  const isChampionship = phase === 'championship';
  const titlePrefix = isChampionship ? 'Championship' : getGameWindowLabel(gameWindow);

  // Find ALL user matchups (supports doubleheader weeks)
  const userMatchups = userFranchiseId
    ? matchups.filter(m => m.home === userFranchiseId || m.away === userFranchiseId)
    : [];

  // Other matchups (excluding all of the user's games)
  const userMatchupSet = new Set(userMatchups);
  const otherMatchups = matchups.filter(m => !userMatchupSet.has(m));

  // Sort others by interest and take enough to fill the compact grid
  const maxCompact = Math.max(0, 3 - (userMatchups.length > 0 ? userMatchups.length - 1 : 0));
  const interestingMatchups = sortByInterest(otherMatchups, scores).slice(0, maxCompact);

  // If no user matchups, promote the most interesting to featured
  const featured = userMatchups.length > 0
    ? userMatchups
    : [interestingMatchups.shift()].filter(Boolean) as MatchupPairing[];
  const compact = userMatchups.length > 0 ? interestingMatchups : interestingMatchups;

  if (matchups.length === 0) {
    return (
      <div className="lsh" aria-label={`Live scoring for Week ${week}`}>
        <div className="lsh__header">
          <h3 className="lsh__title">Live Scoring</h3>
          <StatusBadge isLive={isLive} remaining={remaining} gameWindow={gameWindow} />
        </div>
        <div className="lsh__empty">
          <p>Scores will appear when games begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lsh" aria-label={`Live scoring for Week ${week}`}>
      <div className="lsh__header">
        <h3 className="lsh__title">{titlePrefix} Scoring</h3>
        <StatusBadge isLive={isLive} remaining={remaining} gameWindow={gameWindow} />
      </div>

      {gameWindow && (
        <p className="lsh__window">{getGameWindowLabel(gameWindow)}</p>
      )}

      <div className="lsh__matchups" aria-live="polite">
        {/* Championship: single head-to-head */}
        {isChampionship && featured.length > 0 && (
          <>
            <span className="lsh__champ-label">The League Championship — Week {week}</span>
            <ChampionshipLayout
              matchup={featured[0]}
              teams={teams}
              scores={scores}
            />
          </>
        )}

        {/* Regular / Playoffs: featured matchup(s) + compact */}
        {!isChampionship && featured.map((m, i) => (
          <MatchupCard
            key={`featured-${m.home}-${m.away}`}
            matchup={m}
            teams={teams}
            scores={scores}
            isFeatured={true}
            userFranchiseId={i === 0 ? userFranchiseId : undefined}
          />
        ))}

        {!isChampionship && compact.length > 0 && (
          <div className="lsh__compact-grid">
            {compact.map(m => (
              <MatchupCard
                key={`${m.home}-${m.away}`}
                matchup={m}
                teams={teams}
                scores={scores}
                isFeatured={false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
