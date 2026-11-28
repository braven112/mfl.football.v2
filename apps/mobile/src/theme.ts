/**
 * The app's look. By default it is MFL Football's black and red (the web
 * board's `html.dark[data-league="mfl"]` in
 * src/styles/league-themes.generated.css) and its font, Vend Sans.
 *
 * An owner in one of the leagues this site runs may wear that league's look
 * instead (store-app plan decision 22): its colors, and its logo at the top of
 * Matchups. The server sends each league's colors, built from the league's own
 * website theme (`GET /api/mfl-live/league-themes`); the choice lives in More
 * and is kept on this phone. Dark only: the app has no light theme.
 *
 * `useTheme` stays the one way a screen reads colors, so every screen follows
 * the choice with no change of its own.
 */

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import type {
  MflLiveAppLeagueTheme,
  MflLiveAppLeagueThemesResponse,
} from '@mfl/shared-types/mfl-live-app-themes';
import { apiGet } from './api';

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
  /** Dims the screen behind a sheet or menu. */
  scrim: string;
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
  scrim: 'rgba(0, 0, 0, 0.6)',
};

/** The choice that means "MFL Football's own black and red". */
export const MFL_THEME = 'mfl';

const HEX = /^#[0-9a-f]{6}$/i;
const ROLES = ['ground', 'card', 'border', 'field', 'text', 'muted', 'accent', 'onAccent', 'accentText'] as const;

/** MFL Football's colors with a league's laid over them; a role the league lacks stays black and red. */
export function themeFor(league: MflLiveAppLeagueTheme | null): Theme {
  if (!league) return mflLive;
  const out: Theme = { ...mflLive };
  for (const role of ROLES) {
    const value = league.colors[role];
    if (value && HEX.test(value)) out[role] = value;
  }
  // A fill and the text on it only make sense together.
  if (!league.colors.accent || !league.colors.onAccent) {
    out.accent = mflLive.accent;
    out.onAccent = mflLive.onAccent;
  }
  return out;
}

/**
 * Which theme to wear: the saved choice if this account still has that
 * league, MFL Football if that was chosen, otherwise the first of the
 * account's leagues on our platform.
 */
export function resolveChoice(saved: string | null, options: readonly MflLiveAppLeagueTheme[]): string {
  if (saved === MFL_THEME) return MFL_THEME;
  if (saved && options.some((o) => o.slug === saved)) return saved;
  return options[0]?.slug ?? MFL_THEME;
}

interface Saved {
  choice: string;
  /** The chosen league as last read, so a launch paints it before the server answers. */
  league: MflLiveAppLeagueTheme | null;
}

const KEY = 'mfl-football-theme';

async function loadSaved(): Promise<Saved | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    return typeof parsed?.choice === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function save(value: Saved | null): void {
  const write = value ? SecureStore.setItemAsync(KEY, JSON.stringify(value)) : SecureStore.deleteItemAsync(KEY);
  write.catch(() => {
    // A choice that could not be saved is asked again next launch; nothing else depends on it.
  });
}

export interface ThemeChoice {
  /** `MFL_THEME` or a league's slug. */
  choice: string;
  /** The account's leagues on our platform; [] hides the Theme choice. */
  options: MflLiveAppLeagueTheme[];
  /** The league being worn, or null for MFL Football's own look. */
  league: MflLiveAppLeagueTheme | null;
  setChoice: (choice: string) => void;
}

interface ThemeState extends ThemeChoice {
  theme: Theme;
}

const noop = () => {};
const ThemeContext = createContext<ThemeState>({
  theme: mflLive,
  choice: MFL_THEME,
  options: [],
  league: null,
  setChoice: noop,
});

/**
 * Wraps the whole app. `token` is the session (undefined while it is still
 * being read, null when signed out): signed in, it reads which leagues may
 * theme the app; signed out, it forgets the choice, since the next account
 * may not be in that league.
 */
export function ThemeProvider({ token, children }: { token: string | null | undefined; children: ReactNode }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  /** The phone's saved choice has been read (so it is never overwritten unread). */
  const [loaded, setLoaded] = useState(false);
  const [options, setOptions] = useState<MflLiveAppLeagueTheme[] | null>(null);

  useEffect(() => {
    void loadSaved().then((s) => {
      setSaved((cur) => cur ?? s);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (token === undefined) return;
    if (token === null) {
      setOptions(null);
      setSaved(null);
      save(null);
      return;
    }
    let live = true;
    apiGet<MflLiveAppLeagueThemesResponse>(token, '/api/mfl-live/league-themes')
      .then((body) => {
        if (live && body.ok) setOptions(body.themes);
      })
      .catch(() => {
        // Keep whatever is being worn; the next launch asks again.
      });
    return () => {
      live = false;
    };
  }, [token]);

  // Until the server answers, wear what was saved.
  const choice = options ? resolveChoice(saved?.choice ?? null, options) : saved?.choice ?? MFL_THEME;
  const league = options
    ? options.find((o) => o.slug === choice) ?? null
    : choice === MFL_THEME
      ? null
      : saved?.league ?? null;

  // Remember the resolved pick with its latest colors.
  useEffect(() => {
    if (!options || !loaded) return;
    const next: Saved = { choice, league };
    if (saved?.choice !== next.choice || JSON.stringify(saved?.league) !== JSON.stringify(next.league)) {
      setSaved(next);
      save(next);
    }
  }, [options, loaded, choice, league, saved]);

  const setChoice = useCallback(
    (next: string) => {
      const picked = next === MFL_THEME ? null : options?.find((o) => o.slug === next) ?? null;
      if (next !== MFL_THEME && !picked) return;
      const value: Saved = { choice: next, league: picked };
      setSaved(value);
      save(value);
    },
    [options],
  );

  const value = useMemo<ThemeState>(
    () => ({ theme: themeFor(league), choice, options: options ?? [], league, setChoice }),
    [league, choice, options, setChoice],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

/** The Theme choice in More, and the league logo on Matchups. */
export function useThemeChoice(): ThemeChoice {
  const { choice, options, league, setChoice } = useContext(ThemeContext);
  return { choice, options, league, setChoice };
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
