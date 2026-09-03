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
 * That is not theoretical, and it has now shipped three times:
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
 * - The Waiver Priority modal (2026-09-03) shipped its shell correctly styled
 *   and its team list as unstyled 50px icons: the shell is in the component's
 *   template and got the scope attribute, the rows are built by its own script
 *   and did not. Same component, same `<style>` block, opposite outcomes.
 *
 * The fix for the second one is why the rules now live in
 * src/styles/fa-claim-button.css, imported from both pages' frontmatter, and
 * the fix for the third is src/styles/waiver-priority-modal.css: a plain `.css`
 * import is global, and one copy cannot be missing from a page that needs it.
 * Nothing here fails at build time — it just looks wrong, and only in the
 * rendered page — so these assertions are the whole safety net.
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
  /** In the component's own markup, so scoping them would be fine — but they
   *  live in the same stylesheet, and a missing rule is still a broken control. */
  const STATIC = ['wcp__toggle', 'wcp__head-right'];

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
    for (const cls of [...INJECTED, ...STATIC]) {
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

/**
 * The same rule, for a COMPONENT that builds its own rows.
 *
 * WaiverPriorityModal renders a shell (header, close button, sign-in gate) from
 * its template and a ranked team list from its client script. A scoped `<style>`
 * would style the first and silently skip the second — which is exactly how it
 * shipped the first time. The whole stylesheet therefore lives outside the
 * component, and the component must keep no `<style>` block at all: a partial
 * one is the state that looks correct in review and wrong in the browser.
 */
describe('WaiverPriorityModal — injected-row styles', () => {
  const COMPONENT = 'src/components/shared/WaiverPriorityModal.astro';
  const MODAL_STYLESHEET = 'src/styles/waiver-priority-modal.css';
  const source = read(COMPONENT);
  const css = read(MODAL_STYLESHEET);

  it('keeps no <style> block — its rows are script-built and would not be reached', () => {
    expect(
      source.includes('<style'),
      `${COMPONENT} must not carry a <style> block. Its list rows are injected via ` +
        `innerHTML and carry no scope attribute, so a scoped rule silently does nothing. ` +
        `Put every rule in ${MODAL_STYLESHEET}.`
    ).toBe(false);
  });

  it('imports the stylesheet from FRONTMATTER, where it stays global', () => {
    const frontmatter = source.slice(0, source.indexOf('\n---', 3));
    expect(frontmatter, `${COMPONENT} must import ${MODAL_STYLESHEET}`).toContain(
      'styles/waiver-priority-modal.css'
    );
  });

  it('defines every class the script actually emits', () => {
    // Read the class names out of the row template rather than listing them
    // here, so a new class added to the builder cannot ship unstyled.
    const emitted = new Set(
      [...source.matchAll(/class="(wpm-[a-z0-9_ -]+)"/g)]
        .flatMap((m) => m[1].split(/\s+/))
        .filter(Boolean)
    );
    // The `--me` state class is applied conditionally, so it is not in a static
    // class="" attribute; assert it explicitly.
    emitted.add('wpm-row--me');
    const missing = [...emitted].filter((cls) => !css.includes(`.${cls}`));
    expect(missing, `Classes emitted by ${COMPONENT} with no rule in ${MODAL_STYLESHEET}`).toEqual([]);
  });

  it('the trigger lives in the host page, so its rule must be here too', () => {
    // `.wpm-trigger` is rendered by afl-fantasy/players.astro, not by the
    // component — a scoped rule could never have reached it either.
    expect(css).toContain('.wpm-trigger');
    expect(read('src/pages/afl-fantasy/players.astro')).toContain('wpm-trigger');
  });
});

/**
 * The waiver claims panel is a CARD, so it must not be rendered inside another
 * one.
 *
 * `.wcp` brings its own border, radius, background and bottom margin.
 * `.table-wrapper` is also a card — a radius plus, in dark mode, a 1px ring.
 * TheLeague nested the panel inside the wrapper, which drew a rounded bordered
 * box inside a rounded ringed box with the Bid Status legend's divider running
 * between them (reported 2026-09-03). The AFL never had it, because the AFL
 * never nested it: this was pure sibling drift between two near-identical pages,
 * which is the recurring bug class `tests/page-fork-ratchet.test.ts` exists for.
 *
 * The legend is the counter-example and belongs where it is: it is a strip
 * attached to the table's own header, styled with a `border-bottom` rather than
 * a box. Attached-to-the-table and standalone-card are different jobs.
 */
describe('waiver claims panel placement', () => {
  const PLAYERS_PAGES = [
    'src/pages/theleague/players.astro',
    'src/pages/afl-fantasy/players.astro',
  ];

  for (const page of PLAYERS_PAGES) {
    it(`${page}: renders the panel outside .table-wrapper`, () => {
      const html = read(page);
      const panel = html.indexOf('<WaiverClaimsPanel');
      expect(panel, `${page} does not render WaiverClaimsPanel`).toBeGreaterThan(-1);

      const wrapperOpen = html.indexOf('<div class="table-wrapper">');
      expect(wrapperOpen, `${page} has no .table-wrapper`).toBeGreaterThan(-1);

      // The panel must come BEFORE the table card opens. Both pages render one
      // table-wrapper, so "before the opening tag" is the whole test — no need
      // to balance tags to find where it closes.
      expect(
        panel,
        `${page} renders WaiverClaimsPanel inside .table-wrapper — it is a card with its own border and radius, so it draws a box inside a box`
      ).toBeLessThan(wrapperOpen);
    });
  }

  it('keeps the Bid Status legend INSIDE the table card, where it belongs', () => {
    // Guards the over-correction: the legend is not a card and moving it out
    // would detach a header strip from its table.
    const html = read('src/pages/theleague/players.astro');
    const wrapperOpen = html.indexOf('<div class="table-wrapper">');
    expect(html.indexOf('class="bid-legend"')).toBeGreaterThan(wrapperOpen);
  });
});
