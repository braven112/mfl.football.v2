/**
 * MFL Live's look: the AFL's design language with black where the AFL is
 * navy, gold accents, a light AND a dark theme (docs/plans/mfl-live-app.md,
 * Branding). The phone's own setting picks the theme.
 */

import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  ground: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  win: string;
  danger: string;
  field: string;
}

const light: Theme = {
  dark: false,
  ground: '#f4f4f5',
  card: '#ffffff',
  border: '#e4e4e7',
  text: '#111113',
  muted: '#52525b',
  accent: '#111113',
  accentText: '#b45309',
  win: '#15803d',
  danger: '#b91c1c',
  field: '#e4e4e7',
};

const dark: Theme = {
  dark: true,
  ground: '#0b0b0c',
  card: '#18181b',
  border: '#27272a',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  accent: '#d97706',
  accentText: '#c9a44c',
  win: '#4ade80',
  danger: '#f87171',
  field: '#27272a',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
