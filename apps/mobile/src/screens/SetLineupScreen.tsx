import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  MflLiveAppLineup,
  MflLiveAppLineupMode,
  MflLiveAppLineupPlayer,
  MflLiveAppLineupSubmitResponse,
} from '@mfl/shared-types/mfl-live-app-j';
import { ApiError, apiGet, apiPost, SignedOutError } from '../api';
import { gameStateLabel, points, winSplit } from '../format';
import { useSession } from '../session-context';
import { font, useTheme, type Theme } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SetLineup'>;

/**
 * Set a lineup in any MFL league the account owns a team in (package J).
 *
 * The server decides everything that is a rule: which slots a player may
 * fill, whose game has locked, who is out or on bye, and what the slots MEAN
 * (`mode`). Above all it keeps "no lineup on file" apart from "couldn't read
 * it": a lineup MFL wouldn't show us can't be saved over from here, because
 * one tap would replace the lineup the owner really had. The phone only
 * moves players between slots.
 */
export function SetLineupScreen({ route }: Props) {
  const { leagueId } = route.params;
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { token, signOut } = useSession();

  const [week, setWeek] = useState<number | null>(null);
  const [lineup, setLineup] = useState<MflLiveAppLineup | null>(null);
  const [slots, setSlots] = useState<(string | null)[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    async (forWeek: number | null) => {
      try {
        const query = `league=${encodeURIComponent(leagueId)}${forWeek ? `&week=${forWeek}` : ''}`;
        const next = await apiGet<MflLiveAppLineup>(token, `/api/mfl-live/lineup?${query}`);
        setLineup(next);
        setWeek(next.week);
        setSlots(next.slots.map((s) => s.playerId));
        setLoadError(null);
      } catch (e) {
        if (e instanceof SignedOutError) {
          signOut();
          return;
        }
        setLoadError(e instanceof Error ? e.message : 'Couldn’t load your lineup.');
      }
    },
    [leagueId, token, signOut],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setResult(null);
    await load(week);
    setRefreshing(false);
  }, [load, week]);

  const changeWeek = useCallback(
    (delta: number) => {
      if (!week) return;
      const next = Math.min(22, Math.max(1, week + delta));
      if (next === week) return;
      setResult(null);
      setLineup(null);
      setWeek(next);
      load(next);
    },
    [week, load],
  );

  const players = useMemo(() => new Map((lineup?.players ?? []).map((p) => [p.id, p])), [lineup]);
  const dirty = !!lineup && slots.some((id, i) => id !== lineup.slots[i]?.playerId);
  const warnings = lineup ? lineupWarnings(lineup, slots, players) : [];
  const blocking = (lineup?.problems ?? []).filter((p) => p.severity === 'blocking');
  const allFilled = slots.length > 0 && slots.every(Boolean);
  const canSave =
    !!lineup && !saving && allFilled && blocking.length === 0
    && (dirty ? lineup.canSubmit : lineup.canSubmitUnsaved);

  const save = useCallback(async () => {
    if (!lineup || !canSave) return;
    setSaving(true);
    setResult(null);
    try {
      const body = await apiPost<MflLiveAppLineupSubmitResponse>(
        token,
        `/api/mfl-live/lineup?league=${encodeURIComponent(leagueId)}`,
        { week: lineup.week, starters: slots as string[] },
      );
      if ('success' in body && body.success) {
        setResult({ ok: true, text: 'Lineup saved to MFL.' });
        await load(lineup.week);
      } else {
        setResult({ ok: false, text: 'error' in body ? body.error : 'MFL didn’t save the lineup.' });
      }
    } catch (e) {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      setResult({
        ok: false,
        text: e instanceof ApiError ? e.message : 'Couldn’t reach MFL Football. Your lineup wasn’t changed.',
      });
    } finally {
      setSaving(false);
    }
  }, [lineup, canSave, token, leagueId, slots, load, signOut]);

  const bench = (lineup?.players ?? []).filter((p) => !slots.includes(p.id));

  return (
    <View style={[styles.screen, { backgroundColor: t.ground }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        {lineup ? (
          <Text numberOfLines={1} style={[styles.team, { color: t.muted }]}>
            {lineup.leagueName}  ·  {lineup.franchiseName}
          </Text>
        ) : null}

        <View style={styles.weekRow}>
          <WeekButton t={t} label="Previous week" glyph="‹" disabled={!week || week <= 1} onPress={() => changeWeek(-1)} />
          <Text style={[styles.week, { color: t.text }]}>{week ? `Week ${week}` : 'Lineup'}</Text>
          <WeekButton t={t} label="Next week" glyph="›" disabled={!week || week >= 22} onPress={() => changeWeek(1)} />
        </View>

        {!lineup && !loadError ? <ActivityIndicator color={t.accent} style={styles.spinner} /> : null}
        {!lineup && loadError ? (
          <Banner t={t} tone="danger" title="Couldn’t load your lineup" body={`${loadError} Pull down to try again.`} />
        ) : null}

        {lineup ? (
          <>
            <MatchupCard t={t} lineup={lineup} edited={dirty ? editedTotal(slots, players) : null} />

            <ModeBanner t={t} lineup={lineup} dirty={dirty} />

            {blocking.map((p) => (
              <Banner key={`${p.kind}-${p.playerId ?? ''}`} t={t} tone="danger" title={p.title} body={p.detail} />
            ))}

            {/* The who's-out warning: only while the season is on and the week can still change. */}
            {lineup.inSeason && lineup.canSubmit && warnings.length > 0 ? (
              <View style={[styles.banner, { backgroundColor: t.card, borderColor: t.accent }]}>
                <Text style={[styles.bannerTitle, { color: t.accentText }]}>
                  {warnings.length === 1 ? 'One starter won’t score' : `${warnings.length} starters won’t score`}
                </Text>
                {warnings.map((w) => (
                  <Text key={w} style={[styles.bannerBody, { color: t.text }]}>
                    {w}
                  </Text>
                ))}
              </View>
            ) : null}

            {lineup.supported ? (
              <>
                <Text style={[styles.section, { color: t.muted }]}>STARTERS</Text>
                {lineup.slots.map((slot, i) => {
                  const player = slots[i] ? players.get(slots[i] as string) ?? null : null;
                  const locked = slot.locked || !!player?.locked;
                  const editable = lineup.canSubmit && !locked;
                  return (
                    <Pressable
                      key={`${slot.position}-${i}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${slot.position}: ${player ? player.name : 'empty'}${locked ? ', locked' : ''}`}
                      disabled={!editable}
                      onPress={() => setPicking(i)}
                      style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}
                    >
                      <Text style={[styles.slot, { color: t.accentText }]}>{slot.position}</Text>
                      <PlayerLine t={t} player={player} week={lineup.week} />
                      <Text style={[styles.trail, { color: t.muted }]}>{locked ? 'Locked' : ''}</Text>
                    </Pressable>
                  );
                })}

                <Text style={[styles.section, { color: t.muted }]}>BENCH</Text>
                {bench.length === 0 ? <Text style={[styles.muted, { color: t.muted }]}>Nobody on the bench.</Text> : null}
                {bench.map((p) => (
                  <View key={p.id} style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
                    <Text style={[styles.slot, { color: t.muted }]}>{benchLabel(p)}</Text>
                    <PlayerLine t={t} player={p} week={lineup.week} />
                    <Text style={[styles.trail, { color: t.muted }]}>{p.locked ? 'Locked' : ''}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {lineup?.supported && lineup.canSubmit ? (
        <View style={[styles.bar, { backgroundColor: t.ground, borderTopColor: t.border, paddingBottom: insets.bottom + 12 }]}>
          {result ? (
            <Text style={[styles.result, { color: result.ok ? t.win : t.danger }]}>{result.text}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={save}
            style={[styles.save, { backgroundColor: canSave ? t.accent : t.field }]}
          >
            {saving ? (
              <ActivityIndicator color={t.onAccent} />
            ) : (
              <Text style={[styles.saveText, { color: canSave ? t.onAccent : t.muted }]}>
                {saveLabel({ dirty, allFilled, blocked: blocking.length > 0, mode: lineup.mode })}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {lineup && picking !== null ? (
        <PickSheet
          t={t}
          lineup={lineup}
          slots={slots}
          slotIndex={picking}
          players={players}
          onClose={() => setPicking(null)}
          onPick={(playerId) => {
            setSlots((current) => placePlayer(lineup, current, picking, playerId, players));
            setResult(null);
            setPicking(null);
          }}
        />
      ) : null}
    </View>
  );
}

function benchLabel(p: MflLiveAppLineupPlayer): string {
  if (p.rosterStatus === 'INJURED_RESERVE') return 'IR';
  if (p.rosterStatus === 'TAXI_SQUAD') return 'TAXI';
  return 'BN';
}

/** An edited lineup's total: each starter's projected final, as Matchups adds them up. */
function editedTotal(slots: (string | null)[], players: Map<string, MflLiveAppLineupPlayer>): number {
  return slots.reduce((sum, id) => sum + ((id && players.get(id)?.projectedFinal) || 0), 0);
}

/** Starters who won't score, from the server's own per-player flags. */
function lineupWarnings(
  lineup: MflLiveAppLineup,
  slots: (string | null)[],
  players: Map<string, MflLiveAppLineupPlayer>,
): string[] {
  const out: string[] = [];
  lineup.slots.forEach((slot, i) => {
    if (slot.locked) return;
    const id = slots[i];
    if (!id) {
      out.push(`Your ${slot.position} slot is empty.`);
      return;
    }
    const p = players.get(id);
    if (!p || p.locked) return;
    if (p.isBye) out.push(`${p.name} is on bye in Week ${lineup.week}.`);
    else if (p.out) out.push(`${p.name} is ruled ${p.injury ?? 'out'}.`);
  });
  return out;
}

/** Players a slot may take right now, best projection first. */
function candidatesFor(
  lineup: MflLiveAppLineup,
  slots: (string | null)[],
  slotIndex: number,
  players: Map<string, MflLiveAppLineupPlayer>,
): MflLiveAppLineupPlayer[] {
  const slotType = lineup.slots[slotIndex].position;
  return lineup.players
    .filter((p) => p.canStart && !p.locked && p.slots.includes(slotType) && p.id !== slots[slotIndex])
    // The server's per-position maximums, checked on the lineup the tap would make.
    .filter((p) => withinMaximums(lineup, placePlayer(lineup, slots, slotIndex, p.id, players), players))
    .sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1));
}

function withinMaximums(
  lineup: MflLiveAppLineup,
  slots: (string | null)[],
  players: Map<string, MflLiveAppLineupPlayer>,
): boolean {
  const counts = new Map<string, number>();
  for (const id of slots) {
    const pos = id ? players.get(id)?.position : undefined;
    if (pos) counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  return [...counts].every(([pos, n]) => lineup.positionMax[pos] === undefined || n <= lineup.positionMax[pos]);
}

/** Seat a player in a slot. A starter moved from another slot trades places when the swap is legal. */
function placePlayer(
  lineup: MflLiveAppLineup,
  slots: (string | null)[],
  slotIndex: number,
  playerId: string | null,
  players: Map<string, MflLiveAppLineupPlayer>,
): (string | null)[] {
  const next = [...slots];
  const displaced = next[slotIndex];
  const from = playerId ? next.indexOf(playerId) : -1;
  next[slotIndex] = playerId;
  if (from >= 0 && from !== slotIndex) {
    const d = displaced ? players.get(displaced) : null;
    next[from] = d && d.slots.includes(lineup.slots[from].position) ? displaced : null;
  }
  return next;
}

function saveLabel(s: { dirty: boolean; allFilled: boolean; blocked: boolean; mode: MflLiveAppLineupMode }): string {
  if (s.blocked) return 'Fix the problem above to save';
  if (!s.allFilled) return 'Fill every slot to save';
  if (s.dirty) return 'Save lineup';
  if (s.mode === 'unsaved-offer') return 'Save this lineup';
  return 'Lineup saved';
}

function ModeBanner({ t, lineup, dirty }: { t: Theme; lineup: MflLiveAppLineup; dirty: boolean }) {
  if (!lineup.supported) {
    return (
      <Banner
        t={t}
        tone="danger"
        title="Can’t set this league’s lineup here yet"
        body="We couldn’t read this league’s lineup rules from MFL. Set it on MFL’s site for now."
      />
    );
  }
  switch (lineup.mode) {
    case 'saved':
      return dirty ? null : <Banner t={t} title="Your saved lineup" body="Tap a starter to change him." />;
    case 'saved-partial':
      return (
        <Banner t={t} tone="danger" title="Your saved lineup has a gap" body="A starter you saved is no longer on your roster. Fill the empty slot." />
      );
    case 'saved-from-cache':
      return (
        <Banner t={t} title="Showing your last known lineup" body="MFL didn’t answer just now, so this may not include today’s changes. Pull down to try again." />
      );
    case 'unsaved-offer':
      return (
        <Banner
          t={t}
          tone="accent"
          title="No lineup saved for this week"
          body={lineup.fillIsProjected
            ? 'This is your best lineup by projection. Save it, or change it first.'
            : 'MFL has no projections yet, so set each slot yourself.'}
        />
      );
    case 'read-failed':
      return (
        <Banner
          t={t}
          tone="danger"
          title="Couldn’t read your saved lineup"
          body="MFL didn’t tell us what you have saved, so saving is off to protect it. Pull down to try again."
        />
      );
    case 'past-unset':
      return <Banner t={t} title="No lineup was set this week" body="This week has been played." />;
    case 'week-unscheduled':
      return <Banner t={t} title="No games this week" body="Your league’s season doesn’t include this week." />;
    case 'franchise-unlisted':
      return <Banner t={t} title="You don’t play this week" body="MFL doesn’t list your team for this week, so there’s no lineup to set." />;
  }
}

/**
 * One player, with this week's matchup numbers — the same projection, live
 * points and game state the Matchups tab shows for him.
 */
function PlayerLine({ t, player, week }: { t: Theme; player: MflLiveAppLineupPlayer | null; week: number }) {
  if (!player) {
    return (
      <View style={styles.player}>
        <Text style={[styles.name, { color: t.muted }]}>Empty</Text>
      </View>
    );
  }
  const flag = player.isBye ? `Bye wk ${week}` : player.injury;
  const started = player.live !== null && player.gameState !== null && player.gameState !== 'not-started';
  return (
    <>
      <View style={styles.player}>
        <Text numberOfLines={1} style={[styles.name, { color: t.text }]}>
          {player.name}
        </Text>
        <Text numberOfLines={1} style={[styles.sub, { color: t.muted }]}>
          {player.position}
          {player.nflTeam ? `  ·  ${player.nflTeam}` : ''}
          {player.opponent ? ` ${player.opponent}` : ''}
          {player.gameState && player.gameState !== 'not-started' ? `  ·  ${gameStateLabel(player.gameState)}` : ''}
          {flag ? (
            <Text style={{ color: player.out || player.isBye ? t.danger : t.accentText }}>{`  ·  ${flag}`}</Text>
          ) : null}
        </Text>
      </View>
      <View style={styles.points}>
        <Text style={[styles.pointsMain, { color: started ? t.text : t.muted }]}>
          {started ? points(player.live as number) : player.projection !== null ? points(player.projection) : '–'}
        </Text>
        <Text style={[styles.pointsSub, { color: t.muted }]}>
          {started
            ? player.projectedFinal !== null && player.gameState === 'in-progress'
              ? `proj ${points(player.projectedFinal)}`
              : ''
            : player.projection !== null ? 'proj' : ''}
        </Text>
      </View>
    </>
  );
}

/** This week's fantasy game(s), with the Matchups tab's numbers. */
function MatchupCard(props: { t: Theme; lineup: MflLiveAppLineup; edited: number | null }) {
  const { t, lineup, edited } = props;
  return (
    <>
      {lineup.matchups.map((m) => {
        const [mine, theirs] = m.winProbability !== null ? winSplit(m.winProbability) : [null, null];
        return (
          <View key={m.opponentId} style={[styles.matchup, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.matchupSide}>
              <Text numberOfLines={1} style={[styles.matchupName, { color: t.text }]}>{lineup.franchiseName}</Text>
              <Text style={[styles.matchupScore, { color: t.text }]}>
                {lineup.scoring ? points(m.mine.live) : points(m.mine.projectedFinal)}
              </Text>
              <Text style={[styles.matchupSub, { color: t.muted }]}>
                {lineup.scoring ? `proj ${points(m.mine.projectedFinal)}` : 'projected'}
                {mine !== null && lineup.scoring ? `  ·  ${mine}%` : ''}
              </Text>
            </View>
            <Text style={[styles.matchupVs, { color: t.muted }]}>{m.isHome ? 'vs' : '@'}</Text>
            <View style={[styles.matchupSide, styles.matchupRight]}>
              <Text numberOfLines={1} style={[styles.matchupName, { color: t.text }]}>{m.opponentName}</Text>
              <Text style={[styles.matchupScore, { color: t.text }]}>
                {lineup.scoring ? points(m.opponent.live) : points(m.opponent.projectedFinal)}
              </Text>
              <Text style={[styles.matchupSub, { color: t.muted }]}>
                {lineup.scoring ? `proj ${points(m.opponent.projectedFinal)}` : 'projected'}
                {theirs !== null && lineup.scoring ? `  ·  ${theirs}%` : ''}
              </Text>
            </View>
          </View>
        );
      })}
      {edited !== null ? (
        <Text style={[styles.edited, { color: t.accentText }]}>This lineup projects {points(edited)}</Text>
      ) : null}
    </>
  );
}

function PickSheet(props: {
  t: Theme;
  lineup: MflLiveAppLineup;
  slots: (string | null)[];
  slotIndex: number;
  players: Map<string, MflLiveAppLineupPlayer>;
  onClose: () => void;
  onPick: (playerId: string | null) => void;
}) {
  const { t, lineup, slots, slotIndex, players, onClose, onPick } = props;
  const options = candidatesFor(lineup, slots, slotIndex, players);
  const current = slots[slotIndex];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: t.scrim }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border }]} onPress={() => undefined}>
          <Text style={[styles.sheetTitle, { color: t.text }]}>Start at {lineup.slots[slotIndex].position}</Text>
          <ScrollView>
            {options.length === 0 ? (
              <Text style={[styles.muted, { color: t.muted }]}>Nobody else can play this slot right now.</Text>
            ) : null}
            {options.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                onPress={() => onPick(p.id)}
                style={[styles.sheetRow, { borderColor: t.border }]}
              >
                <PlayerLine t={t} player={p} week={lineup.week} />
                {slots.includes(p.id) ? <Text style={[styles.trail, { color: t.muted }]}>Starting</Text> : null}
              </Pressable>
            ))}
            {current ? (
              <Pressable accessibilityRole="button" onPress={() => onPick(null)} style={[styles.sheetRow, { borderColor: t.border }]}>
                <Text style={[styles.name, { color: t.accentText }]}>Move to bench</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function WeekButton(props: { t: Theme; label: string; glyph: string; disabled: boolean; onPress: () => void }) {
  const { t, label, glyph, disabled, onPress } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={12}
      style={[styles.weekButton, { borderColor: t.border, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[styles.weekGlyph, { color: t.text }]}>{glyph}</Text>
    </Pressable>
  );
}

function Banner(props: { t: Theme; title: string; body: string; tone?: 'danger' | 'accent' }) {
  const { t, title, body, tone } = props;
  const edge = tone === 'danger' ? t.danger : tone === 'accent' ? t.accent : t.border;
  return (
    <View style={[styles.banner, { backgroundColor: t.card, borderColor: edge }]}>
      <Text style={[styles.bannerTitle, { color: tone === 'danger' ? t.danger : t.text }]}>{title}</Text>
      <Text style={[styles.bannerBody, { color: t.muted }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 8 },
  team: { fontFamily: font.medium, fontSize: 13, textAlign: 'center' },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 4 },
  week: { fontFamily: font.bold, fontSize: 20, minWidth: 96, textAlign: 'center' },
  weekButton: { borderWidth: 1, borderRadius: 999, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  weekGlyph: { fontFamily: font.bold, fontSize: 20, lineHeight: 22 },
  spinner: { marginTop: 32 },
  banner: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 10, padding: 12, gap: 4 },
  bannerTitle: { fontFamily: font.semibold, fontSize: 15 },
  bannerBody: { fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  section: { fontFamily: font.semibold, fontSize: 12, letterSpacing: 1, marginTop: 12 },
  muted: { fontFamily: font.regular, fontSize: 14, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 12 },
  slot: { fontFamily: font.bold, fontSize: 13, width: 44 },
  player: { flex: 1, gap: 2 },
  name: { fontFamily: font.semibold, fontSize: 15 },
  sub: { fontFamily: font.regular, fontSize: 13 },
  trail: { fontFamily: font.medium, fontSize: 12 },
  points: { alignItems: 'flex-end', minWidth: 52 },
  pointsMain: { fontFamily: font.bold, fontSize: 16 },
  pointsSub: { fontFamily: font.regular, fontSize: 11 },
  matchup: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  matchupSide: { flex: 1, gap: 2 },
  matchupRight: { alignItems: 'flex-end' },
  matchupName: { fontFamily: font.semibold, fontSize: 14 },
  matchupScore: { fontFamily: font.bold, fontSize: 24 },
  matchupSub: { fontFamily: font.regular, fontSize: 12 },
  matchupVs: { fontFamily: font.medium, fontSize: 13 },
  edited: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, paddingTop: 12, paddingHorizontal: 16, gap: 8 },
  result: { fontFamily: font.medium, fontSize: 14, flexShrink: 1 },
  save: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveText: { fontFamily: font.bold, fontSize: 16 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  sheetTitle: { fontFamily: font.bold, fontSize: 18, marginBottom: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
});
