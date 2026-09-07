/**
 * Presentation types for the shared composite hero shell.
 *
 * A module rather than exports on `CompositeHero.astro` so a `.ts` — the AFL
 * hero resolver, in particular — can import the accent union without importing
 * an Astro component.
 */

/**
 * Palette families defined in `src/styles/composite-hero.css`. Named per HERO,
 * not per color: three of TheLeague's five composites are shades of blue that
 * differ in accent, pill and dark surface, so a color-named union would invite
 * exactly the merge that restyled live heroes once already.
 */
export type CompositeHeroAccent =
  | 'feature'
  | 'recap'
  | 'kickoff'
  | 'roster'
  | 'auction'
  | 'navy'
  | 'gold';

/**
 * How a hero state wants to be rendered as a composite. Carried on the AFL's
 * `EventHeroView` so the choice lives beside the copy, in the one place that
 * already knows whether the event is live and how many days are left.
 */
export interface CompositeHeroTreatment {
  /** Oversized ghost wordmark bled off the top edge. Plain text; U+00A0 to hold two words together. */
  wordmark: string;
  accent: CompositeHeroAccent;
  /** Urgency overlay — a deadline today, a draft actually running. */
  tone?: 'red' | null;
  /**
   * WHOSE colours the card wears.
   *
   * `league` — a league event (a draft, the auction, kickoff, a site
   * announcement). The card keeps `accent`'s gradient.
   * `team` — a team event (your keeper class, your cuts, a club's week). The
   * card is repainted in that franchise's colours, when one is resolved; with
   * no franchise (a signed-out viewer) it falls back to `accent`, which is why
   * nothing branches on auth.
   */
  scope?: 'league' | 'team';
}
