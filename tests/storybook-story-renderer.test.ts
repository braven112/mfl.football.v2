/**
 * A story over a non-Astro component must NAME its renderer, and that renderer
 * must be REGISTERED.
 *
 * ── THE BUG THIS PINS ─────────────────────────────────────────────────────
 * The live-scoring kit added the repo's first story over a React component.
 * Every story before it rendered an `.astro` file, and two things had
 * therefore never been exercised:
 *
 *  1. `@storybook-astro/renderer`'s `render()` only short-circuits on an
 *     `isAstroComponentFactory` marker. A plain function component falls
 *     through to the renderer named in `parameters.renderer` — which the
 *     framework's own preview sets to `'astro'` globally, and which is NOT a
 *     key in the fallback registry. The story throws
 *     `Renderer 'astro' not found. Available renderers: …` when it is
 *     CAPTURED.
 *  2. That registry (`virtual:storybook-renderer-fallback`) is built from
 *     `framework.options.integrations` in `.storybook/main.ts` — NOT from
 *     `astro.config.ts`. Ours was `options: {}`, so the registry was an empty
 *     module and the error printed nothing after the colon.
 *
 * Neither fails the build. `storybook build` exits 0 and the story is indexed;
 * the throw happens in the browser at render time. So the only thing that saw
 * it was Chromatic — 18 component errors on build 455 — and the only thing a
 * developer sees locally is a red box in one story they may not open.
 *
 * Both halves are checked here because fixing either alone still fails:
 * naming `react` with no integration registered swaps one "not found" for
 * another.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const STORIES_DIR = join(ROOT, 'stories');

function storyFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return storyFiles(p);
    return /\.stories\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Comments carry example code; strip them before scanning for real syntax. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The identifier given as `component:` in the default export. */
function componentIdentifier(src: string): string | null {
  return src.match(/^\s*component:\s*([A-Za-z_$][\w$]*)\s*,/m)?.[1] ?? null;
}

/** The module specifier that identifier was imported from. */
function importSpecifierFor(src: string, ident: string): string | null {
  const re = new RegExp(`^\\s*import\\s+${ident}\\s+from\\s+['"]([^'"]+)['"]`, 'm');
  return src.match(re)?.[1] ?? null;
}

/** `parameters: { renderer: 'x' }`, anywhere in the file. */
function declaredRenderer(src: string): string | null {
  return src.match(/\brenderer:\s*['"]([\w-]+)['"]/)?.[1] ?? null;
}

/** Framework names passed to `framework.options.integrations` in main.ts. */
function registeredIntegrations(): string[] {
  const src = stripComments(readFileSync(join(ROOT, '.storybook/main.ts'), 'utf8'));
  const block = src.match(/integrations:\s*\[([^\]]*)\]/)?.[1] ?? '';
  return [...block.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

/** Framework names passed to `integrations` in astro.config.ts. */
function astroIntegrations(): string[] {
  const src = stripComments(readFileSync(join(ROOT, 'astro.config.ts'), 'utf8'));
  const block = src.match(/^\s*integrations:\s*\[([^\]]*)\]/m)?.[1] ?? '';
  return [...block.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

const FILES = storyFiles(STORIES_DIR);

describe('storybook story renderers', () => {
  it('finds the story files', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it.each(FILES.map((f) => [f.slice(ROOT.length + 1), f] as const))(
    '%s — a non-Astro component names its renderer',
    (_label, file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      const ident = componentIdentifier(src);
      // A story file with no `component:` (a pure template story) has nothing
      // for the renderer to dispatch on.
      if (!ident) return;

      const spec = importSpecifierFor(src, ident);
      expect(spec, `could not resolve where ${ident} is imported from`).toBeTruthy();

      if (spec!.endsWith('.astro')) return;

      const renderer = declaredRenderer(src);
      expect(
        renderer,
        `${ident} is not an .astro component, so this story must declare ` +
          `parameters: { renderer: '<framework>' } — without it the story ` +
          `throws "Renderer 'astro' not found" when Chromatic captures it, ` +
          `while the build still exits 0`,
      ).toBeTruthy();

      expect(
        registeredIntegrations(),
        `renderer '${renderer}' is not registered in .storybook/main.ts's ` +
          `framework.options.integrations, so the fallback registry has no ` +
          `such key and the story throws "Renderer '${renderer}' not found"`,
      ).toContain(renderer);
    },
  );

  it('registers at least one integration, so the fallback registry is not empty', () => {
    expect(registeredIntegrations().length).toBeGreaterThan(0);
  });

  it('registers nothing Astro itself does not run', () => {
    // `.storybook/main.ts` mirrors `astro.config.ts`; a framework in one and
    // not the other is drift, and the direction that matters is Storybook
    // claiming to render something the app never ships.
    const astro = astroIntegrations();
    for (const name of registeredIntegrations()) {
      expect(
        astro,
        `${name}() is registered in .storybook/main.ts but astro.config.ts ` +
          `does not use it`,
      ).toContain(name);
    }
  });
});
