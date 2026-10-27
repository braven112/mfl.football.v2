import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MflLiveAppMatchup, MflLiveAppPlayerMeta } from '@mfl/shared-types/mfl-live-app';
// Relative rather than through a tsconfig alias, so this package adds no line
// to a file every package shares. Types only: erased from the bundle.
import type {
  MflLiveAppBoardMatchup,
  MflLiveAppBoardPanel,
  MflLiveAppLeaders,
  MflLiveAppLeagueBoard,
  MflLiveAppLeagueBoardResponse,
  MflLiveAppStandingsRow,
} from '../../../../packages/shared-types/src/mfl-live-app-league-board';
import type { RootStackParamList } from '../navigation/types';
import { apiGet, SignedOutError } from '../api';
import { ageLabel, points } from '../format';
import { useSession } from '../session-context';
import { font, useTheme, type Theme } from '../theme';
import { MatchupCard } from '../components/MatchupCard';
import { TeamMark } from '../components/TeamMark';

type Props = NativeStackScreenProps<RootStackParamList, 'LeagueBoard'>;
type Tab = 'scores' | 'standings';

/** How often the board refreshes while a game in this league is being played. */
const LIVE_POLL_MS = 30_000;

/**
 * One league's full board: every matchup, the week's top scorers and MFL's
 * standings, like `/live/league/<id>` on the web. Store mode (`source=mfl`):
 * MFL data only. The server picks the running NFL week.
 */
