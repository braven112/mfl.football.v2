import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package R, the draft room lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function DraftScreen(_props: NativeStackScreenProps<RootStackParamList, 'Draft'>) {
  return <ComingSoon title="Draft room" />;
}
