/**
 * Franchise Brand — per-team color + imagery for TheLeague franchises, the
 * league-side analogue of `nfl-team-colors.ts`. Where NFL heroes tint by the
 * player's pro team, TEAM-centric heroes (standings, champion, trade block)
 * tint by the FRANCHISE and watermark with the franchise's GroupMe crest.
 *
 * Colors + assets are the single source of truth in `theleague.config.json`
 * (each team's `color`, `colorPrimary`/`colorSecondary`/…, `icon`, `groupMe`);
 * this util just indexes them. The brand-color fallbacks (secondary → darkened
 * primary, etc.) live in `team-colors.ts` and are reused here so there's one
 * resolution path.
 *
 * @example
 * const brand = getFranchiseBrand('0001'); // Pacific Pigskins
 * brand.color;          // '#cc2936' (chart/graph color, unchanged)
 * brand.colorPrimary;   // '#bd1f2b' (brand primary)
 * brand.colorSecondary; // '#181818' (brand accent)
 * brand.groupMe;        // '/assets/theleague/group-me/pigskins.png'
 * franchiseGradient(brand.color); // 'linear-gradient(160deg, #0b0e12 0%, #cc2936 150%)'
 */
import leagueConfig from '../data/theleague.config.json';
import { hexToRgba } from './nfl-team-colors';
import {
  getTeamColorPrimary,
  getTeamColorSecondary,
  getTeamColorTertiary,
  getTeamColorQuaternary,
} from './team-colors';

export interface FranchiseBrand {
  franchiseId: string;
  name: string;
  /**
   * Chart/graph color (hex) — the legacy `color` field, used on the owner-activity
   * page. Kept as-is; the current hero panels tint with this.
   */
  color: string;
  /** Primary brand color (hex) — panel fill / main identity. Falls back to `color`. */
  colorPrimary: string;
  /** Secondary brand color (hex) — accent. Falls back to a darkened `colorPrimary`. */
  colorSecondary: string;
  /** Optional third brand hue sampled from the team art. */
  colorTertiary?: string;
  /** Optional fourth brand hue. */
  colorQuaternary?: string;
  /** Square franchise icon */
  icon: string;
  /** GroupMe-sized franchise avatar/crest — used as a hero background watermark */
  groupMe: string;
  /** Optional dark-mode variant of `groupMe`. Not yet consumed anywhere — reserved for a future dark-mode watermark swap. */
  groupMeDark?: string;
}

/** League-neutral fallback (TheLeague blue) for unknown franchises. */
export const FRANCHISE_BRAND_FALLBACK: Omit<FranchiseBrand, 'franchiseId'> = {
  name: '',
  color: '#1c497c',
  colorPrimary: '#1c497c',
  colorSecondary: '#0e2440',
  icon: '',
  groupMe: '',
};

const BRANDS = new Map<string, FranchiseBrand>();
for (const t of ((leagueConfig as any).teams ?? []) as any[]) {
  if (!t?.franchiseId) continue;
  BRANDS.set(t.franchiseId, {
    franchiseId: t.franchiseId,
    name: t.name ?? '',
    color: t.color ?? FRANCHISE_BRAND_FALLBACK.color,
    // Brand colors resolve through team-colors (single fallback path).
    colorPrimary: getTeamColorPrimary(t.franchiseId),
    colorSecondary: getTeamColorSecondary(t.franchiseId),
    colorTertiary: getTeamColorTertiary(t.franchiseId),
    colorQuaternary: getTeamColorQuaternary(t.franchiseId),
    icon: t.icon ?? '',
    // Prefer the explicit groupMe path; fall back to the per-id avatar.
    groupMe: t.groupMe ?? (t.franchiseId ? `/assets/theleague/group-me/${t.franchiseId}.png` : ''),
    groupMeDark: t.groupMeDark,
  });
}

/** Brand for a franchise id, or the league-neutral fallback when unknown. */
export function getFranchiseBrand(franchiseId: string): FranchiseBrand {
  return BRANDS.get(franchiseId) ?? { franchiseId, ...FRANCHISE_BRAND_FALLBACK };
}

/** A dark → franchise-color gradient (mirrors the NFL panel treatment). */
export function franchiseGradient(color: string, base = '#0b0e12'): string {
  return `linear-gradient(160deg, ${base} 0%, ${color} 150%)`;
}

/** Franchise color as a translucent glow tint. */
export function franchiseGlow(color: string, alpha = 0.38): string {
  return hexToRgba(color, alpha);
}
