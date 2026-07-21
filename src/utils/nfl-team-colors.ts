/**
 * NFL Team Brand Colors
 *
 * Official primary/secondary hex colors for all 32 NFL teams, keyed by
 * ESPN-format team codes (the same codes `normalizeTeamCode()` produces).
 * Powers player composite imagery — team-color gradients behind ESPN
 * headshots — and is reusable anywhere a page needs NFL brand colors
 * (matchup cards, heroes, auction predictor visualizations).
 *
 * @example
 * ```typescript
 * import { getNflTeamColors, getNflTeamNickname, hexToRgba } from '../utils/nfl-team-colors';
 *
 * const { primary, secondary } = getNflTeamColors('CIN'); // '#fb4f14', '#101820'
 * getNflTeamNickname('CIN'); // 'Bengals'
 * hexToRgba('#fb4f14', 0.5); // 'rgba(251, 79, 20, 0.5)'
 * ```
 */

import { normalizeTeamCode, getNFLTeamName, TEAM_CODE_MAP } from './nfl-logo';

export interface NflTeamColors {
  /** Dominant brand color — gradient anchor */
  primary: string;
  /** Complementary brand color — accents, glows */
  secondary: string;
}

/**
 * Official brand colors per ESPN team code.
 * Primary is the color the team is recognized by; secondary is the
 * strongest complementary brand color (not always the "official" second
 * color when that would be near-white and useless on dark composites).
 */
export const NFL_TEAM_COLORS: Record<string, NflTeamColors> = {
  ARI: { primary: '#97233f', secondary: '#ffb612' },
  ATL: { primary: '#a71930', secondary: '#101820' },
  BAL: { primary: '#241773', secondary: '#9e7c0c' },
  BUF: { primary: '#00338d', secondary: '#c60c30' },
  CAR: { primary: '#0085ca', secondary: '#101820' },
  CHI: { primary: '#0b162a', secondary: '#c83803' },
  CIN: { primary: '#fb4f14', secondary: '#101820' },
  CLE: { primary: '#311d00', secondary: '#ff3c00' },
  DAL: { primary: '#003594', secondary: '#869397' },
  DEN: { primary: '#fb4f14', secondary: '#002244' },
  DET: { primary: '#0076b6', secondary: '#b0b7bc' },
  GB: { primary: '#203731', secondary: '#ffb612' },
  HOU: { primary: '#03202f', secondary: '#a71930' },
  IND: { primary: '#002c5f', secondary: '#a2aaad' },
  JAX: { primary: '#006778', secondary: '#d7a22a' },
  KC: { primary: '#e31837', secondary: '#ffb81c' },
  LAC: { primary: '#0080c6', secondary: '#ffc20e' },
  LAR: { primary: '#003594', secondary: '#ffa300' },
  LV: { primary: '#101820', secondary: '#a5acaf' },
  MIA: { primary: '#008e97', secondary: '#fc4c02' },
  MIN: { primary: '#4f2683', secondary: '#ffc62f' },
  NE: { primary: '#002244', secondary: '#c60c30' },
  NO: { primary: '#101820', secondary: '#d3bc8d' },
  NYG: { primary: '#0b2265', secondary: '#a71930' },
  NYJ: { primary: '#125740', secondary: '#101820' },
  PHI: { primary: '#004c54', secondary: '#a5acaf' },
  PIT: { primary: '#101820', secondary: '#ffb612' },
  SEA: { primary: '#002244', secondary: '#69be28' },
  SF: { primary: '#aa0000', secondary: '#b3995d' },
  TB: { primary: '#d50a0a', secondary: '#34302b' },
  TEN: { primary: '#0c2340', secondary: '#4b92db' },
  WSH: { primary: '#5a1414', secondary: '#ffb612' },
};

/** League-neutral fallback (TheLeague blue) for unknown/free-agent codes */
export const NFL_COLORS_FALLBACK: NflTeamColors = {
  primary: '#1c497c',
  secondary: '#8a94a0',
};

