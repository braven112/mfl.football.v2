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

import type { CanonicalLeagueSlug } from '../config/leagues';
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
 * One hero state in the opening gallery.
 *
 * These are not reproductions any more. Each card renders the REAL
 * `CompositeHero` / `CompositePanelBoard` with fixture props, because a
 * lookalike drifted three separate times in one week — it showed the auction
 * hero as a pale blue card when the shipped one is amber, it kept the centred
 * ghost wordmark after the live heroes moved to a right-anchored one, and it
 * never grew the crest watermark at all, which is one of the treatment's
 * defining layers. A page whose entire claim is "this is what it looks like"
 * has to be showing the thing itself.
 *
 * What stays showcase-owned is the ANNOTATION above each hero: which component
 * this is, and which half of the colour rule it is on. That sits outside the
 * card, so nothing the showcase says about a hero can change how the hero
 * renders.
 *
 * The gallery is also an INVENTORY, not a highlight reel — every state the
 * league can render gets a card. `tests/hero-showcase-content.test.ts` fails if
 * a shipped accent or an AFL treatment has none.
 */
export interface ShowcaseGalleryCard {
  key: string;
  /** The shipped accent family, passed straight to the live shell. */
  accent: CompositeHeroAccent;
  /** Urgency overlay, passed straight through. A tone, never a second accent. */
  tone?: 'red';
  /**
   * Which half of the colour rule this state is on, printed in the annotation.
   * `league` — a draft, the auction, kickoff, a site announcement: league
   * colours, and the glow comes from the player's NFL club.
   * `team` — a hero ABOUT a franchise: that club's colours and crest.
   *
   * It also DRIVES the render: a `team` card passes its franchise to the shell
   * (skin + crest), a `league` card passes none. So the badge cannot disagree
   * with what the reader is looking at.
   */
  scope: 'league' | 'team';
  /** The component this card renders, printed in the annotation. */
  component: string;
  /** Ghost wordmark. Empty string is a real state — the live auction hero drops it. */
  wordmark: string;
  pill: string;
  title: string;
  /** Accent-coloured tail of the title, as the live heroes split it. */
  titleAccent?: string;
  summary: string;
  ctaLabel: string;
  /**
   * The franchise this hero is about, when one is. Drives the crest, the skin
   * and the glow through `resolveHeroCrest` / `resolveHeroFranchiseSkin` — the
   * same calls the live heroes make, so the mark behind the player is resolved
   * rather than authored and cannot go stale when a club rebrands.
   * Required on a `team` card; must be absent on a `league` one.
   */
  franchiseId?: string;
  /**
   * The spotlight shape is the default. `board` renders `CompositePanelBoard`
   * instead — four player panels rather than one face, a genuinely different
   * hero shape that no amount of tinting on a one-cutout card stands in for.
   */
  shape?: 'spotlight' | 'board';
  /** Board cards only: the four panels, left to right. */
  panels?: Array<{
    name: string;
    position: string;
    nflTeam: string;
    espnId: string;
    badge: string;
    flag?: string;
    /** Franchise whose crest watermarks this panel — the tag board's behaviour. */
    watermarkFranchiseId?: string;
  }>;
  /** The player modelling the card. Omit for a board, or for a card with no face. */
  model?: {
    name: string;
    descriptor: string;
    /** POS, as the caption prints it. */
    pos: string;
    /** NFL team code — the caption, the glow, and the fallback crest. */
    code: string;
    espnId: string;
  };
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
  /**
   * Whose heroes these are. Not decoration: the gallery renders the LIVE
   * shell, so crests and franchise skins are resolved through the registry
   * for this league rather than authored as paths that go stale.
   */
  league: CanonicalLeagueSlug;
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
