import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { MflLiveAppPlayerMeta } from '@mfl/shared-types/mfl-live-app';
import type { MflLiveAppLiveBoard, MflLiveAppLivePanel } from '@mfl/shared-types/mfl-live-app-a';
import { fetchBoard, SignedOutError } from '../api';
import { ageLabel, feedLabel, holdPanels, isLive, nextPollMs, precisionOf } from '../format';
import { font, useTheme, type Theme } from '../theme';
import { MatchupCard } from '../components/MatchupCard';

interface Props {
  token: string;
  onSignOut: () => void;
}

/**
 * Your matchups in every league, kept in step with `/live`.
 *
 * Polling never stops while the screen is in front of you; the server says
 * how long to wait (`pollAfterMs`, read off the NFL schedule), so the board
 * asks every 25 seconds while games are on and rarely when they are not. A
 * failed read keeps the last good board and says it is reconnecting.
 */
export function MatchupsScreen({ token, onSignOut }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState<MflLiveAppLiveBoard | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [failing, setFailing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const boardRef = useRef<MflLiveAppLiveBoard | null>(null);
  const memory = useRef(new Map<string, { panel: MflLiveAppLivePanel; at: number }>());

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // The server sends the Matchups board's extra fields on `source=mfl`.
      const next = (await fetchBoard(token)) as MflLiveAppLiveBoard;
      boardRef.current = next;
      setBoard(next);
      setReceivedAt(Date.now());
      setFailing(false);
    } catch (e) {
      if (e instanceof SignedOutError) {
        onSignOut();
        return;
      }
      // Keep the last good board on screen; the status line says it is stale.
      setFailing(true);
    } finally {
      inFlight.current = false;
      setNow(Date.now());
    }
  }, [token, onSignOut]);

  // One timer, re-armed after every read with the server's hint, and only
  // while the app is in the foreground. Coming back to the app reads at once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = AppState.currentState === 'active' || AppState.currentState == null;
    let cancelled = false;

    const tick = async () => {
      await load();
      if (cancelled || !active) return;
      // Clear first: a read that was in flight across a background/foreground
      // switch must not leave a second timer running beside the new one.
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, nextPollMs(boardRef.current));
    };
    tick();

    const sub = AppState.addEventListener('change', (state) => {
      if (timer) clearTimeout(timer);
      timer = null;
      active = state === 'active';
      if (active) tick();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [load]);

  // The "updated 12s ago" line moves on its own between reads.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const live = isLive(board);
  const offseason = !!board && (board.preSeason || !board.week);
  const panels = board && !offseason ? holdPanels(board, memory.current, receivedAt, now) : [];
  const age = ageLabel(receivedAt, now);

  return (
    <View style={[styles.screen, { backgroundColor: t.ground, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.brand, { color: t.text }]}>
          MFL <Text style={{ color: t.accentText }}>Football</Text>
        </Text>
        <Pressable accessibilityRole="button" onPress={onSignOut} hitSlop={12}>
          <Text style={[styles.signOut, { color: t.muted }]}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        <Text
          accessibilityRole="text"
          style={[styles.meta, { color: failing ? t.danger : live ? t.accentText : t.muted }]}
        >
          {board && !offseason ? `Week ${board.week}  ·  ` : ''}
          {feedLabel({ failing, loaded: !!board, live })}
          {age ? `  ·  updated ${age}` : ''}
        </Text>

        {!board && !failing ? <Text style={[styles.empty, { color: t.muted }]}>Loading your leagues…</Text> : null}

        {!board && failing ? (
          <Notice
            t={t}
            tone="danger"
            title="Couldn’t reach MFL Football"
            body="Check your connection. We’ll keep trying, or pull down to try now."
          />
        ) : null}

        {offseason ? (
          <Notice
            t={t}
            title="The season hasn’t started"
            body="MyFantasyLeague doesn’t score a week until it begins. This board fills itself in the moment Week 1 does."
          />
        ) : null}

        {board && !offseason && board.leagues.length === 0 ? (
          <Notice
            t={t}
            title="No leagues to show"
            body="We did not find any MFL leagues on your account, or every one is switched off."
          />
        ) : null}

        {board
          ? panels.map(({ panel, heldSince }) => (
              <LeagueSection
                key={panel.leagueId}
                league={panel}
                heldSince={heldSince}
                now={now}
                playerMeta={board.playerMeta}
                t={t}
              />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

/** A league with nothing to show still gets its place, saying why — the web board's words. */
const STATUS_COPY: Record<Exclude<MflLiveAppLivePanel['status'], 'ok'>, { title: string; body: string }> = {
  'not-played': {
    title: 'This week hasn’t kicked off',
    body: 'Scores appear here once the games start. Nothing has been played yet, so this is not a 0-0.',
  },
  'no-matchup': {
    title: 'No matchup this week',
    body: 'The league is scoring normally; you just don’t have a game on the schedule.',
  },
  unavailable: {
    title: 'Couldn’t read this league',
    body: 'We reached for the scores and didn’t get them. These are missing, not zero. Refreshing usually sorts it.',
  },
};

function LeagueSection({
  league,
  heldSince,
  now,
  playerMeta,
  t,
}: {
  league: MflLiveAppLivePanel;
  heldSince: number | null;
  now: number;
  playerMeta: Record<string, MflLiveAppPlayerMeta>;
  t: Theme;
}) {
  const navigation = useNavigation();
  return (
    <View style={styles.league}>
      {/* The way into the league's own board: every matchup and its top scorers. */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open the ${league.leagueName} board`}
        onPress={() => navigation.navigate('LeagueBoard', { leagueId: league.leagueId, leagueName: league.leagueName })}
        hitSlop={8}
      >
        <Text style={[styles.leagueName, { color: t.text }]}>{league.leagueName} ›</Text>
      </Pressable>
      {heldSince !== null ? (
        <Text style={[styles.held, { color: t.danger }]}>
          MFL isn’t answering for this league. Scores from {ageLabel(heldSince, now)}.
        </Text>
      ) : null}
      {league.status === 'ok' ? (
        league.matchups.map((m) => (
          <MatchupCard key={m.index} matchup={m} playerMeta={playerMeta} precision={precisionOf(league)} />
        ))
      ) : (
        <Notice
          t={t}
          tone={league.status === 'unavailable' ? 'danger' : undefined}
          title={STATUS_COPY[league.status].title}
          body={STATUS_COPY[league.status].body}
        />
      )}
    </View>
  );
}

function Notice({ t, title, body, tone }: { t: Theme; title: string; body: string; tone?: 'danger' }) {
  return (
    <View accessibilityRole="summary" style={[styles.notice, { borderColor: t.border, backgroundColor: t.card }]}>
      <Text style={[styles.noticeTitle, { color: tone === 'danger' ? t.danger : t.text }]}>{title}</Text>
      <Text style={[styles.noticeBody, { color: t.muted }]}>{body}</Text>
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
  brand: { fontSize: 22, fontFamily: font.bold },
  signOut: { fontFamily: font.regular, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  meta: { fontFamily: font.regular, fontSize: 13, marginBottom: 12 },
  empty: { fontFamily: font.regular, fontSize: 15, marginTop: 24, textAlign: 'center', lineHeight: 21 },
  league: { marginBottom: 12 },
  leagueName: { fontSize: 13, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  held: { fontFamily: font.regular, fontSize: 12, marginBottom: 8 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4, marginBottom: 12 },
  noticeTitle: { fontFamily: font.semibold, fontSize: 15 },
  noticeBody: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
});