/**
 * Get brand colors for a team code in any format (MFL or ESPN).
 * Unknown codes (including 'FA'/'NFL') return the league-neutral fallback.
 */
export function getNflTeamColors(teamCode: string): NflTeamColors {
  return NFL_TEAM_COLORS[normalizeTeamCode(teamCode)] ?? NFL_COLORS_FALLBACK;
}

/**
 * Dark-mode avatar chips: minimum perceived luminance (0–255) for the
 * gradient's team-color stop. Below this, a dark-jerseyed headshot disappears
 * into the chip — Titans navy behind Cam Ward was the motivating case.
 */
const AVATAR_ANCHOR_MIN_LUMINANCE = 60;
/**
 * Primaries darker than this can't be rescued by lightening without losing
 * their identity (near-black navies collapse to gray-blue) — swap to the
 * curated, lighter secondary instead (PIT gold, TEN light blue, SEA green).
 */
const AVATAR_PRIMARY_SWAP_LUMINANCE = 33;
/**
 * A secondary must be at least this colorful (chroma) to replace a dark
 * primary — keeps near-gray secondaries (LV silver) from winning; those
 * teams lighten their primary instead.
 */
const AVATAR_SWAP_MIN_CHROMA = 25;

/**
 * Pick the team color anchoring the dark-mode avatar gradient: the primary,
 * unless it's so dark that the (lighter, chromatic) secondary reads better.
 */
function pickDarkAvatarAnchor({ primary, secondary }: NflTeamColors): string {
  if (luminance(primary) >= AVATAR_PRIMARY_SWAP_LUMINANCE) return primary;
  if (chroma(secondary) >= AVATAR_SWAP_MIN_CHROMA && luminance(secondary) > luminance(primary)) {
    return secondary;
  }
  return primary;
}

/**
 * White-mix applied to the anchor for the radial spotlight behind the head.
 * A fixed mix (not a floor) so the center is ALWAYS visibly lighter than the
 * anchor, even for already-bright anchors like PIT gold. Combined with the
 * anchor's luminance floor of 60, the center never drops below ~128.
 */
const AVATAR_HEAD_HIGHLIGHT_MIX = 0.35;

/** Lighten `hex` toward white until its perceived luminance reaches `floor`. */
function raiseToLuminanceFloor(hex: string, floor: number): string {
  const lum = luminance(hex);
  if (lum >= floor) return hex;
  // Luminance is linear under mixing toward white, so solve for the exact mix.
  // Target floor+1 so per-channel rounding can't land a hair under the floor;
  // clamp so a floor near 255 can't extrapolate past white into invalid hex.
  return mixHex(hex, '#ffffff', Math.min(1, (floor + 1 - lum) / (255 - lum)));
}

/**
 * CSS `background` for a circular player avatar chip, applied in BOTH themes
 * by `player-cell.css` via `--player-avatar-bg` (light mode formerly used a
 * gray chip and only kept the team-color ring from getPlayerAvatarBorder —
 * running the gradient in light mode too is a July 2026 experiment).
 *
 * A radial spotlight, brightest behind the player's head: the headshot's face
 * sits at top-center of the chip (`object-position: top` + `scale(1.18)` in
 * player-cell.css), so the light pools at 50% 30% and deepens toward the rim.
 * The gradient anchors on the team color best readable against a dark page:
 * the primary, lightened to a luminance floor when it's dark (SF, DAL), or
 * the lighter secondary when the primary is near-black (TEN light blue,
 * PIT gold, SEA action green). Guarded by tests/nfl-team-colors.test.ts,
 * which asserts per-stop luminance floors for all 32 teams — dark headshots
 * must never sink into a near-black chip again.
 *
 * This is the single source of truth for the colored headshot backdrop across
 * every player-cell renderer (PlayerCell.tsx / PlayerCell.astro /
 * buildPlayerCellHTML, plus the players.astro free-agent list), so the
 * treatment stays identical everywhere. Free agents / unknown codes fall back
 * to the league-neutral blue.
 *
 * @example
 * ```typescript
 * getPlayerAvatarBackground('KC');
 * // 'radial-gradient(circle at 50% 30%, #ed697d 0%, #e31837 58%, #821427 100%)'
 * ```
 */
