import { ComingSoon } from '../components/ComingSoon';
import { TeamSwitcher } from '../components/TeamSwitcher';

/**
 * Placeholder until package P, the team page lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 * A tab screen: no params; the league comes from `useActiveTeam()`.
 */
export function MyTeamScreen() {
  return (
    <ComingSoon title="My Team">
      <TeamSwitcher />
    </ComingSoon>
  );
}
