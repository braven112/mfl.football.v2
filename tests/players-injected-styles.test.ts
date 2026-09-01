/**
 * Styles for dynamically-injected table rows must be `:global()`.
 *
 * players.astro renders its player rows by assigning `innerHTML` from the
 * client script. Astro's scoped styles compile to attribute selectors keyed on
 * a `data-astro-cid-*` attribute that is only stamped onto elements present in
 * the template at BUILD time — so a scoped rule targeting an injected element
 * matches nothing and silently does nothing.
 *
 * That is not theoretical: the waiver Bid button shipped as a washed-out grey
 * pill because `button.place-bid-link { background: none }` was scoped. Only
 * the browser's default button styling applied, painting `buttonface` behind
 * the text. Nothing failed — it just looked wrong, and only in the rendered
 * page.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/theleague/players.astro'),
  'utf-8'
);

/** The <style> block is everything from the first <style to the last </style>. */
const styleBlock = SOURCE.slice(SOURCE.indexOf('<style'), SOURCE.lastIndexOf('</style>'));

/**
 * Classes that only ever appear on injected rows. A rule for one of these must
 * be global, or it does nothing.
 */
const INJECTED_ROW_CLASSES = ['place-bid-link', 'claim-open', 'col-fa-action'];

describe('players.astro — injected-row styles', () => {
  for (const cls of INJECTED_ROW_CLASSES) {
    it(`every rule for .${cls} is :global()`, () => {
      // Selector lines mentioning the class, minus comment lines.
      const offenders = styleBlock
        .split('\n')
        .filter((line) => line.includes(`.${cls}`) && line.includes('{'))
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
        .filter((line) => !line.includes(':global('));
      expect(
        offenders,
        `Scoped rules for .${cls} never match — the rows are injected via innerHTML, ` +
          `so they carry no scope attribute. Wrap these in :global(...):\n  ` +
          offenders.join('\n  ')
      ).toEqual([]);
    });
  }

  it('the Bid button reuses the existing pill class so it cannot drift from the anchors', () => {
    expect(SOURCE).toMatch(/class="place-bid-link claim-open"/);
    // The reset must not remove the pill itself — border, padding, colour and
    // radius all come from .place-bid-link and are deliberately not re-declared.
    const rule = /:global\(button\.place-bid-link\)\s*\{([^}]*)\}/.exec(styleBlock);
    expect(rule, 'expected a :global(button.place-bid-link) rule').not.toBeNull();
    expect(rule![1]).not.toMatch(/\bborder\s*:/);
    expect(rule![1]).not.toMatch(/\bpadding\s*:/);
    // But it MUST kill the UA button background, which is what washed it out.
    expect(rule![1]).toMatch(/background\s*:\s*none/);
  });

  it('keeps a visible focus ring on the Bid button', () => {
    expect(styleBlock).toMatch(/:global\(button\.place-bid-link:focus-visible\)/);
  });
});
