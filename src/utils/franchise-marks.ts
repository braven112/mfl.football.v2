/**
 * What the Brand Book pages read for a FANTASY franchise — the league-side
 * analogue of `nfl-marks.ts`.
 *
 * The two halves of the Brand Book answer the same question about different
 * subjects: which cut of a mark does each GROUND draw, and where does the site
 * actually render it. An NFL club's answer comes from a fetched catalog
 * (`nfl-brand-kit.json` + an assignment file); a franchise's comes from the
 * league config, which is already the single source of truth for `icon`,
 * `iconDark`, `groupMe`, `groupMeDark`, `banner`, the colour quartet and the
 * `history[]` eras. So this file INDEXES the config rather than introducing a
 * second catalog — the same relationship `franchise-brand.ts` has to it.
 *
 * Plan: docs/plans/brand-book-franchise-half.md.
 *
 * ── Why the grounds are the same three ───────────────────────────────────
 * A mark sits on a white cell, a dark card, or the team's own colour, and the
 * third is not a variant of the first two. `bandSlot` below applies the same
 * luminance rule `nfl-marks.ts` does, against the franchise's BRAND primary —
 * which is the rule `franchise-band-brand.ts` has been applying to crests on
 * deep-ink surfaces all along. One rule for 40 franchises rather than 40
 * hand-set values.
 *
 * ── Why the dark ground is resolved here, server-side ────────────────────
 * `TeamIconDarkStyles` swaps `icon` → `iconDark` under `html.dark`, keyed on
 * the light src. The Brand Book opts OUT of that swap (a page whose subject is
 * the side-by-side comparison cannot have one pane silently become the other),
 * so each ground must name its artwork explicitly. Same call, same reasoning,
 * as `resolveDarkSurfaceCrest`: a surface that declares its own ground has no
 * theme to follow. See docs/claude/rules/theming-and-assets.md § "A surface
 * that is dark in BOTH themes must resolve its own crest".
 */

import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import type { LeagueSlug } from '../types/nav';
import { luminance, inkOn, type MarkGround } from './nfl-marks';
import { crestStrokeFilter, withStrokeColors } from './crest-dark-stroke-css';
import strokeManifest from '../data/crest-dark-stroke-manifest.json';
import { getTeamAccentPair } from './team-colors';
import { teamAccentProperty } from './team-accent-css';
import { resolveMatchupColorVars } from './live/model';
import { surfaceForLeague } from './live/surface';

export type { MarkGround };
export { luminance, inkOn };

/**
 * The leagues the Brand Book covers.
 *
 * Best Ball is deliberately absent: it is draft-only, its franchises carry no
 * crest art of their own, and `leagueHasFeature` gates it out of the nav
 * everywhere else. A slug-keyed map that returns `[]` rather than throwing
 * keeps a third league from being served TheLeague's crests by accident —
 * the same shape `league-team-brands.ts` uses, minus the throw, because an
 * empty Brand Book renders an honest empty state and a 500 does not.
 */
const LEAGUE_TEAMS: Partial<Record<CanonicalLeagueSlug, RawTeam[]>> = {
  theleague: ((theleagueConfig as unknown as { teams?: RawTeam[] }).teams ?? []),
  'afl-fantasy': ((aflConfig as unknown as { teams?: RawTeam[] }).teams ?? []),
};

/** The Brand Book covers exactly these. */
export const BRAND_BOOK_LEAGUES: CanonicalLeagueSlug[] = ['theleague', 'afl-fantasy'];

export function leagueHasBrandBook(slug: string): slug is CanonicalLeagueSlug {
  return (BRAND_BOOK_LEAGUES as string[]).includes(slug);
}

/** One `history[]` entry, as the configs spell it. */
interface RawEra {
  name?: string;
  nameShort?: string;
  eraLabel?: string;
  icon?: string;
  iconFreeform?: boolean;
  iconStroke?: string;
  iconStrokeDark?: string | boolean;
  banner?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  yearStart: number;
  yearEnd: number;
}

