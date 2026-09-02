/**
 * The signed-in owner's franchise as a HERO BACKDROP — their gradient behind
 * the card, their crest centred under the copy.
 *
 * This is the draft broadcast's reveal treatment (`BroadcastRevealCard` +
 * `.dbc-reveal` in draft-broadcast.css) brought back to the two league
 * homepages, and it reads off exactly the same fields for exactly the same
 * reason: one franchise look, one place it is decided.
 *
 *   - The BACKGROUND is `broadcastGradient` painted verbatim when the config
 *     carries one — the deliberate no-token exception documented in
 *     docs/claude/rules/theming-and-assets.md — and the derived
 *     `toBroadcastPair` gradient when it does not. Never a second, subtly
 *     different version of the same idea.
 *   - The CREST is resolved SERVER-SIDE by `resolveDarkSurfaceCrest`, because
 *     a franchise gradient is dark in BOTH themes (every stop is floored past
 *     `MIN_WHITE_CONTRAST` for white text) and the site's `html.dark` crest
 *     machinery — the `TeamIconDarkStyles` swap and the measured white stroke —
 *     fires only for a viewer whose SITE theme is dark. A light-theme owner
 *     would otherwise get a light mark on ink and a near-black crest would
 *     dissolve into it. Same call, same reasoning, as the recap hero.
 *   - The BIG crest order (`resolveBroadcastCrest`, resolution first) is
 *     deliberately NOT used. That order exists for a 68vh crest on a 65" TV
 *     where a 7x upscale of a 100px dark cut is the more visible failure; a
 *     hero crest is ~300px, so the dark cut costs nothing and is simply the
 *     right artwork.
 *
 * Returns null for a signed-out visitor, or a franchise whose config carries
 * no colours at all — the caller then renders its own league chrome unchanged,
 * which is the correct fallback and the reason every call site treats the
 * backdrop as optional rather than branching on auth itself.
 */

import { resolveDarkSurfaceCrest, type DarkSurfaceCrestTeam } from './dark-surface-crest';
import { resolveBroadcastGradient, toBroadcastPair } from './draft-broadcast';

/** The config fields this reads — a superset of the crest-bearing ones. */
export interface HeroBackdropTeam extends DarkSurfaceCrestTeam {
  colorPrimary?: string;
  colorSecondary?: string;
  /** Raw CSS `background`, painted verbatim. See the theming rules doc. */
  broadcastGradient?: string;
}

export interface HeroFranchiseBackdrop {
  /** CSS `background` for the card. */
  gradient: string;
  /**
   * A SOLID colour standing in for the card surface, for the `color-mix`
   * fades that blend a rectangular player photo into it. Those fades sit on
   * the card's RIGHT flank, which is where the gradient has reached its
   * second stop — so this is the secondary, not the primary.
   */
  surface: string;
  /** Crest src — '' when the franchise config carries no artwork at all. */
  crest: string;
  /** Inline `filter` carrying the measured outline, only for a LIGHT cut. */
  crestFilter?: string;
  /** The custom properties, ready for an inline `style` attribute. */
  style: string;
}

/** Fallbacks matching the derived pair's own defaults, for a colourless entry. */
const FALLBACK_PRIMARY = '#10161f';
const FALLBACK_SECONDARY = '#1c497c';

/**
 * `league` is the crest manifest's league key (`theleague` | `afl`), NOT the
 * route directory (`afl-fantasy`) — same contract as `crestStrokeIndex`.
 */
export function resolveHeroFranchiseBackdrop(
  team: HeroBackdropTeam | null | undefined,
  league: string
): HeroFranchiseBackdrop | null {
  if (!team) return null;
  if (!team.colorPrimary && !team.colorSecondary && !team.broadcastGradient) return null;

  // Floored for white text before either use: the pair is what the derived
  // gradient paints AND what the photo fade blends toward, so taking it once
  // keeps the two from drifting.
  const pair = toBroadcastPair(
    team.colorPrimary || FALLBACK_PRIMARY,
    team.colorSecondary || FALLBACK_SECONDARY
  );
  const gradient =
    resolveBroadcastGradient(team) ??
    `linear-gradient(115deg, ${pair.primary} 0%, ${pair.secondary} 100%)`;

  const art = resolveDarkSurfaceCrest(team, league);

  return {
    gradient,
    surface: pair.secondary,
    crest: art.src,
    ...(art.filter ? { crestFilter: art.filter } : {}),
    style: `--hero-fb-gradient:${gradient};--hero-fb-surface:${pair.secondary};`,
  };
}
