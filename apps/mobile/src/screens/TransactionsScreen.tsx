import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package O, the transactions feed lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function TransactionsScreen(_props: NativeStackScreenProps<RootStackParamList, 'Transactions'>) {
  return <ComingSoon title="Transactions" />;
}
