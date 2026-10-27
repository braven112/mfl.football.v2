import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signIn } from '../api';
import { useTheme } from '../theme';

interface Props {
  onSignedIn: (token: string) => void;
}

export function SignInScreen({ onSignedIn }: Props) {
  const t = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn(username.trim(), password));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: t.ground }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={[styles.brand, { color: t.text }]}>
          MFL <Text style={{ color: t.accentText }}>Live</Text>
        </Text>
        <Text style={[styles.lede, { color: t.muted }]}>
          Sign in with your MyFantasyLeague account to see your live matchups.
        </Text>

        <Text style={[styles.label, { color: t.muted }]}>MFL username</Text>
        <TextInput
          style={[styles.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          editable={!busy}
        />

        <Text style={[styles.label, { color: t.muted }]}>Password</Text>
        <TextInput
          style={[styles.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
        />

        {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={!canSubmit}
          style={[styles.button, { backgroundColor: t.accent, opacity: canSubmit ? 1 : 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color={t.dark ? '#111113' : '#ffffff'} />
          ) : (
            <Text style={[styles.buttonText, { color: t.dark ? '#111113' : '#ffffff' }]}>Sign in</Text>
          )}
        </Pressable>

        <Text style={[styles.fine, { color: t.muted }]}>
          MFL Football is not affiliated with MyFantasyLeague or the NFL. Your password goes to MFL to sign you in and
          is never stored on this phone.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 36, fontWeight: '800', marginBottom: 8 },
  lede: { fontSize: 16, marginBottom: 28, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 16 },
  error: { fontSize: 14, marginBottom: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  fine: { fontSize: 12, marginTop: 24, lineHeight: 17 },
});
