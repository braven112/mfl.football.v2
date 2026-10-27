import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type {
  MflLiveAppPlayersResponse,
  MflLiveAppPlayersSort,
  MflLiveAppPlayersStatus,
  MflLiveAppPlayerSummary,
} from '@mfl/shared-types/mfl-live-app-k';
import { apiGet, SignedOutError } from '../api';
import { useActiveTeam } from '../active-team';
import { useSession } from '../session-context';
import { TeamSwitcher } from '../components/TeamSwitcher';
import { usePlayerAdd } from '../players/player-actions';
import { injuryBadge, ownerLine, playerLine, sortValue, SORT_LABEL } from '../players/format';
import { font, useTheme, type Theme } from '../theme';

const STATUS: { key: MflLiveAppPlayersStatus; label: string }[] = [
  { key: 'fa', label: 'Free agents' },
  { key: 'all', label: 'All players' },
  { key: 'trending', label: 'Trending' },
];
const SORTS: MflLiveAppPlayersSort[] = ['proj', 'pts', 'owned'];

/** Typing waits this long before asking the server, so a search is one request, not one per letter. */
const SEARCH_DEBOUNCE_MS = 400;

/**
 * The Players tab: free agents by default, a search over every player, and
 * MFL-wide trending adds, for the league the header chip names. Read only;
 * the Add button appears once the add/drop flow plugs into `usePlayerAdd`.
 */
