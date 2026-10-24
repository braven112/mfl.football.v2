/**
 * Seasonal franchise marks — while a league's seasonal theme is open
 * (`<html data-season="<id>">`, src/config/seasonal-themes.mjs), every
 * franchise icon and GroupMe avatar renders the season's mark instead
 * (public/assets/<navSlug>/<marks>/<franchiseId>.png).
 *
 * Same mechanism and the same exact-`src` selectors as the dark-mode swap
 * (team-icon-dark-css.ts), one attribute more specific so it wins over that
 * swap. It also clears the dark-card stroke (crest-dark-stroke-css.ts): the
 * marks are drawn for the dark ground, and a ring around them reads as a
 * sticker.
 *
 * A mark set is DATA: src/data/seasonal-marks/<navSlug>-<seasonId>.json maps
 * franchise id → the drawn source file (scripts/build-seasonal-marks.mjs
 * builds the PNGs from it). Only franchises listed there get a rule; any other
 * franchise keeps its normal crest for the season. Nothing is converted
 * automatically (owner's call, Oct 2026).
 *
 * The league's own logo swaps the same way: a set's `_logo` names a file in
 * the marks directory, and every <img> showing the league's registry logo
 * (header, nav drawer) renders it instead. Drawn on the logo's own viewBox,
 * so the swap keeps the box it replaces.
 *
 * Other league art swaps by path: `_swaps` maps a served asset path (a division
 * badge, a conference or tier logo, light and dark cuts alike) to a file in the
 * marks directory. An <img> of that path gets the rule below; art a component
 * inlines as raw SVG (the AFL's year-stamped division badges) asks
 * `seasonalSwapPath` and inlines the drawn file itself, since CSS cannot reach
 * inside an inlined SVG.
 *
 * Franchise marks also swap on a non-league surface wearing the same season
 * (MFL Live, SURFACE_SEASONAL_THEMES): its <html data-league> is a theme key,
 * so each league's franchise-mark and logo rules gain that scope beside
 * their own.
 *
 * Sprite icons swap too: `_icons` maps a sprite icon id (the Premier League
 * page's icon) to a drawn file. A `<use>` cannot take `content:`, so the
 * referencing <svg> is masked by the drawing and filled with `currentColor`
 * (so the mark takes the icon colour of wherever it sits, like the rest of the
 * sprite) and the `<use>` is hidden; every sprite call site (menu, search,
 * related-page cards) follows.
 *
 * The side nav draws the AFL's tier link with the tier logo <img> instead of a
 * sprite icon. `_menuIcons` maps such an image path to a drawing that, inside a
 * nav icon slot only, is tinted the nav's icon colour the same way; the same
 * image elsewhere keeps the plain `_swaps` drawing.
 *
 * The Brand Book (`<main data-brand-book>`) is exempt from the logo, `_swaps`
 * and franchise-mark swaps: it always shows the standard marks, and draws each
 * seasonal set beside them from the set's own files (owner, Oct 2026). Only
 * its page content is exempt; the header and nav around it still swap.
 *
 * A set's `_trim` lists franchises with a knitted trim strip
 * (<marks>/trim/<id>-top.png and -bottom.png, content hashes as values). The
 * rule only names the strips as custom properties on that club's roster
 * header plate (`.rhdr__plate[data-franchise]`); the season's stylesheet
 * decides how to draw them.
 */
import { SEASONAL_THEMES, SURFACE_SEASONAL_THEMES } from '../config/seasonal-themes.mjs';
import { iconSrcVariants, type DarkIconTeamLike } from './team-icon-dark-css';

/** Every current-identity mark a franchise renders: its icon, dark icon and GroupMe avatar (both themes). Era crests are history and keep their art. */
type SeasonalTeamLike = DarkIconTeamLike & { groupMe?: string; groupMeDark?: string };
const MARK_FIELDS = ['icon', 'iconDark', 'groupMe', 'groupMeDark'] as const;

const MARK_SETS = import.meta.glob<Record<string, unknown>>('../data/seasonal-marks/*.json', {
  eager: true,
  import: 'default',
});

/** The raw set file for `navSlug` and `seasonId`, or null — the Brand Book lists every file it names. */
export function seasonalMarkSet(navSlug: string, seasonId: string): Record<string, unknown> | null {
  return MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] ?? null;
}

/** Franchise ids with a drawn mark in `navSlug`'s set for `seasonId`. */
export function seasonalMarkIds(navSlug: string, seasonId: string): Set<string> {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] ?? {};
  return new Set(Object.keys(set).filter((k) => /^\d{4}$/.test(k)));
}

/**
 * Optical size: a mark much wider than it is tall (Computer Jocks' flexing
 * pixel man) fills the tile's width yet reads small beside rounder marks, and
 * no square PNG can make it larger. `_scale` in the set lists those marks with
 * the factor to draw them at; they overhang their box a little, as intended.
 */
function markScale(navSlug: string, seasonId: string, franchiseId: string): number | null {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _scale?: Record<string, number> } | undefined;
  const scale = set?._scale?.[franchiseId];
  return typeof scale === 'number' && scale > 0 && scale !== 1 ? scale : null;
}

