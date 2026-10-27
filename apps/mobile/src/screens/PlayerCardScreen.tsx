import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MflLiveAppPlayerCardResponse } from '@mfl/shared-types/mfl-live-app-k';
import { apiGet, SignedOutError } from '../api';
import { useSession } from '../session-context';
import { usePlayerAdd } from '../players/player-actions';
import { ownerLine, pct, playerLine, stat } from '../players/format';
import type { RootStackParamList } from '../navigation/types';
import { font, useTheme, type Theme } from '../theme';

/**
 * One player's card: status, bye, this week's projection, season points,
 * MFL-wide owned and added %, who has him in this league, and every scored
 * week, all under the league's own scoring. Text only: no photo, no club mark.
 */
export function PlayerCardScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'PlayerCard'>) {
  const { leagueId, playerId } = route.params;
  const t = useTheme();
  const s = styles(t);
  const { token, signOut } = useSession();
  const onAdd = usePlayerAdd();
  const [card, setCard] = useState<MflLiveAppPlayerCardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ league: leagueId, id: playerId });
    try {
      const body = await apiGet<MflLiveAppPlayerCardResponse>(token, `/api/mfl-live/player?${params}`);
      setCard(body);
      setError(null);
      navigation.setOptions({ title: body.player.name });
    } catch (e) {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not load this player.');
    }
  }, [leagueId, playerId, token, signOut, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const p = card?.player;
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
    >
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!p ? (
        !error ? <Text style={s.muted}>Loading…</Text> : null
      ) : (
        <>
          <Text style={s.name}>{p.name}</Text>
          <Text style={s.line}>{playerLine(p)}</Text>
          <Text style={[s.owner, { color: p.isFreeAgent ? t.win : t.muted }]}>{ownerLine(p)}</Text>

          {card.injuryDetail ? (
            <View style={s.injury}>
              <Text style={s.injuryText}>
                {[card.injuryDetail.status, card.injuryDetail.bodyPart].filter(Boolean).join(' · ')}
              </Text>
              {card.injuryDetail.expectedReturn ? (
                <Text style={s.muted}>Expected back {card.injuryDetail.expectedReturn}</Text>
              ) : null}
            </View>
          ) : null}

          {onAdd && p.isFreeAgent ? (
            <Pressable accessibilityRole="button" onPress={() => onAdd(p, leagueId)} style={s.add}>
              <Text style={s.addText}>Add {p.name}</Text>
            </Pressable>
          ) : null}

          <View style={s.tiles}>
            <Tile t={t} label={card.week > 0 ? `Week ${card.week} proj.` : 'Projected'} value={stat(p.projected)} />
            <Tile t={t} label="Season pts" value={stat(p.points)} />
            <Tile t={t} label="Owned" value={pct(p.ownedPct)} />
            <Tile t={t} label="Added" value={pct(p.addedPct)} />
          </View>

          <Text style={s.section}>Weekly points</Text>
          {card.weeks.length === 0 ? (
            <Text style={s.muted}>No points scored yet this season.</Text>
          ) : (
            card.weeks.map((w) => (
              <View key={w.week} style={s.weekRow}>
                <Text style={s.weekLabel}>Week {w.week}</Text>
                <Text style={s.weekPoints}>{stat(w.points)}</Text>
              </View>
            ))
          )}
          <Text style={[s.muted, s.note]}>Points and projections use this league's scoring. Owned and added are across all MFL leagues.</Text>
        </>
      )}
    </ScrollView>
  );
}

function Tile({ t, label, value }: { t: Theme; label: string; value: string }) {
  const s = styles(t);
  return (
    <View style={s.tile}>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { padding: 16, paddingBottom: 32 },
    muted: { fontFamily: font.regular, fontSize: 13, color: t.muted },
    error: { fontFamily: font.regular, fontSize: 13, color: t.danger, marginBottom: 8 },
    name: { fontFamily: font.bold, fontSize: 24, color: t.text },
    line: { fontFamily: font.medium, fontSize: 15, color: t.muted, marginTop: 4 },
    owner: { fontFamily: font.semibold, fontSize: 14, marginTop: 6 },
    injury: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, gap: 2 },
    injuryText: { fontFamily: font.semibold, fontSize: 14, color: t.danger },
    add: { marginTop: 14, borderRadius: 10, backgroundColor: t.accent, paddingVertical: 12, alignItems: 'center' },
    addText: { fontFamily: font.semibold, fontSize: 16, color: t.onAccent },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
    tile: { flexGrow: 1, flexBasis: '45%', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card },
    tileValue: { fontFamily: font.bold, fontSize: 20, color: t.text },
    tileLabel: { fontFamily: font.regular, fontSize: 12, color: t.muted, marginTop: 2 },
    section: { fontFamily: font.bold, fontSize: 17, color: t.text, marginTop: 20, marginBottom: 6 },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
    },
    weekLabel: { fontFamily: font.regular, fontSize: 15, color: t.text },
    weekPoints: { fontFamily: font.semibold, fontSize: 15, color: t.text },
    note: { marginTop: 16 },
  });
