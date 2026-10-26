import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MflLiveAppBoard, MflLiveAppLeaguePanel } from '@mfl/shared-types/mfl-live-app';
import { fetchBoard, SignedOutError } from '../api';
import { anyGameLive, updatedAgo } from '../format';
import { useTheme, type Theme } from '../theme';
import { MatchupCard } from '../components/MatchupCard';

/** How often the board refreshes while one of your games is being played. */
const LIVE_POLL_MS = 30_000;

interface Props {
  token: string;
  onSignOut: () => void;
}

export function MatchupsScreen({ token, onSignOut }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState<MflLiveAppBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetchBoard(token);
      setBoard(next);
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) {
        onSignOut();
        return;
      }
      // Keep the last good board on screen; only say it is stale.
      setError(e instanceof Error ? e.message : 'Could not refresh.');
    } finally {
      inFlight.current = false;
      setNow(Date.now());
    }
  }, [token, onSignOut]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while a game of yours is live AND the app is on screen.
  const live = anyGameLive(board);
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(load, LIVE_POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        load();
        if (!timer) timer = setInterval(load, LIVE_POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [live, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={[styles.screen, { backgroundColor: t.ground, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.brand, { color: t.text }]}>
          MFL <Text style={{ color: t.accentText }}>Live</Text>
        </Text>
        <Pressable accessibilityRole="button" onPress={onSignOut} hitSlop={12}>
          <Text style={[styles.signOut, { color: t.muted }]}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        {board ? (
          <Text style={[styles.meta, { color: t.muted }]}>
            {board.preSeason || !board.week ? 'No NFL week is running' : `Week ${board.week}`}
            {board.fetchedAt ? `  ·  ${updatedAgo(board.fetchedAt, now)}` : ''}
            {live ? '  ·  Live' : ''}
          </Text>
        ) : null}

        {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}

        {!board && !error ? <Text style={[styles.empty, { color: t.muted }]}>Loading your leagues…</Text> : null}

        {board && (board.preSeason || !board.week) ? (
          <Text style={[styles.empty, { color: t.muted }]}>
            Scores show here once the NFL week kicks off. Pull down to refresh.
          </Text>
        ) : null}

        {board && !board.preSeason && board.week && board.leagues.length === 0 ? (
          <Text style={[styles.empty, { color: t.muted }]}>We did not find any MFL leagues on your account.</Text>
        ) : null}

        {board?.leagues.map((league) => (
          <LeagueSection key={league.leagueId} league={league} board={board} t={t} />
        ))}
      </ScrollView>
    </View>
  );
}

/** A league with nothing to show still gets its place, saying why. */
const STATUS_TEXT: Record<Exclude<MflLiveAppLeaguePanel['status'], 'ok'>, string> = {
  'no-matchup': 'No matchup for you this week.',
  'not-played': 'Nothing has kicked off yet.',
  unavailable: 'Could not read this league from MFL just now.',
};

function LeagueSection({ league, board, t }: { league: MflLiveAppLeaguePanel; board: MflLiveAppBoard; t: Theme }) {
  return (
    <View style={styles.league}>
      <Text style={[styles.leagueName, { color: t.text }]}>{league.leagueName}</Text>
      {league.status === 'ok' ? (
        league.matchups.map((m) => <MatchupCard key={m.index} matchup={m} playerMeta={board.playerMeta} />)
      ) : (
        <Text
          style={[
            styles.status,
            { color: league.status === 'unavailable' ? t.danger : t.muted, borderColor: t.border, backgroundColor: t.card },
          ]}
        >
          {STATUS_TEXT[league.status]}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { fontSize: 22, fontWeight: '800' },
  signOut: { fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  meta: { fontSize: 13, marginBottom: 12 },
  error: { fontSize: 14, marginBottom: 12 },
  empty: { fontSize: 15, marginTop: 24, textAlign: 'center', lineHeight: 21 },
  league: { marginBottom: 12 },
  leagueName: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  status: { fontSize: 14, borderWidth: 1, borderRadius: 12, padding: 14, overflow: 'hidden' },
});
