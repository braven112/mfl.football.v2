/**
 * What the Brand Book pages read: a club's marks, which cut each GROUND
 * draws, and who in the league rosters its players.
 *
 * The assignment data (`src/data/nfl-mark-assignments.json`) and the mark
 * catalog (`src/data/nfl-brand-kit.json`) are the same files the dark mirror
 * reads, so the page can never claim a cut the build does not ship. The
 * node-side table lives in `scripts/lib/nfl-mark-sources.mjs`;
 * `tests/nfl-marks-page-data.test.ts` fails if the two id lists drift.
 *
 * Plan: docs/plans/nfl-mark-assignments.md.
 */

import brandKit from '../data/nfl-brand-kit.json';
import assignments from '../data/nfl-mark-assignments.json';
import reversals from '../data/nfl-mark-reversals.json';
import { getAllNFLTeamCodes } from './nfl-logo';
import { resolveNflDarkLogoUrl } from './nfl-logo-dark-css';
import { relativeLuminance } from './team-color-contrast';

/** A surface's ground — NOT the viewer's theme. See the plan's "three grounds". */
export type MarkGround = 'light' | 'dark' | 'band';

export interface MarkOption {
  id: string;
  label: string;
  /** Where the artwork comes from, in one phrase, for the page's caption. */
  source: string;
  format: 'svg' | 'png';
  /** True when the cut is drawn for a dark ground and should preview on one. */
  forDark: boolean;
  /** True when we MAKE this cut rather than fetch it. Only `reversed` today. */
  derived: boolean;
  url: string;
}

/**
 * Presentation names for the mark ids. Ids themselves are the contract with
 * `scripts/lib/nfl-mark-sources.mjs`; these labels are the page's alone, which
 * is why they live here rather than in the shared node table.
 */
const MARK_LABELS: Record<
  string,
  { label: string; source: string; format: 'svg' | 'png'; forDark: boolean; derived?: boolean }
> = {
  primary: { label: 'Primary', source: 'committed SVG', format: 'svg', forDark: false },
  nflcom: { label: 'NFL.com cut', source: 'league club endpoint', format: 'svg', forDark: false },
  espn: { label: 'ESPN light', source: 'ESPN 500', format: 'png', forDark: false },
  espnDark: { label: 'ESPN dark', source: 'ESPN 500-dark', format: 'png', forDark: true },
  altLight: { label: 'Alternate', source: 'ESPN secondary, on white', format: 'png', forDark: false },
  altDark: { label: 'Alternate dark', source: 'ESPN secondary, on black', format: 'png', forDark: true },
  whiteKnockout: { label: 'White knockout', source: 'ESPN primary, white', format: 'png', forDark: true },
  wordmark: { label: 'Wordmark', source: 'nflverse lockup', format: 'png', forDark: false },
  // The one cut we MAKE rather than fetch, and only for the three clubs in the
  // reversal map — every public source serves the standard mark.
  reversed: {
    label: 'Reversed',
    source: 'derived from our own SVG',
    format: 'svg',
    forDark: true,
    derived: true,
  },
};

export const MARK_IDS = Object.keys(MARK_LABELS);

type BrandKitTeam = {
  name: string;
  espnId: string;
  nflDotComVariant: 'light' | 'dark';
  primarySvg: string;
  colors: string[];
  wordmark: string | null;
  squaredLogo: string | null;
  espn: Record<string, { url: string; width?: number; lastUpdated?: string }>;
};

const TEAMS = (brandKit as { teams: Record<string, BrandKitTeam> }).teams;

/**
 * Relative luminance, the same measure the dark-ground rule uses.
 *
 * Re-exported from `team-color-contrast.ts` rather than re-derived: that file
 * is where this repo keeps the WCAG maths, and a second copy of the sRGB
 * transfer curve is a thing that can drift from the one every contrast check
 * uses. Its `parseHex` also handles shorthand, which a blind two-char slice
 * does not.
 */
export const luminance = relativeLuminance;

/** Ink that reads on a given ground — white on dark, near-black on light. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.42 ? '#10141a' : '#ffffff';
}

/**
 * Which assignment slot a club-colour band draws from.
 *
 * A band is neither a light nor a dark surface: it is the club's own colour,
 * so it follows whichever slot suits that colour's luminance — the dark one
 * for most clubs, since most club primaries are dark. DERIVED, never stored:
 * one rule for 32 clubs instead of 32 hand-set values.
 */
export function bandSlot(code: string): 'light' | 'dark' {
  const team = TEAMS[code];
  const colour = team?.colors?.[0] ?? '#000000';
  return luminance(colour) > 0.42 ? 'light' : 'dark';
}

/** The mark id a club draws on one ground. */
export function assignedMark(code: string, ground: MarkGround): string {
  const slot = ground === 'band' ? bandSlot(code) : ground;
  const clubs = (assignments as { clubs: Record<string, Record<string, string>> }).clubs;
  const defaults = (assignments as { defaults: Record<string, string> }).defaults;
  return clubs?.[code]?.[slot] ?? defaults[slot];
}

/** True when this club's assignment differs from what every other club gets. */
export function isCustomised(code: string): boolean {
  const clubs = (assignments as { clubs: Record<string, unknown> }).clubs;
  return Boolean(clubs?.[code]);
}

/**
 * The URL for one mark id, or null when the club has no such cut.
 *
 * `primary` is the committed file rather than a fetch, so it resolves to the
 * local path every other surface renders — which is the point: the page shows
 * the artwork the site actually ships, not a look-alike from a CDN.
 */
