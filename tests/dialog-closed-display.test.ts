/**
 * A native <dialog> must not carry an author `display` on its bare selector.
 *
 * Regression guard. The UA stylesheet hides a closed <dialog> with
 * `dialog:not([open]) { display: none }`. Any author rule that sets `display`
 * on the element itself — even to lay out its children — overrides that, so
 * the moment the dialog closes it drops into normal flow at its DOM position
 * and stays painted, backdrop gone, page showing through. The waiver priority
 * card shipped exactly that on the AFL free-agents page (Sep 2026): closing it
 * left a 12-row panel over the table.
 *
 * Layout belongs on `.x[open]` (or on an inner wrapper). This scans every
 * <dialog> in the shared components, finds the rule for its class in the
 * component's own <style> and in src/styles, and fails on an unguarded
 * `display`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const componentDir = 'src/components/shared';
const stylesDir = 'src/styles';

/** Every `<dialog … class="x">` in the shared components, with its class. */
function nativeDialogs(): { file: string; cls: string }[] {
  const out: { file: string; cls: string }[] = [];
  for (const name of readdirSync(join(root, componentDir))) {
    if (!name.endsWith('.astro')) continue;
    const file = `${componentDir}/${name}`;
    const src = read(file);
    for (const m of src.matchAll(/<dialog\b[^>]*\bclass="([^"]+)"/g)) {
      const cls = m[1].split(/\s+/)[0];
      if (cls) out.push({ file, cls });
    }
  }
  return out;
}

/** The CSS that can reach a component's dialog: its own <style> blocks and src/styles. */
function cssFor(file: string): string {
  const own = [...read(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const shared = readdirSync(join(root, stylesDir))
    .filter((n) => n.endsWith('.css'))
    .map((n) => read(`${stylesDir}/${n}`))
    .join('\n');
  return stripComments(`${own}\n${shared}`);
}

/** Declaration blocks whose selector list contains the BARE class (no [open], no descendant). */
function bareRuleBodies(css: string, cls: string): string[] {
  const bodies: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    const bare = selectors.some((sel) => sel === `.${cls}` || sel === `dialog.${cls}`);
    if (bare) bodies.push(m[2]);
  }
  return bodies;
}

describe('native <dialog> elements never set display on their bare selector', () => {
  const dialogs = nativeDialogs();

  it('finds the shared dialogs (the scan is not vacuous)', () => {
    expect(dialogs.map((d) => d.cls)).toEqual(expect.arrayContaining(['wpm', 'wcm', 'sim']));
  });

  for (const { file, cls } of dialogs) {
    it(`${file} — .${cls} carries no display (layout goes on .${cls}[open])`, () => {
      const offending = bareRuleBodies(cssFor(file), cls).filter((body) => /(^|[\s;])display\s*:/.test(body));
      expect(offending, `.${cls} sets display; a closed <dialog> would stay painted`).toEqual([]);
    });
  }

  it('the waiver priority card keeps its column layout on the open state', () => {
    const css = stripComments(read('src/styles/waiver-priority-modal.css'));
    expect(css).toMatch(/\.wpm\[open\]\s*\{[^}]*display:\s*flex/);
  });
});
