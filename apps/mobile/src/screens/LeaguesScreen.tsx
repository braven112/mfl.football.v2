import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ComingSoon } from '../components/ComingSoon';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

/**
 * Placeholder until the "Which leagues to watch" package lands
 * (docs/plans/mfl-live-store-app.md, P0-5). The Pair a TV entry and Sign out
 * live here and should stay when this screen is replaced.
 */
export function LeaguesScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const { signOut } = useSession();
  return (
    <ComingSoon title="Your leagues">
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('PairTv')}
        style={[styles.button, { borderColor: t.border, backgroundColor: t.card }]}
      >
        <Text style={[styles.buttonText, { color: t.text }]}>Pair a TV</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={signOut} hitSlop={12}>
        <Text style={[styles.signOut, { color: t.muted }]}>Sign out</Text>
      </Pressable>
    </ComingSoon>
  );
}

const styles = StyleSheet.create({
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, marginTop: 12 },
  buttonText: { fontFamily: font.semibold, fontSize: 16 },
  signOut: { fontFamily: font.regular, fontSize: 14, marginTop: 8 },
});
