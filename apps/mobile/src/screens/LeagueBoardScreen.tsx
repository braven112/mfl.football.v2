import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { ComingSoon } from '../components/ComingSoon';

type Props = NativeStackScreenProps<RootStackParamList, 'LeagueBoard'>;

/** Placeholder until the League board package lands (docs/plans/mfl-live-store-app.md, P0-3). */
export function LeagueBoardScreen({ route }: Props) {
  return <ComingSoon title={route.params.leagueName ?? 'League board'} />;
}
