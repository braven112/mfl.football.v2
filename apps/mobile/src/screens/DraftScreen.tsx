import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  MflLiveAppDraftPickResponse,
  MflLiveAppDraftPlayer,
  MflLiveAppDraftPool,
  MflLiveAppDraftPoolPlayer,
  MflLiveAppDraftRoom,
  MflLiveAppDraftQueueResponse,
  MflLiveAppDraftSlot,
} from '@mfl/shared-types/mfl-live-app-draft';
import type { MflLiveAppAuctionRoom } from '@mfl/shared-types/mfl-live-app-auction';
import { ApiError, apiGet, apiPost, SignedOutError } from '../api';
import { useSession } from '../session-context';
import type { RootStackParamList } from '../navigation/types';
import { font, useTheme, type Theme } from '../theme';
import { AuctionPanel } from './AuctionPanel';

type Tab = 'board' | 'players' | 'queue' | 'auction';
const TABS: { key: Tab; label: string }[] = [
  { key: 'board', label: 'Board' },
  { key: 'players', label: 'Players' },
  { key: 'queue', label: 'My queue' },
];
const AUCTION_TAB: { key: Tab; label: string } = { key: 'auction', label: 'Auction' };
const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

/**
 * The draft room for one league: who is on the clock, your next pick, the
 * board round by round, the players still available, and your MFL pre-draft
 * list (MFL picks from it if your clock runs out).
 *
 * You can add players to your queue, reorder or remove them, and save the list
 * back to MFL, and when you're on the clock, draft a player. The server only
 * sends a pick for the slot that is yours on the live board, and only calls it
 * made once the board shows it. The board re-reads itself on the server's `pollAfterMs` hint (seconds during a live
 * draft, minutes otherwise) and stops while the app is in the background.
 * A failed read keeps the last good board on screen and says so.
 *
 * A league that also runs an auction (TheLeague drafts rookies and auctions
 * free agents) gets an Auction tab; a league that drafts BY auction shows only
 * the auction.
 */
