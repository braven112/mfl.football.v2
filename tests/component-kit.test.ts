/**
 * Component kit guard — docs/claude/rules/theming-and-assets.md
 * § "Component kit" and docs/plans/component-kit.md.
 *
 * The site carried ~110 hand-rolled badge classes and ~130 card classes, each
 * restating the same shape with its own padding, weight and dark-mode colours.
 * Each kit stylesheet (badge.css, card.css) is the one shape now, and every
 * instance either wears it (`ui-badge`, `ui-card`, keeping only what differs
 * in its own class) or is a registered FORK in
 * tests/fixtures/component-kit-forks.json — the owner's rule: the kit grows a
 * prop only when every league benefits; anything else is a fork, and a fork
 * is written down.
 *
 * Per kit, this suite pins:
 *   1. every base layout (and Storybook) loads the stylesheet from the
 *      frontmatter, so its rules ship unscoped;
 *   2. every rule in it carries zero specificity, so a component's own class
 *      always wins — that is what keeps every migrated page pixel-identical;
 *   3. every element whose class names the component also carries the kit
 *      class, or is a registered fork — a NEW one-off fails here;
 *   4. every registered fork still exists (the registry only shrinks).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './helpers/scan-guard';
import forksJson from './fixtures/component-kit-forks.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Fork registry, keyed by kit: `<file>::<class>` → why it is not on the kit. */
const forks: Record<Kit['name'], Record<string, string>> = forksJson;

const LAYOUTS = [
  'src/layouts/TheLeagueLayout.astro',
  'src/layouts/LoginLayout.astro',
  'src/layouts/SplashLayout.astro',
  'src/layouts/MflAppLayout.astro',
];

interface Kit {
  /** Key in component-kit-forks.json. */
  name: 'badge' | 'card' | 'modal' | 'tabs' | 'tab' | 'table';
  stylesheet: string;
  cls: string;
  /** Kit classes besides `cls` the stylesheet may define (the modal's scrim, the tab bar's tab). */
  extra?: string[];
  /** A class name that IS this component (block, or block__element). */
  pattern: RegExp;
  /**
   * Found by what the element IS as well as what it is named: a <dialog>, a
   * role="tab". Its own first class names it in the fork registry.
   */
  isInstance?: (name: string, tag: string) => boolean;
  /**
   * Elements that can be this component. A <button> or <a> named `…-pill` is
   * a control (a filter chip), an <img> named `…__badge` is a crest, a table
   * cell named `…__badge` is a column — none of them is the kit's badge.
   */
  tags: Set<string>;
}

