import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useActiveTeam } from '../active-team';
import { TeamSwitcher } from '../components/TeamSwitcher';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

type Row = { label: string; hint?: string; onPress: () => void; disabled?: boolean };

/**
 * Everything that is not a tab. League-scoped rows open for the league in
 * the switcher at the top; they are disabled until the account's leagues load.
 */
export function MoreScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const { signOut } = useSession();
  const { team } = useActiveTeam();
  const leagueId = team?.leagueId;

  const leagueRows: Row[] = [
    { label: 'Transactions', onPress: () => leagueId && navigation.navigate('Transactions', { leagueId }) },
    { label: 'Trades', onPress: () => leagueId && navigation.navigate('Trades', { leagueId }) },
    { label: 'Waivers', onPress: () => leagueId && navigation.navigate('Waivers', { leagueId }) },
    { label: 'Draft room', onPress: () => leagueId && navigation.navigate('Draft', { leagueId }) },
    // Package Q shows this only to the league's commissioner, once it can tell.
    { label: 'Commissioner', onPress: () => leagueId && navigation.navigate('Commissioner', { leagueId }) },
  ].map((r) => ({ ...r, disabled: !leagueId }));

  const appRows: Row[] = [
    { label: 'Standings', hint: 'Every league you watch', onPress: () => navigation.navigate('Standings') },
    { label: 'Leagues to watch', onPress: () => navigation.navigate('Leagues') },
    { label: 'Pair a TV', onPress: () => navigation.navigate('PairTv') },
  ];

  const section = (title: string, rows: Row[]) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.muted }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: t.card, borderColor: t.border }]}>
        {rows.map((row, i) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!row.disabled }}
            disabled={row.disabled}
            onPress={row.onPress}
            style={[styles.row, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <Text style={[styles.label, { color: row.disabled ? t.muted : t.text }]}>{row.label}</Text>
            {row.hint ? <Text style={[styles.hint, { color: t.muted }]}>{row.hint}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={styles.content}>
      <TeamSwitcher />
      {section('This league', leagueRows)}
      {section('MFL Football', appRows)}
      <Pressable accessibilityRole="button" onPress={signOut} hitSlop={12} style={styles.signOut}>
        <Text style={[styles.signOutText, { color: t.muted }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 12, gap: 8 },
  section: { paddingHorizontal: 16, gap: 6, marginTop: 8 },
  sectionTitle: { fontFamily: font.semibold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { paddingVertical: 14, paddingHorizontal: 16 },
  label: { fontFamily: font.semibold, fontSize: 16 },
  hint: { fontFamily: font.regular, fontSize: 13, marginTop: 2 },
  signOut: { alignSelf: 'center', marginTop: 20 },
  signOutText: { fontFamily: font.regular, fontSize: 14 },
});