export function markUrl(code: string, id: string): string | null {
  const team = TEAMS[code];
  if (!team) return null;
  switch (id) {
    case 'primary':
      return `/assets/nfl-logos/${code}.svg`;
    case 'nflcom':
      return team.primarySvg ?? null;
    case 'espn':
      return team.espn?.default?.url ?? null;
    case 'espnDark':
      return team.espn?.dark?.url ?? null;
    case 'altLight':
      return team.espn?.secondaryOnWhite?.url ?? null;
    case 'altDark':
      return team.espn?.secondaryOnBlack?.url ?? null;
    case 'whiteKnockout':
      return team.espn?.primaryWhite?.url ?? null;
    case 'wordmark':
      return team.wordmark ?? null;
    case 'reversed':
      // Null for the 29 clubs with no reversal, which is what keeps the cut off
      // their pages rather than linking a file that was never derived.
      return (reversals as { clubs: Record<string, unknown> }).clubs?.[code]
        ? `/assets/nfl-logos/reversed/${code}.svg`
        : null;
    default:
      return null;
  }
}

/**
 * The brand kit lists a club's colours as the sources spell them, so the same
 * hex arrives twice in different case (`#0B162A` and `#0b162a`) and the page
 * printed four swatches for a two-colour club. Case-fold to compare, keep the
 * FIRST spelling — order is the brand kit's primary-first order, which
 * `bandSlot` and every hero read as `colors[0]`.
 */
function dedupeColors(colors: string[]): string[] {
  const seen = new Set<string>();
  return colors.filter((c) => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every cut on file for a club, in the order the page shows them. */
export function markOptions(code: string): MarkOption[] {
  return MARK_IDS.map((id) => {
    const meta = MARK_LABELS[id];
    const url = markUrl(code, id);
    return url ? { id, ...meta, derived: meta.derived === true, url } : null;
  }).filter((m): m is MarkOption => m !== null);
}

/**
 * The same-origin file the SITE serves for one ground — not the catalog URL.
 *
 * The catalog (`markUrl`) names where a cut CAME FROM, which for every ESPN
 * and nflverse cut is a third-party CDN. What the site actually renders is the
 * mirror: `public/assets/nfl-logos/` on light, and for dark the file
 * `scripts/fetch-nfl-dark-logos.mjs` wrote, whose EXTENSION comes from the
 * manifest rather than the mark's format (a club assigned NFL.com's cut is
 * mirrored as SVG). Previewing the CDN copy instead would make the page a
 * claim about ESPN rather than about this site — and would put 32 cross-origin
 * requests on a page whose whole subject is the local artwork.
 *
 * Null when nothing is mirrored, which is the signal to fall back to the
 * catalog URL rather than to render a path that 404s.
 */
export function shippedUrl(code: string, ground: MarkGround): string | null {
  const slot = ground === 'band' ? bandSlot(code) : ground;
  if (slot === 'light') {
    return assignedMark(code, 'light') === 'primary' ? `/assets/nfl-logos/${code}.svg` : null;
  }
  return resolveNflDarkLogoUrl(code);
}

export interface ClubBrand {
  code: string;
  name: string;
  city: string;
  nick: string;
  colors: string[];
  /**
   * The mark each ground draws, already resolved. `url` is what to RENDER —
   * the mirrored file when there is one, the catalog URL when there is not —
   * while `mark` still names the cut it came from.
   */
  grounds: { ground: MarkGround; slot: 'light' | 'dark'; mark: MarkOption; url: string }[];
  marks: MarkOption[];
  /** NFL.com serves only a for-dark cut for this club. */
  nflDotComIsDark: boolean;
  /** Why this club got a hand-reviewed reversed cut — null for the other 29. */
  reversalNote: string | null;
  customised: boolean;
}

export function clubBrand(code: string): ClubBrand | null {
  const team = TEAMS[code];
  if (!team) return null;
  const marks = markOptions(code);
  const byId = new Map(marks.map((m) => [m.id, m]));
  const parts = team.name.split(' ');
  const grounds = (['light', 'dark', 'band'] as MarkGround[])
    .map((ground) => {
      const slot = ground === 'band' ? bandSlot(code) : (ground as 'light' | 'dark');
      const mark = byId.get(assignedMark(code, ground));
      return mark ? { ground, slot, mark, url: shippedUrl(code, ground) ?? mark.url } : null;
    })
    .filter((g): g is ClubBrand['grounds'][number] => g !== null);

  return {
    code,
    name: team.name,
    city: parts.slice(0, -1).join(' '),
    nick: parts[parts.length - 1],
    colors: dedupeColors(team.colors ?? []),
    grounds,
    marks,
    nflDotComIsDark: team.nflDotComVariant === 'dark',
    reversalNote:
      (reversals as { clubs: Record<string, { note?: string }> }).clubs?.[code]?.note ?? null,
    customised: isCustomised(code),
  };
}

/** Every club, for the index. */
export function allClubs(): ClubBrand[] {
  return getAllNFLTeamCodes()
    .map((code) => clubBrand(code))
    .filter((c): c is ClubBrand => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A club code from a URL segment (`chi`, `CHI`), or null. */
export function codeFromSlug(slug: string): string | null {
  const upper = String(slug || '').toUpperCase();
  return getAllNFLTeamCodes().includes(upper) ? upper : null;
}
