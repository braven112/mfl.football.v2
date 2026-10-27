import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package J, set lineup lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function SetLineupScreen(_props: NativeStackScreenProps<RootStackParamList, 'SetLineup'>) {
  return <ComingSoon title="Set lineup" />;
}
