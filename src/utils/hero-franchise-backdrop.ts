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
   * The franchise's accent for the COPY band: headline word, countdown numeral,
   * eyebrow chip.
   *
   * Cleared for **3:1** — `AA_LARGE_TEXT_RATIO` — against the washed gradient
   * across that whole band, and for ΔE ≥ 18 against the white headline it sits
   * beside. 3:1 is the correct floor and not a relaxed one: every mark this
   * colours is large display type or non-text UI, which is exactly what WCAG's
   * large-text bar covers. Do not "tighten" it to 4.5 — that was tried, and it
   * drove every accent so far toward white that the brand colour stopped being
   * recognisable, which fails a different part of the same standard.
   *
   * The pill's FILL is not this value: it is `--hero-fb-pill-bg`, nudged away
   * from `pillInk` to clear 4.5:1, because a 0.8125rem label is small text.
   */
  accent: string;
  /**
   * The accent for a slotted data panel's small type, on the card's FAR side.
   *
   * Separate from `accent` because it is a different surface AND a different
   * floor: the panel sits over the gradient's far end under the thinnest wash,
   * and its type is 0.75rem, so it is held to 4.5:1. One accent cannot serve
   * both bands on a high-contrast gradient — Midwestside runs gold at one end
   * and black at the other, so a colour readable on one is invisible on the
   * other by construction.
   */
  accentPanel: string;
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
 * The two horizontal bands a mark can occupy, as fractions of the card width.
 *
 * They are separate because a franchise gradient is not one colour — it is at
 * its first stop on the left and its last on the right, and the wash over it is
 * heaviest on the left and thinnest in the middle. A single accent cleared at
 * one point and then published to the whole `<section>` is exactly the bug this
 * replaced: the accent word is the LAST word of the headline, around x=0.48,
 * where five franchises sat under 3:1 while the resolver measured x=0 and the
 * guard test re-measured the same wrong point and agreed with it.
 *
 * The panel band exists because four heroes slot a data panel there
 * (CutWatch, TaggedShowcase, Draft, Auction) whose small type reads
 * `--ev-accent` over the far end of the gradient under the thinnest wash — 25
 * of the 40 franchises were under 4.5:1 there.
 */
const COPY_BAND: readonly [number, number] = [0, 0.55];
const PANEL_BAND: readonly [number, number] = [0.62, 1];

/**
 * Alpha of `.hero-fb__wash`'s dark ramp at horizontal fraction `x`.
 *
 * Mirrors the stylesheet: `linear-gradient(100deg, rgba(0,0,0,.66) 0%,
 * rgba(0,0,0,.28) 58%, rgba(0,0,0,.5) 100%)`. Both numbers live in two places
 * by necessity — CSS cannot be measured from here — so the guard test pins the
 * stylesheet against these constants rather than trusting them to stay in step.
 */
const WASH_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.66],
  [0.58, 0.28],
  [1, 0.5],
];

/**
 * The mobile scrim, which is a flat-ish vertical wash rather than the desktop
 * ramp — under 640px the copy spans the FULL width, so there is no left column
 * for a horizontal ramp to protect.
 *
 * The thinnest point is what matters and it is deliberately heavier than the
 * desktop ramp's thinnest: an accent proven on the desktop left column is
 * otherwise unproven across the whole mobile card. Strengthening the scrim
 * rather than darkening every accent is the trade that keeps Midwestside gold
 * and Music City red on their own cards instead of pushing all 40 toward a
 * safe, generic mid-tone.
 */
const MOBILE_WASH_MIN = 0.58;

/** Channel spread below which a colour has no hue worth accenting with. */
const GREY_SPREAD = 20;

/**
 * ΔE the accent must hold against the WHITE it sits beside.
 *
 * The accent word is one word inside a white headline, so contrast against the
 * BACKGROUND is only half its job — an accent that satisfies its floor by being
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

function parseRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function toHex(rgb: number[]): string {
  return (
    '#' +
    rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
  );
}

function lerp(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseRgb(a);
  const [br, bg, bb] = parseRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** Sample a piecewise-linear stop list at `t`. */
