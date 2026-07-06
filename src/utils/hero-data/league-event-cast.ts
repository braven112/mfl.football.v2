/**
 * league-event-cast — pure event→casting-strategy mapping for the composite
 * LeagueEventHero.
 *
 * The offseason-fallback hero is driven by a `LeagueEventView` (the branded
 * card's props), which does NOT itself carry the event's calendar category —
 * but its `accent`/`glow` colors are set PER CATEGORY from the shared
 * `CATEGORY_ACCENT` / `CATEGORY_GLOW` palettes. So the accent color is a
 * reliable, self-contained signal for which category the view represents,
 * and thus which player the composite should cast:
 *
 *   free-agency  → the top available free agent (castTopFreeAgentModel)
 *   draft        → the #1 rookie prospect (castRookieModel)
 *   preseason    → the marquee game's best player (getMarqueeGameStars + castBestScoredModel)
 *   regular-season / anything else confidently un-mappable → NO player (fall back)
 *
 * Keeping the accent→category resolution here (not inline in the component)
 * makes it unit-testable against the palette and reusable if another hero ever
 * needs the same reverse-mapping.
 */
import { CATEGORY_ACCENT } from '../league-event-hero-view';

/** How a composite hero should cast a player for a given event category. */
export type EventCastStrategy = 'free-agent' | 'rookie' | 'marquee' | 'none';

type EventCategory = keyof typeof CATEGORY_ACCENT;

/**
 * Reverse-map a LeagueEventView accent color to its calendar category.
 * The accent is assigned from CATEGORY_ACCENT, so an exact (case-insensitive)
 * match identifies the category. Returns null when the accent is missing or
 * doesn't correspond to a known category (e.g. a bespoke feature/default view).
 */
export function categoryFromAccent(accent: string | undefined): EventCategory | null {
  if (!accent) return null;
  const target = accent.trim().toLowerCase();
  for (const [category, hex] of Object.entries(CATEGORY_ACCENT)) {
    if (hex.toLowerCase() === target) return category as EventCategory;
  }
  return null;
}

/**
 * The casting strategy for an event category.
 *
 * - free-agency → 'free-agent': the top available FA models "the auction/market."
 * - draft       → 'rookie': the #1 rookie prospect models "the draft."
 * - preseason   → 'marquee': the best player in the season opener models "kickoff."
 * - regular-season → 'none': a generic in-season calendar event maps to no single
 *   player confidently, so the branded card renders instead (a wrong/decorative
 *   player is worse than none).
 */
export function castStrategyForCategory(category: EventCategory | null): EventCastStrategy {
  switch (category) {
    case 'free-agency':
      return 'free-agent';
    case 'draft':
      return 'rookie';
    case 'preseason':
      return 'marquee';
    default:
      // 'regular-season', null, or any future category we can't confidently map.
      return 'none';
  }
}

/**
 * Convenience: resolve the casting strategy straight from a view's accent.
 * The composite hero calls this to decide how (or whether) to cast a player.
 */
export function castStrategyForAccent(accent: string | undefined): EventCastStrategy {
  return castStrategyForCategory(categoryFromAccent(accent));
}
