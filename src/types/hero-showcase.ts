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

/** One reproduced hero card in the opening gallery. */
export interface ShowcaseGalleryCard {
  key: string;
  /** Pill/CTA accent family — matches the shipped hero's own accent. */
  accent?: 'blue' | 'amber' | 'red' | 'green' | 'gold';
  /** The component this card reproduces, printed beside the pill. */
  component: string;
  wordmark: string;
  pill: string;
  title: string;
  summary: string;
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
   * Hex driving the card's glow. An NFL team primary, or — this is the point of
   * the AFL's version — a real franchise colour, when the card is demonstrating
   * that a hero can belong to a fantasy team.
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