/** One franchise, as the configs spell it. Both leagues share this shape. */
interface RawTeam {
  franchiseId: string;
  name?: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  aliases?: string[];
  division?: string;
  conference?: string;
  tier?: string;
  color?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  colorTertiary?: string;
  colorQuaternary?: string;
  colorPrimaryDark?: string;
  colorSecondaryDark?: string;
  broadcastGradient?: string;
  icon?: string;
  iconDark?: string;
  iconStrokeDark?: string | boolean;
  banner?: string;
  groupMe?: string;
  groupMeDark?: string;
  currentOwnerSince?: number;
  history?: RawEra[];
}

/** A cut on file for a franchise. Mirrors `MarkOption` in `nfl-marks.ts`. */
export interface FranchiseMark {
  id: FranchiseMarkId;
  label: string;
  /** What this cut is FOR, in one phrase — the page's caption. */
  source: string;
  format: 'png' | 'svg';
  /** True when the cut is drawn for a dark ground and should preview on one. */
  forDark: boolean;
  /** Nominal authored size, so the page can say what it is rather than guess. */
  spec: string;
  url: string;
  /** Set on a HISTORICAL cut — the era it belongs to. Absent on a current one. */
  era?: { years: string; label: string | null };
}

export type FranchiseMarkId =
  | 'icon'
  | 'iconDark'
  | 'groupMe'
  | 'groupMeDark'
  | 'banner'
  /** An era's crest or banner, when that era wore TODAY's name. See `pastMarks`. */
  | 'eraIcon'
  | 'eraBanner';

/**
 * Presentation names and the authored spec for each cut.
 *
 * The sizes are the ones `dark-surface-crest.ts` records and the asset
 * pipeline writes — 100x100 for the icon pair, 400x400 for the GroupMe pair.
 * They are stated here because "which file do I paste into MFL" is the
 * question the old Asset Library existed to answer, and a page that shows the
 * artwork without its size answers half of it.
 */
const MARK_META: Record<FranchiseMarkId, Omit<FranchiseMark, 'id' | 'url'>> = {
  icon: {
    label: 'Icon',
    source: 'the crest every themed surface draws',
    format: 'png',
    forDark: false,
    spec: '100×100 PNG',
  },
  iconDark: {
    label: 'Icon — dark cut',
    source: 'hand-authored for dark grounds',
    format: 'png',
    forDark: true,
    spec: '100×100 PNG',
  },
  groupMe: {
    label: 'GroupMe crest',
    source: 'the 400px cut heroes watermark with',
    format: 'png',
    forDark: false,
    spec: '400×400 PNG',
  },
  groupMeDark: {
    label: 'GroupMe crest — dark cut',
    source: 'hand-authored for deep-ink composites',
    format: 'png',
    forDark: true,
    spec: '400×400 PNG',
  },
  banner: {
    label: 'Banner',
    source: 'the wide lockup, for MFL and franchise headers',
    format: 'png',
    forDark: false,
    spec: 'wide PNG',
  },
  // The two historical ids. They never come from the config's top level — they
  // are built per era by `pastMarks`, which overwrites `label` with the era's
  // years. Present here so the id list stays one closed set.
  eraIcon: {
    label: 'Icon',
    source: 'retired',
    format: 'png',
    forDark: false,
    spec: 'square PNG',
  },
  eraBanner: {
    label: 'Banner',
    source: 'retired',
    format: 'png',
    forDark: false,
    spec: 'wide PNG',
  },
};

/** The ids read off the config's top level — the cuts a franchise wears TODAY. */
export const CURRENT_MARK_IDS: FranchiseMarkId[] = [
  'icon',
  'iconDark',
  'groupMe',
  'groupMeDark',
  'banner',
];

export const FRANCHISE_MARK_IDS = Object.keys(MARK_META) as FranchiseMarkId[];

/** The registry's short nav slug, which the colour helpers key on. */
function navSlugOf(slug: CanonicalLeagueSlug): LeagueSlug {
  return (getLeagueBySlug(slug)?.navSlug ?? 'theleague') as LeagueSlug;
}

function teamsOf(slug: CanonicalLeagueSlug): RawTeam[] {
  return LEAGUE_TEAMS[slug] ?? [];
}

