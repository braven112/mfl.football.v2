/**
 * Styles for dynamically-injected table rows must be reachable, and they must
 * exist for EVERY page that emits the classes.
 *
 * Both players pages render their rows by assigning `innerHTML` from the client
 * script. Astro's scoped styles compile to attribute selectors keyed on a
 * `data-astro-cid-*` attribute that is only stamped onto elements present in
 * the template at BUILD time — so a scoped rule targeting an injected element
 * matches nothing and silently does nothing.
 *
 * That is not theoretical, and it has now shipped twice:
 *
 * - TheLeague's waiver Bid button rendered as a washed-out grey pill because
 *   `button.place-bid-link { background: none }` was scoped. Only the browser's
 *   default button styling applied, painting `buttonface` behind the text.
 * - The AFL's Claim button rendered as raw browser chrome — measured live on
 *   2026-09-02 as `background: rgb(107,107,107)`, `border: 2px outset white`,
 *   `border-radius: 0`, `font-family: Arial` — because `afl-fantasy/players`
 *   emitted `class="place-bid-link claim-open"` while EVERY rule for it lived
 *   inside `theleague/players.astro`'s scoped `<style>`.
 *
 * The fix for the second one is why the rules now live in
 * src/styles/fa-claim-button.css, imported from both pages' frontmatter: a
 * plain `.css` import is global, and one copy cannot be missing from a page
 * that needs it. Nothing here fails at build time — it just looks wrong, and
 * only in the rendered page — so these assertions are the whole safety net.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

const STYLESHEET = 'src/styles/fa-claim-button.css';
/** Every page that injects rows carrying the pill classes. */
const PAGES = ['src/pages/theleague/players.astro', 'src/pages/afl-fantasy/players.astro'];

/** The <style> block is everything from the first <style to the last </style>. */
const styleBlockOf = (source: string) =>
  source.slice(source.indexOf('<style'), source.lastIndexOf('</style>'));

/**
 * Classes that only ever appear on injected rows. A rule for one of these must
 * be global, or it does nothing.
 */
const INJECTED_ROW_CLASSES = ['place-bid-link', 'claim-open', 'col-fa-action'];

describe.each(PAGES)('%s — injected-row styles', (page) => {
  const source = read(page);
  const styleBlock = styleBlockOf(source);

  for (const cls of INJECTED_ROW_CLASSES) {
    it(`every rule for .${cls} left in the page is :global()`, () => {
      // Selector lines mentioning the class, minus comment lines.
      const offenders = styleBlock
        .split('\n')
        .filter((line) => line.includes(`.${cls}`) && line.includes('{'))
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
        .filter((line) => !line.includes(':global('));
      expect(
        offenders,
        `Scoped rules for .${cls} never match — the rows are injected via innerHTML, ` +
          `so they carry no scope attribute. Move these to ${STYLESHEET}:\n  ` +
          offenders.join('\n  ')
      ).toEqual([]);
    });
  }

  it('imports the shared pill stylesheet from FRONTMATTER, where it stays global', () => {
    expect(source, `${page} emits .place-bid-link`).toContain('place-bid-link');
    const frontmatter = source.slice(0, source.indexOf('\n---', 3));
    expect(frontmatter, `${page} must import ${STYLESHEET}`).toContain('styles/fa-claim-button.css');
  });

  it('keeps no second copy of the pill rules — that is how the two drift apart', () => {
    // Anchored to a rule OPENING. A looser pattern matches the class name
    // inside the row templates and the pointer comments, neither of which is a
    // redefinition.
    expect(source, `${page} redefines .place-bid-link`).not.toMatch(
      /^\s*(:global\(\s*(button)?\.place-bid-link|\.place-bid-link)[^\n]*\{/m
    );
  });
});

describe('the shared free-agent action pill', () => {
  const css = read(STYLESHEET);

  it('defines the pill, the <button> reset, the focus ring and the column', () => {
    for (const selector of [
      '.place-bid-link',
      '.place-bid-link:hover',
      'button.place-bid-link',
      'button.place-bid-link:focus-visible',
      '.col-fa-action',
    ]) {
      expect(css).toContain(`${selector} {`);
    }
  });

  it('the <button> reset does not remove the pill itself', () => {
    // Border, padding, colour and radius all come from .place-bid-link and are
    // deliberately not re-declared, so the button and the anchors cannot drift.
    const rule = /\bbutton\.place-bid-link\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'expected a button.place-bid-link rule').not.toBeNull();
    expect(rule![1]).not.toMatch(/\bborder\s*:/);
    expect(rule![1]).not.toMatch(/\bpadding\s*:/);
    // But it MUST kill the UA button background, which is what washed it out.
    expect(rule![1]).toMatch(/background\s*:\s*none/);
  });

  it('takes its colour from --league-accent, so each league gets its own', () => {
    expect(css).toContain('--league-accent');
    // tokens.css sets --league-accent to var(--color-primary) for TheLeague and
    // overrides it per league, with dark values in tokens-dark.css. A literal
    // here would paint one league's colour on every league, in both themes.
    expect(css).not.toMatch(/#1c497c\s*;/);
  });

  it('the Bid/Claim buttons reuse the pill class so they cannot drift from the anchors', () => {
    for (const page of PAGES) {
      expect(read(page)).toMatch(/class="place-bid-link claim-open"/);
    }
  });
});

/**
 * The panel that lists FILED claims renders its rows with `innerHTML` too, so it
 * has exactly the same exposure — and it shipped with exactly the same bug in
 * its first draft: the rank badge computed to `background: rgba(0,0,0,0)` and
 * rows collapsed to 28px, because every rule for the injected markup sat in the
 * component's SCOPED `<style>` block and matched nothing.
 *
 * Third occurrence of this trap in one feature. Guard it by class.
 */
describe('WaiverClaimsPanel — injected-row styles', () => {
  const COMPONENT = 'src/components/shared/WaiverClaimsPanel.astro';
  const PANEL_CSS = 'src/styles/waiver-claims-panel.css';
  /** Classes that only ever exist on markup the client script injects. */
  const INJECTED = ['wcp__item', 'wcp__rank', 'wcp__who', 'wcp__name', 'wcp__meta', 'wcp__drop', 'wcp__actions', 'wcp__btn'];

  it('keeps injected-row rules OUT of the component\'s scoped style block', () => {
    const src = read(COMPONENT);
    const scoped = src.match(/\n<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const leaked = INJECTED.filter((cls) => scoped.includes(`.${cls}`));
    expect(
      leaked,
      `${COMPONENT} styles injected markup from a scoped <style> block, where it ` +
        `matches nothing (no data-astro-cid). Move these to ${PANEL_CSS}:\n  ` +
        leaked.join('\n  ')
    ).toEqual([]);
  });

  it('imports the stylesheet from frontmatter, where it lands globally', () => {
    const frontmatter = read(COMPONENT).split('---')[1] ?? '';
    expect(frontmatter, `${COMPONENT} must import ${PANEL_CSS}`).toContain('styles/waiver-claims-panel.css');
  });

  it('actually styles every injected class', () => {
    const css = read(PANEL_CSS);
    for (const cls of INJECTED) {
      expect(css, `${PANEL_CSS} has no rule for .${cls}`).toContain(`.${cls}`);
    }
  });

  it('colours from the league token, never a literal', () => {
    // One stylesheet serves both leagues; a hardcoded hex paints one league's
    // colour on the other.
    const css = read(PANEL_CSS);
    expect(css).toContain('--league-accent');
    expect(css, 'a literal accent would paint both leagues the same').not.toMatch(/background:\s*#[0-9a-f]{6}\s*;/i);
  });
});
