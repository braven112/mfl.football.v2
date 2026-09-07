/**
 * Content model for the composite-hero showcase page.
 *
 * The page is a portfolio deep-dive, and the two leagues' versions genuinely
 * say different things — TheLeague's is about a 16-phase season machine and
 * eight casting functions; the AFL's is about two conferences that draft
 * differently, keepers, and a league that rosters the same player twice. So
 * this is NOT a template with a few strings swapped: each league authors its
 * own content module, and `ShowcasePage.astro` renders whatever blocks it asks
 * for.
 *
 * Blocks are a closed union rather than free HTML so the page cannot drift into
 * two divergent layouts, and so the CSS in hero-showcase.css has a known set of
 * shapes to style.
 */

import type { CompositeHeroAccent } from './composite-hero';

/** Page chrome + gallery-card palette. Set as inline custom properties on `.hc-page`. */
export interface ShowcasePalette {
  /**
   * Chrome accent — section numbers, tags, rules, buttons, inline code.
   * BOTH ends are required: the accent must brighten in dark mode or it sinks
   * into the page. TheLeague's page used to get that free from the global
   * `--color-primary` remap, which is exactly why it is explicit now.
   */
  accent: string;
  accentDark: string;
  /** Gallery-card gradient, light theme, and the literal solid beneath it. */
  cardSurface: string;
  cardSolid: string;
  /** Same pair for dark theme, plus the default glow when a card names no team. */
  cardSurfaceDark: string;
  cardSolidDark: string;
  cardGlowDark: string;
}

/**
 * One reproduced hero state in the opening gallery.
 *
 * The gallery is an INVENTORY, not a highlight reel: every composite state the
 * league can actually render gets a card, because the page's whole claim is
 * "here is the system", and a system you only see the good half of is a mood
 * board. `tests/hero-showcase-content.test.ts` fails if a shipped accent or an
 * AFL treatment has no card.
 */
export interface ShowcaseGalleryCard {
  key: string;
  /**
   * The SHIPPED accent family this state renders in — the same names the live
   * components pass to `CompositeHero`, so a card cannot advertise a palette
   * the system does not have. The stylesheet defines one `.hcx--<accent>` per
   * name, mirroring that accent's real tokens.
   */
  accent: CompositeHeroAccent;
  /**
   * The urgency overlay, when the state carries one. A TONE, not an accent —
   * exactly as in the live shell: red flips the pill and CTA on top of
   * whatever accent the phase already chose, rather than replacing it.
   */
  tone?: 'red';
  /**
   * Which half of the colour rule this state is on, printed on the card.
   * `league` — a draft, the auction, kickoff, a site announcement: league
   * colours, and any glow comes from the player's NFL club.
   * `team` — a hero ABOUT a franchise: that club's colours.
   * This is the rule the whole system turns on, so a card must declare it.
   */
  scope: 'league' | 'team';
  /** The component this card reproduces, printed beside the pill. */
  component: string;
  wordmark: string;
  pill: string;
  title: string;
  summary: string;
  /**
   * The spotlight shape is the default. `board` reproduces
   * `CompositePanelBoard` instead — four player panels rather than one face,
   * which is a genuinely different hero shape and cannot be faked with a
   * single cutout.
   */
  shape?: 'spotlight' | 'board';
  /** Board cards only: the four panels, left to right. */
  panels?: Array<{ name: string; badge: string; espnId: string; code: string; flag?: string }>;
  /** The player modelling the card. Omit for a card with no face. */
  model?: {
    name: string;
    descriptor: string;
    pos: string;
    /** NFL team code, printed in the caption. */
    code: string;
    espnId: string;
  };
  /**
   * Hex driving the card's glow. An NFL team primary on a `league` card, or —
   * this is the point of the rule — a real franchise colour on a `team` one.
   */
  primary: string;
  /**
   * Names the franchise whose colour `primary` is, when it is one. Printed as
   * a footnote on the card so the reader knows the colour is not decorative.
   */
  franchise?: string;
}

export type ShowcaseBlock =
  /** Paragraphs. `html` is authored markup (links, <strong>, <code>). */
  | { kind: 'prose'; html: string[] }
  /** Prose beside a pull quote. */
  | { kind: 'prose-quote'; html: string[]; quote: { label: string; html: string } }
  /** Prose beside a code figure; `codeSide` puts the figure first. */
  | { kind: 'prose-code'; html: string[]; code: { caption: string; body: string }; codeSide?: 'left' | 'right'; wideText?: boolean }
  /** The z-ordered render stack. */
  | { kind: 'layers'; layers: Array<{ z: string; name: string; html: string }> }
  /** Two-up explanatory cards. */
  | { kind: 'cards'; cards: Array<{ head: string; html: string; tag: string }> }
  /** Colour swatch row. */
  | { kind: 'swatches'; label: string; swatches: Array<{ label: string; hex: string }> }
  /** Signed-in vs guest columns. */
  | { kind: 'persona'; columns: Array<{ who: string; tone: 'owner' | 'guest'; lines: string[] }> }
  /** Category → who gets cast grid. */
  | { kind: 'categories'; items: Array<{ type: string; cast: string; desc: string }> }
  /** Three-column reference table. */
  | { kind: 'table'; headers: [string, string, string]; rows: Array<[string, string, string]> }
  /** A row of small takeaway chips. */
  | { kind: 'chips'; chips: string[] }
  /** Numbered phase windows, with the shipped ones highlighted. */
  | { kind: 'phases'; phases: Array<[string, string]>; shipped: string[]; legend: string }
  /** Daily slot row. */
  | { kind: 'slots'; label: string; slots: Array<[string, string]> }
  /** What's shipped grid; a `muted` card carries the honest-scope note. */
  | { kind: 'shipped'; items: Array<{ name: string; cast: string; desc: string; muted?: boolean }> };

export interface ShowcaseSection {
  /** Two-digit ordinal printed beside the title. */
  num: string;
  title: string;
  sub: string;
  blocks: ShowcaseBlock[];
}

export interface ShowcaseContent {
  /** Browser title. */
  pageTitle: string;
  palette: ShowcasePalette;
  /** League logo pair for the gallery's 404 silhouette. */
  logo: { light: string; dark: string };
  hero: {
    tag: string;
    kicker: string;
    /** Two lines; rendered with a break between them. */
    title: [string, string];
    deckHtml: string;
    stack: string[];
  };
  gallery: ShowcaseGalleryCard[];
  galleryNote: string;
  sections: ShowcaseSection[];
  closing: {
    title: string;
    paragraphs: string[];
    filesLabel: string;
    files: string[];
    ctas: Array<{ label: string; href: string; primary?: boolean }>;
  };
}
