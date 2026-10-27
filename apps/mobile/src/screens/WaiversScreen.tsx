import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ComingSoon } from '../components/ComingSoon';
import type { RootStackParamList } from '../navigation/types';

/**
 * Placeholder until package L, add/drop and waivers lands
 * (/mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 */
export function WaiversScreen(_props: NativeStackScreenProps<RootStackParamList, 'Waivers'>) {
  return <ComingSoon title="Waivers" />;
}
