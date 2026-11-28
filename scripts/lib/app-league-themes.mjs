/**
 * Each registry league's look, as the MFL Football phone app paints it
 * (store-app plan decision 22).
 *
 * The app keeps its colors as a handful of plain hex roles
 * (apps/mobile/src/theme.ts). This maps a league's own WEBSITE theme
 * (src/themes/<theme>.json, the `dark` block, resolved through
 * `resolveTheme` so a `var()` becomes the color the page actually renders)
 * onto those roles, so the app never keeps a second copy of a league's
 * palette. Dark only: the app has no light theme.
 *
 * A role that does not resolve to a plain hex, or that would be unreadable,
 * is left out, and the app paints that role in its own black and red.
 * `tests/mfl-live-app-league-themes.test.ts` pins the committed data to this
 * builder and every role to WCAG AA.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../../src/config/leagues-data.mjs';
import { resolveTheme } from './theme-resolve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const APP_LEAGUE_THEMES_FILE = 'src/data/mfl-live-app-league-themes.json';

/** Body text contrast (WCAG AA). */
export const AA_BODY = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;

function expandHex(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return HEX.test(v) ? v : null;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio of two 6-digit hex colors. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The app's color roles from one resolved dark theme.
 * @param {Record<string, string | null>} r token → resolved value
 */
export function appColorsFrom(r) {
  const pick = (token) => expandHex(r[token]);
  /** @type {Record<string, string>} */
  const colors = {};
  const set = (role, value) => {
    if (value) colors[role] = value;
  };
  set('ground', pick('--page-bg'));
  set('card', pick('--card-surface'));
  set('border', pick('--table-border'));
  set('field', pick('--input-bg'));

  const surfaces = [colors.ground, colors.card].filter(Boolean);
  const readable = (hex) => Boolean(hex) && surfaces.length > 0 && surfaces.every((s) => contrast(hex, s) >= AA_BODY);

  const text = pick('--page-text');
  if (readable(text)) set('text', text);
  const muted = pick('--color-text-secondary');
  if (readable(muted)) set('muted', muted);

  // The accent is a FILL (buttons, the selected tab) with onAccent on top.
  const accent = pick('--btn-primary-bg');
  const onAccent = pick('--btn-primary-text');
  if (accent && onAccent && contrast(accent, onAccent) >= AA_BODY) {
    set('accent', accent);
    set('onAccent', onAccent);
  }
  // accentText is the league's color AS TEXT on the dark ground: the first
  // of the theme's text-weight accents that reads on both surfaces.
  set('accentText', ['--color-primary', '--color-primary-light', '--league-accent'].map(pick).find(readable));
  return colors;
}

/** slug → { theme, colors } for every league in the registry. */
export function buildAppLeagueThemes() {
  /** @type {Record<string, { theme: string, colors: Record<string, string> }>} */
  const out = {};
  for (const league of ALL_LEAGUES) {
    if (!league.theme) continue;
    const file = path.join(ROOT, 'src/themes', `${league.theme}.json`);
    if (!fs.existsSync(file)) continue;
    const theme = JSON.parse(fs.readFileSync(file, 'utf8'));
    out[league.slug] = { theme: league.theme, colors: appColorsFrom(resolveTheme(theme, 'dark')) };
  }
  return out;
}

export function serializeAppLeagueThemes(themes) {
  return `${JSON.stringify(themes, null, 2)}\n`;
}
