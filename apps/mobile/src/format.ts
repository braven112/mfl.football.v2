import type { MflLiveAppBoard } from '@mfl/shared-types/mfl-live-app';

export function points(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function percent(p: number): string {
  return `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}

/**
 * Is any of the owner's games still being played? Read from MFL's own clock
 * (seconds remaining per starter), never invented: a board with nothing left
 * to play stops polling.
 */
export function anyGameLive(board: MflLiveAppBoard | null): boolean {
  if (!board) return false;
  return board.leagues.some((league) =>
    league.matchups.some((m) =>
      [m.mine, m.opponent].some((team) => team.players.some((p) => p.secondsRemaining > 0)),
    ),
  );
}

export function updatedAgo(fetchedAt: string | undefined, now: number): string {
  if (!fetchedAt) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 1000));
  if (seconds < 60) return 'Updated just now';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'Updated 1 minute ago' : `Updated ${minutes} minutes ago`;
}
