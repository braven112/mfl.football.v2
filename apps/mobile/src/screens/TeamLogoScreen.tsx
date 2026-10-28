import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MflLiveAppLogoChoice, MflLiveAppLogoPrompt } from '@mfl/shared-types/mfl-live-app-logo';
import type { RootStackParamList } from '../navigation/types';
import { ApiError, apiGet, apiPost, SignedOutError } from '../api';
import { useSession } from '../session-context';
import { font, useTheme, type Theme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TeamLogo'>;

/** Where the prompt goes. Web addresses, so Android opens the app when it is installed. */
const TOOLS = [
  { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { label: 'Gemini', url: 'https://gemini.google.com/app' },
  { label: 'Claude', url: 'https://claude.ai/new' },
] as const;

/**
 * Create a team logo: the owner picks a style, one or two team colors and the kind of art,
 * and gets a prompt to paste into the AI tool they already use. We make no
 * images (decided 2026-10-27: no running cost, no AI moderation for Play).
 *
 * The server writes every word of the prompt (`/api/mfl-live/logo-prompt`);
 * this screen shows the choices it is sent and re-asks after each change.
 * Share hands the prompt to Android's share sheet, which offers Copy and the
 * ChatGPT and Gemini apps directly, so no clipboard library is needed.
 */
export function TeamLogoScreen({ route }: Props) {
  const t = useTheme();
  const { leagueId } = route.params;
  const { token, signOut } = useSession();

  const [data, setData] = useState<MflLiveAppLogoPrompt | null>(null);
  const [choice, setChoice] = useState<Required<MflLiveAppLogoChoice> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      setError(e instanceof ApiError ? e.message : 'MFL Football could not write the prompt just now.');
    },
    [signOut],
  );

  useEffect(() => {
    apiGet<MflLiveAppLogoPrompt>(token, `/api/mfl-live/logo-prompt?league=${encodeURIComponent(leagueId)}`)
      .then((next) => {
        setData(next);
        setChoice(next.choice);
        setError(null);
      })
      .catch(fail);
  }, [leagueId, token, fail]);

  // Re-ask after each change, a beat after typing stops. Only the newest answer is kept.
  useEffect(() => {
    if (!choice || !data) return;
    if (
      choice.teamName === data.choice.teamName &&
      choice.idea === data.choice.idea &&
      choice.style === data.choice.style &&
      choice.colors.join() === data.choice.colors.join() &&
      choice.kind === data.choice.kind
    ) {
      return;
    }
    const n = ++asked.current;
    const timer = setTimeout(() => {
      setBusy(true);
      apiPost<MflLiveAppLogoPrompt>(token, '/api/mfl-live/logo-prompt', choice)
        .then((next) => {
          if (n !== asked.current) return;
          setData(next);
          setError(null);
        })
        .catch((e) => n === asked.current && fail(e))
        .finally(() => n === asked.current && setBusy(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [choice, data, token, fail]);

  const set = (patch: Partial<MflLiveAppLogoChoice>) => setChoice((c) => (c ? { ...c, ...patch } : c));

  // Tap a color to add it, tap it again to take it out. The first one picked is the main color.
  // When both slots are full (say, after a ready-made pair), a new color replaces the second.
  const toggleColor = (hex: string) =>
    setChoice((c) => {
      if (!c) return c;
      if (c.colors.includes(hex)) return { ...c, colors: c.colors.filter((h) => h !== hex) };
      const max = data?.maxColors ?? 2;
      if (c.colors.length >= max) return { ...c, colors: [...c.colors.slice(0, max - 1), hex] };
      return { ...c, colors: [...c.colors, hex] };
    });
  const [typedHex, setTypedHex] = useState('');
  const typedValid = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(typedHex.trim());
  const addTyped = () => {
    const raw = typedHex.trim().replace(/^#/, '');
    const hex = `#${(raw.length === 3 ? raw.replace(/./g, (ch) => ch + ch) : raw).toUpperCase()}`;
    toggleColor(hex);
    setTypedHex('');
  };

  if (!data || !choice) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: t.ground }]}>
        {error ? <Text style={[styles.body, { color: t.danger }]}>{error}</Text> : <ActivityIndicator color={t.accent} />}
      </View>
    );
  }

  const share = () => {
    Share.share({ message: data.prompt }).catch(() => undefined);
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: t.ground }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.body, { color: t.muted }]}>
        Pick a look and we’ll write the prompt. Paste it into ChatGPT or Gemini to make the picture, or into Claude for a
        vector logo.
      </Text>

      <Field t={t} label="Team name">
        <TextInput
          value={choice.teamName}
          onChangeText={(teamName) => set({ teamName })}
          placeholder={data.teamName}
          placeholderTextColor={t.muted}
          accessibilityLabel="Team name"
          style={[styles.input, { color: t.text, backgroundColor: t.field, borderColor: t.border }]}
        />
      </Field>

      <Field t={t} label="Mascot or idea">
        <TextInput
          value={choice.idea}
          onChangeText={(idea) => set({ idea })}
          placeholder="a charging boar with a football"
          placeholderTextColor={t.muted}
          maxLength={120}
          accessibilityLabel="Mascot or idea"
          style={[styles.input, { color: t.text, backgroundColor: t.field, borderColor: t.border }]}
        />
      </Field>

      <Field t={t} label="Style">
        <View style={styles.chips}>
          {data.styles.map((s) => (
            <Chip key={s.id} t={t} label={s.label} on={choice.style === s.id} onPress={() => set({ style: s.id })} />
          ))}
        </View>
      </Field>

      <Field t={t} label="Team colors that work well together">
        {/* One square per pair, split corner to corner: the second color is a triangle drawn with borders. */}
        <View style={styles.chips}>
          {data.suggestions.map((sg) => {
            const on = sg.hexes.join() === choice.colors.join();
            return (
              <Pressable
                key={sg.label}
                accessibilityRole="button"
                accessibilityLabel={sg.label}
                accessibilityState={{ selected: on }}
                onPress={() => set({ colors: [...sg.hexes] })}
                style={({ pressed }) => [
                  styles.swatch,
                  styles.pair,
                  { backgroundColor: sg.hexes[0], borderColor: on ? t.accentText : t.border, borderWidth: on ? 3 : 1 },
                  pressed ? styles.pressed : null,
                ]}
              >
                {sg.hexes[1] ? <View style={[styles.pairHalf, { borderBottomColor: sg.hexes[1] }]} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field t={t} label={`Or pick your own · up to ${data.maxColors}`}>
        <View style={styles.chips}>
          {data.colors.map((c) => {
            const at = choice.colors.indexOf(c.hex);
            const on = at >= 0;
            return (
              <Pressable
                key={c.hex}
                accessibilityRole="button"
                accessibilityLabel={c.name}
                accessibilityState={{ selected: on }}
                onPress={() => toggleColor(c.hex)}
                style={[
                  styles.swatch,
                  { backgroundColor: c.hex, borderColor: on ? t.accentText : t.border, borderWidth: on ? 3 : 1 },
                ]}
              >
                {on ? (
                  <View style={[styles.swatchBadge, { backgroundColor: t.ground }]}>
                    <Text style={[styles.swatchBadgeText, { color: t.text }]}>{at + 1}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.typedRow}>
          <TextInput
            value={typedHex}
            onChangeText={setTypedHex}
            placeholder="Or type a hex, like #7A1F2B"
            placeholderTextColor={t.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            onSubmitEditing={() => typedValid && addTyped()}
            accessibilityLabel="Your own color as a hex code"
            style={[styles.input, styles.typedInput, { color: t.text, backgroundColor: t.field, borderColor: t.border }]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!typedValid}
            onPress={addTyped}
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: t.border, backgroundColor: t.card, opacity: typedValid ? 1 : 0.4 },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.buttonText, { color: t.text }]}>Add</Text>
          </Pressable>
        </View>
        <View style={styles.chips}>
          {choice.colors.map((hex) => (
            <Pressable
              key={hex}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${data.colors.find((c) => c.hex === hex)?.name ?? hex}`}
              onPress={() => toggleColor(hex)}
              style={[styles.picked, { borderColor: t.border, backgroundColor: t.card }]}
            >
              <View style={[styles.pickedDot, { backgroundColor: hex, borderColor: t.border }]} />
              <Text style={[styles.chipText, { color: t.text }]}>
                {data.colors.find((c) => c.hex === hex)?.name ?? hex}  ✕
              </Text>
            </Pressable>
          ))}
          <Text style={[styles.hint, { color: t.muted }]}>
            {choice.colors.length === 0 ? 'No colors picked, so the prompt uses red. ' : ''}
            The logo can always use white and black as well.
          </Text>
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.hint,
            { color: data.colorNote.tone === 'good' ? t.win : data.colorNote.tone === 'weak' ? t.danger : t.muted },
          ]}
        >
          {data.colorNote.tone === 'good' ? '✓ ' : data.colorNote.tone === 'weak' ? '! ' : ''}
          {data.colorNote.text}
        </Text>
      </Field>

      <Field t={t} label="Make">
        <View style={styles.chips}>
          {data.kinds.map((k) => (
            <Chip key={k.id} t={t} label={k.label} on={choice.kind === k.id} onPress={() => set({ kind: k.id })} />
          ))}
        </View>
      </Field>

      {data.warning ? <Text style={[styles.hint, { color: t.accentText }]}>{data.warning}</Text> : null}

      <View style={[styles.promptCard, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.promptHead}>
          <Text style={[styles.label, { color: t.muted }]}>YOUR PROMPT</Text>
          {busy ? <ActivityIndicator size="small" color={t.muted} /> : null}
        </View>
        <Text selectable style={[styles.prompt, { color: t.text }]}>
          {data.prompt}
        </Text>
      </View>
      {error ? <Text style={[styles.hint, { color: t.danger }]}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        onPress={share}
        style={({ pressed }) => [styles.button, { backgroundColor: t.accent }, pressed ? styles.pressed : null]}
      >
        <Text style={[styles.buttonText, { color: t.onAccent }]}>Copy or share prompt</Text>
      </Pressable>
      <View style={styles.tools}>
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.label}
            accessibilityRole="link"
            onPress={() => Linking.openURL(tool.url).catch(() => undefined)}
            style={({ pressed }) => [
              styles.button,
              styles.tool,
              { borderColor: t.border, borderWidth: 1, backgroundColor: t.card },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.buttonText, { color: t.text }]}>Open {tool.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.hint, { color: t.muted }]}>
        {choice.kind === 'svg'
          ? 'Claude answers with SVG code, which is a logo you can resize to any size without blur.'
          : 'Ask for a few tries and keep the one that still reads when it’s tiny. A transparent background works best.'}
      </Text>
    </ScrollView>
  );
}

function Field({ t, label, children }: { t: Theme; label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.muted }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Chip({ t, label, on, onPress }: { t: Theme; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : t.card },
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.chipText, { color: on ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  field: { gap: 8 },
  label: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.5 },
  input: { fontFamily: font.regular, fontSize: 16, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontFamily: font.medium, fontSize: 14 },
  swatch: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  swatchBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pair: { overflow: 'hidden' },
  pairHalf: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    borderBottomWidth: 44,
    borderLeftWidth: 44,
    borderLeftColor: 'transparent',
  },
  swatchBadgeText: { fontFamily: font.bold, fontSize: 12 },
  typedRow: { flexDirection: 'row', gap: 8 },
  typedInput: { flex: 1 },
  addButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pickedDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
  hint: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  promptCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  promptHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  prompt: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { fontFamily: font.semibold, fontSize: 15 },
  tools: { flexDirection: 'row', gap: 8 },
  tool: { flex: 1 },
  pressed: { opacity: 0.7 },
});
