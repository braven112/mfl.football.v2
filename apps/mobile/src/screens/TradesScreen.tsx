import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  MflLiveAppTradeOffer,
  MflLiveAppTradeResponse,
  MflLiveAppTradeResult,
  MflLiveAppTrades,
} from '@mfl/shared-types/mfl-live-app-trades';
import { apiGet, apiPost, SignedOutError } from '../api';
import { TradeAssetList } from '../components/TradeAssetList';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Trades'>;

const ACTION_COPY: Record<MflLiveAppTradeResponse['response'], { verb: string; ask: string }> = {
  accept: { verb: 'Accept', ask: 'Accept this trade? MFL processes it right away (or sends it to your commissioner).' },
  reject: { verb: 'Reject', ask: 'Reject this offer?' },
  revoke: { verb: 'Withdraw', ask: 'Withdraw your offer?' },
};

function expiresText(expiresAt: number): string | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt * 1000);
  return `Expires ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Pending trade offers in one league: offers made to you (accept, counter,
 * reject) and offers you made (withdraw). Re-reads whenever the screen comes
 * back into view, so a trade sent from the builder shows at once.
 */
export function TradesScreen({ route, navigation }: Props) {
  const t = useTheme();
  const { token, signOut } = useSession();
  const { leagueId } = route.params;
  const [data, setData] = useState<MflLiveAppTrades | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<MflLiveAppTrades>(token, `/api/mfl-live/trades?league=${encodeURIComponent(leagueId)}`));
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) return signOut();
      setError(e instanceof Error ? e.message : 'Could not load your trades.');
    }
  }, [token, leagueId, signOut]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const respond = (offer: MflLiveAppTradeOffer, response: MflLiveAppTradeResponse['response']) => {
    const copy = ACTION_COPY[response];
    Alert.alert(`${copy.verb} trade`, copy.ask, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: copy.verb,
        style: response === 'accept' ? 'default' : 'destructive',
        onPress: async () => {
          setBusy(offer.tradeId);
          try {
            const body: MflLiveAppTradeResponse = { tradeId: offer.tradeId, response };
            const res = await apiPost<MflLiveAppTradeResult>(
              token,
              `/api/mfl-live/trade-respond?league=${encodeURIComponent(leagueId)}`,
              body,
            );
            Alert.alert(res.message);
          } catch (e) {
            if (e instanceof SignedOutError) return signOut();
            Alert.alert('MFL said no', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBusy(null);
            void load();
          }
        },
      },
    ]);
  };

  const incoming = data?.offers.filter((o) => o.direction === 'incoming') ?? [];
  const outgoing = data?.offers.filter((o) => o.direction === 'outgoing') ?? [];

  const button = (label: string, onPress: () => void, kind: 'primary' | 'plain', disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        kind === 'primary'
          ? { backgroundColor: t.accent, borderColor: t.accent }
          : { backgroundColor: t.field, borderColor: t.border },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, { color: kind === 'primary' ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );

  const card = (o: MflLiveAppTradeOffer) => {
    const isBusy = busy === o.tradeId;
    const expires = expiresText(o.expiresAt);
    return (
      <View key={o.tradeId} style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.partner, { color: t.text }]}>
          {o.direction === 'incoming' ? `From ${o.partner.name}` : `To ${o.partner.name}`}
        </Text>
        <Text style={[styles.sideTitle, { color: t.muted }]}>You give</Text>
        <TradeAssetList assets={o.youGive} empty="Nothing" />
        <Text style={[styles.sideTitle, { color: t.muted }]}>You get</Text>
        <TradeAssetList assets={o.youGet} empty="Nothing" />
        {o.comments ? <Text style={[styles.comments, { color: t.text }]}>“{o.comments}”</Text> : null}
        {expires ? <Text style={[styles.meta, { color: t.muted }]}>{expires}</Text> : null}
        <View style={styles.actions}>
          {isBusy ? (
            <ActivityIndicator color={t.accent} />
          ) : o.direction === 'incoming' ? (
            <>
              {button('Accept', () => respond(o, 'accept'), 'primary', !!busy)}
              {button(
                'Counter',
                () =>
                  navigation.navigate('TradeBuilder', {
                    leagueId,
                    withFranchiseId: o.partner.franchiseId || undefined,
                    counterOfTradeId: o.tradeId,
                  }),
                'plain',
                !!busy || !o.partner.franchiseId,
              )}
              {button('Reject', () => respond(o, 'reject'), 'plain', !!busy)}
            </>
          ) : (
            button('Withdraw', () => respond(o, 'revoke'), 'plain', !!busy)
          )}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.ground }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
    >
      {button('Propose a trade', () => navigation.navigate('TradeBuilder', { leagueId }), 'primary', false)}
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator style={styles.loading} color={t.accent} /> : null}
      {data ? (
        <>
          <Text style={[styles.section, { color: t.muted }]}>Offers to you</Text>
          {incoming.length ? incoming.map(card) : <Text style={[styles.none, { color: t.muted }]}>No offers right now.</Text>}
          <Text style={[styles.section, { color: t.muted }]}>Your offers</Text>
          {outgoing.length ? outgoing.map(card) : <Text style={[styles.none, { color: t.muted }]}>You have no open offers.</Text>}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  loading: { marginTop: 24 },
  section: { fontFamily: font.semibold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10 },
  none: { fontFamily: font.regular, fontSize: 15 },
  error: { fontFamily: font.medium, fontSize: 14 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
  partner: { fontFamily: font.bold, fontSize: 17, marginBottom: 4 },
  sideTitle: { fontFamily: font.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  comments: { fontFamily: font.regular, fontSize: 14, marginTop: 8 },
  meta: { fontFamily: font.regular, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontFamily: font.semibold, fontSize: 15 },
  disabled: { opacity: 0.5 },
});
