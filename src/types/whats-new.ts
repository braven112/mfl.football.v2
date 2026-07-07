/**
 * What's New / Changelog Types
 *
 * Data model for feature announcements and the automated hero banner system.
 * The hero resolver uses these types alongside league events to determine
 * what to promote on the homepage.
 */

import { ALL_LEAGUES } from '../config/leagues';
import type { LeagueSlug } from './nav';

/** Entry category determines badge color and hero accent */
export type WhatsNewCategory = 'new-page' | 'new-feature' | 'enhancement' | 'bug-fix' | 'league-event';

/** An inline image block within an article description */
export interface DescriptionImageBlock {
  type: 'image';
  /** Image filename relative to /assets/whats-new/ */
  src: string;
  /** Accessible alt text */
  alt: string;
  /** Optional caption displayed below the image */
  caption?: string;
}

/** A single block in the article description — either a text paragraph or an inline image */
export type DescriptionBlock = string | DescriptionImageBlock;

/**
 * Custom artwork for the composite hero, replacing the cast player.
 * The image is decorative (captioned via the chip, not alt text) — same
 * treatment as the player headshot it stands in for.
 */
export interface HeroArt {
  /** Absolute path to the artwork (e.g. "/assets/theleague/history/....png") */
  src: string;
  /** Caption chip main line (where the player name would go) */
  caption?: string;
  /** Caption chip meta line (uppercase micro text, e.g. "CIRCA 2007") */
  captionMeta?: string;
}

/** A single feature announcement entry in whats-new.json */
export interface WhatsNewEntry {
  /** Unique ID for the entry (kebab-case) */
  id: string;
  /** Display date (YYYY-MM-DD) — used for sorting & hero freshness */
  date: string;
  /** Headline title */
  title: string;
  /** Short summary (1-2 sentences, shown in hero and cards) */
  summary: string;
  /** Longer description paragraphs or inline images (shown on the What's New page only) */
  description: DescriptionBlock[];
  /** Entry category */
  category: WhatsNewCategory;
  /**
   * Optional link to the relevant page. When omitted, the homepage hero CTA
   * defaults to the entry's own article (/{league}/whats-new/{id}) — never
   * set this to the article URL yourself, or the article page renders a
   * self-referential CTA.
   */
  link?: string;
  /**
   * Optional link label. Defaults to "Check it out" when `link` is set, or
   * "Read the full story" when the CTA falls back to the entry's article.
   */
  linkLabel?: string;
  /** Optional icon ID from sprite.svg (without "icon-" prefix) */
  icon?: string;
  /** Override: force hero display regardless of age (for major launches) */
  pinToHero?: boolean;
  /** Override: never auto-promote to hero (for minor updates) */
  excludeFromHero?: boolean;
  /**
   * Composite-hero appearance override. By default the homepage hero follows
   * the site theme; 'dark' forces the dark treatment even in light mode — for
   * entries where the dark card IS the story (e.g. a dark mode announcement).
   */
  heroTheme?: 'dark';
  /**
   * Composite-hero artwork override. When set, the homepage hero shows this
   * artwork instead of casting a player — for entries where a specific image
   * IS the story (e.g. a recovered vintage logo). Player casting is skipped.
   */
  heroArt?: HeroArt;
  /** Optional screenshot filename relative to /assets/whats-new/ (e.g., "trade-builder.webp") */
  image?: string;
  /** Alt text for the screenshot image (required when image is provided) */
  imageAlt?: string;
  /**
   * Composite-hero featured player. Set ONLY when the entry is about a
   * specific player (his MFL id) — the hero casts him instead of showing the
   * screenshot. Most entries are about pages, not players: leave it unset and
   * the hero shows the entry's screenshot in a browser frame.
   */
  heroPlayerId?: string;
  /** Caption qualifier for the featured player chip (default "Featured"). */
  heroPlayerDescriptor?: string;
  /** Audience restriction — defaults to "all" if omitted. "admin" hides the entry from non-admin users in both the listing and the detail route. */
  visibility?: 'all' | 'admin';
  /**
   * League scope — which league(s) the entry applies to. REQUIRED.
   * Every entry must be explicitly tagged: `["theleague"]`, `["afl"]`, or both.
   * Scoping FAILS CLOSED: an entry with a missing/empty/misspelled `leagues`
   * value is shown NOWHERE (never cross-league). `tests/whats-new-data.test.ts`
   * blocks the build on untagged or invalid values.
   */
  leagues: LeagueSlug[];
}

/** A league slug used by the `leagues` tagging field on What's New entries. */
export type { LeagueSlug } from './nav';

/**
 * The only valid `leagues` values, derived from the league registry (the
 * single source of truth per CLAUDE.md — never hardcode league slugs).
 * Anything else fails validation AND display.
 */
export const VALID_LEAGUE_SLUGS: readonly LeagueSlug[] = ALL_LEAGUES.map(
  (l) => l.navSlug as LeagueSlug,
);

/**
 * Returns true if the entry should be shown in the given league context.
 *
 * FAILS CLOSED: a missing or empty `leagues` field means the entry is shown
 * in NO league. Cross-league leakage from an untagged entry is impossible —
 * the worst an authoring mistake can do is hide the entry, and the data test
 * suite catches that before it ships.
 */
export function entryAppliesToLeague(entry: WhatsNewEntry, league: LeagueSlug): boolean {
  if (!entry.leagues || entry.leagues.length === 0) return false;
  return entry.leagues.includes(league);
}

/** Hero content source type */
export type HeroSource = 'feature' | 'event' | 'auction' | 'draft' | 'default';

/** What the hero resolver returns */
export interface HeroContent {
  source: HeroSource;
  title: string;
  summary: string;
  link?: string;
  linkLabel?: string;
  icon?: string;
  accentColor?: string;
  /** When source is 'event', the event definition ID so What's Next can skip it */
  heroEventId?: string;
  /** Event-only: formatted date or date range (e.g., "Sun, Mar 1 - 7") */
  dateDisplay?: string;
  /** Event-only: countdown or status text (e.g., "In 5 days", "Happening now") */
  statusText?: string;
  /** Event-only: whether the event is currently active */
  isActive?: boolean;
  /** Event-only: whether the event is urgent (approaching deadline) */
  isUrgent?: boolean;
  /** Event-only: whether the link is external */
  isExternal?: boolean;
  /** Optional screenshot image path relative to /assets/whats-new/ */
  image?: string;
  /** Alt text for the screenshot image */
  imageAlt?: string;
  /** Eyebrow badge label (e.g., "New Feature", "Enhancement", "League Event") */
  kicker?: string;
  /** Eyebrow date text shown next to the badge (e.g., "Mar 2, 2026") */
  kickerDate?: string;
  /** Feature-only: forces the dark composite-hero treatment in light mode */
  heroTheme?: 'dark';
  /** Feature-only: custom artwork shown instead of a cast player */
  heroArt?: HeroArt;
  /** Feature-only: the source entry's category — drives composite-hero casting */
  heroCategory?: WhatsNewCategory;
  /** Feature-only: MFL id of the player the entry is about — he models the hero */
  heroPlayerId?: string;
  /** Feature-only: caption qualifier for the featured player chip */
  heroPlayerDescriptor?: string;
}

/** Human-readable labels for What's New categories */
export const WHATS_NEW_CATEGORY_LABELS: Record<WhatsNewCategory, string> = {
  'new-page': 'New Page',
  'new-feature': 'New Feature',
  'enhancement': 'Enhancement',
  'bug-fix': 'Bug Fix',
  'league-event': 'League Event',
};