/** Lowercase, hyphenated, apostrophes dropped rather than hyphenated. */
export function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A URL-safe segment for one franchise.
 *
 * Derived from the FULL name, not `nameShort`: the short names are what an
 * owner says out loud, and several of them make a link that reads wrong on its
 * own — A Bruin Pegs Me shortens to `pegs-me`. A pasted `/brand/<slug>` should
 * say which franchise it is, so the long name wins and every short form stays
 * reachable through `franchiseIdFromSlug`'s alias pass.
 *
 * Never the franchise id: BOTH leagues have an 0001, and the Brand Book is
 * reachable from the shared host where nothing in the path would disambiguate
 * them.
 */
export function franchiseSlug(team: { name?: string; nameShort?: string; franchiseId: string }): string {
  return slugify(team.name || team.nameShort || team.franchiseId);
}

/**
 * Whether two franchise names are the SAME identity.
 *
 * Not `===`. The configs spell a franchise's own name inconsistently across
 * its `history[]` — "Running Down The Dream" against today's "Running down the
 * Dream", and "The Music City Mafia" against "Music City Mafia" — and a strict
 * compare files a team's own past under "former identities", which is exactly
 * the thing this split exists to avoid.
 *
 * Deliberately conservative: case, punctuation and a leading article only. It
 * does NOT try to match "Smokane" to "Smokane FC" or "Swifty" to "Swiftie" —
 * those are judgement calls about whether a rename was a rebrand, and guessing
 * wrong in that direction silently hides a genuinely separate identity.
 */
export function sameIdentity(a: string, b: string): boolean {
  const norm = (v: string) => slugify(v).replace(/^the-/, '');
  return norm(a) === norm(b) && norm(a) !== '';
}

/** One era's art, resolved for the page. */
export interface FranchiseEra {
  /** The config's `eraLabel`. Null when it names none — the page then shows the years alone. */
  label: string | null;
  name: string;
  years: string;
  yearStart: number;
  yearEnd: number;
  icon: string | null;
  banner: string | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  /** True when this era is the identity the franchise wears today. */
  current: boolean;
  /**
   * True when the era wore TODAY's name — an old version of this team's own
   * mark rather than a different club. Its art is folded into `pastMarks` and
   * shown under "Marks on file"; a false one is a separate identity and gets
   * its own section.
   */
  sameIdentity: boolean;
}

export interface FranchiseGround {
  ground: MarkGround;
  slot: 'light' | 'dark';
  mark: FranchiseMark;
  url: string;
  /** The measured white ring, when the light artwork needs one to read on ink. */
  filter?: string;
}

/**
 * A colour the site DERIVES from the brand pair rather than reading from the
 * config — and the theme it applies in.
 *
 * These are the values that actually paint, and none of them is in the config:
 * a franchise's raw hex is the INPUT. Showing only the config hexes was the
 * page's blind spot — an owner reading "Primary #181818" has no way to learn
 * that no surface on the site ever paints that, because every one of them
 * floors it first.
 */
export interface DerivedColor {
  label: string;
  light: string;
  dark: string;
  note: string;
}

export interface FranchiseColor {
  key: string;
  label: string;
  hex: string;
  /** What this hue is FOR — the page's caption under the swatch. */
  note: string;
}

/**
 * Exactly what `resolveHeroFranchiseBackdrop` / `resolveDarkSurfaceCrest` read,
 * lifted off the config entry.
 *
 * Handed over as a field rather than leaving the page to rebuild it from
 * `marks`: those two resolvers apply the crest ORDER (`groupMeDark → iconDark
 * → groupMe → icon`) and the `iconStrokeDark` opt-out, and a caller
 * reassembling the object from the mark list would be re-deriving that order
 * by hand — which is the shape `owner-boundary-parity.test.ts` exists to stop
 * in its own domain. One object, passed straight through.
 */
export interface FranchiseHeroTeam {
  colorPrimary?: string;
  colorSecondary?: string;
  colorTertiary?: string;
  colorQuaternary?: string;
  broadcastGradient?: string;
  icon?: string;
  iconDark?: string;
  groupMe?: string;
  groupMeDark?: string;
  iconStrokeDark?: string | boolean;
}

