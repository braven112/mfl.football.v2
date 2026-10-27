import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type {
  MflLiveAppChatCountResponse,
  MflLiveAppChatMessage,
  MflLiveAppChatPostResponse,
  MflLiveAppChatResponse,
  MflLiveAppChatSource,
} from '@mfl/shared-types/mfl-live-app-n';
import { ApiError, apiGet, apiPost, SignedOutError } from '../api';
import { useActiveTeam } from '../active-team';
import { useSession } from '../session-context';
import { TeamSwitcher } from '../components/TeamSwitcher';
import { font, useTheme, type Theme } from '../theme';

/** While you're reading the chat. */
const OPEN_POLL_MS = 10_000;
/** While it's behind another tab, only the badge count. */
const BADGE_POLL_MS = 60_000;

/**
 * The league's chat, as the active team: MFL's own league chat (package N),
 * or the league's GroupMe group when it talks there instead. Either way a
 * message sent here shows in that chat and the reverse. Opening the tab marks the chat
 * read; while another tab is in front, a light count keeps the badge current.
 */
export function ChatScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { token, signOut } = useSession();
  const { team, loading: teamsLoading, error: teamsError, reload } = useActiveTeam();
  const leagueId = team?.leagueId ?? null;

  const [messages, setMessages] = useState<MflLiveAppChatMessage[] | null>(null);
  const [maxLength, setMaxLength] = useState(500);
  const [failing, setFailing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [source, setSource] = useState<MflLiveAppChatSource>('mfl');
  const list = useRef<FlatList<MflLiveAppChatMessage>>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    navigation.setOptions({ tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined });
  }, [navigation, unread]);

  // A different league is a different chat: start clean.
  useEffect(() => {
    setMessages(null);
    setSource('mfl');
    setUnread(0);
    setSendError(null);
  }, [leagueId]);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof SignedOutError) signOut();
      else setFailing(true);
    },
    [signOut],
  );

  const load = useCallback(async () => {
    if (!leagueId || inFlight.current) return;
    inFlight.current = true;
    try {
      const body = await apiGet<MflLiveAppChatResponse>(token, `/api/mfl-live/chat?league=${leagueId}`);
      if (!body.ok) throw new Error(body.error);
      setMessages(body.messages);
      setMaxLength(body.maxLength);
      setSource(body.source ?? 'mfl');
      setUnread(0);
      setFailing(false);
    } catch (e) {
      handleError(e);
    } finally {
      inFlight.current = false;
    }
  }, [leagueId, token, handleError]);

  const loadCount = useCallback(async () => {
    if (!leagueId) return;
    try {
      const body = await apiGet<MflLiveAppChatCountResponse>(token, `/api/mfl-live/chat?league=${leagueId}&count=1`);
      if (body.ok) setUnread(body.unread);
    } catch (e) {
      if (e instanceof SignedOutError) signOut();
      // A missed count keeps the badge it had.
    }
  }, [leagueId, token, signOut]);

  // One timer, foreground only: the full chat while this tab is in front,
  // just the count while it isn't.
  useEffect(() => {
    if (!leagueId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = AppState.currentState === 'active' || AppState.currentState == null;
    let cancelled = false;
    const tick = async () => {
      await (focused ? load() : loadCount());
      if (cancelled || !active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, focused ? OPEN_POLL_MS : BADGE_POLL_MS);
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
  }, [leagueId, focused, load, loadCount]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!leagueId || !text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const body = await apiPost<MflLiveAppChatPostResponse>(token, `/api/mfl-live/chat?league=${leagueId}`, { text });
      if (!body.ok) throw new ApiError(body.message, 200);
      setDraft('');
      if (body.messages.length) setMessages(body.messages);
      else load();
    } catch (e) {
      if (e instanceof SignedOutError) signOut();
      else setSendError(e instanceof Error ? e.message : 'Your message did not send.');
    } finally {
      setSending(false);
    }
  }, [draft, leagueId, sending, token, signOut, load]);

  const header = (
    <View style={[styles.header, { borderBottomColor: t.border }]}>
      <Text style={[styles.title, { color: t.text }]}>{source === 'groupme' ? 'GroupMe' : 'League chat'}</Text>
      <TeamSwitcher />
    </View>
  );

  if (!team) {
    return (
      <View style={[styles.screen, { backgroundColor: t.ground, paddingTop: insets.top }]}>
        {header}
        <View style={styles.center}>
          <Text style={[styles.muted, { color: t.muted }]}>
            {teamsLoading ? 'Loading your leagues…' : teamsError ?? 'You have no MFL team to chat as yet.'}
          </Text>
          {!teamsLoading && teamsError ? (
            <Pressable accessibilityRole="button" onPress={reload}>
              <Text style={[styles.link, { color: t.accentText }]}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: t.ground, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header}
      {failing ? (
        <Text style={[styles.status, { color: t.danger }]}>Can't reach {source === 'groupme' ? 'GroupMe' : 'MFL'} right now. Retrying…</Text>
      ) : null}
      <FlatList
        ref={list}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages ?? []}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble message={item} t={t} />}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={[styles.muted, styles.empty, { color: t.muted }]}>
            {messages === null ? 'Loading the chat…' : 'No messages yet. Say something.'}
          </Text>
        }
      />
      {sendError ? <Text style={[styles.status, { color: t.danger }]}>{sendError}</Text> : null}
      <View style={[styles.composer, { borderTopColor: t.border, paddingBottom: 8 }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={source === 'groupme' ? `Message ${team.leagueName} on GroupMe` : `Message ${team.leagueName}`}
          placeholderTextColor={t.muted}
          maxLength={maxLength}
          multiline
          style={[styles.input, { color: t.text, backgroundColor: t.field, borderColor: t.border }]}
          accessibilityLabel="Message"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!canSend}
          onPress={send}
          style={[styles.send, { backgroundColor: canSend ? t.accent : t.field }]}
        >
          <Text style={[styles.sendText, { color: canSend ? t.onAccent : t.muted }]}>{sending ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function timeLabel(m: MflLiveAppChatMessage): string {
  if (!m.postedAt) return m.postedLabel;
  const at = new Date(m.postedAt);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Bubble({ message, t }: { message: MflLiveAppChatMessage; t: Theme }) {
  const mine = message.mine;
  return (
    <View style={[styles.row, mine ? styles.rowMine : null]}>
      {!mine && message.avatarUrl ? <Image source={{ uri: message.avatarUrl }} style={styles.avatar} /> : null}
      <View
        style={[
          styles.bubble,
          mine ? { backgroundColor: t.accent } : { backgroundColor: t.card, borderColor: t.border, borderWidth: 1 },
        ]}
      >
        {!mine ? (
          <Text style={[styles.name, { color: t.accentText }]}>
            {message.franchiseName || `Team ${message.franchiseId}`}
          </Text>
        ) : null}
        {(message.imageUrls ?? []).map((uri) => (
          <Image key={uri} source={{ uri }} style={styles.photo} resizeMode="cover" accessibilityLabel="Photo" />
        ))}
        {message.text ? (
          <Text style={[styles.text, { color: mine ? t.onAccent : t.text }]}>{message.text}</Text>
        ) : null}
        <Text style={[styles.time, { color: mine ? t.onAccent : t.muted }]}>{timeLabel(message)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: font.bold, fontSize: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  link: { fontFamily: font.semibold, fontSize: 15 },
  status: { fontFamily: font.medium, fontSize: 13, textAlign: 'center', paddingVertical: 6, paddingHorizontal: 16 },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 8, flexGrow: 1 },
  empty: { marginTop: 48 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  photo: { width: 220, height: 220, borderRadius: 10, marginVertical: 4 },
  rowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  name: { fontFamily: font.semibold, fontSize: 13 },
  text: { fontFamily: font.regular, fontSize: 16, lineHeight: 22 },
  time: { fontFamily: font.regular, fontSize: 11, opacity: 0.8, alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: font.regular,
    fontSize: 16,
  },
  send: { height: 42, borderRadius: 21, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontFamily: font.semibold, fontSize: 15 },
});