export function LeagueBoardScreen({ route }: Props) {
  const { leagueId } = route.params;
  const { token, signOut } = useSession();
  const t = useTheme();
  const [board, setBoard] = useState<MflLiveAppLeagueBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('scores');
  const [now, setNow] = useState(Date.now());
  // When the PHONE got the board: the server's clock is not the phone's.
  const [receivedAt, setReceivedAt] = useState(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await apiGet<MflLiveAppLeagueBoardResponse>(
        token,
        `/api/league-board?mfl=${encodeURIComponent(leagueId)}&source=mfl`,
      );
      // `ok: false` is a failed read, not an empty league: keep what is on screen.
      if (!next.ok) throw new Error('Could not read this league from MFL just now.');
      setBoard(next as MflLiveAppLeagueBoard);
      setReceivedAt(Date.now());
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not refresh.');
    } finally {
      inFlight.current = false;
      setNow(Date.now());
    }
  }, [token, leagueId, signOut]);

  useEffect(() => {
    load();
  }, [load]);

  const panel = board?.panels[0] ?? null;
  const live = gameInProgress(panel);
  // Poll only while a game is being played AND the app is on screen.
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
    <ScrollView
      style={{ backgroundColor: t.ground }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
    >
      {board ? (
        <Text style={[styles.meta, { color: t.muted }]}>
          {board.week ? `Week ${board.week}` : 'No NFL week is running'}
          {receivedAt ? `  ·  Updated ${ageLabel(receivedAt, now)}` : ''}
          {live ? '  ·  Live' : ''}
        </Text>
      ) : null}

      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      {!board && !error ? <Text style={[styles.empty, { color: t.muted }]}>Loading the league…</Text> : null}

      {board && panel ? (
        <>
          <Tabs tab={tab} onChange={setTab} t={t} />
          {tab === 'scores' ? (
            <Scores board={board} panel={panel} t={t} />
          ) : (
            <Standings rows={panel.standings} precision={panel.scorePrecision} t={t} />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

/** Any starter in this league mid-game: on MFL's own clock, under an hour left. */
function gameInProgress(panel: MflLiveAppBoardPanel | null): boolean {
  if (!panel) return false;
  return panel.matchups.some((m) =>
    m.sides.some((team) => team.players.some((p) => p.secondsRemaining > 0 && p.secondsRemaining < 3600)),
  );
}

function Tabs({ tab, onChange, t }: { tab: Tab; onChange: (tab: Tab) => void; t: Theme }) {
  const options: Array<{ key: Tab; label: string }> = [
    { key: 'scores', label: 'Scores' },
    { key: 'standings', label: 'Standings' },
  ];
  return (
    <View style={[styles.tabs, { backgroundColor: t.card, borderColor: t.border }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === tab;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.tab, on ? { backgroundColor: t.accent } : null]}
          >
            <Text style={[styles.tabLabel, { color: on ? t.onAccent : t.muted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const STATUS_TEXT: Record<Exclude<MflLiveAppBoardPanel['status'], 'ok'>, string> = {
  'no-matchup': 'No matchups in this league this week.',
  'not-played': 'Nothing has kicked off yet. Pull down to refresh.',
  unavailable: 'Could not read this league from MFL just now.',
};

function Scores({ board, panel, t }: { board: MflLiveAppLeagueBoard; panel: MflLiveAppBoardPanel; t: Theme }) {
  if (!board.week) {
    return (
      <Text style={[styles.empty, { color: t.muted }]}>
        Scores show here once the NFL week kicks off. The standings are on the next tab.
      </Text>
    );
  }
  if (panel.status !== 'ok') {
    return (
      <Text
        style={[
          styles.status,
          { color: panel.status === 'unavailable' ? t.danger : t.muted, borderColor: t.border, backgroundColor: t.card },
        ]}
      >
        {STATUS_TEXT[panel.status]}
      </Text>
    );
  }
  return (
    <View>
      {panel.leaders ? (
        <Leaders leaders={panel.leaders} meta={board.playerMeta} precision={panel.scorePrecision} t={t} />
      ) : null}
      <Text style={[styles.section, { color: t.text }]}>Matchups</Text>
      {orderMatchups(panel.matchups).map((m) => (
        <View key={m.index}>
          {m.viewerSide !== null ? <Text style={[styles.yours, { color: t.accentText }]}>Your matchup</Text> : null}
          <MatchupCard matchup={fromViewer(m)} playerMeta={board.playerMeta} precision={panel.scorePrecision} />
        </View>
      ))}
    </View>
  );
}

/** The viewer's own matchup first, the rest in MFL's order. */
function orderMatchups(matchups: MflLiveAppBoardMatchup[]): MflLiveAppBoardMatchup[] {
  return [...matchups.filter((m) => m.viewerSide !== null), ...matchups.filter((m) => m.viewerSide === null)];
}

/**
 * The shared matchup card reads one side as "mine". The viewer's side when
 * they are in this matchup, else MFL's first side, with the win probability
 * turned to face whichever side leads the card.
 */
function fromViewer(m: MflLiveAppBoardMatchup): MflLiveAppMatchup {
  const first = m.viewerSide ?? 0;
  return {
    index: m.index,
    mine: m.sides[first],
    opponent: m.sides[first === 0 ? 1 : 0],
    winProbability: first === 0 ? m.p0 : 1 - m.p0,
    noProjections: m.noProjections,
  };
}

function Leaders({
  leaders,
  meta,
  precision,
  t,
}: {
  leaders: MflLiveAppLeaders;
  meta: Record<string, MflLiveAppPlayerMeta>;
  precision?: number;
  t: Theme;
}) {
  // A week nobody has played yet has no leaders; draw nothing rather than zeros.
  if (leaders.teams.length === 0 && leaders.players.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text style={[styles.section, { color: t.text }]}>Top scorers</Text>
      <View style={[styles.box, { backgroundColor: t.card, borderColor: t.border }]}>
        {leaders.teams.slice(0, 3).map((team, i) => (
          <View key={team.franchiseId} style={[styles.row, i > 0 ? { borderTopColor: t.border, ...styles.rule } : null]}>
            <Text style={[styles.rank, { color: t.muted }]}>{i + 1}</Text>
            <TeamMark team={{ ...team, projectedFinal: 0, players: [], bench: [] }} size={28} />
            <Text numberOfLines={1} style={[styles.rowName, { color: t.text }]}>
              {team.nameShort}
            </Text>
            <Text style={[styles.rowPts, { color: t.text }]}>{points(team.live, precision)}</Text>
          </View>
        ))}
        {leaders.players.slice(0, 5).map((p, i) => {
          const who = meta[p.playerId];
          return (
            <View key={p.playerId} style={[styles.row, styles.rule, { borderTopColor: t.border }]}>
              <Text style={[styles.rank, { color: t.muted }]}>{i + 1}</Text>
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={[styles.rowName, { color: t.text }]}>
                  {who?.name ?? `Player ${p.playerId}`}
                  {who?.position ? <Text style={{ color: t.muted }}>{`  ${who.position}`}</Text> : null}
                </Text>
                <Text numberOfLines={1} style={[styles.sub, { color: t.muted }]}>
                  {p.owners.map((o) => o.franchiseName).join(', ')}
                  {p.secondsRemaining > 0 ? '  ·  Playing' : '  ·  Final'}
                </Text>
              </View>
              <Text style={[styles.rowPts, { color: t.text }]}>{points(p.points, precision)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** MFL's rows in MFL's order. Never re-sorted: its order applies the league's tiebreakers. */
function Standings({
  rows,
  precision,
  t,
}: {
  rows: MflLiveAppStandingsRow[] | null | undefined;
  /** The league's own decimals; the shared default when absent. */
  precision?: number;
  t: Theme;
}) {
  if (rows === null) {
    return (
      <Text style={[styles.status, { color: t.danger, borderColor: t.border, backgroundColor: t.card }]}>
        Could not read the standings from MFL just now.
      </Text>
    );
  }
  if (!rows || rows.length === 0) {
    return <Text style={[styles.empty, { color: t.muted }]}>No standings for this league yet.</Text>;
  }
  return (
    <View style={[styles.box, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.row}>
        <Text style={[styles.rank, styles.head, { color: t.muted }]}>#</Text>
        <View style={styles.markGap} />
        <Text style={[styles.rowName, styles.head, { color: t.muted }]}>Team</Text>
        <Text style={[styles.record, styles.head, { color: t.muted }]}>W-L</Text>
        <Text style={[styles.pf, styles.head, { color: t.muted }]}>PF</Text>
      </View>
      {rows.map((row) => (
        <View
          key={row.franchiseId}
          style={[styles.row, styles.rule, { borderTopColor: t.border }, row.isViewer ? { backgroundColor: t.field } : null]}
        >
          <Text style={[styles.rank, { color: t.muted }]}>{row.rank}</Text>
          <TeamMark team={{ ...row, live: 0, projectedFinal: 0, yetToPlay: 0, players: [], bench: [] }} size={24} />
          <Text
            numberOfLines={1}
            style={[styles.rowName, { color: row.isViewer ? t.accentText : t.text, fontFamily: row.isViewer ? font.semibold : font.regular }]}
          >
            {row.nameShort}
          </Text>
          <Text style={[styles.record, { color: t.text }]}>
            {row.ties ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`}
          </Text>
          <Text style={[styles.pf, { color: t.muted }]}>{points(row.pointsFor, precision)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  meta: { fontFamily: font.regular, fontSize: 13, marginBottom: 12 },
  error: { fontFamily: font.regular, fontSize: 14, marginBottom: 12 },
  empty: { fontFamily: font.regular, fontSize: 15, marginTop: 24, textAlign: 'center', lineHeight: 21 },
  status: { fontFamily: font.regular, fontSize: 14, borderWidth: 1, borderRadius: 12, padding: 14, overflow: 'hidden' },
  tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, padding: 3, marginBottom: 16 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabLabel: { fontFamily: font.semibold, fontSize: 14 },
  block: { marginBottom: 16 },
  section: { fontSize: 13, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  yours: { fontSize: 12, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  box: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth },
  rank: { width: 20, fontFamily: font.medium, fontSize: 13, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1 },
  rowName: { flex: 1, fontFamily: font.regular, fontSize: 15 },
  rowPts: { fontFamily: font.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
  sub: { fontFamily: font.regular, fontSize: 12, marginTop: 2 },
  markGap: { width: 24 },
  head: { fontFamily: font.semibold, fontSize: 12 },
  record: { width: 52, textAlign: 'right', fontFamily: font.medium, fontSize: 14, fontVariant: ['tabular-nums'] },
  pf: { width: 56, textAlign: 'right', fontFamily: font.regular, fontSize: 13, fontVariant: ['tabular-nums'] },
});
