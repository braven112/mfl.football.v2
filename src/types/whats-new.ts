/**
 * What's New / Changelog Types
 *
 * Data model for feature announcements and the automated hero banner system.
 * The hero resolver uses these types alongside league events to determine
 * what to promote on the homepage.
 */

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
  /** Optional link to the relevant page */
  link?: string;
  /** Optional link label (defaults to "Check it out") */
  linkLabel?: string;
  /** Optional icon ID from sprite.svg (without "icon-" prefix) */
  icon?: string;
  /** Override: force hero display regardless of age (for major launches) */
  pinToHero?: boolean;
  /** Override: never auto-promote to hero (for minor updates) */
  excludeFromHero?: boolean;
  /** Optional screenshot filename relative to /assets/whats-new/ (e.g., "trade-builder.webp") */
  image?: string;
  /** Alt text for the screenshot image (required when image is provided) */
  imageAlt?: string;
  /** Audience restriction — defaults to "all" if omitted. "admin" hides the entry from non-admin users in both the listing and the detail route. */
  visibility?: 'all' | 'admin';
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
}

/** Human-readable labels for What's New categories */
export const WHATS_NEW_CATEGORY_LABELS: Record<WhatsNewCategory, string> = {
  'new-page': 'New Page',
  'new-feature': 'New Feature',
  'enhancement': 'Enhancement',
  'bug-fix': 'Bug Fix',
  'league-event': 'League Event',
};
