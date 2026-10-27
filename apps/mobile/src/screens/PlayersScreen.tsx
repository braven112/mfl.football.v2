import { ComingSoon } from '../components/ComingSoon';
import { TeamSwitcher } from '../components/TeamSwitcher';

/**
 * Placeholder until package K, players and free agents lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 * A tab screen: no params; the league comes from `useActiveTeam()`.
 */
export function PlayersScreen() {
  return (
    <ComingSoon title="Players">
      <TeamSwitcher />
    </ComingSoon>
  );
}
