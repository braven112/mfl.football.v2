import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package M, trades lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function TradeBuilderScreen(_props: NativeStackScreenProps<RootStackParamList, 'TradeBuilder'>) {
  return <ComingSoon title="Propose a trade" />;
}
