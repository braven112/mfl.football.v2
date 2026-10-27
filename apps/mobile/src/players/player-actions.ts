/**
 * The hook the add/drop flow plugs into (package L).
 *
 * The Players tab and the player card show an Add button on a free agent only
 * when `usePlayerAdd()` returns a function, and call it with the player and
 * the league. Add opens the Waivers screen with the add/drop sheet up for that
 * player, so the claim lands next to the owner's other pending claims.
 */

import { useNavigation } from '@react-navigation/native';
import type { MflLiveAppPlayerSummary } from '@mfl/shared-types/mfl-live-app-k';

export type AddPlayer = (player: MflLiveAppPlayerSummary, leagueId: string) => void;

export function usePlayerAdd(): AddPlayer | null {
  const navigation = useNavigation();
  return (player, leagueId) =>
    navigation.navigate('Waivers', {
      leagueId,
      add: { id: player.id, name: player.name, position: player.position, team: player.team },
    });
}
