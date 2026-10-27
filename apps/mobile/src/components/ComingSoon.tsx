import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font, useTheme } from '../theme';

/** A screen whose feature is still being built: says what will be here, nothing more. */
export function ComingSoon({ title, children }: { title: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: t.ground }]}>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <Text style={[styles.body, { color: t.muted }]}>Coming soon to the app. It's on the web at mfl.football/live today.</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontFamily: font.bold, fontSize: 22 },
  body: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