/** The mark's content hash (`_v`, written by build-seasonal-marks.mjs), as a cache-busting query. */
function markVersion(navSlug: string, seasonId: string, franchiseId: string): string {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _v?: Record<string, string> } | undefined;
  const v = set?._v?.[franchiseId];
  return typeof v === 'string' && /^[0-9a-f]+$/.test(v) ? `?v=${v}` : '';
}

/** Franchise id → content hash of its top and bottom trim strips (`_trim`). */
function seasonalTrims(navSlug: string, seasonId: string): Map<string, { top: string; bottom: string }> {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _trim?: unknown } | undefined;
  const out = new Map<string, { top: string; bottom: string }>();
  const trims = set?._trim;
  if (!trims || typeof trims !== 'object') return out;
  for (const [fid, v] of Object.entries(trims as Record<string, { top?: unknown; bottom?: unknown }>)) {
    const hash = (h: unknown) => (typeof h === 'string' && /^[0-9a-f]+$/.test(h) ? h : null);
    const top = hash(v?.top);
    const bottom = hash(v?.bottom);
    if (/^\d{4}$/.test(fid) && top && bottom) out.set(fid, { top, bottom });
  }
  return out;
}

/** The league logo drawn for the season (`_logo`), as a file name in the marks directory, or null. */
export function seasonalLogoFile(navSlug: string, seasonId: string): string | null {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _logo?: unknown } | undefined;
  return typeof set?._logo === 'string' && /^[\w.-]+\.(svg|png)$/.test(set._logo) ? set._logo : null;
}

/** Asset path → drawn file in the marks directory (`_swaps`), entries with a safe file name only. */
function seasonalSwaps(navSlug: string, seasonId: string): Array<[string, string]> {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _swaps?: unknown } | undefined;
  const swaps = set?._swaps;
  if (!swaps || typeof swaps !== 'object') return [];
  return Object.entries(swaps as Record<string, unknown>).filter(
    (e): e is [string, string] =>
      e[0].startsWith('/assets/') && typeof e[1] === 'string' && /^([\w-]+\/)*[\w.-]+\.(svg|png)$/.test(e[1]),
  );
}

/** The served path of the drawn replacement for `assetPath` while `seasonId` is open, or null. */
export function seasonalSwapPath(navSlug: string, seasonId: string | null | undefined, assetPath: string): string | null {
  if (!seasonId) return null;
  const marks = SEASONAL_THEMES[seasonId]?.marks;
  if (!marks) return null;
  const hit = seasonalSwaps(navSlug, seasonId).find(([from]) => from === assetPath);
  return hit ? `/assets/${navSlug}/${marks}/${hit[1]}` : null;
}

/** Sprite icon id → drawn file in the marks directory (`_icons`). */
function seasonalIcons(navSlug: string, seasonId: string): Array<[string, string]> {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _icons?: unknown } | undefined;
  const icons = set?._icons;
  if (!icons || typeof icons !== 'object') return [];
  return Object.entries(icons as Record<string, unknown>).filter(
    (e): e is [string, string] => /^[a-z0-9-]+$/.test(e[0]) && typeof e[1] === 'string' && /^([\w-]+\/)*[\w.-]+\.(svg|png)$/.test(e[1]),
  );
}

