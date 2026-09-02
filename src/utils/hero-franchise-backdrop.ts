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
import {
  AA_BODY_TEXT_RATIO,
  AA_LARGE_TEXT_RATIO,
  colorDistance,
  contrastRatio,
  ensureContrastOn,
  relativeLuminance,
  shiftLightness,
} from './team-color-contrast';

/** The config fields this reads — a superset of the crest-bearing ones. */
export interface HeroBackdropTeam extends DarkSurfaceCrestTeam {
  colorPrimary?: string;
  colorSecondary?: string;
  colorTertiary?: string;
  colorQuaternary?: string;
  /** Raw CSS `background`, painted verbatim. See the theming rules doc. */
  broadcastGradient?: string;
}

export interface HeroFranchiseBackdrop {
  /** CSS `background` for the card. */
  gradient: string;
  /** Crest src — '' when the franchise config carries no artwork at all. */
  crest: string;
  /** Inline `filter` carrying the measured outline, only for a LIGHT cut. */
  crestFilter?: string;
  /**
   * The franchise's accent: headline word, countdown numeral, star chip, pill
   * fill. Cleared for 4.5:1 against the washed gradient AND for ΔE ≥ 18 against
   * the white it sits beside.
   */
  accent: string;
  /** Ink on the accent-filled pill — whichever of white/near-black clears. */
  pillInk: string;
  /** Ink on the neutral-white CTA, darkened until it clears 4.5:1 on white. */
  ctaInk: string;
  /** Card border for the DARK theme — lightened until 3:1 on a dark surface. */
  borderDark: string;
  /** Card border for the LIGHT theme — darkened until 3:1 on a light one. */
  borderLight: string;
  /** The custom properties, ready for an inline `style` attribute. */
  style: string;
}

// ── The franchise's own accent, held to a contrast floor ─────────────────────

/**
 * Reference surfaces, per theme, for anything that must read against what is
 * BEHIND the card — currently just the border.
 *
 * Each is the WORST CASE for the mark it carries, not the typical one. The
 * dark-theme border is light, so its worst case is the LIGHTEST dark surface
 * the hero can sit on (the AFL's `--content-bg`, #16283c — lighter than either
 * league's `--page-bg`). The light-theme border is dark, so its worst case is
 * the DARKEST light surface (`--page-bg`, #e0e0e0). Taking the typical surface
 * instead would put the failure exactly where nobody looks: the one league, one
 * theme, one page that happens to sit at the edge of the range.
 */
export const SURFACE_BEHIND_DARK = '#16283c';
export const SURFACE_BEHIND_LIGHT = '#e0e0e0';

/**
 * How much black the wash lays over the gradient where the COPY sits.
 *
 * `.hero-fb__wash` ramps `rgba(0,0,0,.66)` at the left edge to `.28` at 58%,
 * and the copy column ends around half way — so ~0.33 is the thinnest cover any
 * headline character gets. Using the thinnest rather than the average is the
 * whole point: a contrast figure computed against the darkest part of a ramp is
 * a figure that does not hold where the text actually ends.
 */
const WASH_OVER_COPY = 0.33;

/** Channel spread below which a colour has no hue worth accenting with. */
const GREY_SPREAD = 20;

/**
 * ΔE the accent must hold against the WHITE it sits beside.
 *
 * The accent word is one word inside a white headline, so contrast against the
 * BACKGROUND is only half its job — an accent that satisfies 4.5:1 by being
 * near-white is perfectly legible and completely invisible AS an accent. This
 * is the second half. 18 is the `DEFAULT_MIN_BG_CONTRAST` bar from
 * `team-color-contrast.ts`, reused rather than re-invented.
 */
const DISTINCT_FROM_WHITE = 18;

const HEADLINE_INK = '#ffffff';
/** Ink for a pill whose background is too light to carry white. */
const PILL_DARK_INK = '#10131a';

