import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MflLiveAppTeam } from '@mfl/shared-types/mfl-live-app';
import type {
  MflLiveAppStandings,
  MflLiveAppStandingsLeague,
  MflLiveAppStandingsMode,
  MflLiveAppStandingsRow,
} from '@mfl/shared-types/mfl-live-app-standings';
import { apiGet, SignedOutError } from '../api';
import { points } from '../format';
import { useSession } from '../session-context';
import { font, useTheme, type Theme } from '../theme';
import { TeamMark } from '../components/TeamMark';

/**
 * Every watched league's table, under one Live / Projected / Final switch —
 * the app's `/live/standings`.
 *
 * The server builds every view (`/api/live-standings?source=mfl`), so this
 * screen only picks one to show: the "never count a week twice" overlay lives
 * in one place, and a view the owner may not see never arrives at all.
 */

const MODES: readonly MflLiveAppStandingsMode[] = ['live', 'projected', 'final'];
const MODE_LABEL: Record<MflLiveAppStandingsMode, string> = {
  live: 'Live',
  projected: 'Projected',
  final: 'Final',
};
const MODE_NOTE: Record<MflLiveAppStandingsMode, string> = {
  live: "Adds this week's games as they stand right now.",
  projected: "Adds this week's games as each side is projected to finish.",
  final: "MFL's official standings.",
};

/** A standing moves when a game goes final; the server caches it two minutes. */
const POLL_MS = 60_000;

export function StandingsScreen() {
  const { token, signOut } = useSession();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MflLiveAppStandings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<MflLiveAppStandingsMode>('live');
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await apiGet<MflLiveAppStandings>(token, '/api/live-standings?source=mfl');
      // `ok: false` is a failed assembly, not an empty league list: keep the
      // last good tables and only say they are stale.
      if (!next.ok) throw new Error('MFL Live could not load your standings just now.');
      setData(next);
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not refresh.');
    } finally {
      inFlight.current = false;
    }
  }, [token, signOut]);

  // Refresh whenever the tab is opened, and every minute while it stays open
  // with the app on screen. Nothing polls before the season starts.
  const preSeason = !!data?.preSeason;
  useFocusEffect(
    useCallback(() => {
      load();
      if (preSeason) return undefined;
      let timer: ReturnType<typeof setInterval> | null = setInterval(load, POLL_MS);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          load();
          if (!timer) timer = setInterval(load, POLL_MS);
        } else if (timer) {
          clearInterval(timer);
          timer = null;
        }
      });
      return () => {
        if (timer) clearInterval(timer);
        sub.remove();
      };
    }, [load, preSeason]),
  );

  // A locked view (no MFL Live Pro) falls back to Final, the one always sent.
  const locked = (m: MflLiveAppStandingsMode) => m !== 'final' && !!data?.proLocked;
  const shown: MflLiveAppStandingsMode = locked(mode) ? 'final' : mode;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const leagues = data?.leagues ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: t.ground, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>Standings</Text>
        {data?.week ? <Text style={[styles.week, { color: t.muted }]}>Week {data.week}</Text> : null}
      </View>

      <View style={[styles.switch, { borderColor: t.border, backgroundColor: t.card }]} accessibilityRole="tablist">
        {MODES.map((m) => {
          const on = m === shown;
          const off = locked(m);
          return (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled: off }}
              disabled={off}
              onPress={() => setMode(m)}
              style={[styles.switchItem, on && { backgroundColor: t.accent }]}
            >
              <Text style={[styles.switchText, { color: on ? t.onAccent : off ? t.border : t.text }]}>
                {MODE_LABEL[m]}
                {off ? ' · Pro' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.note, { color: t.muted }]}>{MODE_NOTE[shown]}</Text>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}

        {!data && !error ? <Text style={[styles.empty, { color: t.muted }]}>Loading your standings…</Text> : null}

        {data?.preSeason ? (
          <Text style={[styles.empty, { color: t.muted }]}>
            Standings show here once the NFL week kicks off. Pull down to refresh.
          </Text>
        ) : null}

        {data && !data.preSeason && leagues.length === 0 ? (
          <Text style={[styles.empty, { color: t.muted }]}>No leagues are switched on to watch.</Text>
        ) : null}

        {leagues.map((league) => (
          <LeagueTable key={league.leagueId} league={league} mode={shown} t={t} />
        ))}
      </ScrollView>
    </View>
  );
}

