import { Linking, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import type {
  MflLiveAppAuctionLot,
  MflLiveAppAuctionRoom,
  MflLiveAppAuctionWin,
} from '@mfl/shared-types/mfl-live-app-auction';
import type { MflLiveAppDraftPlayer } from '@mfl/shared-types/mfl-live-app-draft';
import { font, type Theme } from '../theme';

/** "$1.25M", "$425K", "$12": league money is whole dollars, from $1 to millions. */
export function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${trim(abs / 1_000)}K`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
}
function trim(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, '');
}

function playerLine(p: MflLiveAppDraftPlayer): string {
  return [p.position, p.nflTeam, p.rookie ? 'Rookie' : ''].filter(Boolean).join(' · ');
}

type Row = { kind: 'lot'; lot: MflLiveAppAuctionLot } | { kind: 'win'; win: MflLiveAppAuctionWin };

/**
 * The league's auction (slow auctions first, the owner's call on 2026-10-27):
 * who is up, the high bid and who holds it, the owner's outbid players first,
 * what the team can still spend, and who has been won.
 *
 * Read-only. MFL has no developer request for bidding or nominating, so the
 * Bid button opens MFL's own Auction Bid page in the browser (never a web view
 * inside the app).
 */
export function AuctionPanel({
  auction,
  error,
  refreshing,
  onRefresh,
  teamName,
  onPlayer,
  t,
}: {
  auction: MflLiveAppAuctionRoom | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  teamName: (id: string) => string;
  onPlayer: (playerId: string) => void;
  t: Theme;
}) {
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />;
  if (!auction) {
    return (
      <SectionList
        sections={[]}
        refreshControl={refresh}
        contentContainerStyle={styles.list}
        renderItem={() => null}
        ListHeaderComponent={
          error ? (
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.danger }]}>
              <Text style={[styles.title, { color: t.danger }]}>Couldn’t load the auction</Text>
              <Text style={[styles.sub, { color: t.muted }]}>{error}</Text>
            </View>
          ) : (
            <Text style={[styles.muted, { color: t.muted }]}>Loading the auction…</Text>
          )
        }
      />
    );
  }

  const outbid = auction.lots.filter((l) => l.outbid).length;
  const sections = [
    {
      key: 'lots',
      title: auction.lots.length ? `Up for bids (${auction.lots.length})` : 'Up for bids',
      data: auction.lots.map((lot): Row => ({ kind: 'lot', lot })),
    },
    ...(auction.won.length
      ? [{ key: 'won', title: `Won (${auction.won.length})`, data: auction.won.map((win): Row => ({ kind: 'win', win })) }]
      : []),
  ];
  const rules = [
    auction.minBid ? `Minimum bid ${money(auction.minBid)}` : '',
    auction.bidIncrement ? `raises of ${money(auction.bidIncrement)}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <SectionList
      sections={sections}
      keyExtractor={(r) => (r.kind === 'lot' ? `lot-${r.lot.player.id}` : `win-${r.win.player.id}-${r.win.wonAt ?? ''}`)}
      refreshControl={refresh}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? (
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.danger }]}>
              <Text style={[styles.title, { color: t.danger }]}>Couldn’t refresh</Text>
              <Text style={[styles.sub, { color: t.muted }]}>{error}</Text>
            </View>
          ) : null}
          {outbid ? (
            <View style={[styles.card, { backgroundColor: t.accent, borderColor: t.accent }]}>
              <Text style={[styles.title, { color: t.onAccent }]}>
                You’ve been outbid on {outbid} player{outbid === 1 ? '' : 's'}
              </Text>
              <Text style={[styles.sub, { color: t.onAccent }]}>They’re at the top of the list.</Text>
            </View>
          ) : null}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            {auction.budget ? (
              <>
                <Text style={[styles.label, { color: t.accentText }]}>
                  {auction.budget.basis === 'cap-room' ? 'Cap room left' : 'Budget left'}
                </Text>
                <Text style={[styles.headline, { color: auction.budget.left < 0 ? t.danger : t.text }]}>
                  {money(auction.budget.left)}
                </Text>
                <Text style={[styles.sub, { color: t.muted }]}>
                  {money(auction.budget.available)} {auction.budget.basis === 'cap-room' ? 'in cap room' : 'to spend'}, less{' '}
                  {money(auction.budget.committed)} in high bids you hold now.
                </Text>
              </>
            ) : (
              <Text style={[styles.sub, { color: t.muted }]}>MFL didn’t send what your team can spend just now.</Text>
            )}
            {rules ? <Text style={[styles.sub, { color: t.muted }]}>{rules}.</Text> : null}
            <Pressable
              onPress={() => Linking.openURL(auction.bidUrl)}
              accessibilityRole="link"
              style={[styles.button, { backgroundColor: t.accent }]}
            >
              <Text style={[styles.buttonText, { color: t.onAccent }]}>Bid or nominate on MyFantasyLeague</Text>
            </Pressable>
            <Text style={[styles.note, { color: t.muted }]}>Bids are placed on MFL’s Auction Bid page for now. This room shows them as they come in.</Text>
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={[styles.section, { color: t.muted }]}>{section.title}</Text>}
      renderSectionFooter={({ section }) =>
        section.key === 'lots' && !section.data.length ? (
          <Text style={[styles.muted, { color: t.muted }]}>
            {auction.status === 'none' ? `Nobody has been nominated in the ${auction.year} auction yet.` : 'Nobody is up for bids right now.'}
          </Text>
        ) : null
      }
      renderItem={({ item }) =>
        item.kind === 'lot' ? (
          <LotRow lot={item.lot} teamName={teamName} onPress={() => onPlayer(item.lot.player.id)} t={t} />
        ) : (
          <WinRow win={item.win} teamName={teamName} onPress={() => onPlayer(item.win.player.id)} t={t} />
        )
      }
    />
  );
}

