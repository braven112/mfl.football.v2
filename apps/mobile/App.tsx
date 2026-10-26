import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { signOutOnServer } from './src/api';
import { clearToken, loadToken, saveToken } from './src/session';
import { useTheme } from './src/theme';
import { SignInScreen } from './src/screens/SignInScreen';
import { MatchupsScreen } from './src/screens/MatchupsScreen';

/** Two screens, no router: signed out shows sign-in, signed in shows your matchups. */
export default function App() {
  const t = useTheme();
  // undefined = still reading the keystore; null = signed out.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    loadToken().then(setToken);
  }, []);

  const onSignedIn = useCallback(async (next: string) => {
    await saveToken(next);
    setToken(next);
  }, []);

  const onSignOut = useCallback(async () => {
    setToken(null);
    await clearToken();
    await signOutOnServer();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {token === undefined ? (
        <View style={{ flex: 1, backgroundColor: t.ground, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : token ? (
        <MatchupsScreen token={token} onSignOut={onSignOut} />
      ) : (
        <SignInScreen onSignedIn={onSignedIn} />
      )}
    </SafeAreaProvider>
  );
}
