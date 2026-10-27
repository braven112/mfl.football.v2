import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package Q, commissioner actions lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function CommissionerScreen(_props: NativeStackScreenProps<RootStackParamList, 'Commissioner'>) {
  return <ComingSoon title="Commissioner" />;
}
