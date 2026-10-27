import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type {
  MflLiveAppPairTvRequest,
  MflLiveAppPairTvResponse,
} from '@mfl/shared-types/mfl-live-app-pair-tv';
import { apiPost, ApiError, SignedOutError } from '../api';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../session-context';
import { font, useTheme } from '../theme';

/**
 * Pair a TV: approve the code the TV is showing, from the phone.
 *
 * The TV (mfl.football/tv, or the Google TV app) shows a six-character code
 * and a QR code for `/live/broadcast/pair?code=<CODE>`. The owner scans it
 * here (or types the code), checks it matches the TV, and taps Pair. The
 * server mints a WATCH-ONLY pass for this owner and the TV picks it up on its
 * next poll (src/utils/broadcast-tv-pairing.ts). Nothing on the phone changes.
 */

/**
 * The TV's code alphabet: no 0/O, 1/I/L or U/V. A copy of the server's
 * `USER_CODE_ALPHABET` (the app cannot import site code); the server checks
 * again, so a drift here only costs a friendlier error message.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const CODE_LENGTH = 6;
const PAIR_PATH = '/live/broadcast/pair';

/** Upper-case, drop spaces and dashes, and refuse anything off the alphabet. */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** The code out of a scanned QR: the TV's pairing link, or a bare code. */
export function codeFromScan(data: string): string | null {
  const bare = normalizeCode(data);
  if (bare) return bare;
  const match = /^https?:\/\/[^/?#]+(\/[^?#]*)\?([^#]*)/i.exec(data.trim());
  if (!match || match[1].replace(/\/$/, '') !== PAIR_PATH) return null;
  for (const pair of match[2].split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === 'code') return normalizeCode(decodeURIComponent(value.replace(/\+/g, ' ')));
  }
  return null;
}

/** "K7Q4M2" → "K7Q 4M2", the way the TV prints it. */
const formatCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

type Step =
  | { kind: 'scan' }
  | { kind: 'type' }
  | { kind: 'confirm'; code: string }
  | { kind: 'pairing'; code: string }
  | { kind: 'paired' };

/** What each refusal means to the owner. The endpoint answers each with its own status. */
function refusalMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 400) return "That isn't a TV code. Check the six characters on the TV.";
    if (e.status === 410) return 'That code has expired or was already used. Use the new code on the TV.';
    if (e.status === 429) return 'Too many tries. Wait a few minutes and try again.';
    if (e.status === 503) return "Pairing isn't available just now. Try again in a minute.";
    return e.message;
  }
  return 'Pairing failed. Try again.';
}

