import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  MflLiveAppTradeBuilder,
  MflLiveAppTradeProposal,
  MflLiveAppTradeResult,
  MflLiveAppTrades,
  MflLiveAppTradeSide,
} from '@mfl/shared-types/mfl-live-app-trades';
import { apiGet, apiPost, SignedOutError } from '../api';
import { TradeAssetList } from '../components/TradeAssetList';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TradeBuilder'>;

function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Build a trade: pick a team, tick what you give and what you get, add a
 * note, send. As a counter (`counterOfTradeId`) it starts from the offer
 * being countered, and sending it rejects that offer once MFL takes the new one.
 */
export function TradeBuilderScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { token, signOut } = useSession();
  const { leagueId, withFranchiseId, counterOfTradeId } = route.params;
  const [partner, setPartner] = useState<string | undefined>(withFranchiseId);
  const [data, setData] = useState<MflLiveAppTradeBuilder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: counterOfTradeId ? 'Counter offer' : 'Propose a trade' });
  }, [navigation, counterOfTradeId]);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof SignedOutError) return signOut();
      setError(e instanceof Error ? e.message : fallback);
    },
    [signOut],
  );

  // The rosters, re-read whenever the partner changes.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const q = `league=${encodeURIComponent(leagueId)}${partner ? `&with=${encodeURIComponent(partner)}` : ''}`;
    apiGet<MflLiveAppTradeBuilder>(token, `/api/mfl-live/trade-builder?${q}`)
      .then((b) => !cancelled && setData(b))
      .catch((e) => !cancelled && fail(e, 'Could not load the rosters.'));
    return () => {
      cancelled = true;
    };
  }, [token, leagueId, partner, fail]);

  // A counter starts from what the original offer moved.
  useEffect(() => {
    if (!counterOfTradeId) return;
    let cancelled = false;
    apiGet<MflLiveAppTrades>(token, `/api/mfl-live/trades?league=${encodeURIComponent(leagueId)}`)
      .then((list) => {
        const offer = list.offers.find((o) => o.tradeId === counterOfTradeId);
        if (cancelled || !offer) return;
        setGive(new Set(offer.youGive.map((a) => a.id)));
        setGet(new Set(offer.youGet.map((a) => a.id)));
      })
      .catch(() => {
        // Starting from blank is fine; the owner can still build the counter.
      });
    return () => {
      cancelled = true;
    };
  }, [token, leagueId, counterOfTradeId]);

  const choosePartner = (fid: string) => {
    setPartner(fid);
    setGet(new Set());
  };

  const send = async () => {
    if (!partner) return;
    setSending(true);
    try {
      const body: MflLiveAppTradeProposal = {
        offeredTo: partner,
        give: [...give],
        get: [...get],
        comments: comments.trim() || undefined,
        counterOfTradeId,
      };
      const res = await apiPost<MflLiveAppTradeResult>(
        token,
        `/api/mfl-live/trades?league=${encodeURIComponent(leagueId)}`,
        body,
      );
      Alert.alert(res.originalStillOpen ? 'Counter sent' : res.message, res.originalStillOpen ? res.message : undefined);
      navigation.goBack();
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      Alert.alert('MFL said no', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSending(false);
    }
  };

  const side = (title: string, s: MflLiveAppTradeSide, selected: Set<string>, set: (n: Set<string>) => void) => (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.cardTitle, { color: t.text }]}>{title}</Text>
      <Text style={[styles.sub, { color: t.muted }]}>Players</Text>
      <TradeAssetList assets={s.players} empty="No players" selected={selected} onToggle={(id) => set(toggle(selected, id))} />
      {s.picks.length ? (
        <>
          <Text style={[styles.sub, { color: t.muted }]}>Draft picks</Text>
          <TradeAssetList assets={s.picks} selected={selected} onToggle={(id) => set(toggle(selected, id))} />
        </>
      ) : null}
    </View>
  );

  const partnerName = data?.theirs?.name ?? data?.teams.find((x) => x.franchiseId === partner)?.name;
  const canSend = !!data?.theirs && give.size + get.size > 0 && !sending;

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator style={styles.loading} color={t.accent} /> : null}

      {data && !partner ? (
        <>
          <Text style={[styles.section, { color: t.muted }]}>Trade with</Text>
          <View style={[styles.card, styles.flush, { backgroundColor: t.card, borderColor: t.border }]}>
            {data.teams.map((team, i) => (
              <Pressable
                key={team.franchiseId}
                accessibilityRole="button"
                onPress={() => choosePartner(team.franchiseId)}
                style={[styles.teamRow, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={[styles.teamName, { color: t.text }]}>{team.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {data && partner ? (
        <>
          <View style={styles.withRow}>
            <Text style={[styles.withText, { color: t.text }]}>With {partnerName ?? 'that team'}</Text>
            {!counterOfTradeId ? (
              <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setPartner(undefined)}>
                <Text style={[styles.change, { color: t.accentText }]}>Change</Text>
              </Pressable>
            ) : null}
          </View>
          {side('You give', data.mine, give, setGive)}
          {data.theirs ? side('You get', data.theirs, get, setGet) : null}
          <TextInput
            value={comments}
            onChangeText={setComments}
            placeholder="Add a note (optional)"
            placeholderTextColor={t.muted}
            maxLength={500}
            multiline
            style={[styles.input, { color: t.text, backgroundColor: t.field, borderColor: t.border }]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!canSend}
            onPress={send}
            style={[styles.send, { backgroundColor: t.accent }, !canSend && styles.disabled]}
          >
            {sending ? (
              <ActivityIndicator color={t.onAccent} />
            ) : (
              <Text style={[styles.sendText, { color: t.onAccent }]}>
                {counterOfTradeId ? 'Send counter' : 'Send offer'}
              </Text>
            )}
          </Pressable>
          {counterOfTradeId ? (
            <Text style={[styles.note, { color: t.muted }]}>Sending your counter rejects their original offer.</Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  loading: { marginTop: 24 },
  error: { fontFamily: font.medium, fontSize: 14 },
  section: { fontFamily: font.semibold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  flush: { padding: 0, overflow: 'hidden' },
  cardTitle: { fontFamily: font.bold, fontSize: 17, marginBottom: 4 },
  sub: { fontFamily: font.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  teamRow: { paddingVertical: 14, paddingHorizontal: 16 },
  teamName: { fontFamily: font.semibold, fontSize: 16 },
  withRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  withText: { fontFamily: font.bold, fontSize: 18, flex: 1 },
  change: { fontFamily: font.semibold, fontSize: 15 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 64, fontFamily: font.regular, fontSize: 15, textAlignVertical: 'top' },
  send: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  sendText: { fontFamily: font.bold, fontSize: 16 },
  disabled: { opacity: 0.5 },
  note: { fontFamily: font.regular, fontSize: 13, textAlign: 'center' },
});