function sampleStops(stops: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const [p0, v0] = stops[i - 1];
      const [p1, v1] = stops[i];
      return p1 === p0 ? v1 : v0 + (v1 - v0) * ((t - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
}

/** Every `#rrggbb` in a gradient, with its declared position where it has one. */
function gradientStops(gradient: string): Array<{ hex: string; at: number | null }> {
  const out: Array<{ hex: string; at: number | null }> = [];
  const re = /#([0-9a-f]{6})\b\s*(?:(-?[\d.]+)%)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gradient)) !== null) {
    out.push({ hex: `#${m[1].toLowerCase()}`, at: m[2] === undefined ? null : parseFloat(m[2]) / 100 });
  }
  return out;
}

/**
 * The gradient's colour at horizontal fraction `x` of the CARD.
 *
 * Which end of the stop list is on the left depends on the angle: CSS angles
 * increase clockwise from 0deg = up, so 0-180 runs left-to-right and 180-360
 * right-to-left. Both shapes ship — 38 franchises at 115deg, the two
 * hand-authored cards at 315deg — and reading Midwestside's 315deg card
 * forwards is what put its gold under the copy, which demanded an accent no
 * gold can reach and drove the lift to pure white.
 *
 * The exact 0/180/360 boundaries are vertical gradients with no left or right
 * end. They take the lightest stop rather than an arbitrary one, which is the
 * same answer this gives anything it cannot read.
 */
function gradientAt(stops: ReturnType<typeof gradientStops>, angle: number | null, x: number): string {
  if (stops.length === 1) return stops[0].hex;
  if (angle === null || angle === 0 || angle === 180 || angle === 360) {
    return stops.reduce((a, b) => (relativeLuminance(b.hex) > relativeLuminance(a.hex) ? b : a)).hex;
  }
  const forward = angle > 0 && angle < 180;
  const seq = forward ? stops : [...stops].reverse();
  // A reversed list's declared positions are measured from the other end.
  const pos = seq.map((s, i) =>
    s.at !== null ? (forward ? s.at : 1 - s.at) : i / (seq.length - 1)
  );
  const t = Math.max(0, Math.min(1, x));
  if (t <= pos[0]) return seq[0].hex;
  for (let i = 1; i < seq.length; i += 1) {
    if (t <= pos[i]) {
      const span = pos[i] - pos[i - 1];
      return span <= 0 ? seq[i].hex : lerp(seq[i - 1].hex, seq[i].hex, (t - pos[i - 1]) / span);
    }
  }
  return seq[seq.length - 1].hex;
}

/** Leading `<n>deg` of a single-layer linear-gradient, or null. */
function gradientAngle(gradient: string): number | null {
  const m = /^\s*linear-gradient\(\s*(-?[\d.]+)deg\s*,/i.exec(gradient);
  if (!m || gradient.toLowerCase().split('gradient(').length !== 2) return null;
  return ((parseFloat(m[1]) % 360) + 360) % 360;
}

/**
 * The LIGHTEST surface a mark in `band` can land on — the worst case for the
 * light type this card carries, and therefore the one to measure against.
 *
 * Samples rather than solving: the gradient and the wash are both piecewise
 * linear but in different spaces, so their composite has no closed form worth
 * deriving. 21 samples across a band is far finer than the eye needs and costs
 * nothing at build time.
 *
 * `fallbackStops` is used when the gradient carries no `#rrggbb` at all —
 * `isSafeCssGradient` also permits `rgb()`, 3-digit hex and named colours, so
 * this is reachable with a perfectly valid config. Handing it the franchise's
 * own derived pair keeps the answer team-accurate instead of inventing a
 * surface, which the earlier near-black fallback did in the wrong direction.
 */
function bandExtreme(
  gradient: string,
  band: readonly [number, number],
  fallbackStops: string[]
): string {
  const parsed = gradientStops(gradient);
  const stops = parsed.length > 0 ? parsed : fallbackStops.map((hex) => ({ hex, at: null }));
  if (stops.length === 0) return '#10161f';
  const angle = parsed.length > 0 ? gradientAngle(gradient) : 115;

  let worst = '#000000';
  const STEPS = 20;
  for (let i = 0; i <= STEPS; i += 1) {
    const x = band[0] + ((band[1] - band[0]) * i) / STEPS;
    const base = gradientAt(stops, angle, x);
    // Desktop ramp, and the mobile scrim at its thinnest. A black overlay at
    // alpha a is exactly a mix toward black by a.
    for (const alpha of [sampleStops(WASH_STOPS, x), MOBILE_WASH_MIN]) {
      const lit = shiftLightness(base, -alpha);
      if (relativeLuminance(lit) > relativeLuminance(worst)) worst = lit;
    }
  }
  return worst;
}

/** Worst-case surface under the copy column (headline, countdown, pill, CTA). */
export function copyBackdrop(gradient: string, fallbackStops: string[] = []): string {
  return bandExtreme(gradient, COPY_BAND, fallbackStops);
}

/** Worst-case surface under a slotted data panel, on the card's far side. */
export function panelBackdrop(gradient: string, fallbackStops: string[] = []): string {
  return bandExtreme(gradient, PANEL_BAND, fallbackStops);
}

/**
 * The franchise colour that carries an accent, made readable without being made
 * generic.
 *
 * Candidate order puts SECONDARY first: the primary is usually the gradient
 * itself, so accenting with it is accenting with the background. Greyscale
 * entries are set aside unless the franchise is greyscale throughout.
 *
 * Each candidate is lifted to `floor` against the surface it will sit on FIRST,
 * and only then tested for distinctness from white — that order matters,
 * because the lift is what moves a colour toward white and so is what can
 * destroy the distinctness. Testing before the lift passes colours that fail
 * after it.
 *
 * `floor` is a parameter rather than a constant because the same function
 * serves two marks with genuinely different requirements: the headline accent
 * is large display type (3:1) and the panel accent is 0.75rem (4.5:1).
 *
 * Falling back to the best-scoring candidate rather than to a league colour is
 * deliberate (Brandon, Sep 2026): the accent stays the team's on every
 * franchise, nudged as far as it needs to go and no further.
 */
function resolveAccent(team: HeroBackdropTeam, backdrop: string, floor: number): string {
  const candidates = [
    team.colorSecondary,
    team.colorTertiary,
    team.colorQuaternary,
    team.colorPrimary,
  ].filter((c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c.trim()));

  const unique = [...new Set(candidates.map((c) => c.toLowerCase()))];
  if (unique.length === 0) return ensureContrastOn('#c9a94e', backdrop, floor);

  const hued = unique.filter((c) => channelSpread(c) >= GREY_SPREAD);

  // A franchise with no hue anywhere in its palette — four of the forty: TITS
  // and BADD in the AFL, Bring The Pain and Wabs in TheLeague. Grey IS their
  // brand, so the accent stays grey, but WHICH grey has to be constructed
  // rather than picked.
  //
  // Picking left them at #696969: the near-white stop fails the distinctness
  // bound (ΔE 8 from the headline it sits in), so selection fell through to the
  // near-black stop, which then had to be lifted to clear the backdrop —
  // landing on a mid-grey DARKER than the white around it, which reads as
  // disabled text rather than as emphasis. Legible by the numbers, an
  // anti-accent in practice.
  //
  // Walking down from white to the first shade that clears the same bound lands
  // ~#bfbfbf — as distinct, and brighter than it is dark. It also makes all four
  // agree, where selection had two at #a3a3a3 and two at #696969 for no reason
  // a reader could see.
  if (hued.length === 0) {
    let grey = HEADLINE_INK;
    for (let step = 0.05; step <= 1.0001; step += 0.05) {
      grey = shiftLightness(HEADLINE_INK, -step);
      if (colorDistance(grey, HEADLINE_INK) >= DISTINCT_FROM_WHITE) break;
    }
    return ensureContrastOn(grey, backdrop, floor);
  }

  let best = '';
  let bestScore = -1;
  for (const candidate of hued) {
    const safe = ensureContrastOn(candidate, backdrop, floor);
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
  return ensureContrastOn(out, backdrop, floor);
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
  // The derived pair doubles as the fallback surface for a gradient that
  // carries no parseable hex — see `bandExtreme`.
  const fallbackStops = [pair.primary, pair.secondary];
  const backdrop = copyBackdrop(gradient, fallbackStops);
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
  const accent = resolveAccent(team, backdrop, AA_LARGE_TEXT_RATIO);

  // The panel's own accent: far side of the card, small type, so a different
  // surface and the body floor. Falls back to the copy accent when the two
  // agree, which they do wherever the gradient is close to flat.
  const accentPanel = resolveAccent(
    team,
    panelBackdrop(gradient, fallbackStops),
    AA_BODY_TEXT_RATIO
  );

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
    accentPanel,
    pillInk,
    ctaInk,
    borderDark,
    borderLight,
    style:
      `--hero-fb-gradient:${gradient};` +
      `--hero-fb-accent:${accent};` +
      `--hero-fb-accent-panel:${accentPanel};` +
      `--hero-fb-pill-bg:${pillBg};` +
      `--hero-fb-pill-ink:${pillInk};` +
      `--hero-fb-cta-ink:${ctaInk};` +
      `--hero-fb-border-dark:${borderDark};` +
      `--hero-fb-border-light:${borderLight};`,
  };
}
