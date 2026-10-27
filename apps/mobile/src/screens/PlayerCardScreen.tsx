import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package K, players and free agents lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function PlayerCardScreen(_props: NativeStackScreenProps<RootStackParamList, 'PlayerCard'>) {
  return <ComingSoon title="Player" />;
}
