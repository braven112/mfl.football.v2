/**
 * Site styles — the style library (src/styles/site-styles/<id>.json) is the
 * one place a site STYLE (Editorial, Primetime) is defined, and a style
 * reaches every page through the `--style-*` tokens the layout puts on
 * <html data-site-theme>. Plan: docs/plans/site-styles.md.
 *
 * Pins:
 *  - the committed generated CSS is exactly what the generator produces;
 *  - every style names EVERY style token (null = the component's own value),
 *    and nothing else, so a new token cannot ship half-defined;
 *  - style tokens and colour-theme tokens never overlap — the theme decides
 *    colour, the style decides type, shape and furniture;
 *  - SITE_THEMES (what a league or a preview may name) matches the library;
 *  - Editorial leaves every token null, which is what keeps TheLeague and the
 *    AFL pixel-identical to the site before styles existed;
 *  - the league layout sets data-site-theme on <html>;
 *  - a section title's under-mark goes through --style-section-mark;
 *  - a section title's stripe goes through --style-section-rule, so a style
 *    can drop it (Primetime has no editorial borders);
 *  - a card's neutral 1px outline goes through --style-card-border, so a
 *    style can drop it (Primetime lifts cards with --style-card-shadow);
 *  - per-style branches (`=== 'primetime'`, `[data-site-theme=`) only shrink:
 *    a style should arrive through tokens, and a page-specific layout within
 *    a style is the exception, pinned in tests/fixtures/site-style-branch-baseline.json.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STYLE_TOKENS } from '../src/config/style-tokens.mjs';
import { THEMED_TOKENS } from '../src/config/theme-tokens.mjs';
import { loadStyles, buildStyleCss, OUTPUT, DEFAULT_STYLE_ID } from '../scripts/generate-site-styles.mjs';
import { SITE_THEMES } from '../src/utils/site-theme';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styles = loadStyles();
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(astro|css|tsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC_FILES = walk(path.join(ROOT, 'src'));

describe('site-style library', () => {
  it('the generated CSS is fresh', () => {
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(buildStyleCss(styles, STYLE_TOKENS));
  });

  it('every style names every style token, and no other', () => {
    for (const [id, style] of Object.entries(styles)) {
      expect(Object.keys(style.tokens).sort(), id).toEqual([...STYLE_TOKENS].sort());
      for (const key of Object.keys(style.dark ?? {})) expect(STYLE_TOKENS, `${id} dark`).toContain(key);
    }
  });

  it('style tokens are --style-* and never overlap the colour theme', () => {
    const themed = new Set<string>(THEMED_TOKENS);
    for (const t of STYLE_TOKENS) {
      expect(t).toMatch(/^--style-[a-z-]+$/);
      expect(themed.has(t), t).toBe(false);
    }
  });

  it('SITE_THEMES matches the style files', () => {
    expect([...SITE_THEMES].sort()).toEqual(Object.keys(styles).sort());
  });

  it('Editorial is the components’ own values (every token null)', () => {
    const editorial = styles[DEFAULT_STYLE_ID];
    expect(Object.values(editorial.tokens).every((v) => v === null)).toBe(true);
    expect(editorial.dark ?? {}).toEqual({});
  });

  it('only the generated CSS declares a style token', () => {
    const offenders: string[] = [];
    for (const f of SRC_FILES) {
      if (f === OUTPUT) continue;
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/(?<![\w(,-])(--style-[a-z-]+)\s*:/g)) offenders.push(`${rel(f)} ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every layout imports the generated CSS, and the league layout sets data-site-theme', () => {
    for (const l of ['TheLeagueLayout', 'MflAppLayout', 'LoginLayout', 'SplashLayout']) {
      const s = fs.readFileSync(path.join(ROOT, `src/layouts/${l}.astro`), 'utf8');
      expect(s, l).toContain("site-styles.generated.css'");
    }
    const layout = fs.readFileSync(path.join(ROOT, 'src/layouts/TheLeagueLayout.astro'), 'utf8');
    expect(layout).toMatch(/<html[^>]*data-site-theme=\{siteStyle\}/s);
    expect(layout).toContain('resolveSiteTheme(leagueContext.slug, Astro.locals.siteThemePreview)');
  });

  it('Storybook offers every style in its Style toolbar', () => {
    const preview = fs.readFileSync(path.join(ROOT, '.storybook/preview.ts'), 'utf8');
    expect(preview).toContain("html.setAttribute('data-site-theme', style)");
    for (const id of SITE_THEMES) expect(preview, id).toContain(`{ value: '${id}', title:`);
  });

  it('the generator --check passes', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/generate-site-styles.mjs'), '--check']);
  });
});

/** A selector that names a section title or header. */
const TITLE_SELECTOR = /title|header|heading|kicker|eyebrow|subheading|section h2/i;
/** Title-shaped selectors whose left border is not the editorial stripe. */
const STRIPE_ALLOW = [
  'thead', // table header rows: a column divider, not a stripe
  '--pinned', '--yours', '--selected', '.selected', '__rec', // a STATE mark, which every style keeps
  'dr-tier-header', // transparent placeholder border
  'sb-composer__title', // grey divider
  'ds-editorial-section-title', // the design system's specimen OF the editorial stripe
  'cdm-type-badge',
];

