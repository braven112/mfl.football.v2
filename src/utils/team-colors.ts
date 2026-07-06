/**
 * Team Color Palette
 *
 * Franchise colors, sourced from the league config JSON (the canonical source).
 * Each team carries up to four brand colors plus a chart color:
 *
 *   color            — chart/graph color, used on the owner-activity page.
 *                      Unchanged legacy field; TheLeague only.
 *   colorPrimary     — primary brand color (panel fill / main identity)
 *   colorSecondary   — secondary brand color (accent)
 *   colorTertiary    — optional third brand hue sampled from the team art
 *   colorQuaternary  — optional fourth brand hue
 *
 * The brand colors were sampled from each franchise's icon + banner and then
 * hand-tuned. This utility provides convenient, league-aware access with
 * defensive fallbacks so a team missing a value still resolves to something
 * sensible.
 */

import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';

export type LeagueSlug = 'theleague' | 'afl';

export interface TeamColors {
  /** Chart/graph color (owner-activity page). May be undefined (e.g. AFL). */
  graph?: string;
  primary?: string;
  secondary?: string;
  tertiary?: string;
  quaternary?: string;
}

/** Neutral fallback when a franchise/league is unknown. */
const GRAY = '#6b7280';

function buildMap(teams: any[]): Record<string, TeamColors> {
  const map: Record<string, TeamColors> = {};
  for (const team of teams) {
    map[team.franchiseId] = {
      graph: team.color,
      primary: team.colorPrimary,
      secondary: team.colorSecondary,
      tertiary: team.colorTertiary,
      quaternary: team.colorQuaternary,
    };
  }
  return map;
}

const MAPS: Record<LeagueSlug, Record<string, TeamColors>> = {
  theleague: buildMap(theleagueConfig.teams),
  afl: buildMap(aflConfig.teams),
};

function entry(franchiseId: string, league: LeagueSlug): TeamColors {
  return MAPS[league]?.[franchiseId] ?? {};
}

/**
 * Darken a 6-digit hex toward black by `amount` (0..1). Used for the secondary
 * fallback. Malformed/short/long input falls back to the neutral GRAY rather
 * than being echoed back, so a bad `colorPrimary` can never propagate an
 * invalid string into a CSS gradient downstream.
 */
export function darken(hex: string, amount = 0.4): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return GRAY;
  const n = parseInt(m[1], 16);
  const f = 1 - amount;
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Graph/chart color (owner-activity page). Backward-compatible: existing callers
 * pass only a franchiseId and get TheLeague's chart color.
 */
export function getTeamColor(franchiseId: string, league: LeagueSlug = 'theleague'): string {
  return entry(franchiseId, league).graph ?? GRAY;
}

/** Primary brand color. Falls back to the graph color, then gray. */
export function getTeamColorPrimary(franchiseId: string, league: LeagueSlug = 'theleague'): string {
  const e = entry(franchiseId, league);
  return e.primary ?? e.graph ?? GRAY;
}

/** Secondary brand color. Falls back to a darkened shade of the primary. */
export function getTeamColorSecondary(franchiseId: string, league: LeagueSlug = 'theleague'): string {
  const e = entry(franchiseId, league);
  return e.secondary ?? darken(getTeamColorPrimary(franchiseId, league));
}

/** Tertiary brand color, if the team defines one. */
export function getTeamColorTertiary(
  franchiseId: string,
  league: LeagueSlug = 'theleague',
): string | undefined {
  return entry(franchiseId, league).tertiary;
}

/** Quaternary brand color, if the team defines one. */
export function getTeamColorQuaternary(
  franchiseId: string,
  league: LeagueSlug = 'theleague',
): string | undefined {
  return entry(franchiseId, league).quaternary;
}

/**
 * All defined brand colors for a team, in order (primary, secondary, then any
 * tertiary/quaternary). Primary and secondary always resolve (via fallbacks);
 * tertiary/quaternary are included only when defined.
 */
export function getTeamColors(franchiseId: string, league: LeagueSlug = 'theleague'): string[] {
  const e = entry(franchiseId, league);
  return [
    getTeamColorPrimary(franchiseId, league),
    getTeamColorSecondary(franchiseId, league),
    e.tertiary,
    e.quaternary,
  ].filter(Boolean) as string[];
}
