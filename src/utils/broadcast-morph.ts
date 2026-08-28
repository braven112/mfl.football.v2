/**
 * Shared-element motion between the AFL draft broadcast's two screens.
 *
 * The idle board and the reveal both show the same two things: the franchise
 * CREST and a block of COPY beside it. They just show them in different places
 * — the idle board holds them as a side-by-side lockup in the middle of the
 * stage, the reveal puts the crest dead centre behind everything and the copy
 * over on the left. Cross-fading the two screens therefore threw away the one
 * piece of continuity the surface had: the room watched a logo vanish and a
 * different logo appear, when what is actually happening is that the SAME two
 * elements are being rearranged.
 *
 * So each pair is animated between the two positions (a FLIP: measure both
 * boxes, start the arriving element on the departing one's box, and let it
 * travel home). The departing element runs the same path in reverse, which is
 * what makes the pair read as one object moving through the cross-fade rather
 * than two objects swapping.
 *
 * Note the two elements in a pair are usually DIFFERENT FRANCHISES: the board
 * behind a reveal has already advanced to whoever is on the clock next. That is
 * the point of dissolving them into each other along one path instead of
 * hard-cutting — the mark moves to centre and becomes the drafting team's.
 *
 * This module owns the geometry; the timing lives with the CSS cross-fade
 * (`--dbc-fade`), which the caller reads and passes in so the two can never
 * drift apart.
 */

/** Just the part of a DOMRect this module needs — so the math is testable. */
export interface MorphBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MorphDelta {
  dx: number;
  dy: number;
  scale: number;
}

/** Matches the reveal card's own entrance easing, so a morph and a plain
 *  reveal→reveal swap decelerate identically. */
export const MORPH_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * The transform that puts an element whose layout box is `home` visually on top
 * of `other` — centre over centre.
 *
 * `withScale` is off for text: a copy block goes from a 2.5vh team name to a
 * 9vh player name, and scaling type between those two sizes reads as a zoom
 * effect rather than as the same words moving. Translate it and cross-fade the
 * content instead. Artwork scales, type does not.
 */
export function morphDelta(home: MorphBox, other: MorphBox, withScale = true): MorphDelta {
  const scale = withScale && home.width > 0 ? other.width / home.width : 1;
  return {
    dx: other.left + other.width / 2 - (home.left + home.width / 2),
    dy: other.top + other.height / 2 - (home.top + home.height / 2),
    scale,
  };
}

/**
 * Compose a delta onto whatever transform the stylesheet already applies.
 *
 * The base has to be carried through verbatim: the reveal crest is centred with
 * `translate(-50%, -50%)`, and a WAAPI keyframe REPLACES the property rather
 * than adding to it — animating a bare `translate(dx, dy)` would silently drop
 * that centring and throw the crest half its own width off in both directions.
 * The base is read as the computed matrix rather than hardcoded here so a CSS
 * change can't quietly desync from this file.
 */
export function morphTransform(base: string, delta: MorphDelta): string {
  const moved = `translate(${delta.dx}px, ${delta.dy}px) scale(${delta.scale})`;
  return base && base !== 'none' ? `${base} ${moved}` : moved;
}

/** The stylesheet's own transform for this element, as a matrix string. */
function baseTransform(el: Element): string {
  const t = getComputedStyle(el).transform;
  return !t || t === 'none' ? '' : t;
}

