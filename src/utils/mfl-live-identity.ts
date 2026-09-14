/**
 * What a franchise LOOKS like on the MFL Live board — a three-rung ladder.
 *
 * The board spans every league an MFL account is in, and most of them are
 * leagues this site has never heard of. It has artwork for some franchises,
 * can infer artwork for others, and must be honest about the rest:
 *
 *   1. **A league we run** — its own crest and brand colours, from the league
 *      config. ALWAYS WINS. A TheLeague franchise that renames itself
 *      "Cowboys" keeps its own mark; an owner's real identity outranks a
 *      lookup every time.
 *   2. **A franchise whose name IS an NFL club** — that club's mark and brand
 *      colour stand in (`nfl-name-match.ts`). Exact whole-name match only.
 *   3. **Everything else** — initials on a neutral field. Initials are a TEXT
 *      label, not invented artwork: no fabricated crest, and no invented brand
 *      hue. The two sides of a matchup are separated by a neutral step, which
 *      is a legibility decision rather than a claim about anybody's colours.
 *
 * ── COLOURS ARE NOT RESOLVED HERE, ON PURPOSE ─────────────────────────────
 * This module answers "which colours does this franchise CLAIM" and stops.
 * Turning a claim into a paintable pair — separating home from away, keeping
 * both legible against a specific ground — is `resolveTeamColorPair`
 * (`team-color-contrast.ts`), which the live-scoring board already uses for
 * exactly this and which has to run TWICE, once per theme, because this board
 * has a light card and a dark one. Resolving a single colour here would bake
 * in one theme's ground and reproduce the bug the AFL's near-black franchises
 * already caused on the broadcast board.
 */

import { getLeagueTeamConfig } from './league-team-brands';
import { matchNflTeamName } from './nfl-name-match';
import { getNflTeamColors } from './nfl-team-colors';
import { getNFLTeamName } from './nfl-logo';

/** Which rung answered. Shipped so the UI can render each honestly. */
export type IdentityRung = 'league' | 'nfl' | 'text';

/** The colour CLAIM, in the shape `resolveTeamColorPair` consumes. */
export interface FranchiseColorClaim {
  color: string;
  colorPrimary?: string;
  colorSecondary?: string;
  colorPrimaryDark?: string;
  colorSecondaryDark?: string;
}

export interface FranchiseIdentity {
  franchiseId: string;
  name: string;
  nameShort: string;
  /** Always present — the last-resort mark, and the alt text's fallback. */
  initials: string;
  /** Crest or club mark; '' on the text rung. */
  icon: string;
  rung: IdentityRung;
  /** The NFL club, when rung is 'nfl'. Null otherwise. */
  nflCode: string | null;
  colors: FranchiseColorClaim;
}

/**
 * Neutral field for the text rung.
 *
 * Deliberately grey rather than a hue derived from the name. A colour picked
 * by hashing a string LOOKS like a brand and is not one — an owner would
 * reasonably read it as their team's colour, and it would change the day they
 * renamed. `resolveTeamColorPair` separates the two sides of a matchup from
 * here, which keeps the split bar readable without anyone inventing a claim.
 */
const NEUTRAL_FIELD = '#64748b';

/**
 * Up to two initials, for the text rung.
 *
 * A label, not a monogram: "Wagon Circlers" → WC, "Cowboys" → CO. A leading
 * "the" is dropped for the same reason the matcher drops it — "The Boondock
 * Saints" should read BS, not TB.
 */
export function franchiseInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words[0]?.toLowerCase() === 'the' && words.length > 1) words.shift();
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export interface ResolveIdentityInput {
  franchiseId: string;
  /**
   * The franchise's FULL name. Never a short name or an abbreviation — see
   * `nfl-name-match.ts`: the AFL's "The Boondock Saints" carries
   * `nameShort: "Saints"`, which matches New Orleans.
   */
  franchiseName: string;
  /** Registry slug when this site runs the league; '' or null when it does not. */
  leagueSlug?: string | null;
}

export function resolveFranchiseIdentity(input: ResolveIdentityInput): FranchiseIdentity {
  const { franchiseId, leagueSlug } = input;
  const franchiseName = (input.franchiseName ?? '').trim();

  // ── Rung 1: a league we run ─────────────────────────────────────────────
  // Checked FIRST and unconditionally. Not a performance ordering — it is the
  // rule: a real identity outranks an inferred one.
  const config = leagueSlug ? getLeagueTeamConfig(leagueSlug, franchiseId) : undefined;
  if (config) {
    const name = (config.name as string) || franchiseName;
    return {
      franchiseId,
      name,
      nameShort: (config.nameShort as string) || name,
      initials: franchiseInitials(name),
      icon: (config.icon as string) || '',
      rung: 'league',
      nflCode: null,
      colors: {
        color: (config.color as string) || NEUTRAL_FIELD,
        colorPrimary: config.colorPrimary as string | undefined,
        colorSecondary: config.colorSecondary as string | undefined,
        colorPrimaryDark: config.colorPrimaryDark as string | undefined,
        colorSecondaryDark: config.colorSecondaryDark as string | undefined,
      },
    };
  }

  // ── Rung 2: the name IS an NFL club ─────────────────────────────────────
  const nflCode = matchNflTeamName(franchiseName);
  if (nflCode) {
    // Through the accessor, never the table: it normalizes the code and
    // supplies the fallback, and `tests/team-color-backdrop-guard.test.ts`
    // enforces that every surface goes the same way.
    const brand = getNflTeamColors(nflCode);
    return {
      franchiseId,
      // The owner's own name, not the club's: they called it "Cowboys", so
      // that is what the board calls it. The MARK is what the club supplies.
      name: franchiseName,
      nameShort: franchiseName,
      initials: franchiseInitials(franchiseName),
      // The LOCAL svg, not ESPN's CDN. Same-origin, and it is one of the light
      // srcs `nfl-logo-dark-css.ts` already keys its dark swap on — so this
      // mark picks up the 500-dark cut under html.dark for free, including the
      // white ring on the black-bodied ones.
      icon: `/assets/nfl-logos/${nflCode}.svg`,
      rung: 'nfl',
      nflCode,
      colors: {
        color: brand?.primary || NEUTRAL_FIELD,
        colorPrimary: brand?.primary,
        colorSecondary: brand?.secondary,
      },
    };
  }

  // ── Rung 3: text ────────────────────────────────────────────────────────
  const name = franchiseName || `Franchise ${franchiseId}`;
  return {
    franchiseId,
    name,
    nameShort: name,
    initials: franchiseInitials(name),
    icon: '',
    rung: 'text',
    nflCode: null,
    colors: { color: NEUTRAL_FIELD },
  };
}

/** Alt text for a franchise's mark — never a bare code. */
export function identityIconAlt(identity: FranchiseIdentity): string {
  if (identity.rung === 'nfl' && identity.nflCode) {
    return `${getNFLTeamName(identity.nflCode)} logo`;
  }
  return identity.rung === 'league' ? `${identity.name} crest` : '';
}