function channelSpread(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Every 6-digit hex in a CSS gradient string, in source order. */
function gradientStops(gradient: string): string[] {
  return (gradient.match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => h.toLowerCase());
}

/**
 * The colour the copy is actually drawn on.
 *
 * All the copy — headline, pill, countdown, CTA — is in the card's LEFT column,
 * so the stop that matters is the one at the left edge, and which stop that is
 * depends on the gradient's angle. In CSS 0deg points to the top and angles
 * increase clockwise, so a gradient between 0 and 180deg runs left-to-right and
 * its FIRST stop is leftmost; between 180 and 360 it runs right-to-left and its
 * LAST stop is. Both shapes are in the configs: 38 of the 40 franchises use
 * 115deg, and the two hand-authored cards (Midwestside, Vitside) use 315deg.
 *
 * The first cut of this took the LIGHTEST stop instead, to avoid parsing
 * anything. That is conservative in the abstract and wrong in practice, in a
 * way worth recording: Midwestside's gold sits in a 7% wedge at the BOTTOM
 * RIGHT of a card that is black everywhere the text goes, so measuring against
 * the gold demanded an accent no gold can reach — the lift ran to pure white
 * and the accent vanished into the headline it was supposed to punctuate.
 * Every other franchise came back a pastel for the same reason. A safety margin
 * that destroys the thing it is protecting is not a safety margin.
 *
 * Anything this cannot read as an angled linear-gradient — a radial, a conic,
 * a multi-layer value, all of which `broadcastGradient` permits — falls back to
 * the lightest stop, which needs no geometry and errs toward legibility.
 *
 * Exported so the guard test can measure the shipped accent against the SAME
 * surface this resolver measured it against. A test that recomputes the
 * backdrop its own way is testing its own arithmetic, which is how the first
 * pass of this reported fifteen franchises below the floor when none were.
 */
export function copyBackdrop(gradient: string): string {
  const stops = gradientStops(gradient);
  if (stops.length === 0) return shiftLightness('#10161f', -WASH_OVER_COPY);

  const lightest = () =>
    stops.reduce((a, b) => (relativeLuminance(b) > relativeLuminance(a) ? b : a));

  // One `linear-gradient(<n>deg, …)` layer and nothing else — the shape every
  // real config uses. A second layer or a non-angle syntax takes the fallback.
  const single = /^\s*linear-gradient\(\s*(-?[\d.]+)deg\s*,/i.exec(gradient);
  const nearest =
    single && gradient.toLowerCase().split('gradient(').length === 2
      ? (() => {
          const angle = ((parseFloat(single[1]) % 360) + 360) % 360;
          return angle > 0 && angle < 180 ? stops[0] : stops[stops.length - 1];
        })()
      : lightest();

  // A black overlay at alpha a is exactly a mix toward black by a.
  return shiftLightness(nearest, -WASH_OVER_COPY);
}

/**
 * The franchise colour that carries the accent, made readable without being
 * made generic.
 *
 * Candidate order puts SECONDARY first: the primary is usually the gradient
 * itself, so accenting with it is accenting with the background. Greyscale
 * entries are set aside unless the franchise is greyscale throughout — four
 * are (TITS and BADD in the AFL, Bring The Pain and Wabs in TheLeague), and for
 * those a light grey IS the brand, so it is the honest accent rather than a hue
 * invented for them.
 *
 * Each candidate is lifted to 4.5:1 against the washed gradient first, THEN
 * tested for distinctness from white — that order matters, because the lift is
 * what moves a colour toward white and so is what can destroy the distinctness.
 * Testing before the lift would pass colours that fail after it.
 *
 * Falling back to the best-scoring candidate rather than to a league colour is
 * deliberate (Brandon, Sep 2026): the accent stays the team's on every
 * franchise, nudged as far as it needs to go and no further.
 */
function resolveAccent(team: HeroBackdropTeam, backdrop: string): string {
  const candidates = [
    team.colorSecondary,
    team.colorTertiary,
    team.colorQuaternary,
    team.colorPrimary,
  ].filter((c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c.trim()));

  const unique = [...new Set(candidates.map((c) => c.toLowerCase()))];
  if (unique.length === 0) return ensureContrastOn('#c9a94e', backdrop, AA_LARGE_TEXT_RATIO);

  const hued = unique.filter((c) => channelSpread(c) >= GREY_SPREAD);

  // A franchise with no hue anywhere in its palette — four of the forty: TITS
  // and BADD in the AFL, Bring The Pain and Wabs in TheLeague. Grey IS their
  // brand, so the accent stays grey, but WHICH grey has to be constructed
  // rather than picked.
  //
  // Picking left them at #696969: the near-white stop fails the
  // distinctness bound (ΔE 8 from the headline it sits in), so selection fell
  // through to the near-black stop, which then had to be lifted to clear the
  // backdrop — landing on a mid-grey that is DARKER than the white around it
  // and reads as disabled text rather than as emphasis. Legible by the numbers,
  // an anti-accent in practice.
  //
  // Walking down from white to the first shade that clears the same bound
  // lands ~#a3a3a3 — as distinct from the headline, and brighter than it is
  // dark, so it reads as emphasis. It also makes all four agree, where
  // selection had two of them at #a3a3a3 and two at #696969 for no reason a
  // reader could see.
  if (hued.length === 0) {
    let grey = HEADLINE_INK;
    for (let step = 0.05; step <= 1.0001; step += 0.05) {
      grey = shiftLightness(HEADLINE_INK, -step);
      if (colorDistance(grey, HEADLINE_INK) >= DISTINCT_FROM_WHITE) break;
    }
    return ensureContrastOn(grey, backdrop, AA_LARGE_TEXT_RATIO);
  }

  const pool = hued;

  let best = '';
  let bestScore = -1;
  for (const candidate of pool) {
    const safe = ensureContrastOn(candidate, backdrop, AA_LARGE_TEXT_RATIO);
    const score = colorDistance(safe, HEADLINE_INK);
    if (score >= DISTINCT_FROM_WHITE) return safe;
    if (score > bestScore) {
      best = safe;
      bestScore = score;
    }
  }

  // Nothing separated from white on its own. Deepen the closest one until it
  // does, then re-clear it against the backdrop — a colour that has to satisfy
  // both bounds can end up between them, and the backdrop bound is the one a
  // reader cannot work around.
  let out = best;
  for (let step = 0.05; step <= 1.0001; step += 0.05) {
    if (colorDistance(out, HEADLINE_INK) >= DISTINCT_FROM_WHITE) break;
    out = shiftLightness(best, -step);
  }
  return ensureContrastOn(out, backdrop, AA_LARGE_TEXT_RATIO);
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

  // Floored for white text: a franchise gradient is the card's whole
  // background and the copy sits on it in both themes.
  const pair = toBroadcastPair(
    team.colorPrimary || FALLBACK_PRIMARY,
    team.colorSecondary || FALLBACK_SECONDARY
  );
  const gradient =
    resolveBroadcastGradient(team) ??
    `linear-gradient(115deg, ${pair.primary} 0%, ${pair.secondary} 100%)`;

  const art = resolveDarkSurfaceCrest(team, league);

  // Everything below is measured against a colour that is actually rendered —
  // the gradient under its wash for the copy, the page surface for the border —
  // rather than against an assumed one. That is the difference between "this
  // clears 4.5:1" and "this clears 4.5:1 against something else".
  const backdrop = copyBackdrop(gradient);
  // 3:1, not 4.5:1, and the size is what earns it: every element the accent
  // colours is large text or non-text UI, which is exactly what WCAG's
  // large-text floor is for. The headline word runs clamp(2.2rem, 4.4vw,
  // 3.25rem) at weight 700 and the countdown numeral clamp(2.6rem, 5vw,
  // 3.1rem) — both far past the 18.66px-bold threshold — and the star chip is
  // a background. Holding display type to the BODY floor is not "extra safe":
  // it forced every accent so far toward white that the brand colour stopped
  // being recognisable, which fails a different part of the same standard.
  // The pill is the exception and is handled at 4.5 below, because its label is
  // 0.8125rem — genuinely small text.
  const accent = resolveAccent(team, backdrop);

  // Pill: the accent is the fill, so the ink is whichever of the two neutrals
  // reads on it, and the fill is then nudged AWAY from that ink if the pair
  // still falls short — a mid-tone accent carries neither neutral at 4.5:1 on
  // its own, and shrinking the accent's role is better than shipping the pill
  // at 3:1 because the fill was treated as fixed.
  const pillInk =
    contrastRatio(accent, HEADLINE_INK) >= contrastRatio(accent, PILL_DARK_INK)
      ? HEADLINE_INK
      : PILL_DARK_INK;
  const pillBg = ensureContrastOn(accent, pillInk, AA_BODY_TEXT_RATIO);

  // CTA is neutral white, so its ink is the team colour DARKENED onto white.
  const ctaInk = ensureContrastOn(accent, '#ffffff', AA_BODY_TEXT_RATIO);

  // Border is non-text UI → the 3:1 floor, and it is the one mark measured
  // against what is BEHIND the card. Both variants are emitted and CSS picks:
  // with theme preference 'auto' the server cannot know which theme resolved,
  // so choosing here would be the `var(--x)`-with-no-definition bug in reverse.
  const borderDark = ensureContrastOn(accent, SURFACE_BEHIND_DARK, AA_LARGE_TEXT_RATIO);
  const borderLight = ensureContrastOn(accent, SURFACE_BEHIND_LIGHT, AA_LARGE_TEXT_RATIO);

  return {
    gradient,
    crest: art.src,
    ...(art.filter ? { crestFilter: art.filter } : {}),
    accent,
    pillInk,
    ctaInk,
    borderDark,
    borderLight,
    style:
      `--hero-fb-gradient:${gradient};` +
      `--hero-fb-accent:${accent};` +
      `--hero-fb-pill-bg:${pillBg};` +
      `--hero-fb-pill-ink:${pillInk};` +
      `--hero-fb-cta-ink:${ctaInk};` +
      `--hero-fb-border-dark:${borderDark};` +
      `--hero-fb-border-light:${borderLight};`,
  };
}
