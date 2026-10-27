import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MflLiveAppWaiverContext } from '@mfl/shared-types/mfl-live-app-l';
import { SignedOutError } from '../api';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';
import { fetchWaivers, formatMoney, submitClaims } from './api';

/** The player being added. Only what the sheet shows; the server re-checks everything. */
export interface AddDropTarget {
  id: string;
  name: string;
  position?: string;
  team?: string;
}

interface Props {
  leagueId: string;
  /** null hides the sheet. */
  player: AddDropTarget | null;
  onClose: () => void;
  /** After a claim is filed or a player added, so the caller can refresh. */
  onDone?: (message: string) => void;
}

/**
 * Add a free agent: a FAAB bid or a priority claim while waivers run, or an
 * immediate add in a first-come window, with an optional drop. The rules
 * (minimum, increment, balance, which window is open) come from the server,
 * which applies the site's own code and re-checks all of it before writing.
 */
export function AddDropSheet({ leagueId, player, onClose, onDone }: Props) {
  const t = useTheme();
  const { token, signOut } = useSession();
  const [context, setContext] = useState<MflLiveAppWaiverContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bid, setBid] = useState('');
  const [round, setRound] = useState(1);
  const [dropId, setDropId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!player) return;
    let live = true;
    setContext(null);
    setLoadError(null);
    setError(null);
    setDone(null);
    setDropId(null);
    setRound(1);
    fetchWaivers(token, leagueId)
      .then((body) => {
        if (!live) return;
        setContext(body.context);
        setBid(String(body.context.rules.minimum || 0));
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof SignedOutError) return signOut();
        setLoadError(e instanceof Error ? e.message : 'Could not load your waiver options.');
      });
    return () => {
      live = false;
    };
  }, [player, leagueId, token, signOut]);

  const immediate = context?.windowMode === 'fcfs';
  const bidding = !!context?.rules.blindBid && !immediate;
  const taken = !!player && !!context?.rosteredIds.includes(player.id);
  const full =
    context?.rosterLimit !== undefined &&
    context.activeRosterCount !== undefined &&
    context.activeRosterCount >= context.rosterLimit;

  const bidError = useMemo(() => {
    if (!bidding || !context) return null;
    const amount = Number(bid);
    if (!bid.trim() || !Number.isFinite(amount)) return 'Enter a bid.';
    if (amount < context.rules.minimum) return `The minimum bid is ${formatMoney(context.rules.minimum, context.rules.increment)}.`;
    if (context.balance !== undefined && amount > context.balance) {
      return `You have ${formatMoney(context.balance, context.rules.increment)} left.`;
    }
    return null;
  }, [bid, bidding, context]);

  const verb = immediate ? 'Add now' : context?.verb === 'Bid' ? 'Place bid' : 'Submit claim';
  const canSend = !!context?.canClaim && !taken && !bidError && !sending && !done;

  async function send() {
    if (!player || !context) return;
    setSending(true);
    setError(null);
    try {
      const result = await submitClaims(token, leagueId, {
        claims: [
          {
            addPlayerId: player.id,
            ...(bidding ? { bid: Number(bid) } : {}),
            ...(dropId ? { dropPlayerId: dropId } : {}),
          },
        ],
        ...(immediate ? {} : { round }),
        year: context.year,
      });
      setDone(result.message);
      onDone?.(result.message);
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing was filed.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={!!player} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.backdrop, { backgroundColor: t.scrim }]}
      >
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.title, { color: t.text }]}>
            {immediate ? 'Add' : context?.verb ?? 'Add'} {player?.name}
          </Text>
          {player?.position || player?.team ? (
            <Text style={[styles.sub, { color: t.muted }]}>
              {[player?.position, player?.team].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          {!context && !loadError ? <ActivityIndicator color={t.accentText} style={styles.spinner} /> : null}
          {loadError ? <Text style={[styles.error, { color: t.danger }]}>{loadError}</Text> : null}

          {context ? (
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={[styles.window, { color: t.muted }]}>
                {immediate ? 'Free agency is first come, first served right now.' : context.windowLabel}
              </Text>
              {taken ? (
                <Text style={[styles.error, { color: t.danger }]}>This player is already on a roster.</Text>
              ) : null}
              {!context.canClaim && !taken ? (
                <Text style={[styles.error, { color: t.danger }]}>
                  Claims can't be filed from the app right now. Try again shortly.
                </Text>
              ) : null}

              {bidding ? (
                <View style={styles.section}>
                  <Text style={[styles.label, { color: t.text }]}>Bid</Text>
                  <TextInput
                    value={bid}
                    onChangeText={setBid}
                    keyboardType={context.rules.increment < 1 ? 'decimal-pad' : 'number-pad'}
                    accessibilityLabel="Bid amount"
                    style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.field }]}
                  />
                  <Text style={[styles.hint, { color: bidError ? t.danger : t.muted }]}>
                    {bidError ??
                      [
                        `Minimum ${formatMoney(context.rules.minimum, context.rules.increment)}`,
                        context.balance !== undefined ? `${formatMoney(context.balance, context.rules.increment)} left` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                  </Text>
                </View>
              ) : null}

              {!immediate && context.rules.conditional && context.rules.maxRounds > 1 ? (
                <View style={styles.section}>
                  <Text style={[styles.label, { color: t.text }]}>Round</Text>
                  <View style={styles.rounds}>
                    {Array.from({ length: context.rules.maxRounds }, (_, i) => i + 1).map((n) => (
                      <Pressable
                        key={n}
                        accessibilityRole="button"
                        accessibilityState={{ selected: n === round }}
                        onPress={() => setRound(n)}
                        style={[
                          styles.round,
                          { borderColor: t.border },
                          n === round && { backgroundColor: t.accent, borderColor: t.accent },
                        ]}
                      >
                        <Text style={[styles.roundText, { color: n === round ? t.onAccent : t.text }]}>{n}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={[styles.label, { color: t.text }]}>Drop</Text>
                {full ? (
                  <Text style={[styles.hint, { color: t.muted }]}>
                    Your roster is full ({context.activeRosterCount}/{context.rosterLimit}), so pick someone to drop.
                  </Text>
                ) : null}
                {[{ id: '', name: 'Nobody', slot: 'active' as const }, ...context.roster].map((p) => {
                  const selected = (dropId ?? '') === p.id;
                  return (
                    <Pressable
                      key={p.id || 'none'}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setDropId(p.id || null)}
                      style={[styles.dropRow, { borderColor: t.border }, selected && { backgroundColor: t.field }]}
                    >
                      <Text style={[styles.dropName, { color: selected ? t.accentText : t.text }]}>{p.name}</Text>
                      {p.slot !== 'active' ? (
                        <Text style={[styles.slot, { color: t.muted }]}>{p.slot === 'ir' ? 'IR' : 'Taxi'}</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
          {done ? <Text style={[styles.done, { color: t.win }]}>{done}</Text> : null}

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.button, { borderColor: t.border }]}>
              <Text style={[styles.buttonText, { color: t.text }]}>{done ? 'Done' : 'Cancel'}</Text>
            </Pressable>
            {!done ? (
              <Pressable
                accessibilityRole="button"
                disabled={!canSend}
                onPress={send}
                style={[styles.button, { backgroundColor: t.accent, borderColor: t.accent, opacity: canSend ? 1 : 0.5 }]}
              >
                {sending ? (
                  <ActivityIndicator color={t.onAccent} />
                ) : (
                  <Text style={[styles.buttonText, { color: t.onAccent }]}>{verb}</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  title: { fontFamily: font.bold, fontSize: 20 },
  sub: { fontFamily: font.regular, fontSize: 14 },
  spinner: { marginVertical: 24 },
  body: { flexGrow: 0 },
  window: { fontFamily: font.regular, fontSize: 14, marginBottom: 8 },
  section: { marginTop: 12, gap: 6 },
  label: { fontFamily: font.semibold, fontSize: 15 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontFamily: font.medium, fontSize: 17 },
  hint: { fontFamily: font.regular, fontSize: 13 },
  rounds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  round: { borderWidth: 1, borderRadius: 999, minWidth: 40, paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center' },
  roundText: { fontFamily: font.semibold, fontSize: 15 },
  dropRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  dropName: { fontFamily: font.medium, fontSize: 15 },
  slot: { fontFamily: font.regular, fontSize: 13 },
  error: { fontFamily: font.medium, fontSize: 14 },
  done: { fontFamily: font.medium, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  button: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { fontFamily: font.semibold, fontSize: 16 },
});
