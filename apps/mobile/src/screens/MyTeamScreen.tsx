import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type {
  MflLiveAppDraftPick,
  MflLiveAppRosterPlayer,
  MflLiveAppRosterSlot,
  MflLiveAppTeamPage,
} from '@mfl/shared-types/mfl-live-app-team';
import { ApiError, apiGet, SignedOutError } from '../api';
import { useActiveTeam } from '../active-team';
import { TeamSwitcher } from '../components/TeamSwitcher';
import { useSession } from '../session-context';
import { font, useTheme, type Theme } from '../theme';

/**
 * Your team in the league picked in the header: the roster by slot with
 * injuries and byes, the cap and contracts where the league uses them, and
 * the draft picks you hold. Buttons lead to Set lineup and Waivers.
 *
 * Read only. Every number comes from `/api/mfl-live/team`, which applies the
 * league's own MFL settings; a failed read keeps the last good page on screen
 * and says so rather than showing an empty roster.
 */
export function MyTeamScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { token, signOut } = useSession();
  const { team: active } = useActiveTeam();
  const leagueId = active?.leagueId ?? null;

  const [page, setPage] = useState<MflLiveAppTeamPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requested = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!leagueId) return;
    requested.current = leagueId;
    try {
      const next = await apiGet<MflLiveAppTeamPage>(token, `/api/mfl-live/team?league=${encodeURIComponent(leagueId)}`);
      // A slow answer for the league you just switched away from is dropped.
      if (requested.current !== leagueId) return;
      setPage(next);
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      if (requested.current !== leagueId) return;
      setError(e instanceof ApiError ? e.message : 'MFL Football could not load your team just now.');
    }
  }, [leagueId, token, signOut]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Never show one league's roster under another league's name.
  const shown = page && page.leagueId === leagueId ? page : null;

  return (
    <View style={[styles.screen, { backgroundColor: t.ground, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <TeamSwitcher />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        {!leagueId ? (
          <Notice t={t} title="No team picked" body="Pick one of your leagues at the top to see your team." />
        ) : null}

        {leagueId && !shown && !error ? <Text style={[styles.empty, { color: t.muted }]}>Loading your team…</Text> : null}

        {error ? <Notice t={t} tone="danger" title={shown ? 'Couldn’t refresh' : 'Couldn’t load your team'} body={error} /> : null}

        {shown && leagueId ? (
          <>
            <TeamHeader page={shown} t={t} />

            <View style={styles.actions}>
              <ActionButton
                t={t}
                primary
                label="Set lineup"
                onPress={() => navigation.navigate('SetLineup', { leagueId })}
              />
              <ActionButton t={t} label="Waivers" onPress={() => navigation.navigate('Waivers', { leagueId })} />
            </View>

            {shown.cap ? <CapCard cap={shown.cap} t={t} /> : null}

            {SLOTS.map((slot) => {
              const players = shown.players.filter((p) => p.slot === slot.key);
              if (players.length === 0 && slot.key !== 'active') return null;
              const limit = shown.limits[slot.limitKey];
              return (
                <View key={slot.key} style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: t.muted }]}>
                    {slot.title}  {players.length}
                    {limit ? ` / ${limit}` : ''}
                  </Text>
                  <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                    {players.length === 0 ? (
                      <Text style={[styles.rowEmpty, { color: t.muted }]}>Nobody here.</Text>
                    ) : (
                      players.map((p, i) => (
                        <PlayerRow
                          key={p.id}
                          player={p}
                          week={shown.week}
                          usesContracts={shown.usesContracts}
                          first={i === 0}
                          t={t}
                          onPress={() => navigation.navigate('PlayerCard', { leagueId, playerId: p.id })}
                        />
                      ))
                    )}
                  </View>
                </View>
              );
            })}

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: t.muted }]}>Draft picks  {shown.picks.length}</Text>
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                {shown.picks.length === 0 ? (
                  <Text style={[styles.rowEmpty, { color: t.muted }]}>No picks held.</Text>
                ) : (
                  shown.picks.map((pick, i) => <PickRow key={`${pick.label}-${i}`} pick={pick} first={i === 0} t={t} />)
                )}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const SLOTS: { key: MflLiveAppRosterSlot; title: string; limitKey: keyof MflLiveAppTeamPage['limits'] }[] = [
  { key: 'active', title: 'ROSTER', limitKey: 'roster' },
  { key: 'ir', title: 'INJURED RESERVE', limitKey: 'ir' },
  { key: 'taxi', title: 'TAXI SQUAD', limitKey: 'taxi' },
];

/** "$1.63M", "$425K", "−$1.2M" — the cap's own units, short enough for a phone row. */
function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}

function TeamHeader({ page, t }: { page: MflLiveAppTeamPage; t: Theme }) {
  return (
    <View style={styles.teamHeader}>
      {page.icon ? <Image source={{ uri: page.icon }} style={styles.crest} accessibilityIgnoresInvertColors /> : null}
      <View style={styles.teamText}>
        <Text style={[styles.teamName, { color: t.text }]} numberOfLines={1}>
          {page.franchiseName}
        </Text>
        <Text style={[styles.teamMeta, { color: t.muted }]} numberOfLines={1}>
          {page.leagueName}
          {page.week ? `  ·  Week ${page.week}` : ''}
        </Text>
      </View>
    </View>
  );
}

