import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MflLiveAppFiledClaim, MflLiveAppWaivers } from '@mfl/shared-types/mfl-live-app-l';
import { SignedOutError } from '../api';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { dropPlayer, fetchWaivers, formatMoney, manageClaim } from '../waivers/api';

type Props = NativeStackScreenProps<RootStackParamList, 'Waivers'>;

/**
 * Waivers (package L): the window MFL says is open, your FAAB balance, the
 * claims you have filed (cancel one, or change who it drops), and dropping a
 * player outright. New claims start from Add on a free agent (the Players tab).
 *
 * There is no reordering: MFL has no way to reorder a round, and a
 * delete-then-refile would leave a moment with no claim at all.
 */
export function WaiversScreen({ route, navigation }: Props) {
  const { leagueId } = route.params;
  const t = useTheme();
  const { token, signOut } = useSession();
  const [data, setData] = useState<MflLiveAppWaivers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The claim whose drop is being changed, or 'cut' for a plain drop. */
  const [picking, setPicking] = useState<MflLiveAppFiledClaim | 'cut' | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchWaivers(token, leagueId));
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      // Keep what is on screen; say why it could not refresh.
      setError(e instanceof Error ? e.message : 'Could not load your waivers.');
    }
  }, [token, leagueId, signOut]);

  useEffect(() => {
    navigation.setOptions({ title: 'Waivers' });
    void load();
  }, [load, navigation]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function run(key: string, action: () => Promise<{ message: string }>) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.message);
      await load();
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      setNotice(e instanceof Error ? e.message : 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  }

  function cancelClaim(claim: MflLiveAppFiledClaim) {
    Alert.alert('Cancel this claim?', `${claim.addName ?? 'This player'} will come off your round ${claim.round} claims.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel claim',
        style: 'destructive',
        onPress: () =>
          void run(`del-${claim.round}-${claim.addPlayerId}`, () =>
            manageClaim(token, leagueId, { action: 'delete', round: claim.round, addPlayerId: claim.addPlayerId }),
          ),
      },
    ]);
  }

  function pick(playerId: string | null, name: string) {
    const target = picking;
    setPicking(null);
    if (!target) return;
    if (target === 'cut') {
      if (!playerId) return;
      Alert.alert(`Drop ${name}?`, `${name} goes to free agency right away. This can't be undone from the app.`, [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Drop',
          style: 'destructive',
          onPress: () =>
            void run(`cut-${playerId}`, () => dropPlayer(token, leagueId, { playerId, year: data?.context.year })),
        },
      ]);
      return;
    }
    void run(`edit-${target.round}-${target.addPlayerId}`, () =>
      manageClaim(token, leagueId, {
        action: 'editDrop',
        round: target.round,
        addPlayerId: target.addPlayerId,
        dropPlayerId: playerId,
        comment: target.comment,
      }),
    );
  }

  if (!data && !error) {
    return (
      <View style={[styles.center, { backgroundColor: t.ground }]}>
        <ActivityIndicator color={t.accentText} />
      </View>
    );
  }

  const context = data?.context;
  const rounds = new Map<string, MflLiveAppFiledClaim[]>();
  for (const claim of data?.claims ?? []) rounds.set(claim.round, [...(rounds.get(claim.round) ?? []), claim]);
  const money = (n: number) => formatMoney(n, context?.rules.increment ?? 1);

  return (
    <View style={[styles.screen, { backgroundColor: t.ground }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accentText} />}
      >
        {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
        {notice ? <Text style={[styles.notice, { color: t.text, backgroundColor: t.field }]}>{notice}</Text> : null}

        {context ? (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.cardTitle, { color: t.text }]}>
              {context.windowMode === 'fcfs' ? 'First come, first served' : 'Waivers'}
            </Text>
            <Text style={[styles.muted, { color: t.muted }]}>{context.windowLabel}</Text>
            <View style={styles.stats}>
              {context.balance !== undefined ? (
                <Stat label="FAAB left" value={money(context.balance)} />
              ) : (
                <Stat label="System" value="Waiver priority" />
              )}
              {context.rosterLimit !== undefined && context.activeRosterCount !== undefined ? (
                <Stat label="Roster" value={`${context.activeRosterCount}/${context.rosterLimit}`} />
              ) : null}
              {context.rules.blindBid ? <Stat label="Min bid" value={money(context.rules.minimum)} /> : null}
            </View>
            <Text style={[styles.muted, { color: t.muted }]}>
              To add someone, tap Add on a free agent in the Players tab.
            </Text>
          </View>
        ) : null}

        <Text style={[styles.heading, { color: t.text }]}>Your claims</Text>
        {data?.claims === null ? (
          <Text style={[styles.muted, { color: t.muted }]}>MFL didn't return your pending claims. Pull down to try again.</Text>
        ) : rounds.size === 0 ? (
          <Text style={[styles.muted, { color: t.muted }]}>No pending claims.</Text>
        ) : (
          [...rounds.entries()].map(([round, claims]) => (
            <View key={round} style={styles.round}>
              {rounds.size > 1 || round !== '1' ? (
                <Text style={[styles.roundLabel, { color: t.muted }]}>Round {round}</Text>
              ) : null}
              {claims.map((claim, i) => {
                const key = `${claim.round}-${claim.addPlayerId}`;
                return (
                  <View key={key} style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                    <View style={styles.claimTop}>
                      <Text style={[styles.priority, { color: t.muted }]}>{i + 1}</Text>
                      <View style={styles.claimNames}>
                        <Text style={[styles.add, { color: t.text }]}>
                          Add {claim.addName ?? claim.addPlayerId}
                          <Text style={[styles.meta, { color: t.muted }]}>
                            {'  '}
                            {[claim.addPosition, claim.addNflTeam].filter(Boolean).join(' ')}
                          </Text>
                        </Text>
                        <Text style={[styles.drop, { color: t.muted }]}>
                          {claim.dropPlayerId ? `Drop ${claim.dropName ?? claim.dropPlayerId}` : 'No drop'}
                        </Text>
                      </View>
                      {claim.bid !== null ? <Text style={[styles.bid, { color: t.accentText }]}>{money(claim.bid)}</Text> : null}
                    </View>
                    <View style={styles.claimActions}>
                      <SmallButton label="Change drop" busy={busy === `edit-${key}`} onPress={() => setPicking(claim)} />
                      <SmallButton label="Cancel" danger busy={busy === `del-${key}`} onPress={() => cancelClaim(claim)} />
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}

        {context && context.roster.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPicking('cut')}
            style={[styles.cutButton, { borderColor: t.border, backgroundColor: t.card }]}
          >
            {busy?.startsWith('cut-') ? (
              <ActivityIndicator color={t.accentText} />
            ) : (
              <Text style={[styles.cutText, { color: t.text }]}>Drop a player</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={[styles.backdrop, { backgroundColor: t.scrim }]} onPress={() => setPicking(null)}>
          <View style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.cardTitle, { color: t.text }]}>
              {picking === 'cut' ? 'Drop which player?' : 'Drop instead'}
            </Text>
            <ScrollView>
              {[
                ...(picking === 'cut' ? [] : [{ id: '', name: 'Nobody', slot: 'active' as const }]),
                ...(context?.roster ?? []),
              ].map((p) => (
                <Pressable
                  key={p.id || 'none'}
                  accessibilityRole="button"
                  onPress={() => pick(p.id || null, p.name)}
                  style={[styles.pickRow, { borderColor: t.border }]}
                >
                  <Text style={[styles.pickName, { color: t.text }]}>{p.name}</Text>
                  {p.slot !== 'active' ? (
                    <Text style={[styles.meta, { color: t.muted }]}>{p.slot === 'ir' ? 'IR' : 'Taxi'}</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: t.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

function SmallButton({ label, onPress, busy, danger }: { label: string; onPress: () => void; busy?: boolean; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[styles.small, { borderColor: danger ? t.danger : t.border }]}
    >
      {busy ? (
        <ActivityIndicator color={t.accentText} />
      ) : (
        <Text style={[styles.smallText, { color: danger ? t.danger : t.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  error: { fontFamily: font.medium, fontSize: 14 },
  notice: { fontFamily: font.medium, fontSize: 14, padding: 12, borderRadius: 8, overflow: 'hidden' },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  cardTitle: { fontFamily: font.bold, fontSize: 18 },
  muted: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: 24, marginVertical: 4 },
  stat: { gap: 2 },
  statValue: { fontFamily: font.bold, fontSize: 18 },
  statLabel: { fontFamily: font.regular, fontSize: 12 },
  heading: { fontFamily: font.bold, fontSize: 18, marginTop: 8 },
  round: { gap: 8 },
  roundLabel: { fontFamily: font.semibold, fontSize: 13 },
  claimTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  priority: { fontFamily: font.bold, fontSize: 16, width: 18 },
  claimNames: { flex: 1, gap: 2 },
  add: { fontFamily: font.semibold, fontSize: 16 },
  meta: { fontFamily: font.regular, fontSize: 13 },
  drop: { fontFamily: font.regular, fontSize: 14 },
  bid: { fontFamily: font.bold, fontSize: 16 },
  claimActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  small: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, minWidth: 90, alignItems: 'center' },
  smallText: { fontFamily: font.semibold, fontSize: 14 },
  cutButton: { borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  cutText: { fontFamily: font.semibold, fontSize: 16 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  sheet: { maxHeight: '75%', borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  pickRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  pickName: { fontFamily: font.medium, fontSize: 15 },
});