/** The readable team color anchoring both the chip gradient and the ring. */
function avatarAnchor(teamCode: string): string {
  return raiseToLuminanceFloor(
    pickDarkAvatarAnchor(getNflTeamColors(teamCode)),
    AVATAR_ANCHOR_MIN_LUMINANCE,
  );
}

export function getPlayerAvatarBackground(teamCode: string): string {
  const anchor = avatarAnchor(teamCode);
  const highlight = mixHex(anchor, '#ffffff', AVATAR_HEAD_HIGHLIGHT_MIX);
  const edge = mixHex(anchor, '#0b0e13', 0.45);
  return `radial-gradient(circle at 50% 30%, ${highlight} 0%, ${anchor} 58%, ${edge} 100%)`;
}

/** Ring mix ratio — how far the anchor shifts toward the theme's pole. */
const AVATAR_RING_MIX = 0.35;
/** Dark pole for the light-mode ring — same ink as the gradient's edge stop. */
const AVATAR_RING_INK = '#0b0e13';

/**
 * Light-mode ring color for the avatar chip: the gradient's anchor color
 * mixed toward ink (AVATAR_RING_MIX), so the ring reads as a darker echo of the chip that
 * separates it from white table rows. Opaque on purpose — the translucent
 * fallback ring in player-cell.css disappears on light rows. Set as
 * `--player-avatar-ring` alongside the other avatar properties;
 * `getPlayerAvatarRingDark` supplies the dark-mode counterpart.
 */
export function getPlayerAvatarRing(teamCode: string): string {
  return mixHex(avatarAnchor(teamCode), AVATAR_RING_INK, AVATAR_RING_MIX);
}

/**
 * Dark-mode ring color: the anchor mixed toward white (AVATAR_RING_MIX) — a lighter echo
 * of the chip that pops it off dark table rows. Set as
 * `--player-avatar-ring-dark`; player-cell.css swaps to it under html.dark.
 */
export function getPlayerAvatarRingDark(teamCode: string): string {
  return mixHex(avatarAnchor(teamCode), '#ffffff', AVATAR_RING_MIX);
}

/**
 * Team-primary hex for `--player-avatar-border`. Gradient chips ring with
 * the theme-split team-tinted pair instead (`--player-avatar-ring` light /
 * `--player-avatar-ring-dark` dark — see getPlayerAvatarRing/RingDark), so
 * this only surfaces on chips that opt out of the gradient (the base
 * fallback in player-cell.css, e.g. the --eligible highlight state).
 * Renderers still set it alongside the other avatar properties.
 */
export function getPlayerAvatarBorder(teamCode: string): string {
  return getNflTeamColors(teamCode).primary;
}

/**
 * Precomputed avatar-style maps for client-side renderers that can't import
 * at runtime (`define:vars` scripts — players.astro, projected-free-agents,
 * AFL players). Keys cover every ESPN code AND every MFL alias (KCC, GBP,
 * WAS, …) so a raw feed team code hits without client-side normalization.
 * Pages pass these via `define:vars` and look up `map[team] || fallback`,
 * with the `'FA'` result from each getter as the fallback.
 */
export function getPlayerAvatarStyleMaps(): {
  bg: Record<string, string>;
  border: Record<string, string>;
  ring: Record<string, string>;
  ringDark: Record<string, string>;
} {
  const bg: Record<string, string> = {};
  const border: Record<string, string> = {};
  const ring: Record<string, string> = {};
  const ringDark: Record<string, string> = {};
  for (const code of [...Object.keys(NFL_TEAM_COLORS), ...Object.keys(TEAM_CODE_MAP)]) {
    bg[code] = getPlayerAvatarBackground(code);
    border[code] = getPlayerAvatarBorder(code);
    ring[code] = getPlayerAvatarRing(code);
    ringDark[code] = getPlayerAvatarRingDark(code);
  }
  return { bg, border, ring, ringDark };
}

