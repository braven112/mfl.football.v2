import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectDesignLiterals, DESIGN_LITERAL_EXTENSIONS } from '../scripts/lib/ratchet-measures.mjs';
import { walkFiles } from '../scripts/lib/walk.mjs';
import { buildEmptyStateHTML, buildErrorStateHTML } from '../src/utils/state-html';
import baseline from './fixtures/design-literal-baseline.json';

/**
 * The polish layer — docs/claude/rules/theming-and-assets.md § "The polish layer".
 *
 * Two kinds of check:
 *   1. INVARIANTS: the tokens and global rules exist, are loaded on every
 *      layout, and keep the specific shapes that were chosen on purpose
 *      (no plain `ease`, reduced motion that does not freeze loaders, the
 *      text-wrap LONGHAND, no hardcoded 44px touch target).
 *   2. A RATCHET on hand-typed transitions, font sizes and shadows, per file.
 *      New code uses tokens; the legacy count may only shrink, and a file
 *      that shrank must be retightened (node scripts/ratchet.mjs --write) —
 *      same idiom as the fork and typecheck baselines.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const tokens = read('src/styles/tokens.css');
const tokensDark = read('src/styles/tokens-dark.css');
const polish = read('src/styles/polish.css');

const LAYOUTS = [
  'src/layouts/TheLeagueLayout.astro',
  'src/layouts/MflAppLayout.astro',
  'src/layouts/LoginLayout.astro',
  'src/layouts/SplashLayout.astro',
];

describe('polish tokens', () => {
  it.each([
    '--ease-out',
    '--ease-in',
    '--ease-in-out',
    '--duration-instant',
    '--duration-fast',
    '--duration-base',
    '--duration-slow',
    '--duration-overlay',
    '--touch-target-min',
    '--tracking-caps',
    '--font-size-2xs',
    '--font-size-3xs',
    '--surface-raised',
    '--surface-overlay',
  ])('defines %s', (name) => {
    expect(tokens).toMatch(new RegExp(`^\\s*${name}\\s*:`, 'm'));
  });

  it('never pairs a transition token with plain `ease` (slow start reads as lag)', () => {
    for (const name of ['--transition-fast', '--transition-base', '--transition-slow']) {
      const value = tokens.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1] ?? '';
      expect(value, name).not.toMatch(/\bease\b(?!-)/);
      expect(value, name).toContain('var(--ease-');
    }
  });

  it('steps dark-mode overlays above the card surface', () => {
    expect(tokensDark).toMatch(/--surface-overlay:\s*var\(--color-surface-3\)/);
  });

  it('ships metric-matched fallbacks in the display and numeric stacks', () => {
    expect(tokens).toMatch(/--font-display:\s*'UFC Sans Condensed',\s*'UFC Sans Condensed Fallback'/);
    expect(tokens).toMatch(/--font-numeric:\s*'UFC Sans',\s*'UFC Sans Fallback'/);
  });
});

describe('global polish rules', () => {
  it.each(LAYOUTS)('%s imports polish.css and states.css from the frontmatter, never via @import', (layout) => {
    const src = read(layout);
    // Astro SCOPES rules @imported inside a component <style> block to that
    // component's own markup, so a global sheet @imported there silently
    // never reaches page content. Frontmatter imports stay global.
    expect(src).toMatch(/^import '\.\.\/styles\/polish\.css';$/m);
    expect(src).toMatch(/^import '\.\.\/styles\/states\.css';$/m);
    expect(src).not.toMatch(/@import '\.\.\/styles\/(?:polish|states)\.css'/);
  });

  it('reduced motion collapses transitions but never zeroes animations (a frozen spinner reads as stuck)', () => {
    const block = polish.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(block).toContain('transition-duration');
    expect(block).not.toMatch(/animation/);
  });

  it('uses the text-wrap-style LONGHAND (the shorthand overrides white-space: nowrap)', () => {
    expect(polish).toMatch(/text-wrap-style:\s*balance/);
    expect(polish).not.toMatch(/^\s*text-wrap\s*:/m);
  });
});

describe('token files carry tokens only', () => {
  // The layouts pull tokens.css / tokens-dark.css in with `@import` inside a
  // scoped <style> block, and Astro SCOPES @imported rules to that layout's own
  // markup. Custom properties on :root / html survive that (they inherit
  // down), but any real styling rule placed here matches only the header, nav
  // and footer — which is how the site-wide focus ring and the dark-mode
  // selection colours silently never reached page content until Sep 2026.
  // Global styling belongs in polish.css, imported from the frontmatter.
  it.each(['src/styles/tokens.css', 'src/styles/tokens-dark.css'])('%s declares only custom properties', (file) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      if (selector.startsWith('@font-face')) continue;
      const styling = m[2]
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !d.startsWith('--') && !d.startsWith('color-scheme'));
      if (styling.length) offenders.push(`${selector.split('\n').pop()} { ${styling[0]} }`);
    }
    expect(offenders, 'move styling rules to src/styles/polish.css').toEqual([]);
  });
});

describe('touch targets', () => {
  it('no min-height / min-width is hardcoded to 44px — use var(--touch-target-min)', () => {
    expect(scanFor(/\bmin-(?:height|width)\s*:\s*44px\b/)).toEqual([]);
  });
});

describe('empty / error state builders', () => {
  it('escapes caller text and picks the role by kind', () => {
    const empty = buildEmptyStateHTML({ title: '<b>x</b>', body: 'a "b"' });
    expect(empty).toContain('role="status"');
    expect(empty).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(empty).toContain('a &quot;b&quot;');
    const error = buildErrorStateHTML({ title: 'Failed', actions: [{ label: 'Try again', id: 'retry' }] });
    expect(error).toContain('role="alert"');
    expect(error).toContain('ui-state--error');
    expect(error).toContain('<button type="button" class="ui-state__action" data-state-action="retry">Try again</button>');
  });

  it('compact drops the icon and the panel', () => {
    const html = buildEmptyStateHTML({ title: 'None', compact: true });
    expect(html).toContain('ui-state--compact');
    expect(html).not.toContain('ui-state__icon');
  });
});

describe('design literal ratchet', () => {
  type Counts = Partial<Record<'transition' | 'fontSize' | 'shadow', number>>;
  const now = collectDesignLiterals(join(ROOT, 'src')) as Record<string, Counts>;
  const recorded = baseline.files as Record<string, Counts>;
  const KINDS = ['transition', 'fontSize', 'shadow'] as const;
  const HINT: Record<(typeof KINDS)[number], string> = {
    transition: 'var(--transition-fast|base|slow)',
    fontSize: 'var(--font-size-*)',
    shadow: 'var(--shadow-sm|md|lg|xl)',
  };

  it('no file gains a hand-typed transition, font size or shadow', () => {
    const grew: string[] = [];
    for (const [file, counts] of Object.entries(now)) {
      for (const kind of KINDS) {
        const was = recorded[file]?.[kind] ?? 0;
        const is = counts[kind] ?? 0;
        if (is > was) grew.push(`${file}: ${kind} ${was} → ${is} (use ${HINT[kind]})`);
      }
    }
    expect(grew, 'new literals — use the tokens instead').toEqual([]);
  });

  it('a file that dropped literals is retightened (node scripts/ratchet.mjs --write)', () => {
    const fell: string[] = [];
    for (const [file, counts] of Object.entries(recorded)) {
      for (const kind of KINDS) {
        const was = counts[kind] ?? 0;
        const is = now[file]?.[kind] ?? 0;
        if (is < was) fell.push(`${file}: ${kind} ${was} → ${is}`);
      }
    }
    expect(fell, 'progress — retighten tests/fixtures/design-literal-baseline.json').toEqual([]);
  });
});

/** repo-relative `file:line` for every match, over the ratchet's file set. */
function scanFor(re: RegExp): string[] {
  const hits: string[] = [];
  for (const file of walkFiles(join(ROOT, 'src'), { extensions: DESIGN_LITERAL_EXTENSIONS })) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (rel.startsWith('src/assets/')) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (re.test(line)) hits.push(`${rel}:${i + 1}`);
      });
  }
  return hits;
}