function LotRow({
  lot,
  teamName,
  onPress,
  t,
}: {
  lot: MflLiveAppAuctionLot;
  teamName: (id: string) => string;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { backgroundColor: t.card, borderColor: lot.outbid ? t.accent : t.border }, lot.outbid && styles.rowStrong]}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: t.text }]} numberOfLines={1}>
          {lot.player.name}
        </Text>
        <Text style={[styles.rowSub, { color: t.muted }]}>{playerLine(lot.player)}</Text>
        <Text style={[styles.rowSub, { color: lot.mine ? t.win : lot.outbid ? t.accentText : t.muted }]} numberOfLines={1}>
          {lot.mine ? 'Your high bid' : lot.outbid ? `Outbid by ${teamName(lot.highBidder)}` : teamName(lot.highBidder)}
          {` · ${lot.bids} bid${lot.bids === 1 ? '' : 's'}`}
        </Text>
      </View>
      <Text style={[styles.amount, { color: lot.mine ? t.win : t.text }]}>{money(lot.highBid)}</Text>
    </Pressable>
  );
}

function WinRow({
  win,
  teamName,
  onPress,
  t,
}: {
  win: MflLiveAppAuctionWin;
  teamName: (id: string) => string;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: t.text }]} numberOfLines={1}>
          {win.player.name}
        </Text>
        <Text style={[styles.rowSub, { color: win.mine ? t.accentText : t.muted }]} numberOfLines={1}>
          {win.mine ? 'Won by you' : `Won by ${teamName(win.franchiseId)}`} · {playerLine(win.player)}
        </Text>
      </View>
      <Text style={[styles.amount, { color: t.muted }]}>{money(win.amount)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  header: { gap: 12, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  label: { fontFamily: font.semibold, fontSize: 13, letterSpacing: 0.5 },
  headline: { fontFamily: font.bold, fontSize: 24 },
  title: { fontFamily: font.semibold, fontSize: 15 },
  sub: { fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  note: { fontFamily: font.regular, fontSize: 12, lineHeight: 17 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { fontFamily: font.semibold, fontSize: 15 },
  section: { fontFamily: font.semibold, fontSize: 13, letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  rowStrong: { borderWidth: 2 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: font.semibold, fontSize: 15 },
  rowSub: { fontFamily: font.regular, fontSize: 13 },
  amount: { fontFamily: font.bold, fontSize: 16 },
});