export interface FranchiseBrand {
  leagueSlug: CanonicalLeagueSlug;
  leagueName: string;
  franchiseId: string;
  slug: string;
  name: string;
  nameShort: string;
  abbrev: string;
  aliases: string[];
  division: string | null;
  conference: string | null;
  tier: string | null;
  colors: FranchiseColor[];
  /** What the site derives from those hexes before it paints anything. */
  derived: DerivedColor[];
  /** The CSS custom property a foreground use must read, never the raw hex. */
  accentProperty: string;
  /** The band ground's colour — the brand primary, or the chart hue if there is none. */
  bandColor: string;
  /** The raw CSS the draft broadcast paints verbatim. Null when unset. */
  broadcastGradient: string | null;
  grounds: FranchiseGround[];
  marks: FranchiseMark[];
  /** Retired cuts of this team's OWN mark — eras that wore today's name. */
  past: FranchiseMark[];
  /** Every era, current and former identities alike. */
  eras: FranchiseEra[];
  /** Only the eras that wore a DIFFERENT name — genuinely separate identities. */
  formerIdentities: FranchiseEra[];
  /** Pass-through payload for the hero resolvers. */
  heroTeam: FranchiseHeroTeam;
  ownerSince: number | null;
  /** True when the franchise ships a hand-authored dark cut of either crest. */
  hasDarkCut: boolean;
  /** True when the light crest measured illegible on ink and wears a ring. */
  ringed: boolean;
  /**
   * True when the crest was MEASURED illegible on ink, whether or not it ends
   * up ringed.
   *
   * Separate from `ringed` because `iconStrokeDark: false` is a human's
   * opt-OUT and outranks the measurement — so a franchise can be measured
   * illegible and still wear no ring. Dark Magicians is exactly that
   * (`legible: 0.367`, opted out), and copy keyed on `ringed` alone told the
   * reader their art "measured legible on ink as-is", which is the opposite of
   * what the manifest records.
   */
  measuredIllegible: boolean;
}

/**
 * Which assignment slot a team-colour band draws from.
 *
 * Identical rule to `nfl-marks.ts#bandSlot`, against the franchise's brand
 * primary. Kept as its own function rather than shared because the SUBJECT
 * differs — a club reads `brandKit.colors[0]`, a franchise reads the config's
 * `colorPrimary` — while the threshold is deliberately the same number, so the
 * two halves of one page cannot disagree about what "dark enough" means.
 */
export function bandSlot(hex: string): 'light' | 'dark' {
  return luminance(hex) > 0.42 ? 'light' : 'dark';
}

function markUrl(team: RawTeam, id: FranchiseMarkId): string | null {
  switch (id) {
    case 'icon':
      return team.icon ?? null;
    case 'iconDark':
      return team.iconDark ?? null;
    case 'groupMe':
      return team.groupMe ?? null;
    case 'groupMeDark':
      return team.groupMeDark ?? null;
    case 'banner':
      return team.banner ?? null;
    default:
      return null;
  }
}

/** The cuts a franchise wears TODAY, in the order the page shows them. */
export function franchiseMarks(team: RawTeam): FranchiseMark[] {
  return CURRENT_MARK_IDS.map((id) => {
    const url = markUrl(team, id);
    return url ? { id, ...MARK_META[id], url } : null;
  }).filter((m): m is FranchiseMark => m !== null);
}

/**
 * The measured white ring for a franchise's LIGHT crest, when it needs one.
 *
 * `withStrokeColors` already excludes every franchise that ships an
 * `iconDark`, so a crest can never wear both treatments — the same guarantee
 * `franchise-band-brand.ts` relies on. An `iconStrokeDark: false` in config is
 * a human's opt-OUT and outranks the measurement, which is why the `=== false`
 * check stays rather than being folded into a truthiness test.
 */
function ringFilters(slug: CanonicalLeagueSlug): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of withStrokeColors(navSlugOf(slug), teamsOf(slug) as unknown as any[])) {
    if (!entry?.franchiseId || entry.strokeColor === false) continue;
    out[entry.franchiseId] = crestStrokeFilter(entry.strokeColor || undefined);
  }
  return out;
}