export function PairTvScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'PairTv'>>();
  const { token, signOut } = useSession();

  const linked = normalizeCode(route.params?.code);
  const [step, setStep] = useState<Step>(linked ? { kind: 'confirm', code: linked } : { kind: 'scan' });
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  // The camera reports the same QR many times a second; take the first.
  const scanned = useRef(false);

  function onScan(result: BarcodeScanningResult) {
    if (scanned.current) return;
    const code = codeFromScan(result.data);
    if (!code) {
      setError("That QR code isn't from an MFL Live TV.");
      return;
    }
    scanned.current = true;
    setError(null);
    setStep({ kind: 'confirm', code });
  }

  function startOver(kind: 'scan' | 'type') {
    scanned.current = false;
    setError(null);
    setTyped('');
    setStep({ kind });
  }

  async function pair(code: string) {
    setError(null);
    setStep({ kind: 'pairing', code });
    try {
      const body: MflLiveAppPairTvRequest = { code };
      await apiPost<MflLiveAppPairTvResponse>(token, '/api/broadcast-tv/approve', body);
      setStep({ kind: 'paired' });
    } catch (e) {
      if (e instanceof SignedOutError) {
        signOut();
        return;
      }
      setError(refusalMessage(e));
      setStep({ kind: 'confirm', code });
    }
  }

  const button = (label: string, onPress: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={opts.disabled}
      style={[
        styles.button,
        opts.primary
          ? { backgroundColor: t.accent, borderColor: t.accent }
          : { backgroundColor: t.card, borderColor: t.border },
        { opacity: opts.disabled ? 0.5 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: opts.primary ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );

  const errorLine = error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null;

  if (step.kind === 'paired') {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: t.ground }]}>
        <Text style={[styles.title, { color: t.text }]}>Your TV is paired</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          It opens your broadcast in a few seconds. It can only watch scores, and you can unpair it from the Broadcast
          page on mfl.football/live.
        </Text>
        {button('Done', () => navigation.goBack(), { primary: true })}
      </View>
    );
  }

  if (step.kind === 'confirm' || step.kind === 'pairing') {
    const busy = step.kind === 'pairing';
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: t.ground }]}>
        <Text style={[styles.eyebrow, { color: t.accentText }]}>Pair a TV</Text>
        <Text style={[styles.code, { color: t.text }]} accessibilityLabel={step.code.split('').join(' ')}>
          {formatCode(step.code)}
        </Text>
        <Text style={[styles.body, { color: t.muted }]}>
          Check that this matches the code on the TV. Pairing lets that TV watch your live scores. It can't change
          your lineup or anything else.
        </Text>
        {errorLine}
        <Pressable
          accessibilityRole="button"
          onPress={() => pair(step.code)}
          disabled={busy}
          style={[styles.button, { backgroundColor: t.accent, borderColor: t.accent }]}
        >
          {busy ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text style={[styles.buttonText, { color: t.onAccent }]}>Pair this TV</Text>
          )}
        </Pressable>
        {button('Scan a different code', () => startOver('scan'), { disabled: busy })}
      </View>
    );
  }

  if (step.kind === 'type') {
    const code = normalizeCode(typed);
    return (
      <KeyboardAvoidingView
        style={[styles.screen, styles.center, { backgroundColor: t.ground }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={[styles.title, { color: t.text }]}>Enter the code on your TV</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          On the TV, open the MFL Live app or go to mfl.football/tv. It shows a six-character code.
        </Text>
        <TextInput
          style={[styles.input, { color: t.text, backgroundColor: t.field, borderColor: t.border }]}
          value={typed}
          onChangeText={(v) => {
            setTyped(v);
            setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={CODE_LENGTH + 1}
          placeholder="ABC 234"
          placeholderTextColor={t.muted}
          returnKeyType="go"
          onSubmitEditing={() => code && setStep({ kind: 'confirm', code })}
          accessibilityLabel="TV code"
        />
        {errorLine}
        {button('Continue', () => code && setStep({ kind: 'confirm', code }), { primary: true, disabled: !code })}
        {button('Scan the QR code instead', () => startOver('scan'))}
      </KeyboardAvoidingView>
    );
  }

  // Scanning. The camera needs the owner's permission first.
  if (!permission) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: t.ground }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: t.ground }]}>
        <Text style={[styles.title, { color: t.text }]}>Scan the code on your TV</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          {permission.canAskAgain
            ? 'MFL Football uses the camera only to read the QR code on your TV.'
            : 'Camera access is off for MFL Football. Turn it on in Settings to scan, or type the code instead.'}
        </Text>
        {permission.canAskAgain
          ? button('Allow camera', () => void requestPermission(), { primary: true })
          : button('Open Settings', () => void Linking.openSettings(), { primary: true })}
        {button('Type the code instead', () => startOver('type'))}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: t.ground }]}>
      <View style={[styles.cameraWrap, { borderColor: t.border }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
      </View>
      <View style={styles.below}>
        <Text style={[styles.body, { color: t.muted }]}>
          Point your camera at the QR code on the TV. On the TV, open the MFL Live app or go to mfl.football/tv.
        </Text>
        {errorLine}
        {button('Type the code instead', () => startOver('type'))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24 },
  center: { justifyContent: 'center', alignItems: 'stretch', gap: 12 },
  cameraWrap: { flex: 1, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  below: { paddingTop: 16, gap: 12 },
  eyebrow: { fontFamily: font.semibold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  title: { fontFamily: font.bold, fontSize: 22, textAlign: 'center' },
  code: { fontFamily: font.bold, fontSize: 40, letterSpacing: 4, textAlign: 'center' },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  error: { fontFamily: font.regular, fontSize: 14, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: font.semibold,
    fontSize: 24,
    letterSpacing: 4,
    textAlign: 'center',
  },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontFamily: font.bold, fontSize: 16 },
});
