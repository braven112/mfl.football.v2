import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  MflLiveAppChatSourcePostResponse,
  MflLiveAppChatSourceRequest,
  MflLiveAppChatSourceResponse,
} from '@mfl/shared-types/mfl-live-app-n';
import { apiGet, apiPost, SignedOutError } from '../api';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

/**
 * Which chat the league's Chat tab shows: MFL's own league chat, or a GroupMe
 * group. Any owner in the league can connect one of their own groups or switch
 * back; the tab says who connected it. Leagues whose GroupMe the server runs
 * are fixed. Contract: packages/shared-types/src/mfl-live-app-n.ts.
 */
export function ChatSourcePanel({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const t = useTheme();
  const { token, signOut } = useSession();
  const [state, setState] = useState<Extract<MflLiveAppChatSourceResponse, { ok: true }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Opened the GroupMe sign-in; reload when the app comes back. */
  const awaitingSignIn = useRef(false);

  const load = useCallback(async () => {
    try {
      const body = await apiGet<MflLiveAppChatSourceResponse>(token, `/api/mfl-live/chat-source?league=${leagueId}`);
      if (!body.ok) throw new Error(body.error);
      setState(body);
      setError(null);
    } catch (e) {
      if (e instanceof SignedOutError) signOut();
      else setError("Can't load your chat settings right now.");
    }
  }, [leagueId, token, signOut]);

  useEffect(() => {
    setState(null);
    load();
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && awaitingSignIn.current) {
        awaitingSignIn.current = false;
        load();
      }
    });
    return () => sub.remove();
  }, [load]);

  const post = useCallback(
    async (req: MflLiveAppChatSourceRequest) => {
      setBusy(true);
      setError(null);
      try {
        const body = await apiPost<MflLiveAppChatSourcePostResponse>(
          token,
          `/api/mfl-live/chat-source?league=${leagueId}`,
          req,
        );
        const signInUrl = body.signInUrl;
        if (signInUrl) {
          awaitingSignIn.current = true;
          await Linking.openURL(signInUrl);
          return;
        }
        if (!body.ok) {
          setError(body.message);
          return;
        }
        await load();
        onChanged();
      } catch (e) {
        if (e instanceof SignedOutError) signOut();
        else setError('That did not go through. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [leagueId, token, signOut, load, onChanged],
  );

  const muted = { color: t.muted };
  if (!state) {
    return (
      <View style={[styles.panel, { backgroundColor: t.card, borderColor: t.border }]}>
        {error ? <Text style={[styles.body, { color: t.danger }]}>{error}</Text> : <ActivityIndicator color={t.accent} />}
      </View>
    );
  }

  const current =
    state.source === 'groupme'
      ? `GroupMe${state.groupName ? ` · ${state.groupName}` : ''}`
      : 'MFL league chat';

  return (
    <View style={[styles.panel, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.label, muted]}>This league's chat</Text>
      <Text style={[styles.current, { color: t.text }]}>{current}</Text>
      {state.connectedBy ? (
        <Text style={[styles.body, muted]}>
          Connected by {state.connectedBy.mine ? 'you' : state.connectedBy.name || `team ${state.connectedBy.franchiseId}`}
        </Text>
      ) : null}

      {state.fixed ? (
        <Text style={[styles.body, muted]}>This league's chat is set up by MFL Football.</Text>
      ) : !state.groupMe.signedIn ? (
        <>
          <Text style={[styles.body, { color: t.text }]}>
            Use your league's GroupMe here instead. Sign in to GroupMe, then pick the group.
          </Text>
          <Button label="Sign in to GroupMe" onPress={() => post({ signIn: true })} disabled={busy} primary />
        </>
      ) : (
        <>
          <Text style={[styles.label, muted]}>Your GroupMe groups</Text>
          <ScrollView style={styles.groups} nestedScrollEnabled>
            {state.groupMe.groups.length === 0 ? (
              <Text style={[styles.body, muted]}>You're not in any GroupMe groups as {state.groupMe.name}.</Text>
            ) : (
              state.groupMe.groups.map((g) => (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => post({ groupId: g.id })}
                  style={[styles.group, { borderBottomColor: t.border }]}
                >
                  <Text style={[styles.groupName, { color: t.text }]}>{g.name || 'Untitled group'}</Text>
                  <Text style={[styles.body, muted]}>{g.members} members</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </>
      )}

      {!state.fixed && state.source === 'groupme' ? (
        <Button label="Use MFL chat instead" onPress={() => post({ groupId: null })} disabled={busy} />
      ) : null}
      {error ? <Text style={[styles.body, { color: t.danger }]}>{error}</Text> : null}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary ? { backgroundColor: t.accent } : { borderColor: t.border, borderWidth: 1 },
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  label: { fontFamily: font.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  current: { fontFamily: font.semibold, fontSize: 17 },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  groups: { maxHeight: 220 },
  group: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  groupName: { fontFamily: font.semibold, fontSize: 15 },
  button: { height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontFamily: font.semibold, fontSize: 15 },
});
