/**
 * MFL Live's look: the web board's black and red (`html.dark[data-league="mfl"]`
 * in src/styles/league-themes.generated.css), and its font, Vend Sans.
 *
 * One theme for now, on the owner's call (2026-10-27): no light theme until
 * the app's core features are right. `useTheme` stays the one way a screen
 * reads colours, so a second theme later is a change to this file only.
 */

export interface Theme {
  dark: boolean;
  ground: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  /** Text on an `accent` fill. */
  onAccent: string;
  accentText: string;
  win: string;
  danger: string;
  field: string;
}

const mflLive: Theme = {
  dark: true,
  ground: '#14161a',
  card: '#1e2126',
  border: '#3a3f47',
  text: '#eef0f2',
  muted: '#9aa0a9',
  accent: '#d81b41',
  onAccent: '#ffffff',
  accentText: '#ef5350',
  win: '#4ade80',
  danger: '#ff8a80',
  field: '#282c33',
};

export function useTheme(): Theme {
  return mflLive;
}

/**
 * Vend Sans, loaded in App.tsx. React Native picks a weight by FAMILY name, not
 * by `fontWeight`, so every text style names one of these instead.
 */
export const font = {
  regular: 'VendSans_400Regular',
  medium: 'VendSans_500Medium',
  semibold: 'VendSans_600SemiBold',
  bold: 'VendSans_700Bold',
} as const;
