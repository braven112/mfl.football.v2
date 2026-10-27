import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useActiveTeam } from '../active-team';
import { font, useTheme } from '../theme';

/**
 * The header chip that says which league and team the screen acts on, and
 * opens a list to switch. Hidden when the account has only one team.
 */
export function TeamSwitcher() {
  const t = useTheme();
  const { team, teams, selectLeague } = useActiveTeam();
  const [open, setOpen] = useState(false);
  if (!team) return null;
  const canSwitch = teams.length > 1;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${team.leagueName}, ${team.franchiseName || 'your team'}${canSwitch ? '. Switch league' : ''}`}
        disabled={!canSwitch}
        onPress={() => setOpen(true)}
        style={[styles.chip, { backgroundColor: t.card, borderColor: t.border }]}
      >
        <Text numberOfLines={1} style={[styles.league, { color: t.text }]}>
          {team.leagueName}
        </Text>
        {team.franchiseName ? (
          <Text numberOfLines={1} style={[styles.team, { color: t.muted }]}>
            {team.franchiseName}
          </Text>
        ) : null}
        {canSwitch ? <Text style={[styles.caret, { color: t.accentText }]}>Switch</Text> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: t.scrim }]} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>Your leagues</Text>
            <ScrollView>
              {teams.map((option) => {
                const active = option.leagueId === team.leagueId;
                return (
                  <Pressable
                    key={option.leagueId}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      selectLeague(option.leagueId);
                      setOpen(false);
                    }}
                    style={[styles.row, { borderColor: t.border }, active && { backgroundColor: t.field }]}
                  >
                    <Text style={[styles.rowLeague, { color: active ? t.accentText : t.text }]}>{option.leagueName}</Text>
                    {option.franchiseName ? (
                      <Text style={[styles.rowTeam, { color: t.muted }]}>{option.franchiseName}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  league: { fontFamily: font.semibold, fontSize: 14, flexShrink: 1 },
  team: { fontFamily: font.regular, fontSize: 13, flexShrink: 1 },
  caret: { fontFamily: font.semibold, fontSize: 13 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  sheet: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, maxHeight: '70%' },
  sheetTitle: { fontFamily: font.bold, fontSize: 18, paddingHorizontal: 16, paddingBottom: 8 },
  row: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  rowLeague: { fontFamily: font.semibold, fontSize: 16 },
  rowTeam: { fontFamily: font.regular, fontSize: 14, marginTop: 2 },
});