export function DraftScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'Draft'>) {
  const t = useTheme();
  const { leagueId } = route.params;
  const { token, signOut } = useSession();

  const [room, setRoom] = useState<MflLiveAppDraftRoom | null>(null);
  const [pool, setPool] = useState<MflLiveAppDraftPool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('board');
  const [round, setRound] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('All');
  const [active, setActive] = useState(AppState.currentState === 'active');
  /** Your queue while you're editing it, before Save. null = not editing. */
  const [queueEdit, setQueueEdit] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<{ tone?: 'danger'; text: string } | null>(null);
  const [auction, setAuction] = useState<MflLiveAppAuctionRoom | null>(null);
  const [auctionError, setAuctionError] = useState<string | null>(null);

  const onFailure = useCallback(
    (e: unknown, fallback: string, set: (m: string) => void) => {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      set(e instanceof ApiError ? e.message : fallback);
    },
    [signOut],
  );

  const loadRoom = useCallback(async () => {
    try {
      const next = await apiGet<MflLiveAppDraftRoom>(token, `/api/mfl-live/draft?league=${encodeURIComponent(leagueId)}`);
      setRoom(next);
      setError(null);
      return next;
    } catch (e) {
      onFailure(e, 'MFL Football could not load the draft just now.', setError);
      return null;
    }
  }, [leagueId, token, onFailure]);

  const loadPool = useCallback(async () => {
    try {
      const next = await apiGet<MflLiveAppDraftPool>(token, `/api/mfl-live/draft-pool?league=${encodeURIComponent(leagueId)}`);
      setPool(next);
      setPoolError(null);
    } catch (e) {
      onFailure(e, 'MFL Football could not load the available players just now.', setPoolError);
    }
  }, [leagueId, token, onFailure]);

  const loadAuction = useCallback(async () => {
    try {
      const next = await apiGet<MflLiveAppAuctionRoom>(token, `/api/mfl-live/auction?league=${encodeURIComponent(leagueId)}`);
      setAuction(next);
      setAuctionError(null);
    } catch (e) {
      onFailure(e, 'MFL Football could not load the auction just now.', setAuctionError);
    }
  }, [leagueId, token, onFailure]);

  useEffect(() => {
    loadRoom();
    loadPool();
    loadAuction();
  }, [loadRoom, loadPool, loadAuction]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Follow the server's hint for the next read, only while the app is open.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active || !room) return;
    timer.current = setTimeout(loadRoom, room.pollAfterMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, room, loadRoom]);

  const auctionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active || !auction || auction.kind === 'none') return;
    auctionTimer.current = setTimeout(loadAuction, auction.pollAfterMs);
    return () => {
      if (auctionTimer.current) clearTimeout(auctionTimer.current);
    };
  }, [active, auction, loadAuction]);

  useEffect(() => {
    if (room) navigation.setOptions({ title: `${room.leagueName} draft` });
  }, [room?.leagueName, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadRoom(), loadPool(), loadAuction()]);
    setRefreshing(false);
  }, [loadRoom, loadPool, loadAuction]);

  const teamName = useMemo(() => {
    const names = new Map(room?.teams.map((x) => [x.franchiseId, x.name]) ?? []);
    return (id: string) => names.get(id) ?? `Team ${id}`;
  }, [room?.teams]);

  // The pool is read less often than the board, so drop players the board
  // has since seen picked.
  const available = useMemo(() => {
    const taken = new Set(room?.slots.map((s) => s.player?.id).filter(Boolean));
    const q = query.trim().toLowerCase();
    return (pool?.players ?? []).filter(
      (p) =>
        !taken.has(p.id) &&
        (position === 'All' || p.position === position) &&
        (!q || p.name.toLowerCase().includes(q) || p.nflTeam.toLowerCase() === q),
    );
  }, [pool, room?.slots, query, position]);

  const known = useMemo(() => {
    const map = new Map<string, MflLiveAppDraftPlayer>();
    for (const p of pool?.players ?? []) map.set(p.id, p);
    for (const p of room?.queue ?? []) map.set(p.id, p);
    return map;
  }, [pool, room?.queue]);
  const queueIds = queueEdit ?? room?.queue?.map((p) => p.id) ?? [];
  const queueShown = queueIds.map((id) => known.get(id) ?? { id, name: `Player ${id}`, position: '', nflTeam: '' });
  const inQueue = useMemo(() => new Set(queueIds), [queueIds.join(',')]);

  const editQueue = useCallback(
    (change: (ids: string[]) => string[]) => {
      if (!room?.queue) return;
      setQueueEdit((cur) => change([...(cur ?? room.queue!.map((p) => p.id))]));
    },
    [room?.queue],
  );
  const addToQueue = (id: string) => editQueue((ids) => (ids.includes(id) ? ids : [...ids, id]));
  const removeFromQueue = (id: string) => editQueue((ids) => ids.filter((x) => x !== id));
  const moveInQueue = (index: number, by: -1 | 1) =>
    editQueue((ids) => {
      const to = index + by;
      if (to < 0 || to >= ids.length) return ids;
      [ids[index], ids[to]] = [ids[to], ids[index]];
      return ids;
    });

  const saveQueue = useCallback(async () => {
    if (!queueEdit || !room?.queue) return;
    setSaving(true);
    try {
      const res = await apiPost<MflLiveAppDraftQueueResponse>(
        token,
        `/api/mfl-live/draft-queue?league=${encodeURIComponent(leagueId)}`,
        { playerIds: queueEdit, basedOn: room.queue.map((p) => p.id) },
      );
      if (res.ok) {
        setRoom({ ...room, queue: res.queue });
        setQueueEdit(null);
        setNotice({ text: 'Your queue is saved on MyFantasyLeague.' });
      } else {
        if ('queue' in res) {
          setRoom({ ...room, queue: res.queue });
          setQueueEdit(null);
        }
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (e) {
      onFailure(e, 'MFL Football could not save your queue just now.', (m) => setNotice({ tone: 'danger', text: m }));
    } finally {
      setSaving(false);
    }
  }, [queueEdit, room, token, leagueId, onFailure]);

  const sendPick = useCallback(
    async (player: MflLiveAppDraftPlayer, overall: number) => {
      setPicking(true);
      try {
        const res = await apiPost<MflLiveAppDraftPickResponse>(
          token,
          `/api/mfl-live/draft-pick?league=${encodeURIComponent(leagueId)}`,
          { playerId: player.id, overall },
        );
        if (res.ok) {
          setRoom(res.room);
          setQueueEdit((cur) => (cur ? cur.filter((id) => id !== player.id) : cur));
          setNotice({ text: `You drafted ${player.name}.` });
        } else {
          if (res.room) setRoom(res.room);
          setNotice({ tone: 'danger', text: res.message });
        }
      } catch (e) {
        onFailure(e, 'MFL Football could not send your pick. Check the board before you try again.', (m) =>
          setNotice({ tone: 'danger', text: m }),
        );
      } finally {
        setPicking(false);
      }
    },
    [token, leagueId, onFailure],
  );

  const myTurn = !!room?.onClock?.mine && room.kind !== 'auction';
  const confirmPick = (player: MflLiveAppDraftPlayer) => {
    const clock = room?.onClock;
    if (!clock?.mine || picking) return;
    Alert.alert(`Draft ${player.name}?`, `With pick ${clock.label}. This goes straight to MyFantasyLeague.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Draft', onPress: () => sendPick(player, clock.overall) },
    ]);
  };

  const rounds = useMemo(() => [...new Set(room?.slots.map((s) => s.round) ?? [])], [room?.slots]);
  const clockRound = room?.slots.find((s) => s.overall === room.onClock?.overall)?.round;
  const shownRound = round ?? clockRound ?? rounds[rounds.length - 1] ?? 1;
  const roundSlots = room?.slots.filter((s) => s.round === shownRound) ?? [];

  if (!room) {
    return (
      <ScrollView
        style={{ backgroundColor: t.ground }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        {error ? (
          <Notice t={t} tone="danger" title="Couldn’t load the draft" body={error} />
        ) : (
          <Text style={[styles.muted, { color: t.muted }]}>Loading the draft…</Text>
        )}
      </ScrollView>
    );
  }

  const auctionPanel = (
    <AuctionPanel
      auction={auction}
      error={auctionError}
      refreshing={refreshing}
      onRefresh={onRefresh}
      teamName={teamName}
      onPlayer={(playerId) => navigation.navigate('PlayerCard', { leagueId, playerId })}
      t={t}
    />
  );

  if (room.kind === 'auction') {
    return <View style={[styles.screen, { backgroundColor: t.ground, paddingTop: 12 }]}>{auctionPanel}</View>;
  }
  const tabs = auction && auction.kind !== 'none' ? [...TABS, AUCTION_TAB] : TABS;
  const outbid = auction?.lots.filter((l) => l.outbid).length ?? 0;

  return (
    <View style={[styles.screen, { backgroundColor: t.ground }]}>
      <View style={styles.top}>
        <ClockCard room={room} teamName={teamName} t={t} />
        {error ? <Notice t={t} tone="danger" title="Couldn’t refresh" body={error} /> : null}
        {notice ? (
          <Pressable onPress={() => setNotice(null)} accessibilityHint="Dismiss">
            <Text
              style={[
                styles.banner,
                { color: notice.tone === 'danger' ? t.danger : t.win, borderColor: notice.tone === 'danger' ? t.danger : t.border },
              ]}
            >
              {notice.text}
            </Text>
          </Pressable>
        ) : null}
        {picking ? <Text style={[styles.banner, { color: t.muted, borderColor: t.border }]}>Sending your pick to MyFantasyLeague…</Text> : null}
        {queueEdit ? (
          <View style={[styles.saveBar, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.sub, { color: t.text, flex: 1 }]}>Your queue has changes.</Text>
            <SmallButton t={t} label="Discard" onPress={() => setQueueEdit(null)} disabled={saving} />
            <SmallButton t={t} primary label={saving ? 'Saving…' : 'Save'} onPress={saveQueue} disabled={saving} />
          </View>
        ) : null}
        <View style={[styles.tabs, { borderColor: t.border }]}>
          {tabs.map((x) => (
            <Pressable
              key={x.key}
              onPress={() => setTab(x.key)}
              style={[styles.tab, tab === x.key && { backgroundColor: t.accent }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === x.key }}
            >
              <Text style={[styles.tabText, { color: tab === x.key ? t.onAccent : t.muted }]}>
                {x.label}
                {x.key === 'queue' && room.queue ? `  ${queueIds.length}` : ''}
                {x.key === 'auction' && outbid ? `  ${outbid}!` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === 'board' ? (
        <FlatList
          data={roundSlots}
          keyExtractor={(s) => String(s.overall)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
          ListHeaderComponent={
            rounds.length > 1 ? (
              <Chips t={t} items={rounds.map(String)} selected={String(shownRound)} prefix="Round " onSelect={(r) => setRound(Number(r))} />
            ) : undefined
          }
          ListEmptyComponent={
            <Text style={[styles.muted, { color: t.muted }]}>
              {room.status === 'not-set' ? `MFL hasn’t set this league’s ${room.year} draft order yet.` : 'No picks in this round.'}
            </Text>
          }
          renderItem={({ item }) => (
            <SlotRow
              slot={item}
              team={teamName(item.franchiseId)}
              mine={item.franchiseId === room.franchiseId}
              onClock={item.overall === room.onClock?.overall}
              t={t}
            />
          )}
          contentContainerStyle={styles.list}
        />
      ) : null}

      {tab === 'players' ? (
        <FlatList
          data={available}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.filters}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search players"
                placeholderTextColor={t.muted}
                style={[styles.search, { backgroundColor: t.field, color: t.text, borderColor: t.border }]}
                autoCorrect={false}
              />
              <Chips t={t} items={POSITIONS} selected={position} onSelect={setPosition} />
              {pool?.rookiesOnly ? <Text style={[styles.note, { color: t.muted }]}>Rookies only, like this league’s draft.</Text> : null}
              {poolError ? <Notice t={t} tone="danger" title="Couldn’t load the players" body={poolError} /> : null}
            </View>
          }
          ListEmptyComponent={
            <Text style={[styles.muted, { color: t.muted }]}>
              {!pool && !poolError ? 'Loading players…' : pool ? 'Nobody matches.' : ''}
            </Text>
          }
          renderItem={({ item }) => (
            <PlayerRow
              player={item}
              t={t}
              onPress={() => navigation.navigate('PlayerCard', { leagueId, playerId: item.id })}
            >
              {room.queue ? (
                inQueue.has(item.id) ? (
                  <Text style={[styles.adp, { color: t.muted }]}>Queued</Text>
                ) : (
                  <SmallButton t={t} label="+ Queue" onPress={() => addToQueue(item.id)} />
                )
              ) : null}
              {myTurn ? <SmallButton t={t} primary label="Draft" onPress={() => confirmPick(item)} disabled={picking} /> : null}
            </PlayerRow>
          )}
          contentContainerStyle={styles.list}
        />
      ) : null}

      {tab === 'queue' ? (
        <FlatList
          data={queueShown}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
          ListHeaderComponent={
            <Text style={[styles.note, { color: t.muted }]}>
              Your pre-draft list on MyFantasyLeague. If your clock runs out, MFL picks the first player here who’s still available. Add players from Players, reorder them here, then Save.
            </Text>
          }
          ListEmptyComponent={
            <Text style={[styles.muted, { color: t.muted }]}>
              {room.queue === null ? 'MFL didn’t send your list just now. Pull down to try again.' : 'Your list is empty. Add players from Players.'}
            </Text>
          }
          renderItem={({ item, index }) => (
            <PlayerRow
              player={item}
              rank={index + 1}
              t={t}
              onPress={() => navigation.navigate('PlayerCard', { leagueId, playerId: item.id })}
            >
              <SmallButton t={t} label="↑" onPress={() => moveInQueue(index, -1)} disabled={index === 0} accessibilityLabel="Move up" />
              <SmallButton
                t={t}
                label="↓"
                onPress={() => moveInQueue(index, 1)}
                disabled={index === queueShown.length - 1}
                accessibilityLabel="Move down"
              />
              <SmallButton t={t} label="✕" onPress={() => removeFromQueue(item.id)} accessibilityLabel="Remove" />
              {myTurn ? <SmallButton t={t} primary label="Draft" onPress={() => confirmPick(item)} disabled={picking} /> : null}
            </PlayerRow>
          )}
          contentContainerStyle={styles.list}
        />
      ) : null}

      {tab === 'auction' ? auctionPanel : null}
    </View>
  );
}

/** "3h 12m", "4m", "under a minute". */
function elapsed(sinceIso: string, now: number): string {
  const mins = Math.floor((now - Date.parse(sinceIso)) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function ClockCard({ room, teamName, t }: { room: MflLiveAppDraftRoom; teamName: (id: string) => string; t: Theme }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const clock = room.onClock;
  const headline =
    room.status === 'not-set'
      ? 'No draft order yet'
      : room.status === 'complete'
        ? 'The draft is over'
        : clock?.mine
          ? 'You’re on the clock'
          : clock
            ? `${teamName(clock.franchiseId)} is on the clock`
            : 'Draft';
  const details = [room.pickClock, room.pool].filter(Boolean).join(' · ');

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: clock?.mine ? t.accent : t.card, borderColor: clock?.mine ? t.accent : t.border },
      ]}
    >
      {clock ? (
        <Text style={[styles.clockLabel, { color: clock.mine ? t.onAccent : t.accentText }]}>Pick {clock.label}</Text>
      ) : null}
      <Text style={[styles.headline, { color: clock?.mine ? t.onAccent : t.text }]}>{headline}</Text>
      {clock?.since ? (
        <Text style={[styles.sub, { color: clock.mine ? t.onAccent : t.muted }]}>On the clock for {elapsed(clock.since, now)}</Text>
      ) : null}
      {room.myNextPick && !clock?.mine ? (
        <Text style={[styles.sub, { color: t.text }]}>
          Your next pick: {room.myNextPick.label}, {room.myNextPick.picksAway} pick{room.myNextPick.picksAway === 1 ? '' : 's'} away
        </Text>
      ) : null}
      {clock?.mine ? (
        <Text style={[styles.sub, { color: t.onAccent }]}>Tap Draft next to a player in Players or your queue.</Text>
      ) : null}
      {details ? <Text style={[styles.sub, { color: clock?.mine ? t.onAccent : t.muted }]}>{details}</Text> : null}
    </View>
  );
}

function playerLine(p: MflLiveAppDraftPlayer): string {
  return [p.position, p.nflTeam, p.rookie ? 'Rookie' : ''].filter(Boolean).join(' · ');
}

function SlotRow({
  slot,
  team,
  mine,
  onClock,
  t,
}: {
  slot: MflLiveAppDraftSlot;
  team: string;
  mine: boolean;
  onClock: boolean;
  t: Theme;
}) {
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: t.card, borderColor: onClock ? t.accent : t.border },
        onClock && styles.rowStrong,
      ]}
    >
      <Text style={[styles.slotLabel, { color: onClock ? t.accentText : t.muted }]}>{slot.label}</Text>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: mine ? t.accentText : t.text }]} numberOfLines={1}>
          {team}
          {mine ? ' (you)' : ''}
        </Text>
        {slot.player ? (
          <Text style={[styles.rowSub, { color: t.text }]} numberOfLines={1}>
            {slot.player.name}  <Text style={{ color: t.muted }}>{playerLine(slot.player)}</Text>
          </Text>
        ) : (
          <Text style={[styles.rowSub, { color: t.muted }]}>
            {slot.skipped ? 'Skipped' : onClock ? 'On the clock' : '—'}
          </Text>
        )}
        {slot.fromTeam ? <Text style={[styles.rowSub, { color: t.muted }]}>From {slot.fromTeam}</Text> : null}
      </View>
    </View>
  );
}

function PlayerRow({
  player,
  rank,
  t,
  onPress,
  children,
}: {
  player: MflLiveAppDraftPoolPlayer | MflLiveAppDraftPlayer;
  rank?: number;
  t: Theme;
  onPress: () => void;
  children?: ReactNode;
}) {
  const adp = 'adpRank' in player ? player.adpRank : undefined;
  return (
    <Pressable onPress={onPress} style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
      {rank ? <Text style={[styles.slotLabel, { color: t.muted }]}>{rank}</Text> : null}
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: t.text }]} numberOfLines={1}>
          {player.name}
        </Text>
        <Text style={[styles.rowSub, { color: t.muted }]}>{playerLine(player)}</Text>
      </View>
      {adp ? <Text style={[styles.adp, { color: t.muted }]}>ADP {adp}</Text> : null}
      {children}
    </Pressable>
  );
}

function SmallButton({
  t,
  label,
  onPress,
  primary,
  disabled,
  accessibilityLabel,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={6}
      style={[
        styles.smallButton,
        { backgroundColor: primary ? t.accent : t.field, borderColor: primary ? t.accent : t.border, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={[styles.smallButtonText, { color: primary ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

function Chips({
  t,
  items,
  selected,
  onSelect,
  prefix = '',
}: {
  t: Theme;
  items: string[];
  selected: string;
  onSelect: (v: string) => void;
  prefix?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {items.map((v) => (
        <Pressable
          key={v}
          onPress={() => onSelect(v)}
          style={[
            styles.chip,
            { borderColor: v === selected ? t.accent : t.border, backgroundColor: v === selected ? t.accent : t.card },
          ]}
        >
          <Text style={[styles.chipText, { color: v === selected ? t.onAccent : t.text }]}>
            {prefix}
            {v}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Notice({ t, title, body, tone }: { t: Theme; title: string; body: string; tone?: 'danger' }) {
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: tone === 'danger' ? t.danger : t.border }]}>
      <Text style={[styles.noticeTitle, { color: tone === 'danger' ? t.danger : t.text }]}>{title}</Text>
      <Text style={[styles.sub, { color: t.muted }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  top: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  clockLabel: { fontFamily: font.semibold, fontSize: 13, letterSpacing: 0.5 },
  headline: { fontFamily: font.bold, fontSize: 20 },
  sub: { fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  noticeTitle: { fontFamily: font.semibold, fontSize: 15 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center' },
  tabText: { fontFamily: font.semibold, fontSize: 14 },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontFamily: font.medium, fontSize: 13 },
  filters: { gap: 8, marginBottom: 4 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: font.regular, fontSize: 15 },
  note: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  rowStrong: { borderWidth: 2 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: font.semibold, fontSize: 15 },
  rowSub: { fontFamily: font.regular, fontSize: 13 },
  slotLabel: { fontFamily: font.semibold, fontSize: 14, minWidth: 40 },
  adp: { fontFamily: font.medium, fontSize: 12 },
  banner: { fontFamily: font.medium, fontSize: 14, borderWidth: 1, borderRadius: 10, padding: 10 },
  saveBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  smallButton: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  smallButtonText: { fontFamily: font.semibold, fontSize: 13 },
});