/** Image path shown in a nav icon slot → drawn file to tint there (`_menuIcons`). */
function seasonalMenuIcons(navSlug: string, seasonId: string): Array<[string, string]> {
  const set = MARK_SETS[`../data/seasonal-marks/${navSlug}-${seasonId}.json`] as { _menuIcons?: unknown } | undefined;
  const icons = set?._menuIcons;
  if (!icons || typeof icons !== 'object') return [];
  return Object.entries(icons as Record<string, unknown>).filter(
    (e): e is [string, string] =>
      e[0].startsWith('/assets/') && typeof e[1] === 'string' && /^([\w-]+\/)*[\w.-]+\.(svg|png)$/.test(e[1]),
  );
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Appended to every swapped <img>: the Brand Book's own content keeps the standard marks. */
const NOT_BRAND_BOOK = ':not([data-brand-book] img)';

export function buildSeasonalMarkCss(
  navSlug: string,
  seasonalThemes: readonly string[] | undefined,
  teams: SeasonalTeamLike[],
  logo?: { light?: string; dark?: string },
): string {
  const rules: string[] = [];
  for (const id of seasonalThemes ?? []) {
    const marks = SEASONAL_THEMES[id]?.marks;
    if (!marks) continue;
    // The league's own pages, plus every non-league surface wearing the same
    // season (MFL Live): this league's franchises show their drawn marks
    // there, and a league that does not wear the season emits nothing, so
    // its franchises keep their logos on that surface. Franchise marks and the
    // league logo only — art swaps and sprite icons are this league's chrome.
    const scopes = [
      navSlug,
      ...Object.entries(SURFACE_SEASONAL_THEMES)
        .filter(([, ids]) => ids.includes(id))
        .map(([surface]) => surface),
    ];
    const logoFile = seasonalLogoFile(navSlug, id);
    const logoSrcs = [logo?.light, logo?.dark].filter((s): s is string => Boolean(s));
    if (logoFile && logoSrcs.length) {
      const selectors = scopes.flatMap((scope) =>
        [...new Set(logoSrcs)].map((src) => `html[data-league="${scope}"][data-season="${id}"] img[src="${esc(src)}"]${NOT_BRAND_BOOK}`),
      );
      rules.push(`${selectors.join(',\n')} { content: url("/assets/${navSlug}/${marks}/${logoFile}"); filter: none; }`);
    }
    for (const [from, file] of seasonalSwaps(navSlug, id)) {
      rules.push(
        `html[data-league="${navSlug}"][data-season="${id}"] img[src="${esc(from)}"]${NOT_BRAND_BOOK} { content: url("/assets/${navSlug}/${marks}/${file}"); filter: none; }`,
      );
    }
    for (const [icon, file] of seasonalIcons(navSlug, id)) {
      const scope = `html[data-league="${navSlug}"][data-season="${id}"]`;
      const use = `use[href$="#icon-${icon}"]`;
      rules.push(
        `${scope} svg:has(> ${use}) { --seasonal-icon: url("/assets/${navSlug}/${marks}/${file}"); background-color: currentColor; -webkit-mask: var(--seasonal-icon) center / contain no-repeat; mask: var(--seasonal-icon) center / contain no-repeat; }`,
        `${scope} ${use} { visibility: hidden; }`,
      );
    }
    for (const [from, file] of seasonalMenuIcons(navSlug, id)) {
      const img = `html[data-league="${navSlug}"][data-season="${id}"] .nav-links__icon img[src="${esc(from)}"]`;
      // object-position pushes the image itself out of its box; the box then
      // shows the icon colour through the drawing's silhouette.
      rules.push(
        `${img} { content: normal; object-position: -9999px 0; --seasonal-icon: url("/assets/${navSlug}/${marks}/${file}"); background-color: var(--color-primary, #1c497c); -webkit-mask: var(--seasonal-icon) center / contain no-repeat; mask: var(--seasonal-icon) center / contain no-repeat; }`,
        `html[data-league="${navSlug}"][data-season="${id}"] .nav-links__link--active .nav-links__icon img[src="${esc(from)}"] { background-color: #ffffff; }`,
      );
    }
    const trims = seasonalTrims(navSlug, id);
    const drawn = seasonalMarkIds(navSlug, id);
    for (const team of teams) {
      const trim = team?.franchiseId ? trims.get(team.franchiseId) : undefined;
      if (trim) {
        const dir = `/assets/${navSlug}/${marks}/trim/${team.franchiseId}`;
        rules.push(
          `html[data-league="${navSlug}"][data-season="${id}"] .rhdr__plate[data-franchise="${team.franchiseId}"] { --rhdr-trim-top: url("${dir}-top.png?v=${trim.top}"); --rhdr-trim-bottom: url("${dir}-bottom.png?v=${trim.bottom}"); }`,
        );
      }
      if (!team?.franchiseId || !drawn.has(team.franchiseId)) continue;
      const srcs = new Set<string>([`/assets/${navSlug}/icons/${team.franchiseId}.png`]);
      for (const field of MARK_FIELDS) {
        const src = team[field];
        if (src) iconSrcVariants(src).forEach((s) => srcs.add(s));
      }
      const selectors = scopes.flatMap((scope) => [
        ...[...srcs].map((src) => `html[data-league="${scope}"][data-season="${id}"] img[src="${esc(src)}"]${NOT_BRAND_BOOK}`),
        // An era crest naming a club that still plays (a defending champion
        // under last season's identity) asks for the season's mark by id.
        // League pages only: both leagues have a franchise 0013.
        ...(scope === navSlug ? [`html[data-league="${scope}"][data-season="${id}"] img[data-seasonal-franchise="${team.franchiseId}"]${NOT_BRAND_BOOK}`] : []),
      ]);
      const scale = markScale(navSlug, id, team.franchiseId);
      rules.push(
        `${selectors.join(',\n')} { content: url("/assets/${navSlug}/${marks}/${team.franchiseId}.png${markVersion(navSlug, id, team.franchiseId)}"); filter: none; border-radius: 0;${scale ? ` scale: ${scale};` : ''} }`,
      );
      // border-radius: 0 because many crest slots round the <img> itself to a
      // circle, which suits the regular round crests but cuts the corners off
      // a square mark (Dark Magicians' card frame on the home scoring card).
      // `scale`, not `transform`: a watermark centres itself with
      // transform: translate(-50%, -50%), which a transform here would replace.
      // A scaled mark overhangs its box, and crest frames clip (live scoring's
      // `.lv-side__crest` is overflow:hidden), so its direct parent lets it show
      // — except a watermark's, a whole panel whose clip is the design (the
      // lineup faceoff card spilled CPU Jocks' crest across both teams).
      if (scale) {
        rules.push(
          `${selectors.map((sel) => sel.replace(/ img\[/, ' :has(> img[') + ':not([class*="watermark"]))').join(',\n')} { overflow: visible; }`,
        );
      }
    }
  }
  return rules.join('\n');
}
