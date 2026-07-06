/**
 * Franchise Brand — per-team color + imagery for TheLeague franchises, the
 * league-side analogue of `nfl-team-colors.ts`. Where NFL heroes tint by the
 * player's pro team, TEAM-centric heroes (standings, champion, trade block)
 * tint by the FRANCHISE and watermark with the franchise's GroupMe crest.
 *
 * Colors + assets are the single source of truth in `theleague.config.json`
 * (each team's `color`, `icon`, `groupMe`); this util just indexes them.
 *
 * @example
 * const brand = getFranchiseBrand('0001'); // Pacific Pigskins
 * brand.color;   // '#cc2936'
 * brand.groupMe; // '/assets/theleague/group-me/pigskins.png'
 * franchiseGradient(brand.color); // 'linear-gradient(160deg, #0b0e12 0%, #cc2936 150%)'
 */
import leagueConfig from '../data/theleague.config.json';
import { hexToRgba } from './nfl-team-colors';

export interface FranchiseBrand {
  franchiseId: string;
  name: string;
  /** Primary franchise color (hex) */
  color: string;
  /** Square franchise icon */
  icon: string;
  /** GroupMe-sized franchise avatar/crest — used as a hero background watermark */
  groupMe: string;
}

/** League-neutral fallback (TheLeague blue) for unknown franchises. */
export const FRANCHISE_BRAND_FALLBACK: Omit<FranchiseBrand, 'franchiseId'> = {
  name: '',
  color: '#1c497c',
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
    icon: t.icon ?? '',
    // Prefer the explicit groupMe path; fall back to the per-id avatar.
    groupMe: t.groupMe ?? (t.franchiseId ? `/assets/theleague/group-me/${t.franchiseId}.png` : ''),
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
