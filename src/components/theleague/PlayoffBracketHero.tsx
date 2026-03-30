/**
 * PlayoffBracketHero — React island for the compact championship bracket display.
 *
 * Rendered by SeasonDailyHero when phase === 'playoffs' && slot === 'standings'
 * (Monday pre-game during Weeks 15-16). Shows who's still alive in the bracket
 * with user-aware highlighting.
 */

import type { PlayoffBracketSummaryGame } from '../../types/hero-state';

interface PlayoffBracketHeroProps {
  leagueYear: number;
  userFranchiseId?: string;
  userIsEliminated?: boolean;
  bracketSummary: PlayoffBracketSummaryGame[];
}

type TeamSlot = PlayoffBracketSummaryGame['home'];

function TeamSlotRow({ team, isUser, isWinner }: {
  team: TeamSlot;
  isUser: boolean;
  isWinner: boolean;
}) {
  return (
    <div className={`plhero__team-row${isWinner ? ' plhero__team-row--winner' : ''}${isUser ? ' plhero__team-row--user' : ''}`}>
      <div className="plhero__team-info">
        {team.icon && (
          <img className="plhero__team-icon" src={team.icon} alt="" loading="lazy" />
        )}
        <span className="plhero__seed">{team.seed ?? '?'}</span>
        <span className="plhero__team-name">{team.displayName}</span>
        {isUser && <span className="plhero__you-badge" aria-label="Your team">&#9733; You</span>}
      </div>
      {team.points != null && (
        <span className={`plhero__score${isWinner ? ' plhero__score--winner' : ''}`}>
          {team.points.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function GameCard({ game, userFranchiseId }: {
  game: PlayoffBracketSummaryGame;
  userFranchiseId?: string;
}) {
  const homeIsUser = !!userFranchiseId && game.home.franchiseId === userFranchiseId;
  const awayIsUser = !!userFranchiseId && game.away.franchiseId === userFranchiseId;
  const hasUser = homeIsUser || awayIsUser;

  const homeWinning = game.home.points != null && game.away.points != null && game.home.points > game.away.points;
  const awayWinning = game.home.points != null && game.away.points != null && game.away.points > game.home.points;

  return (
    <div className={`plhero__game${hasUser ? ' plhero__game--user' : ''}`}>
      <TeamSlotRow team={game.home} isUser={homeIsUser} isWinner={homeWinning} />
      <TeamSlotRow team={game.away} isUser={awayIsUser} isWinner={awayWinning} />
    </div>
  );
}

export default function PlayoffBracketHero({
  leagueYear,
  userFranchiseId,
  userIsEliminated,
  bracketSummary,
}: PlayoffBracketHeroProps) {
  // Group games by round week
  const roundMap = new Map<number, PlayoffBracketSummaryGame[]>();
  for (const game of bracketSummary) {
    const existing = roundMap.get(game.roundWeek) ?? [];
    existing.push(game);
    roundMap.set(game.roundWeek, existing);
  }
  const rounds = [...roundMap.entries()].sort(([a], [b]) => a - b);

  const roundLabels: Record<number, string> = {};
  if (rounds.length === 3) {
    roundLabels[rounds[0][0]] = 'Quarterfinals';
    roundLabels[rounds[1][0]] = 'Semifinals';
    roundLabels[rounds[2][0]] = 'Championship';
  } else if (rounds.length === 2) {
    roundLabels[rounds[0][0]] = 'Semifinals';
    roundLabels[rounds[1][0]] = 'Championship';
  }

  return (
    <div className="plhero" aria-label="Playoff bracket">
      <div className="plhero__header">
        <h3 className="plhero__title">Playoff Bracket</h3>
        {userIsEliminated && userFranchiseId && (
          <span className="plhero__eliminated-badge">Eliminated</span>
        )}
      </div>

      <div className="plhero__bracket">
        {rounds.map(([week, games]) => (
          <div key={week} className="plhero__round">
            <span className="plhero__round-label">
              {roundLabels[week] ?? `Week ${week}`}
            </span>
            <div className="plhero__round-games">
              {games.map(game => (
                <GameCard
                  key={game.gameId}
                  game={game}
                  userFranchiseId={!userIsEliminated ? userFranchiseId : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <a href="/theleague/playoffs" className="plhero__cta">
        View Full Bracket
      </a>
    </div>
  );
}
