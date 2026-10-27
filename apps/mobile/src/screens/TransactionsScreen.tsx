import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  MflLiveAppTransaction,
  MflLiveAppTransactionsFeed,
  MflLiveAppTxPlayer,
  MflLiveAppTxTradeSide,
} from '@mfl/shared-types/mfl-live-app-o';
import type { RootStackParamList } from '../navigation/types';
import { apiGet, SignedOutError } from '../api';
import { useSession } from '../session-context';
import { font, useTheme, type Theme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Transactions'>;

type Filter = 'all' | 'adds' | 'trades' | 'mine';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'adds', label: 'Adds & drops' },
  { key: 'trades', label: 'Trades' },
  { key: 'mine', label: 'My team' },
];

const KIND_LABEL: Record<MflLiveAppTransaction['kind'], string> = {
  'free-agent': 'Free agent',
  waiver: 'Waiver',
  'blind-bid': 'Blind bid',
  auction: 'Auction',
  trade: 'Trade',
};

/** A row in the list: a day header or a move. */
type Item = { type: 'day'; key: string; label: string } | { type: 'tx'; key: string; tx: MflLiveAppTransaction };

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Whole dollars unless the league bids in cents. */
function money(amount: number): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;
}

function withDays(transactions: MflLiveAppTransaction[]): Item[] {
  const items: Item[] = [];
  let lastDay = '';
  for (const tx of transactions) {
    const day = new Date(tx.at).toDateString();
    if (day !== lastDay) {
      items.push({ type: 'day', key: `day-${day}`, label: dayLabel(tx.at) });
      lastDay = day;
    }
    items.push({ type: 'tx', key: tx.id, tx });
  }
  return items;
}

/**
 * One league's adds, drops, waiver claims and trades, newest first, like the
 * web's /transactions. The server does the parsing and naming; this screen
 * only lays it out, and asks for older moves as you scroll.
 */
export function TransactionsScreen({ route }: Props) {
  const { leagueId } = route.params;
  const { token, signOut } = useSession();
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<MflLiveAppTransaction[]>([]);
  const [feed, setFeed] = useState<MflLiveAppTransactionsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Drops an answer for a filter the owner has already moved off.
  const request = useRef(0);

  const path = useCallback(
    (before: string | null) =>
      `/api/mfl-live/transactions?league=${encodeURIComponent(leagueId)}&filter=${filter}` +
      (before ? `&before=${encodeURIComponent(before)}` : ''),
    [leagueId, filter],
  );

  const loadFirst = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await apiGet<MflLiveAppTransactionsFeed>(token, path(null));
      if (id !== request.current) return;
      setFeed(next);
      setRows(next.transactions);
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      if (id !== request.current) return;
      // Keep whatever is already on screen; say it could not refresh.
      setError(e instanceof Error ? e.message : 'Could not load transactions.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [token, path, signOut]);

  useEffect(() => {
    setLoading(true);
    setRows([]);
    setFeed(null);
    loadFirst();
  }, [loadFirst]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirst();
    setRefreshing(false);
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    const before = feed?.nextBefore;
    if (!before || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const next = await apiGet<MflLiveAppTransactionsFeed>(token, path(before));
      if (id !== request.current) return;
      setFeed(next);
      setRows((prev) => [...prev, ...next.transactions]);
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      // Scrolling to the end again retries.
    } finally {
      setLoadingMore(false);
    }
  }, [feed, loadingMore, token, path, signOut]);

  const items = withDays(rows);

  return (
    <View style={[styles.screen, { backgroundColor: t.ground }]}>
      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable
              key={f.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : t.card }]}
            >
              <Text style={[styles.chipText, { color: on ? t.onAccent : t.text }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) =>
          item.type === 'day' ? (
            <Text style={[styles.day, { color: t.muted }]}>{item.label}</Text>
          ) : (
            <TransactionCard tx={item.tx} t={t} />
          )
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={t.accent} style={styles.spinner} />
          ) : error ? null : (
            <Text style={[styles.empty, { color: t.muted }]}>
              {filter === 'all'
                ? `No moves in ${feed?.leagueName ?? 'this league'} yet this ${feed?.year ?? ''} season.`
                : 'Nothing matches this filter yet.'}
            </Text>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={t.accent} style={styles.spinner} /> : null}
      />
    </View>
  );
}