function colorsOf(team: RawTeam): FranchiseColor[] {
  const rows: Array<[string, string, string | undefined, string]> = [
    ['colorPrimary', 'Primary', team.colorPrimary, 'The lead colour: panel fills, band anchors, the first gradient stop.'],
    ['colorSecondary', 'Secondary', team.colorSecondary, 'The accent: trim, glows, the second gradient stop. Use it before any other accent.'],
    ['colorTertiary', 'Tertiary', team.colorTertiary, 'Use where the primary and secondary are both taken, or where an accent must sit apart from both.'],
    ['colorQuaternary', 'Quaternary', team.colorQuaternary, 'A fourth accent, for the same cases as the tertiary.'],
    ['colorPrimaryDark', 'Primary — dark theme', team.colorPrimaryDark, 'Use in place of the primary on a dark surface.'],
    ['colorSecondaryDark', 'Secondary — dark theme', team.colorSecondaryDark, 'Use in place of the secondary on a dark surface.'],
    [
      'color',
      'Chart hue',
      team.color,
      'Charts and graphs only. Never brand identity, and never a band anchor.',
    ],
  ];
  return rows
    .filter(([, , hex]) => typeof hex === 'string' && /^#[0-9a-f]{3,8}$/i.test(hex))
    .map(([key, label, hex, note]) => ({ key, label, hex: hex as string, note }));
}

/**
 * A deliberately NEUTRAL opponent for the live-bar resolution.
 *
 * The win-probability bar's colours are resolved per MATCHUP, not per
 * franchise: `resolveTeamColorPair` nudges the two sides apart so a matchup
 * between two navy teams still reads as two bars. There is therefore no single
 * "this franchise's bar colour" to print, and inventing one would be a claim
 * the site does not honour. Resolving against a mid grey gives the value this
 * franchise takes when nothing is pulling it, which is what the page says it
 * is showing.
 */
const NEUTRAL_OPPONENT = { color: '#808080', colorPrimary: '#808080', colorSecondary: '#808080' };

/**
 * The colours the site DERIVES for one franchise, per theme.
 *
 * Read from the real resolvers rather than recomputed here — the whole point
 * of the page is that it cannot drift from what ships. `getTeamAccentPair`
 * floors the hue to 3:1 against each theme's card; `resolveMatchupColorVars`
 * produces the live board's two pairs, which are NOT the same number: the fill
 * clears ΔE against the card (perceptual distance, right for a block of
 * colour) and the ink clears WCAG AA (luminance, the only metric for reading).
 * They diverge exactly where a colour passes as a bar and fails as a score —
 * the AFL's #314d78 is ΔE 31 from the card and 1.89:1 against it.
 */
function derivedColorsOf(slug: CanonicalLeagueSlug, team: RawTeam): DerivedColor[] {
  const nav = navSlugOf(slug);
  const accent = getTeamAccentPair(team.franchiseId, nav);
  const claim = {
    color: team.color || team.colorPrimary || '#64748b',
    ...(team.colorPrimary ? { colorPrimary: team.colorPrimary } : {}),
    ...(team.colorSecondary ? { colorSecondary: team.colorSecondary } : {}),
    ...(team.colorPrimaryDark ? { colorPrimaryDark: team.colorPrimaryDark } : {}),
    ...(team.colorSecondaryDark ? { colorSecondaryDark: team.colorSecondaryDark } : {}),
  };
  const bar = resolveMatchupColorVars(claim, NEUTRAL_OPPONENT, surfaceForLeague(slug));
  return [
    {
      label: 'Accent token',
      light: accent.light,
      dark: accent.dark,
      note: 'What teamAccentVar(franchiseId) resolves to. EVERY foreground use of a team colour reads this — text, a rank numeral, a chart line, a legend swatch — because it is floored to 3:1 against each theme\u2019s card. Several franchises\u2019 raw hexes land near 1:1 there.',
    },
    {
      label: 'Live bar fill',
      light: bar['--t0-light'] ?? accent.light,
      dark: bar['--t0-dark'] ?? accent.dark,
      note: 'The win-probability bar on Live Scoring. Cleared for ΔE against the card \u2014 perceptual distance, the right metric for a block of colour. Resolved per MATCHUP, so an opponent in the same family shifts it; this is the value against a neutral.',
    },
    {
      label: 'Live bar ink',
      light: bar['--t0-ink-light'] ?? accent.light,
      dark: bar['--t0-ink-dark'] ?? accent.dark,
      note: 'The SCORE beside that bar. Cleared for WCAG AA body contrast instead, because ΔE is not a reading metric \u2014 a colour can pass as a fill and be unreadable as a number, which is how coloured bars once sat beside grey scores.',
    },
  ];
}

function erasOf(team: RawTeam): FranchiseEra[] {
  const history = Array.isArray(team.history) ? team.history : [];
  return history
    .slice()
    .sort((a, b) => a.yearStart - b.yearStart)
    .map((era) => ({
      label: era.eraLabel || null,
      name: era.name || team.name || '',
      years: era.yearStart === era.yearEnd ? `${era.yearStart}` : `${era.yearStart}–${era.yearEnd}`,
      yearStart: era.yearStart,
      yearEnd: era.yearEnd,
      icon: era.icon ?? null,
      banner: era.banner ?? null,
      colorPrimary: era.colorPrimary ?? null,
      colorSecondary: era.colorSecondary ?? null,
      // An era whose art is the franchise's CURRENT crest is the identity it
      // still wears; the throwback picker reads the same equality
      // (`resolveEraCrest`), so the two agree on what "historical" means.
      current: Boolean(era.icon && team.icon && era.icon === team.icon),
      sameIdentity: sameIdentity(era.name || team.name || '', team.name || ''),
    }));
}

/**
 * The retired cuts of a franchise's OWN mark.
 *
 * An era that wore today's name is not a different club — it is this team's
 * logo before the current one, so it belongs beside the current cuts under
 * "Marks on file" rather than in a section about other identities. An era that
 * wore a different name is the opposite and stays out of here entirely.
 *
 * BOTH current files are excluded, not just the crest. An era that is still
 * the identity a franchise wears carries today's art, and listing it here
 * would print the same file twice inside one section — Computer Jocks' 2016
 * era banner IS their current banner, which a guard caught the moment the
 * crest was the only thing deduped. `resolveEraCrest` applies the same
 * equality when it decides whether a throwback week has anything to change.
 */
export function pastMarks(
  eras: FranchiseEra[],
  currentIcon: string,
  currentBanner = ''
): FranchiseMark[] {
  const out: FranchiseMark[] = [];
  for (const era of eras) {
    if (!era.sameIdentity) continue;
    const suffix = era.label ? `${era.years} — ${era.label}` : era.years;
    if (era.icon && era.icon !== currentIcon) {
      out.push({
        ...MARK_META.eraIcon,
        id: 'eraIcon',
        label: `Icon · ${era.years}`,
        source: suffix,
        url: era.icon,
        era: { years: era.years, label: era.label },
      });
    }
    if (era.banner && era.banner !== currentBanner) {
      out.push({
        ...MARK_META.eraBanner,
        id: 'eraBanner',
        label: `Banner · ${era.years}`,
        source: suffix,
        url: era.banner,
        era: { years: era.years, label: era.label },
      });
    }
  }
  return out;
}

/** One franchise's brand, or null when the league or the id is unknown. */
export function franchiseBrand(
  leagueSlug: CanonicalLeagueSlug,
  franchiseId: string
): FranchiseBrand | null {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !leagueHasBrandBook(leagueSlug)) return null;
  const team = teamsOf(leagueSlug).find((t) => t.franchiseId === franchiseId);
  if (!team) return null;

  const marks = franchiseMarks(team);
  const eras = erasOf(team);
  const byId = new Map(marks.map((m) => [m.id, m]));
  const colors = colorsOf(team);
  // The BRAND primary, never the chart hue — `franchise-band-brand.ts` records
  // what happened when a band anchored on `color` (a black-and-red franchise
  // opened in pink). Falling back to the chart hue only when there is no brand
  // primary at all keeps a franchise off the neutral grey default.
  const bandColor = team.colorPrimary || team.color || '#64748b';
  const ring = ringFilters(leagueSlug)[team.franchiseId];

  const light = byId.get('icon') ?? byId.get('groupMe') ?? null;
  // Theme first, exactly the order `resolveDarkSurfaceCrest` uses, narrowed to
  // the icon pair because this ground stands for a dark CARD (100px), not for
  // the 300px watermark the GroupMe cut serves.
  const dark = byId.get('iconDark') ?? byId.get('icon') ?? null;

  const grounds: FranchiseGround[] = [];
  if (light) grounds.push({ ground: 'light', slot: 'light', mark: light, url: light.url });
  if (dark) {
    grounds.push({
      ground: 'dark',
      slot: 'dark',
      mark: dark,
      url: dark.url,
      // Only the LIGHT artwork can need the ring — a franchise with an
      // `iconDark` is excluded from the manifest by construction.
      ...(dark.id === 'icon' && ring ? { filter: ring } : {}),
    });
  }
  const slot = bandSlot(bandColor);
  const bandMark = slot === 'light' ? light : dark;
  if (bandMark) {
    grounds.push({
      ground: 'band',
      slot,
      mark: bandMark,
      url: bandMark.url,
      ...(bandMark.id === 'icon' && slot === 'dark' && ring ? { filter: ring } : {}),
    });
  }

  return {
    leagueSlug,
    leagueName: league.name,
    franchiseId: team.franchiseId,
    slug: franchiseSlug(team),
    name: team.name ?? `Franchise ${team.franchiseId}`,
    nameShort: team.nameShort || team.nameMedium || team.name || team.franchiseId,
    abbrev: team.abbrev || '',
    aliases: Array.isArray(team.aliases) ? team.aliases : [],
    division: team.division ?? null,
    conference: team.conference ?? null,
    tier: team.tier ?? null,
    colors,
    derived: derivedColorsOf(leagueSlug, team),
    accentProperty: teamAccentProperty(team.franchiseId),
    bandColor,
    broadcastGradient: team.broadcastGradient ?? null,
    grounds,
    marks,
    eras,
    past: pastMarks(eras, team.icon ?? '', team.banner ?? ''),
    formerIdentities: eras.filter((e) => !e.sameIdentity),
    heroTeam: {
      ...(team.colorPrimary ? { colorPrimary: team.colorPrimary } : {}),
      ...(team.colorSecondary ? { colorSecondary: team.colorSecondary } : {}),
      ...(team.colorTertiary ? { colorTertiary: team.colorTertiary } : {}),
      ...(team.colorQuaternary ? { colorQuaternary: team.colorQuaternary } : {}),
      ...(team.broadcastGradient ? { broadcastGradient: team.broadcastGradient } : {}),
      ...(team.icon ? { icon: team.icon } : {}),
      ...(team.iconDark ? { iconDark: team.iconDark } : {}),
      ...(team.groupMe ? { groupMe: team.groupMe } : {}),
      ...(team.groupMeDark ? { groupMeDark: team.groupMeDark } : {}),
      ...(team.iconStrokeDark !== undefined ? { iconStrokeDark: team.iconStrokeDark } : {}),
    },
    ownerSince: typeof team.currentOwnerSince === 'number' ? team.currentOwnerSince : null,
    hasDarkCut: Boolean(team.iconDark || team.groupMeDark),
    ringed: Boolean(ring && !team.iconDark),
    measuredIllegible: strokeManifest.needsStroke.some(
      (e: { league?: string; franchiseId?: string }) =>
        e.league === navSlugOf(leagueSlug) && e.franchiseId === team.franchiseId
    ),
  };
}

