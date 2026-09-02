/**
 * Backdrop for a letterboxed Throwback Week era banner: the era's own palette.
 *
 * Every era-banner slot renders `object-fit: contain`, and that stays true —
 * a legacy banner may be any shape at all and `cover` would crop a wordmark
 * in half. The problem `contain` leaves behind is the FIELD, not the fit: 21
 * of the AFL archive's 109 "banners" are not banners, they are the 2003/04
 * MFL franchise logo — square or portrait, often under 150px wide — so they
 * fit as a stamp marooned in a wide grey box.
 *
 * Cropping those is strictly worse than stamping them: a 92x180 portrait
 * cropped to a ~6:1 strip is a horizontal sliver of one, with no way to tell
 * which team it was. So the fix paints the empty space with the era's own two
 * colors, and the stamp reads as a crest on a branded ground.
 *
 * This is the second job the derived palettes do, and the reason deriving one
 * for every era was worth it. A true 6:1 banner in a wide slot covers its box
 * edge to edge and never shows the gradient at all, so the treatment costs
 * the good art nothing.
 *
 * League-agnostic and data-driven: an era that later gets real banner art
 * keeps the same call and simply stops showing any gradient.
 */

/** Minimal shape this needs from an era — a history entry or its view model. */
export interface EraPalette {
  colorPrimary?: string | undefined;
  colorSecondary?: string | undefined;
}

/**
 * An inline `style` value for an era banner `<img>`, or undefined when the era
 * has no palette.
 *
 * Undefined rather than a grey literal so the caller's stylesheet fallback
 * (`background: var(--content-border)`) still applies — a themed token beats a
 * hardcoded color, and an era added without colors should look plain, not
 * transparent.
 */
export function eraBannerStyle(era: EraPalette | null | undefined): string | undefined {
  const a = era?.colorPrimary;
  if (!a) return undefined;
  const b = era.colorSecondary ?? a;
  // Vertical, not diagonal. The art sits in the MIDDLE of the box, so a
  // diagonal gradient leaves one flank primary and the other secondary and
  // reads as two mismatched slabs bolted to a logo. Top-to-bottom makes both
  // flanks identical and the whole thing reads as one pillarboxed field.
  return `background: linear-gradient(180deg, ${a} 0%, ${b} 100%)`;
}