function TransactionCard({ tx, t }: { tx: MflLiveAppTransaction; t: Theme }) {
  const mine = tx.trade ? tx.trade.sides.some((s) => s.team.mine) : tx.team.mine;
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: mine ? t.accent : t.border }]}>
      <View style={styles.cardHead}>
        <Text style={[styles.kind, { color: t.accentText }]}>
          {KIND_LABEL[tx.kind]}
          {tx.amount !== null ? `  ·  ${money(tx.amount)}` : ''}
          {tx.byCommish ? '  ·  by commissioner' : ''}
        </Text>
        <Text style={[styles.time, { color: t.muted }]}>{timeLabel(tx.at)}</Text>
      </View>

      {tx.trade ? (
        <>
          {tx.trade.sides.map((side, i) => (
            <TradeSide key={side.team.franchiseId + i} side={side} other={tx.trade!.sides[1 - i]} t={t} />
          ))}
          {tx.trade.comments ? (
            <Text style={[styles.comment, { color: t.muted }]}>“{tx.trade.comments}”</Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={[styles.team, { color: t.text }]}>{tx.team.name}</Text>
          {tx.added.map((p) => (
            <PlayerLine key={`a${p.id}`} sign="+" player={p} t={t} tone={t.win} />
          ))}
          {tx.dropped.map((p) => (
            <PlayerLine key={`d${p.id}`} sign="–" player={p} t={t} tone={t.danger} />
          ))}
        </>
      )}
    </View>
  );
}

/** One side gives these up; the other side receives them. */
function TradeSide({ side, other, t }: { side: MflLiveAppTxTradeSide; other: MflLiveAppTxTradeSide; t: Theme }) {
  return (
    <View style={styles.side}>
      <Text style={[styles.team, { color: t.text }]}>{other.team.name} gets</Text>
      {side.players.map((p) => (
        <PlayerLine key={p.id} sign="+" player={p} t={t} tone={t.win} />
      ))}
      {side.picks.map((pick) => (
        <Text key={pick} style={[styles.player, { color: t.text }]}>
          <Text style={{ color: t.win }}>+ </Text>
          {pick}
        </Text>
      ))}
      {side.players.length === 0 && side.picks.length === 0 ? (
        <Text style={[styles.player, { color: t.muted }]}>Nothing</Text>
      ) : null}
    </View>
  );
}

function PlayerLine({ sign, player, t, tone }: { sign: string; player: MflLiveAppTxPlayer; t: Theme; tone: string }) {
  const meta = [player.position, player.nflTeam].filter(Boolean).join(' · ');
  return (
    <Text style={[styles.player, { color: t.text }]}>
      <Text style={{ color: tone }}>{sign} </Text>
      {player.name}
      {meta ? <Text style={{ color: t.muted }}>{`  ${meta}`}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontFamily: font.medium, fontSize: 13 },
  error: { fontFamily: font.regular, fontSize: 13, paddingHorizontal: 16, paddingTop: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  day: {
    fontFamily: font.bold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, gap: 4 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  kind: { fontFamily: font.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  time: { fontFamily: font.regular, fontSize: 12 },
  team: { fontFamily: font.semibold, fontSize: 15, marginTop: 2 },
  side: { gap: 2, marginTop: 2 },
  player: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  comment: { fontFamily: font.regular, fontSize: 13, fontStyle: 'italic', marginTop: 4 },
  empty: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', marginTop: 32, lineHeight: 21 },
  spinner: { marginVertical: 24 },
});