/** Every franchise in one league, for the index. */
export function allFranchiseBrands(leagueSlug: CanonicalLeagueSlug): FranchiseBrand[] {
  return teamsOf(leagueSlug)
    .map((t) => franchiseBrand(leagueSlug, t.franchiseId))
    .filter((b): b is FranchiseBrand => b !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A franchise id from a URL segment, or null.
 *
 * Matches the derived slug first, then the short names, the `abbrev` and the
 * aliases, so `/brand/pacific-pigskins`, `/brand/pigskins`, `/brand/skins` and
 * `/brand/pigs` all land on the same page. Case-folded because a pasted link
 * carries whatever case the source had.
 */
export function franchiseIdFromSlug(
  leagueSlug: CanonicalLeagueSlug,
  segment: string
): string | null {
  // `slugify`, not a second copy of its body: the lookup and the slug it is
  // matching against have to normalise identically, and two copies of the rule
  // is how they stop doing that.
  const want = slugify(segment);
  if (!want) return null;
  const teams = teamsOf(leagueSlug);
  const exact = teams.find((t) => franchiseSlug(t) === want);
  if (exact) return exact.franchiseId;
  const aliased = teams.find((t) =>
    [t.nameShort, t.nameMedium, t.abbrev, ...(t.aliases ?? [])]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .some((v) => slugify(v) === want)
  );
  return aliased?.franchiseId ?? null;
}