function LeagueTable({ league, mode, t }: { league: MflLiveAppStandingsLeague; mode: MflLiveAppStandingsMode; t: Theme }) {
  const rows = league.views?.[mode] ?? league.views?.final ?? null;
  return (
    <View style={styles.league}>
      <Text style={[styles.leagueName, { color: t.text }]}>{league.leagueName}</Text>
      {rows ? (
        <View style={[styles.table, { borderColor: t.border, backgroundColor: t.card }]}>
          <View style={[styles.row, styles.headRow, { borderBottomColor: t.border }]}>
            <Text style={[styles.rank, styles.head, { color: t.muted }]}>#</Text>
            <Text style={[styles.team, styles.head, { color: t.muted }]}>Team</Text>
            <Text style={[styles.record, styles.head, { color: t.muted }]}>W-L</Text>
            <Text style={[styles.pf, styles.head, { color: t.muted }]}>PF</Text>
          </View>
          {rows.map((row) => (
            <StandingsRow key={row.franchiseId} row={row} t={t} />
          ))}
        </View>
      ) : (
        <Text style={[styles.status, { color: t.danger, borderColor: t.border, backgroundColor: t.card }]}>
          Could not read this league's standings from MFL just now.
        </Text>
      )}
    </View>
  );
}

function StandingsRow({ row, t }: { row: MflLiveAppStandingsRow; t: Theme }) {
  const record = row.ties ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
  return (
    <View
      style={[styles.row, { borderBottomColor: t.border }, row.isViewer && { backgroundColor: t.field }]}
      accessibilityLabel={`${row.rank}. ${row.name}, ${record}, ${points(row.pointsFor)} points`}
    >
      <View style={styles.rank}>
        <Text style={[styles.rankText, { color: t.text }]}>{row.rank}</Text>
        {row.move ? (
          <Text style={[styles.move, { color: row.move > 0 ? t.win : t.danger }]}>
            {row.move > 0 ? `▲${row.move}` : `▼${-row.move}`}
          </Text>
        ) : null}
      </View>
      <View style={[styles.team, styles.teamCell]}>
        {/* TeamMark reads only the identity fields, which a row carries too. */}
        <TeamMark team={row as unknown as MflLiveAppTeam} size={24} />
        <Text
          numberOfLines={1}
          style={[styles.name, { color: t.text, fontFamily: row.isViewer ? font.bold : font.regular }]}
        >
          {row.nameShort || row.name}
        </Text>
      </View>
      <Text style={[styles.record, styles.cell, { color: t.text }]}>{record}</Text>
      <Text style={[styles.pf, styles.cell, { color: row.includesWeek ? t.accentText : t.muted }]}>
        {points(row.pointsFor)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontFamily: font.bold },
  week: { fontFamily: font.regular, fontSize: 14 },
  switch: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 10, padding: 3 },
  switchItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  switchText: { fontFamily: font.semibold, fontSize: 14 },
  note: { fontFamily: font.regular, fontSize: 12, marginHorizontal: 16, marginTop: 8 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  error: { fontFamily: font.regular, fontSize: 14, marginBottom: 12 },
  empty: { fontFamily: font.regular, fontSize: 15, marginTop: 24, textAlign: 'center', lineHeight: 21 },
  league: { marginBottom: 16 },
  leagueName: { fontSize: 13, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  table: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headRow: { paddingVertical: 6 },
  head: { fontFamily: font.semibold, fontSize: 12 },
  rank: { width: 40, flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  rankText: { fontFamily: font.semibold, fontSize: 14 },
  move: { fontFamily: font.medium, fontSize: 10 },
  team: { flex: 1 },
  teamCell: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 },
  name: { flexShrink: 1, fontSize: 14 },
  record: { width: 56, textAlign: 'right' },
  pf: { width: 64, textAlign: 'right' },
  cell: { fontFamily: font.regular, fontSize: 14 },
  status: { fontFamily: font.regular, fontSize: 14, borderWidth: 1, borderRadius: 12, padding: 14, overflow: 'hidden' },
});
