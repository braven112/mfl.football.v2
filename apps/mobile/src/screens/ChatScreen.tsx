import { ComingSoon } from '../components/ComingSoon';
import { TeamSwitcher } from '../components/TeamSwitcher';

/**
 * Placeholder until package N, league chat lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 * A tab screen: no params; the league comes from `useActiveTeam()`.
 */
export function ChatScreen() {
  return (
    <ComingSoon title="League chat">
      <TeamSwitcher />
    </ComingSoon>
  );
}