export function PlayersScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { token, signOut } = useSession();
  const { team } = useActiveTeam();
  const onAdd = usePlayerAdd();

  const [status, setStatus] = useState<MflLiveAppPlayersStatus>('fa');
  const [sort, setSort] = useState<MflLiveAppPlayersSort>('proj');
  const [pos, setPos] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<MflLiveAppPlayersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed]);

  // A different league has different positions: start its filters fresh.
  useEffect(() => {
    setPos('');
    setData(null);
  }, [team?.leagueId]);

  const load = useCallback(async () => {
    if (!team) return;
    const mine = ++request.current;
    setLoading(true);
    const params = new URLSearchParams({ league: team.leagueId, status, sort });
    if (q) params.set('q', q);
    if (pos) params.set('pos', pos);
    try {
      const body = await apiGet<MflLiveAppPlayersResponse>(token, `/api/mfl-live/players?${params}`);
      if (mine !== request.current) return;
      setData(body);
      setError(null);
    } catch (e) {
      if (mine !== request.current) return;
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      // Keep the last list on screen; say why it may be out of date.
      setError(e instanceof Error ? e.message : 'Could not load players.');
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, [team, status, sort, q, pos, token, signOut]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const s = styles(t);

  if (!team) {
    return (
      <View style={[s.screen, s.center, { paddingTop: insets.top }]}>
        <Text style={s.muted}>No league to show players for yet.</Text>
      </View>
    );
  }

  const header = (
    <View>
      <TeamSwitcher />
      <TextInput
        value={typed}
        onChangeText={setTyped}
        placeholder="Search players"
        placeholderTextColor={t.muted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search players"
        style={s.search}
      />
      <ChipRow t={t}>
        {STATUS.map((o) => (
          <Chip key={o.key} t={t} label={o.label} active={status === o.key} onPress={() => setStatus(o.key)} />
        ))}
      </ChipRow>
      <ChipRow t={t}>
        <Chip t={t} label="All" active={pos === ''} onPress={() => setPos('')} />
        {(data?.positions ?? []).map((p) => (
          <Chip key={p} t={t} label={p} active={pos === p} onPress={() => setPos(p)} />
        ))}
      </ChipRow>
      {status !== 'trending' ? (
        <ChipRow t={t}>
          <Text style={[s.muted, s.sortBy]}>Sort</Text>
          {SORTS.map((k) => (
            <Chip key={k} t={t} label={SORT_LABEL[k]} active={sort === k} onPress={() => setSort(k)} />
          ))}
        </ChipRow>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <View style={s.columns}>
        <Text style={[s.muted, s.colName]}>
          {data ? `${data.total} player${data.total === 1 ? '' : 's'}` : loading ? 'Loading…' : ''}
        </Text>
        <Text style={[s.muted, s.colStat]}>{status === 'trending' ? 'Added' : SORT_LABEL[sort]}</Text>
      </View>
    </View>
  );

  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 24 }}
      data={data?.players ?? []}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={
        data && !loading ? <Text style={[s.muted, s.empty]}>No players match.</Text> : undefined
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      renderItem={({ item }) => (
        <PlayerRow
          t={t}
          player={item}
          stat={status === 'trending' ? (item.addedPct === null ? '–' : `${Math.round(item.addedPct)}%`) : sortValue(item, sort)}
          onPress={() => navigation.navigate('PlayerCard', { leagueId: team.leagueId, playerId: item.id })}
          onAdd={onAdd && item.isFreeAgent ? () => onAdd(item, team.leagueId) : undefined}
        />
      )}
    />
  );
}

function PlayerRow(props: {
  t: Theme;
  player: MflLiveAppPlayerSummary;
  stat: string;
  onPress: () => void;
  onAdd?: () => void;
}) {
  const { t, player, stat, onPress, onAdd } = props;
  const s = styles(t);
  const badge = injuryBadge(player.injury);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${player.name}, ${playerLine(player)}, ${ownerLine(player)}`}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.field }]}
    >
      <View style={s.colName}>
        <View style={s.nameLine}>
          <Text numberOfLines={1} style={s.name}>
            {player.name}
          </Text>
          {badge ? <Text style={s.badge}>{badge}</Text> : null}
        </View>
        <Text numberOfLines={1} style={s.muted}>
          {playerLine(player)}
        </Text>
        <Text numberOfLines={1} style={[s.owner, { color: player.isFreeAgent ? t.win : t.muted }]}>
          {ownerLine(player)}
        </Text>
      </View>
      <Text style={[s.stat, s.colStat]}>{stat}</Text>
      {onAdd ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${player.name}`} onPress={onAdd} hitSlop={8} style={s.add}>
          <Text style={s.addText}>Add</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function ChipRow({ t, children }: { t: Theme; children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles(t).chips}>
      {children}
    </ScrollView>
  );
}

function Chip(props: { t: Theme; label: string; active: boolean; onPress: () => void }) {
  const { t, label, active, onPress } = props;
  const s = styles(t);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.chip, active && { backgroundColor: t.accent, borderColor: t.accent }]}
    >
      <Text style={[s.chipText, { color: active ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
    muted: { fontFamily: font.regular, fontSize: 13, color: t.muted },
    search: {
      fontFamily: font.regular,
      fontSize: 16,
      color: t.text,
      backgroundColor: t.field,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginHorizontal: 16,
      marginBottom: 8,
    },
    chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 4, alignItems: 'center' },
    chip: { borderWidth: 1, borderColor: t.border, backgroundColor: t.card, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontFamily: font.medium, fontSize: 14 },
    sortBy: { marginRight: 2 },
    error: { fontFamily: font.regular, fontSize: 13, color: t.danger, marginHorizontal: 16, marginTop: 8 },
    columns: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
    },
    colName: { flex: 1, minWidth: 0 },
    colStat: { width: 72, textAlign: 'right' },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { fontFamily: font.semibold, fontSize: 16, color: t.text, flexShrink: 1 },
    badge: { fontFamily: font.bold, fontSize: 11, color: t.danger },
    owner: { fontFamily: font.regular, fontSize: 12, marginTop: 1 },
    stat: { fontFamily: font.semibold, fontSize: 16, color: t.text },
    empty: { textAlign: 'center', padding: 24 },
    add: { borderRadius: 8, backgroundColor: t.accent, paddingVertical: 6, paddingHorizontal: 12 },
    addText: { fontFamily: font.semibold, fontSize: 14, color: t.onAccent },
  });
