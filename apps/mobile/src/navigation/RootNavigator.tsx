import { DarkTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';
import { MatchupsScreen } from '../screens/MatchupsScreen';
import { StandingsScreen } from '../screens/StandingsScreen';
import { LeaguesScreen } from '../screens/LeaguesScreen';
import { LeagueBoardScreen } from '../screens/LeagueBoardScreen';
import { PairTvScreen } from '../screens/PairTvScreen';
import type { RootStackParamList, TabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

/** The Matchups screen predates the session context and still takes its session as props. */
function MatchupsTab() {
  const { token, signOut } = useSession();
  return <MatchupsScreen token={token} onSignOut={signOut} />;
}

function Tabs() {
  const t = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentText,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        // Text tabs for now: no icon set is bundled yet, so the icon slot is hidden.
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 13 },
        tabBarLabelPosition: 'beside-icon',
      }}
    >
      <Tab.Screen name="Matchups" component={MatchupsTab} />
      <Tab.Screen name="Standings" component={StandingsScreen} />
      <Tab.Screen name="Leagues" component={LeaguesScreen} />
    </Tab.Navigator>
  );
}

/** The signed-in app: the tabs, plus the screens that open on top of them. */
export function RootNavigator() {
  const t = useTheme();
  const navTheme: NavTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: t.accentText,
      background: t.ground,
      card: t.card,
      text: t.text,
      border: t.border,
      notification: t.accent,
    },
    fonts: {
      regular: { fontFamily: font.regular, fontWeight: 'normal' },
      medium: { fontFamily: font.medium, fontWeight: 'normal' },
      bold: { fontFamily: font.bold, fontWeight: 'normal' },
      heavy: { fontFamily: font.bold, fontWeight: 'normal' },
    },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerTitleStyle: { fontFamily: font.semibold },
          contentStyle: { backgroundColor: t.ground },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="LeagueBoard"
          component={LeagueBoardScreen}
          options={({ route }) => ({ title: route.params.leagueName ?? 'League' })}
        />
        <Stack.Screen name="PairTv" component={PairTvScreen} options={{ title: 'Pair a TV' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