describe('section-title stripes go through the style', () => {
  it('no title block draws a raw 2–4px left stripe', () => {
    const offenders: string[] = [];
    for (const f of SRC_FILES.filter((x) => /\.(astro|css|tsx)$/.test(x))) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/^[ \t]*border-left: *([2-4]px solid [^;\n]+);/gm)) {
        if (/transparent|gray|grey/.test(m[1]!)) continue;
        const open = s.lastIndexOf('{', m.index);
        const start = Math.max(s.lastIndexOf('}', open), s.lastIndexOf('*/', open) + 1, s.lastIndexOf('{', open - 1) + 1);
        const sel = s.slice(start + 1, open).trim().replace(/\s+/g, ' ');
        if (!TITLE_SELECTOR.test(sel) || STRIPE_ALLOW.some((k) => sel.includes(k))) continue;
        if (sel.includes('[data-site-theme')) continue;
        offenders.push(`${rel(f)} :: ${sel} :: ${m[1]}`);
      }
    }
    // Wrap it: border-left: var(--style-section-rule, <your stripe>) and
    // padding-left: var(--style-section-rule-gap, <your gap>).
    expect(offenders).toEqual([]);
  });
});

describe('section titles carry the style\'s under-mark', () => {
  it('every block wearing --style-section-rule also wears --style-section-mark', () => {
    const offenders: string[] = [];
    for (const f of SRC_FILES.filter((x) => /\.(astro|css|tsx)$/.test(x))) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/^[ \t]*border-left: var\(--style-section-rule,/gm)) {
        const open = s.lastIndexOf('{', m.index);
        const body = s.slice(open, s.indexOf('}', m.index));
        // A wrapper that holds a title AND a blurb puts the mark on its
        // heading instead, and says so with this comment.
        if (/--style-section-mark-pad/.test(body) && /--style-section-mark,/.test(body)) continue;
        if (/section mark: on the/.test(body)) continue;
        offenders.push(`${rel(f)} :: ${s.slice(s.lastIndexOf('}', open) + 1, open).trim().slice(-60)}`);
      }
    }
    // Add: background: var(--style-section-mark, none);
    //      padding-bottom: var(--style-section-mark-pad, <your padding-bottom>);
    expect(offenders).toEqual([]);
  });
});

/** Selectors that name a card-like surface, plus the front page's sections,
 *  which are cards in all but name. Kept in step with the sweep that
 *  introduced the card tokens (Phase 2, docs/plans/site-styles.md). */
const CARD_SELECTOR = /card|panel|tile|box\b|widget|\.fp-(heads|lead|wire|strip|band--guest)$/i;
/** A STATE of a card (hover, selected, yours…) or an overlay is not its resting edge. */
const CARD_SKIP = /:hover|--active|--selected|is-|:focus|\.active|\.selected|--yours|--pinned|--mine|--you|--highlight|--current|--live|--warn|--error|--danger|--success|\[aria-|\[data-site-theme|:checked|--open|::|html\.dark|sheet|modal|dialog|popover|drawer|menu|tooltip|dropdown/i;
/** The neutral greys a card outline is drawn in. */
const NEUTRAL_EDGE = /(--content-border|--card-border\b(?!-strength)|--color-gray-(100|200|300)|#e2e8f0|#e5e7eb|#e5e5e5|#e2e2e2|#dddddd|#ddd\b|--sf-border|--content-border-color|--primary-content-border-color|--border-color|--color-border)/;

describe('card outlines go through the style', () => {
  it('no card block draws a raw neutral 1px outline', () => {
    const offenders: string[] = [];
    for (const f of SRC_FILES.filter((x) => /\.(astro|css|tsx)$/.test(x))) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/^[ \t]*border: *(1px solid [^;\n]+);/gm)) {
        if (!NEUTRAL_EDGE.test(m[1]!) || /transparent/.test(m[1]!)) continue;
        const open = s.lastIndexOf('{', m.index);
        const start = Math.max(s.lastIndexOf('}', open), s.lastIndexOf('*/', open) + 1, s.lastIndexOf('{', open - 1) + 1);
        const sel = s.slice(start + 1, open).trim().replace(/\s+/g, ' ');
        if (!CARD_SELECTOR.test(sel) || CARD_SKIP.test(sel) || sel.startsWith('@')) continue;
        offenders.push(`${rel(f)} :: ${sel.slice(-80)}`);
      }
    }
    // Wrap it: border: var(--style-card-border, <your border>), and, if the
    // card has no shadow of its own, box-shadow: var(--style-card-shadow, none).
    expect(offenders).toEqual([]);
  });
});

const BASELINE = path.join(ROOT, 'tests/fixtures/site-style-branch-baseline.json');
const BRANCH = /[!=]==\s*'primetime'|'primetime'\s*[!=]==|\[data-site-theme/g;

describe('per-style branches only shrink', () => {
  it('matches tests/fixtures/site-style-branch-baseline.json', () => {
    const counts: Record<string, number> = {};
    for (const f of SRC_FILES) {
      if (f === OUTPUT) continue;
      const n = (fs.readFileSync(f, 'utf8').match(BRANCH) ?? []).length;
      if (n) counts[rel(f)] = n;
    }
    const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).files;
    const grew = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
    // A new branch: reach for a --style-* token first (src/config/style-tokens.mjs).
    // A genuine page-specific layout within a style: add it here, with a reason in the PR.
    expect(grew, 'new per-style branches').toEqual([]);
    const shrank = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n);
    // Retighten the baseline so the slack cannot be spent elsewhere.
    expect(shrank, 'retighten the baseline').toEqual([]);
  });
});