const KITS: Kit[] = [
  {
    name: 'badge',
    stylesheet: 'src/styles/badge.css',
    cls: 'ui-badge',
    pattern: /^[a-z0-9-]+(?:__[a-z0-9-]+)?(?:__|-)(?:badge|pill)$/,
    tags: new Set(['span', 'div', 'p', 'li', 'strong', 'small', 'em', 'b', 'i', 'abbr', 'time', 'mark']),
  },
  {
    name: 'card',
    stylesheet: 'src/styles/card.css',
    cls: 'ui-card',
    pattern: /^(?:[a-z0-9-]+(?:__[a-z0-9-]+)?(?:__|-))?card$/,
    tags: new Set(['div', 'article', 'section', 'aside', 'li', 'a', 'figure', 'details']),
  },
  {
    name: 'modal',
    stylesheet: 'src/styles/modal.css',
    cls: 'ui-modal',
    extra: ['ui-scrim'],
    pattern: /(?!)/,
    tags: new Set(['dialog', 'div', 'section', 'aside', 'form']),
    isInstance: (name, tag) =>
      name === 'dialog' || /\brole=["'{]+(?:alert)?dialog\b/.test(tag) || /\baria-modal=["'{]+true\b/.test(tag),
  },
  {
    name: 'tabs',
    stylesheet: 'src/styles/tabs.css',
    cls: 'ui-tabs',
    extra: ['ui-tab'],
    pattern: /^[a-z0-9-]+(?:__[a-z0-9-]+)?(?:__|-)(?:tabs|tab-bar|tabbar)$/,
    tags: new Set(['div', 'nav', 'ul', 'section', 'header']),
    isInstance: (_name, tag) => /\brole=["'{]+tablist\b/.test(tag),
  },
  {
    name: 'tab',
    stylesheet: 'src/styles/tabs.css',
    cls: 'ui-tab',
    extra: ['ui-tabs'],
    pattern: /^[a-z0-9-]+(?:__[a-z0-9-]+)?(?:__|-)(?:tab|tab-btn)$/,
    tags: new Set(['button', 'a', 'li', 'div', 'span']),
    isInstance: (_name, tag) => /\brole=["'{]+tab["'}\s]/.test(tag),
  },
  {
    name: 'table',
    stylesheet: 'src/styles/table.css',
    cls: 'ui-table',
    pattern: /(?!)/,
    tags: new Set(['table']),
    isInstance: () => true,
  },
];

/** Every opening tag in a file, brace/quote aware (same walk as cta-pattern). */
function openingTags(src: string): { name: string; tag: string; line: number }[] {
  const out: { name: string; tag: string; line: number }[] = [];
  const re = /<([a-z][a-z0-9]*)(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + 1 + m[1].length;
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
    out.push({ name: m[1], tag: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Class-name-looking tokens inside class= / className= / class:list=. */
function classTokens(tag: string): string[] {
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

const SOURCES = walkFiles({ roots: ['src'], extensions: ['.astro', '.tsx', '.jsx', '.ts'] }).map((rel) => ({
  rel,
  tags: openingTags(read(rel)),
}));

describe.each(KITS)('component kit: $name', (kit) => {
  const registry = forks[kit.name];
  const file = path.basename(kit.stylesheet);

  it.each(LAYOUTS)(`%s imports ${file} from the frontmatter, never via @import`, (layout) => {
    const src = read(layout);
    expect(src).toMatch(new RegExp(`^import '\\.\\./styles/${file.replace('.', '\\.')}';$`, 'm'));
    expect(src).not.toMatch(new RegExp(`@import '\\.\\./styles/${file.replace('.', '\\.')}'`));
  });

  it(`Storybook preview imports ${file}`, () => {
    expect(read('.storybook/preview.ts')).toMatch(new RegExp(`^import '\\.\\./src/styles/${file.replace('.', '\\.')}';$`, 'm'));
  });

  it('every rule sits inside :where(), so a component class always wins', () => {
    const css = read(kit.stylesheet).replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(0);
    // Everything inside :where() — a state such as :hover or [aria-selected]
    // outside it would add specificity back. Only a pseudo-ELEMENT may follow.
    const names = new Set([kit.cls, ...(kit.extra ?? [])]);
    for (const s of selectors) {
      // The one exception, as in cta.css: link tabs out-rank the layouts' global a / a:hover.
      if (kit.stylesheet.endsWith('tabs.css') && s.split(/,\s*/).every((one) => /^\.ui-tab(?:--active)?:is\(a\)(?::hover|:focus|\[aria-current='page'\])?$/.test(one))) continue;
      const m = s.match(/^:where\(([^{}]+)\)(::backdrop)?$/);
      expect(m, s).not.toBeNull();
      for (const c of m![1].matchAll(/\.([a-z][a-z0-9-]*?)(?:--[a-z]+)?(?![a-z0-9-])/g)) expect(names.has(c[1]), `${s}: .${c[1]}`).toBe(true);
    }
  });

  it('colours come from tokens, never literals', () => {
    const css = read(kit.stylesheet).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const { rel, tags } of SOURCES) {
    for (const { name, tag, line } of tags) {
      if (!kit.tags.has(name)) continue;
      const tokens = classTokens(tag);
      // A classless match is prose (`<dialog>` in a comment), never markup.
      const hit =
        tokens.find((t) => kit.pattern.test(t)) ??
        (kit.isInstance?.(name, tag) ? tokens.find((t) => !t.startsWith('ui-')) : undefined);
      if (!hit) continue;
      // The scrim may carry the dialog role when the panel inside wears the kit.
      if (tokens.includes(kit.cls) || kit.extra?.some((t) => tokens.includes(t))) continue;
      const key = `${rel}::${hit}`;
      if (registry[key]) {
        seen.add(key);
        continue;
      }
      offenders.push(`${rel}:${line}  .${hit}`);
    }
  }

  it(`no element carries a one-off ${kit.name} class without \`${kit.cls}\``, () => {
    expect(
      offenders,
      `Add \`${kit.cls}\` (${kit.stylesheet}) and keep only what differs in your own class — or, if ` +
        'this one is deliberately its own thing, register it as a fork in ' +
        'tests/fixtures/component-kit-forks.json with the reason.',
    ).toEqual([]);
  });

  it('every registered fork still matches a real element', () => {
    const stale = Object.keys(registry).filter((k) => !seen.has(k));
    expect(stale, 'Remove these from tests/fixtures/component-kit-forks.json — the registry only shrinks.').toEqual([]);
  });

  it('every fork carries a reason', () => {
    for (const [k, why] of Object.entries(registry)) expect(why.length, k).toBeGreaterThan(15);
  });
});