function ActionButton({ t, label, onPress, primary }: { t: Theme; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: t.accent } : { borderColor: t.border, borderWidth: 1, backgroundColor: t.card },
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

function CapCard({ cap, t }: { cap: NonNullable<MflLiveAppTeamPage['cap']>; t: Theme }) {
  const over = cap.room < 0;
  return (
    <View style={[styles.card, styles.capCard, { backgroundColor: t.card, borderColor: t.border }]}>
      <CapStat t={t} label="Cap room" value={money(cap.room)} tone={over ? t.danger : t.win} />
      <CapStat t={t} label="Committed" value={money(cap.committed)} />
      <CapStat t={t} label="Cap" value={money(cap.cap)} />
      {cap.adjustments ? (
        <Text style={[styles.capNote, { color: t.muted }]}>Includes {money(cap.adjustments)} in adjustments (dead money).</Text>
      ) : null}
    </View>
  );
}

function CapStat({ t, label, value, tone }: { t: Theme; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.capStat}>
      <Text style={[styles.capValue, { color: tone ?? t.text }]}>{value}</Text>
      <Text style={[styles.capLabel, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

function PlayerRow({
  player,
  week,
  usesContracts,
  first,
  t,
  onPress,
}: {
  player: MflLiveAppRosterPlayer;
  week?: number;
  usesContracts: boolean;
  first: boolean;
  t: Theme;
  onPress: () => void;
}) {
  const byeNow = !!week && player.byeWeek === week;
  const details = [player.nflTeam || 'FA', player.byeWeek ? `Bye ${player.byeWeek}` : null].filter(Boolean).join('  ·  ');
  const contract = [
    player.salary !== undefined ? money(player.salary) : null,
    usesContracts && player.contractYears !== undefined ? `${player.contractYears} yr` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${player.name}, ${player.position}${player.injury ? `, ${player.injury.status}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first ? { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={[styles.pos, { backgroundColor: t.field }]}>
        <Text style={[styles.posText, { color: t.text }]}>{player.position || '—'}</Text>
      </View>
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
            {player.name}
          </Text>
          {player.injury ? (
            <Text style={[styles.injury, { color: t.danger }]}>{injuryLabel(player.injury.status)}</Text>
          ) : null}
        </View>
        <Text style={[styles.detail, { color: byeNow ? t.accentText : t.muted }]} numberOfLines={1}>
          {byeNow ? `${details}  ·  on bye this week` : details}
        </Text>
        {player.contractInfo ? (
          <Text style={[styles.detail, { color: t.muted }]} numberOfLines={1}>
            {player.contractInfo}
          </Text>
        ) : null}
      </View>
      {contract ? <Text style={[styles.contract, { color: t.text }]}>{contract}</Text> : null}
    </Pressable>
  );
}

/** The badge's short form of MFL's designation: Q, D, O, IR… */
function injuryLabel(status: string): string {
  const s = status.trim();
  const short: Record<string, string> = { questionable: 'Q', doubtful: 'D', out: 'O', probable: 'P' };
  return short[s.toLowerCase()] ?? s.toUpperCase();
}

function PickRow({ pick, first, t }: { pick: MflLiveAppDraftPick; first: boolean; t: Theme }) {
  return (
    <View style={[styles.row, !first ? { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
      <Text style={[styles.name, { color: t.text }]}>{pick.label}</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  empty: { fontFamily: font.regular, fontSize: 15, marginTop: 24, textAlign: 'center', lineHeight: 21 },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  crest: { width: 44, height: 44, borderRadius: 8 },
  teamText: { flex: 1 },
  teamName: { fontFamily: font.bold, fontSize: 22 },
  teamMeta: { fontFamily: font.regular, fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { fontFamily: font.semibold, fontSize: 15 },
  pressed: { opacity: 0.7 },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  capCard: { flexDirection: 'row', flexWrap: 'wrap', padding: 14, marginBottom: 14 },
  capStat: { flex: 1, minWidth: 90 },
  capValue: { fontFamily: font.bold, fontSize: 18 },
  capLabel: { fontFamily: font.regular, fontSize: 12, marginTop: 2 },
  capNote: { fontFamily: font.regular, fontSize: 12, marginTop: 10, width: '100%' },
  section: { marginBottom: 14 },
  sectionTitle: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.5, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowEmpty: { fontFamily: font.regular, fontSize: 14, padding: 12 },
  pos: { width: 40, borderRadius: 6, paddingVertical: 4, alignItems: 'center' },
  posText: { fontFamily: font.semibold, fontSize: 12 },
  rowMain: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontFamily: font.semibold, fontSize: 15, flexShrink: 1 },
  injury: { fontFamily: font.bold, fontSize: 12 },
  detail: { fontFamily: font.regular, fontSize: 12, marginTop: 2 },
  contract: { fontFamily: font.medium, fontSize: 13 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4, marginBottom: 12 },
  noticeTitle: { fontFamily: font.semibold, fontSize: 15 },
  noticeBody: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
});