/**
 * Get a team's nickname (e.g. 'CIN' → 'Bengals') for wordmark treatments.
 * Falls back to the normalized code when the team is unknown.
 */
export function getNflTeamNickname(teamCode: string): string {
  const code = normalizeTeamCode(teamCode);
  const fullName = getNFLTeamName(code);
  if (!fullName || fullName === code) return code;
  return fullName.split(' ').pop() ?? code;
}

/**
 * Convert a #rrggbb hex color to an rgba() string.
 * Invalid input falls back to a neutral dark at the requested alpha.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(22, 32, 44, ${alpha})`;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseHexChannels(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match ? parseInt(match[1], 16) : 0x16202c;
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Linear mix of two #rrggbb colors; t=0 → a, t=1 → b.
 * Invalid input channels fall back to the neutral dark used by hexToRgba.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHexChannels(a);
  const cb = parseHexChannels(b);
  const mixed = ca.map((c, i) => Math.round(c + (cb[i] - c) * t));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Drain saturation from a #rrggbb color by mixing each channel toward its
 * own luminance gray. amount=0 → unchanged, amount=1 → fully gray.
 * Powers "dead colors" treatments (Dead Money Awards) where team identity
 * should read washed-out rather than vibrant.
 */
export function desaturateHex(hex: string, amount: number): string {
  const [r, g, b] = parseHexChannels(hex);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (c: number) => Math.round(c + (gray - c) * t);
  return `#${[channel(r), channel(g), channel(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Perceived luminance (0–255) of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = parseHexChannels(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Chroma (max−min channel spread, 0–255) — how colorful vs gray a color is. */
function chroma(hex: string): number {
  const ch = parseHexChannels(hex);
  return Math.max(...ch) - Math.min(...ch);
}

/** A color usable as a gradient hero: colorful enough and not near-black. */
function isUsableAccent(hex: string): boolean {
  return chroma(hex) >= 25 && luminance(hex) >= 40;
}

/**
 * Pick the brand color from a franchise's primary/secondary pair to use as a
 * gradient "hero" stop.
 *
 * The franchise's chosen **primary is preferred** — it's their identity. But
 * many franchises run a near-black or gray primary with a vibrant secondary
 * (a common convention); a black primary makes a flat, identity-less band, so
 * only then does the secondary take over. When both are near-gray (a true
 * black/white team) the primary is kept and the band simply reads dark. A very
 * bright winner (e.g. a yellow primary) is darkened toward a mid tone so a
 * light cutout and white text still read on top.
 *
 * @param primary - franchise colorPrimary (#rrggbb) or undefined
 * @param secondary - franchise colorSecondary (#rrggbb) or undefined
 * @param fallback - color when neither input is usable (default league blue)
 */
export function pickBrandAccent(
  primary?: string,
  secondary?: string,
  fallback: string = NFL_COLORS_FALLBACK.primary,
): string {
  const valid = (c?: string): c is string =>
    typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim());
  // Store the TRIMMED value — the validator tolerates surrounding whitespace,
  // so keep the untrimmed input out of the returned CSS color.
  const p = valid(primary) ? primary.trim() : undefined;
  const s = valid(secondary) ? secondary.trim() : undefined;

  let hero: string;
  if (p && isUsableAccent(p)) hero = p;
  else if (s && isUsableAccent(s)) hero = s;
  else hero = p ?? s ?? fallback; // both near-gray/dark → keep primary; band reads dark

  // Keep the hero from washing out white text/cutout: pull very light heroes down.
  if (luminance(hero) > 170) hero = mixHex(hero, '#0b0e13', 0.4);
  return hero.startsWith('#') ? hero : `#${hero}`;
}
