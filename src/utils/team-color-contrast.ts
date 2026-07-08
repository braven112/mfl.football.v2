/**
 * Team-color contrast system — site-wide.
 *
 * A reusable toolkit for showing two teams' brand colors next to each other so
 * they always read as two distinct colors (win-probability bars, matchup
 * headers, head-to-head charts, versus badges, anywhere two franchises meet).
 *
 * Design rule (see resolveTeamColorPair):
 *   - HOME keeps its primary color.
 *   - AWAY adjusts for a minimum contrast against home, choosing from — in
 *     order — its primary → secondary → chart `color` (the 3rd option), taking
 *     the first that clears the contrast threshold, else the most-different.
 *   - Optional fallbacks keep both colors legible on the card background
 *     (theme-aware) and force a distinct away color when no brand color works.
 *
 * Everything is theme-agnostic and league-agnostic: pass plain hex color sets.
 * Convenience wiring for a specific color source (franchise config, NFL team
 * colors, …) lives with that source, not here.
 *
 * @example
 *   import { resolveTeamColorPair } from '../utils/team-color-contrast';
 *   const { home, away } = resolveTeamColorPair(homeColors, awayColors);
 *   el.style.setProperty('--home-color', home);
 *   el.style.setProperty('--away-color', away);
 */

/** A team's brand colors, most-preferred first. All optional. */
export interface TeamColorSet {
  /** Brand primary — the home team's color, and the away team's first choice. */
  colorPrimary?: string;
  /** Brand secondary — the away team's second choice. */
  colorSecondary?: string;
  /** Vibrant chart color — the away team's third (last) choice. */
  color?: string;
}

export interface ColorPairOptions {
  /** Minimum ΔE (CIE76) between the two colors to read as distinct. Default 25. */
  minContrast?: number;
  /**
   * If provided, also keep both colors legible against this background (e.g.
   * the card surface for the active theme): a color too close to the bg is
   * nudged in lightness. Handles near-black primaries on dark cards.
   */
  background?: string;
  /** Minimum ΔE a color must have vs `background` to count as legible. Default 18. */
  minBackgroundContrast?: number;
  /**
   * When no away brand color clears `minContrast`, shift the best candidate's
   * lightness until it does (invents a shade). Guarantees two distinct colors.
   */
  forceAdjust?: boolean;
  /**
   * Allow HOME to fall primary → color → secondary when its primary is
   * illegible on `background`. Off by default (home normally keeps primary).
   */
  homeVisibilityFallback?: boolean;
}

/** Minimum ΔE (CIE76) between two colors to read as distinct. */
export const DEFAULT_MIN_CONTRAST = 25;
/** Minimum ΔE a color needs vs a background to be considered legible on it. */
export const DEFAULT_MIN_BG_CONTRAST = 18;

const HOME_FALLBACK = '#1c497c';
const AWAY_FALLBACK = '#8a94a0';
const isHex = (c?: string): c is string => !!c && /^#?[0-9a-f]{6}$/i.test(c.trim());

// ── color math ──

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  const v = m ? parseInt(m[1], 16) : 0x1c497c;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function labFwd(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}
function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(srgbToLinear);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const fx = labFwd(x), fy = labFwd(y), fz = labFwd(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual color difference (CIE76 ΔE). ~0 identical, ≥25 clearly distinct. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** WCAG relative luminance (0 black → 1 white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mix a color toward white (amount>0) or black (amount<0); amount in -1..1. */
export function shiftLightness(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  return toHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

// ── selection ──

/**
 * Pick, from `candidates`, the first color with ΔE ≥ min vs `base`; if none
 * qualify, the most-different one. With `forceAdjust`, that best candidate is
 * then lightness-shifted (away from base) until it clears `min`.
 */
export function pickContrastingColor(
  base: string,
  candidates: string[],
  min = DEFAULT_MIN_CONTRAST,
  forceAdjust = false,
): string {
  const valid = candidates.filter(isHex).map((c) => c.trim());
  if (valid.length === 0) {
    // No usable brand color — honor forceAdjust so a caller that omits
    // `background` still gets a guaranteed-distinct away color, not raw grey.
    return forceAdjust ? forceContrast(base, AWAY_FALLBACK, min) : AWAY_FALLBACK;
  }

  let best = valid[0], bestD = -1;
  for (const c of valid) {
    const d = colorDistance(base, c);
    if (d >= min) return c;
    if (d > bestD) { bestD = d; best = c; }
  }
  return forceAdjust ? forceContrast(base, best, min) : best;
}

/** Shift `color`'s lightness (away from base) until ΔE(base,color) ≥ min. */
export function forceContrast(base: string, color: string, min = DEFAULT_MIN_CONTRAST): string {
  if (colorDistance(base, color) >= min) return color;
  // Push away from the base's luminance: lighten if base is dark, else darken.
  const dir = relativeLuminance(base) < 0.5 ? 1 : -1;
  let out = color;
  for (let step = 0.12; step <= 1.0001; step += 0.12) {
    out = shiftLightness(color, dir * step);
    if (colorDistance(base, out) >= min) return out;
  }
  return out;
}

/** Nudge `color`'s lightness so it's legible (ΔE ≥ minBg) against `background`. */
export function ensureLegibleOn(color: string, background: string, minBg = DEFAULT_MIN_BG_CONTRAST): string {
  if (colorDistance(color, background) >= minBg) return color;
  const dir = relativeLuminance(background) < 0.5 ? 1 : -1; // dark bg → lighten
  let out = color;
  for (let step = 0.1; step <= 1.0001; step += 0.1) {
    out = shiftLightness(color, dir * step);
    if (colorDistance(out, background) >= minBg) return out;
  }
  return out;
}

/**
 * Resolve the home + away colors for a two-team display. See module docs.
 */
export function resolveTeamColorPair(
  home: TeamColorSet | undefined,
  away: TeamColorSet | undefined,
  opts: ColorPairOptions = {},
): { home: string; away: string } {
  const min = opts.minContrast ?? DEFAULT_MIN_CONTRAST;
  const minBg = opts.minBackgroundContrast ?? DEFAULT_MIN_BG_CONTRAST;

  // Home = primary (chart color as last resort), with optional visibility fallback.
  let homeColor = home?.colorPrimary || home?.color || HOME_FALLBACK;
  if (opts.background && opts.homeVisibilityFallback) {
    const homeChoices = [home?.colorPrimary, home?.color, home?.colorSecondary].filter(isHex);
    homeColor =
      homeChoices.find((c) => colorDistance(c, opts.background!) >= minBg) ?? homeColor;
  }

  // Away = first of primary/secondary/color that contrasts with home.
  let awayColor = pickContrastingColor(
    homeColor,
    [away?.colorPrimary, away?.colorSecondary, away?.color].filter(isHex),
    min,
    opts.forceAdjust,
  );

  // Keep both legible on the background if one is given.
  if (opts.background) {
    homeColor = ensureLegibleOn(homeColor, opts.background, minBg);
    awayColor = ensureLegibleOn(awayColor, opts.background, minBg);
    // Re-contrast if the legibility nudge collapsed the pair.
    if (opts.forceAdjust && colorDistance(homeColor, awayColor) < min) {
      awayColor = forceContrast(homeColor, awayColor, min);
    }
  }

  return { home: homeColor, away: awayColor };
}
