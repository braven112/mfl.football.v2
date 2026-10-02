/**
 * CTA pattern guard — docs/claude/rules/theming-and-assets.md § "CTAs — one
 * pattern".
 *
 * Every base layout carries a global `a:hover` (link colour + underline) at
 * specificity (0,1,1). A hand-rolled CTA class is (0,1,0), so unless it
 * restated colour AND decoration in its own :hover it wore the link hover:
 * the Owners' Poll's blue "Change your vote" button went red and underlined
 * (Oct 2026), and ~100 one-off `__cta` / `__btn` classes each carried the same
 * latent bug. `src/styles/cta.css` fixes it once, at (0,2,0).
 *
 * This suite pins:
 *   1. every base layout (and Storybook) loads cta.css from the frontmatter,
 *      so its rules ship unscoped;
 *   2. the state rules in cta.css out-rank the layouts' global a:hover, and
 *      the base rules stay at zero specificity so components can override;
 *   3. every <a> styled as a CTA — a class named `…__cta`, `…__btn`,
 *      `…-btn`, `…__button`, or a bare `btn` — also carries `cta` or
 *      `cta-link`. A new one-off CTA fails here; add the shared class and
 *      keep the BEM class only for layout overrides.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const LAYOUTS = [
  'src/layouts/TheLeagueLayout.astro',
  'src/layouts/LoginLayout.astro',
  'src/layouts/SplashLayout.astro',
  'src/layouts/MflAppLayout.astro',
];

/**
 * <a> elements that carry a CTA-shaped class name but are deliberately NOT
 * the shared pattern. Key: `path::class`. Every entry needs a reason.
 */
const ALLOWED: Record<string, string> = {
  'src/components/shared/live-broadcast/BroadcastControls.astro::lbc-bar__btn':
    'Broadcast toolbar chip, styled as a set with the sound/fullscreen <button>s on a bar that is dark in both themes; its own :hover restates colour and decoration.',
  'src/components/theleague/suggestions/AdminToolbar.tsx::sb-admin__btn':
    'Admin toolbar chip (pin/lock/archive/issue link) styled as a set with toggle <button>s; SuggestionBoxPage restates colour and decoration on :hover.',
};

const CTA_CLASS = /^(?:btn|[a-z0-9-]+(?:__|-)(?:cta|btn|button)(?:-[a-z0-9-]+|--[a-z0-9-]+)?)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(astro|tsx|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The text of every `<a …>` opening tag, brace/quote aware. */
export function anchorTags(src: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  const re = /<a(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + 2;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ tag: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Class-name-looking tokens inside class= / className= / class:list=. */
export function classTokens(tag: string): string[] {
  const attr = /\b(?:class|className|class:list)=/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = attr.exec(tag))) {
    const start = m.index + m[0].length;
    const open = tag[start];
    let end = start + 1;
    if (open === '"' || open === "'") end = tag.indexOf(open, start + 1);
    else if (open === '{') {
      let depth = 0;
      for (end = start; end < tag.length; end++) {
        if (tag[end] === '{') depth++;
        else if (tag[end] === '}' && --depth === 0) break;
      }
    }
    const value = tag.slice(start + 1, end);
    // Only string-literal contents are class names; strip `${…}` holes first.
    const literals = value.replace(/\$\{[^}]*\}/g, ' ').match(/(["'`])([^"'`]*)\1/g) ?? [value];
    for (const lit of open === '{' ? literals : [value]) {
      for (const t of lit.replace(/^["'`]|["'`]$/g, '').split(/\s+/)) if (t) tokens.push(t);
    }
  }
  return tokens;
}

describe('cta.css is loaded everywhere', () => {
  it.each(LAYOUTS)('%s imports cta.css from the frontmatter, never via @import', (layout) => {
    const src = read(layout);
    expect(src).toMatch(/^import '\.\.\/styles\/cta\.css';$/m);
    expect(src).not.toMatch(/@import '\.\.\/styles\/cta\.css'/);
  });

  it('Storybook preview imports cta.css', () => {
    expect(read('.storybook/preview.ts')).toMatch(/^import '\.\.\/src\/styles\/cta\.css';$/m);
  });
});

describe('cta.css out-ranks the global link hover', () => {
  const css = read('src/styles/cta.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('state rules restate colour and decoration at (0,2,0)', () => {
    const rule = css.match(/\.cta:is\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(rule, '.cta:is(:link, :visited, :hover, :focus, :active) rule').toBeTruthy();
    for (const s of [':hover', ':focus', ':visited']) expect(rule![1]).toContain(s);
    expect(rule![2]).toMatch(/color:\s*var\(--cta-ink\)/);
    expect(rule![2]).toMatch(/text-decoration:\s*none/);

    const link = css.match(/\.cta-link:hover\s*\{([^}]*)\}/);
    expect(link?.[1]).toMatch(/text-decoration:\s*none/);
  });

  it('base rules carry zero specificity so a component class can override them', () => {
    expect(css).toMatch(/:where\(\.cta\)\s*\{/);
    expect(css).toMatch(/:where\(\.cta--ghost\)\s*\{/);
    expect(css).toMatch(/:where\(\.cta-link\)\s*\{/);
    // A bare `.cta {` base would tie with component classes and make the
    // result depend on stylesheet order.
    expect(css).not.toMatch(/(^|\})\s*\.cta\s*\{/);
  });
});

describe('every CTA-styled link uses the shared pattern', () => {
  const offenders: string[] = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    for (const { tag, line } of anchorTags(fs.readFileSync(file, 'utf8'))) {
      const tokens = classTokens(tag);
      if (tokens.includes('cta') || tokens.includes('cta-link')) continue;
      const hit = tokens.find((t) => CTA_CLASS.test(t));
      if (!hit || ALLOWED[`${rel}::${hit}`]) continue;
      offenders.push(`${rel}:${line}  .${hit}`);
    }
  }

  it('no <a> carries a one-off CTA class without `cta` / `cta-link`', () => {
    expect(
      offenders,
      'Add `cta cta--primary`, `cta cta--ghost` or `cta-link` (src/styles/cta.css) and move ' +
        'colours to --cta-* variables. See docs/claude/rules/theming-and-assets.md § "CTAs".',
    ).toEqual([]);
  });

  it('every allowlist entry still matches a real link', () => {
    for (const key of Object.keys(ALLOWED)) {
      const [rel, cls] = key.split('::');
      expect(fs.existsSync(path.join(ROOT, rel)), key).toBe(true);
      expect(read(rel), key).toContain(cls);
    }
  });
});
