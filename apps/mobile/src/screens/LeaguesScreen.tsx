import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type {
  MflLiveAppLeagueChoice,
  MflLiveAppLeagues,
  MflLiveAppLeagueToggle,
} from '@mfl/shared-types/mfl-live-app-leagues';
import { ApiError, apiGet, apiPost, SignedOutError } from '../api';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

/**
 * Which leagues the app watches (docs/plans/mfl-live-store-app.md, P0-5).
 *
 * The choice lives on the server per MFL account, so it is the same one
 * `/live/settings` shows on the web. Each switch sends ONE league
 * (`{ league, enabled }`) and the server applies the rules: the last league
 * on cannot be switched off, and "all on" goes back to the default so a
 * league joined later appears by itself. The server's answer replaces the
 * list, so the screen never has to know those rules.
 *
 * Re-read every time the screen is opened, because the owner may have
 * changed it on the web in between. Pushed from More, under its own header.
 */
export function LeaguesScreen() {
  const t = useTheme();
  const { token, signOut } = useSession();
  const [leagues, setLeagues] = useState<MflLiveAppLeagueChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Leagues with a save in flight. Every switch waits while one is saving:
   * the server reads, toggles and writes the whole list, so two at once could
   * each undo the other.
   */
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const seq = useRef(0);

  const handle = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      // A refusal names a reason, not a sentence, so say it in our words;
      // a network failure already has one.
      setError(e instanceof ApiError && e.status !== 0 ? fallback : e instanceof Error ? e.message : fallback);
    },
    [signOut],
  );

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const body = await apiGet<MflLiveAppLeagues>(token, '/api/live-leagues');
      if (mine !== seq.current) return;
      setLeagues(body.leagues);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      handle(e, 'Could not load your leagues.');
    }
  }, [token, handle]);

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

  const toggle = useCallback(
    async (league: MflLiveAppLeagueChoice, enabled: boolean) => {
      if (!leagues || saving.size > 0) return;
      const previous = leagues;
      // Move the switch now; put it back if the server says no.
      setLeagues(previous.map((l) => (l.id === league.id ? { ...l, enabled } : l)));
      setSaving((s) => new Set(s).add(league.id));
      const mine = ++seq.current;
      try {
        const body = await apiPost<MflLiveAppLeagues>(token, '/api/live-leagues', {
          league: league.id,
          enabled,
        } satisfies MflLiveAppLeagueToggle);
        if (mine === seq.current) setLeagues(body.leagues);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setLeagues(previous);
        handle(
          e,
          e instanceof ApiError && e.status === 409
            ? 'At least one league has to stay on.'
            : 'Could not save that. Try again.',
        );
      } finally {
        setSaving((s) => {
          const next = new Set(s);
          next.delete(league.id);
          return next;
        });
      }
    },
    [leagues, saving, token, handle],
  );

  return (
    <ScrollView
      style={{ backgroundColor: t.ground }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.muted} />}
    >
      <Text style={[styles.lede, { color: t.muted }]}>
        Choose which leagues the app follows. The same choice is used on mfl.football/live.
      </Text>

      {error && <Text style={[styles.error, { color: t.danger }]}>{error}</Text>}

      {leagues === null && !error && <ActivityIndicator color={t.muted} style={styles.spinner} />}

      {leagues !== null && leagues.length === 0 && (
        <Text style={[styles.lede, { color: t.muted }]}>MFL did not list any leagues for your account this season.</Text>
      )}

      {leagues !== null && leagues.length > 0 && (
        <View style={[styles.list, { borderColor: t.border, backgroundColor: t.card }]}>
          {leagues.map((league, i) => (
            <View
              key={league.id}
              style={[styles.row, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <View style={styles.names}>
                <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
                  {league.name}
                </Text>
                {!!league.franchiseName && (
                  <Text style={[styles.sub, { color: t.muted }]} numberOfLines={1}>
                    {league.franchiseName}
                  </Text>
                )}
                {league.locked && (
                  <Text style={[styles.sub, { color: t.muted }]}>Your only league on. Turn another on first.</Text>
                )}
              </View>
              <Switch
                accessibilityLabel={`Watch ${league.name}`}
                value={league.enabled}
                disabled={league.locked || saving.size > 0}
                onValueChange={(on) => void toggle(league, on)}
                trackColor={{ false: t.field, true: t.accent }}
                thumbColor={t.onAccent}
              />
            </View>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 12 },
  lede: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  error: { fontFamily: font.medium, fontSize: 14 },
  spinner: { marginTop: 24 },
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, gap: 12 },
  names: { flex: 1, gap: 2 },
  name: { fontFamily: font.semibold, fontSize: 16 },
  sub: { fontFamily: font.regular, fontSize: 13 },
});