function boxOf(el: Element): MorphBox {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * The pairs that move. Left is the idle board's element, right is the reveal's.
 * Selectors rather than refs threaded through two component trees: this is a
 * display surface with exactly one instance of each on screen, and the
 * alternative is four refs forwarded through props for a purely visual effect.
 */
const PAIRS: Array<{ idle: string; reveal: string; scale: boolean; fade: boolean }> = [
  { idle: '.dbc-idle__crest', reveal: '.dbc-reveal__crest', scale: true, fade: false },
  { idle: '.dbc-idle__clock-copy', reveal: '.dbc-reveal__text', scale: false, fade: true },
];

export interface MorphOptions {
  /** Duration in ms — the caller passes the CSS cross-fade's own duration. */
  durationMs: number;
  /** True when the reveal is taking over, false when the board is coming back. */
  toReveal: boolean;
}

/**
 * Run one screen-to-screen morph. Returns the animations it started (empty when
 * there is nothing to move, which is a normal outcome — a franchise with no
 * crest art, the "no draft board" idle state, or reduced motion).
 *
 * Must be called from a LAYOUT effect: it measures both screens in their
 * settled positions and starts the animations before the browser has painted
 * the new arrangement. A plain effect paints the jump first and then animates
 * away from it.
 */
export function morphScreens(
  idleLayer: HTMLElement | null,
  revealLayer: HTMLElement | null,
  { durationMs, toReveal }: MorphOptions
): Animation[] {
  const played: Animation[] = [];
  if (!idleLayer || !revealLayer || durationMs <= 0) return played;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return played;
  }

  const card = revealLayer.querySelector<HTMLElement>('.dbc-reveal');
  if (toReveal && card) {
    // `dbc-reveal-in` fades the card AND scales it 1.04 → 1. The scale is fatal
    // to a shared-element move: the crest would be measured inside a parent
    // still growing under it, so it would set off from the wrong box and drift
    // the whole way. Cancel it and hand the card a straight fade — the motion
    // is the crest's job now, not the container's.
    for (const a of card.getAnimations()) a.cancel();
    played.push(
      card.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: durationMs,
        easing: 'ease',
        fill: 'backwards',
      })
    );
  }

  for (const pair of PAIRS) {
    const idleEl = idleLayer.querySelector<HTMLElement>(pair.idle);
    const revealEl = revealLayer.querySelector<HTMLElement>(pair.reveal);
    if (!idleEl || !revealEl) continue;

    // Cancel first, THEN measure: an element still running its own entrance
    // (dbc-crest-in, dbc-text-in) would otherwise be measured mid-flight, and
    // every box in this morph would be wrong by however far it had got. Both
    // the boxes AND the base transforms below have to come from a settled
    // element — see the `fill` note on the leaving animation for what happens
    // when they don't.
    for (const a of [...idleEl.getAnimations(), ...revealEl.getAnimations()]) a.cancel();

    const idleBox = boxOf(idleEl);
    const revealBox = boxOf(revealEl);
    if (!idleBox.width || !revealBox.width) continue;

    const arriving = toReveal ? revealEl : idleEl;
    const leaving = toReveal ? idleEl : revealEl;
    const arrivingHome = toReveal ? revealBox : idleBox;
    const leavingHome = toReveal ? idleBox : revealBox;

    const arrivingBase = baseTransform(arriving);
    const leavingBase = baseTransform(leaving);
    const arrivingAway = morphTransform(
      arrivingBase,
      morphDelta(arrivingHome, leavingHome, pair.scale)
    );
    const leavingAway = morphTransform(
      leavingBase,
      morphDelta(leavingHome, arrivingHome, pair.scale)
    );
    const home = (base: string) => base || 'none';

    played.push(
      arriving.animate(
        [
          { transform: arrivingAway, ...(pair.fade ? { opacity: 0 } : {}) },
          { transform: home(arrivingBase), ...(pair.fade ? { opacity: 1 } : {}) },
        ],
        // `backwards`, not `both`: the arriving element holds the start pose
        // until the clock starts, then hands the property back to the
        // stylesheet at the end. `both` would pin a stale transform on an
        // element that lives on screen for the next 18 seconds.
        { duration: durationMs, easing: MORPH_EASING, fill: 'backwards' }
      ),
      leaving.animate([{ transform: home(leavingBase) }, { transform: leavingAway }], {
        duration: durationMs,
        easing: MORPH_EASING,
        // NO fill — the leaving element snaps home the instant it lands, and
        // that is deliberate. `fill: forwards` is the obvious choice (park it
        // where it flew to, it's about to be hidden anyway) and it is a trap:
        // the pinned transform SURVIVES `cancel()` on a finished animation in
        // Chrome — it stops being listed by `getAnimations()` while still
        // applying — so the next morph measured the idle crest sitting on the
        // reveal's box, computed a zero delta, and the board stopped animating
        // back. Nothing to pin means nothing to un-pin. The snap is invisible
        // because this animation and the layer's opacity transition are the
        // same duration and start together: it lands exactly as the layer
        // reaches zero.
      })
    );
  }

  return played;
}
