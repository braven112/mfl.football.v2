import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const MENU = 'src/components/shared/mfl-live/MflAppMenu.astro';
const LAYOUT = 'src/layouts/MflAppLayout.astro';

/**
 * MFL Live's shell: a bar with two things in it, and one drawer behind the
 * hamburger.
 *
 * The bar used to carry every destination inline — both league links, a
 * settings gear, the theme toggle, sign in/out — and drop the league links
 * entirely below 640px, so the phone this app is FOR was the device that lost
 * navigation. Everything now lives in `MflAppMenu`, and the checks below are
 * each a thing that was measured wrong in a browser before it was fixed.
 */
describe('the bar holds the brand and the menu, nothing else', () => {
  const layout = read(LAYOUT);

  it('mounts MflAppMenu', () => {
    expect(layout).toContain('<MflAppMenu');
  });

  it('grows no second nav in the header', () => {
    // A `<nav>` in the bar is the old shape coming back: the menu is the one
    // place a destination goes, or the bar starts competing for width again.
    const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
    expect(header).not.toMatch(/<nav\b/);
  });

  it('routes the theme control and sign-in through the menu, not the bar', () => {
    const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
    expect(header).not.toContain('<ThemeToggle');
    expect(header).not.toMatch(/href=\{mflLoginUrl/);
  });

  it('hides the menu behind no breakpoint', () => {
    // One menu at every width. A `display: none` on the button in a media
    // query is the mobile-only pattern this deliberately is not.
    const menu = read(MENU);
    const mediaBlocks = menu.match(/@media[^{]+\{[\s\S]*?\n\t\}/g) ?? [];
    for (const block of mediaBlocks) {
      expect(block, `a media query hides the hamburger:\n${block}`).not.toMatch(
        /\.mfl-menu__button[\s\S]*display:\s*none/,
      );
    }
  });
});

describe('the drawer survives the ClientRouter', () => {
  const menu = read(MENU);
  /** The script block alone, comments stripped — the prose names what the code must not do. */
  const script = menu
    .slice(menu.indexOf('<script is:inline>'), menu.indexOf('</script>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('initialises on astro:page-load, never on DOMContentLoaded', () => {
    // MflAppLayout mounts <ClientRouter />, so a bundled script evaluates once
    // per browser SESSION while the DOM is swapped underneath it.
    expect(script).toContain("addEventListener('astro:page-load'");
    expect(script).not.toContain('DOMContentLoaded');
  });

  it('guards against stacking a second listener on a button that survived a swap', () => {
    expect(menu).toMatch(/dataset\.menuBound/);
  });

  it('clears the open state before every swap', () => {
    // The open class lives on <html>, which the router does NOT replace. Left
    // set, the next page is scroll-locked under a drawer that is not there.
    const swap = menu.slice(menu.indexOf("astro:before-swap"));
    expect(swap).toContain("classList.remove('mfl-menu-open')");
    expect(swap).toMatch(/inert = false/);
  });

  it('closes itself when a link is followed', () => {
    // A link to the page you are already on fires no navigation at all, so
    // without this the drawer sits open over the board it just "went" to.
    expect(menu).toMatch(/closest\('a\[href\]'\)[\s\S]{0,120}close\(/);
  });
});

describe('the drawer is reachable, trappable and dismissable', () => {
  const menu = read(MENU);

  it('the hamburger reports its state to assistive tech', () => {
    expect(menu).toContain('aria-expanded="false"');
    expect(menu).toContain('aria-controls="mfl-menu-panel"');
    expect(menu).toMatch(/setAttribute\('aria-expanded', 'true'\)/);
    expect(menu).toMatch(/setAttribute\('aria-expanded', 'false'\)/);
  });

  it('closes on Escape and on a backdrop click', () => {
    expect(menu).toMatch(/event\.key === 'Escape'/);
    expect(menu).toMatch(/backdrop\.addEventListener\('click'/);
  });

  it('takes the board out of reach while open, and gives it back on close', () => {
    expect(menu).toMatch(/main\.inert = true/);
    expect(menu).toMatch(/main\.inert = false/);
  });

  it('filters the focus trap on VISIBILITY, not on client rects alone', () => {
    // A `visibility: hidden` element still reports client rects. Rects alone
    // would count a closed drawer's ten links as focusable.
    const trap = menu.slice(menu.indexOf('querySelectorAll(FOCUSABLE)'));
    expect(trap).toMatch(/getComputedStyle\(el\)\.visibility !== 'hidden'/);
  });

  it('excludes roving tabindex="-1" controls from the trap', () => {
    // The theme toggle is an ARIA radiogroup: two of its three buttons carry
    // tabindex="-1" and are never tabbable. Counted, they make items[last] an
    // element Tab skips, the wrap never fires, and focus leaves the drawer.
    // A `button:not([disabled])` SELECTOR does not exclude them — the filter
    // has to.
    const trap = menu.slice(menu.indexOf('querySelectorAll(FOCUSABLE)'));
    expect(trap).toMatch(/getAttribute\('tabindex'\) !== '-1'/);
    expect(trap).toMatch(/!el\.disabled/);
  });
});

describe('the panel stylesheet carries two fixes that look like style', () => {
  const menu = read(MENU);
  // Comments stripped first: this block's own commentary explains each fix by
  // naming the declaration it replaced, and prose is not a declaration.
  const panel = menu
    .slice(menu.indexOf('.mfl-menu__panel {'), menu.indexOf('@media (prefers-reduced-motion'))
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('steps visibility with a 0s transition, so focus can land on open', () => {
    // `visibility 200ms ease` looks equivalent and is not: visibility
    // interpolates discretely and stays `hidden` for the first instant of the
    // open transition. `.focus()` on a still-invisible element is a silent
    // no-op, and the drawer opens with focus stranded on the hamburger — one
    // Tab from the page behind it. Measured in a browser, not theorised.
    expect(panel).toMatch(/visibility 0s linear 200ms/);
    expect(panel).toMatch(/visibility 0s linear 0s/);
    expect(panel).not.toMatch(/visibility \d+ms ease/);
  });

  it('is border-box, so the safe-area padding fits INSIDE 100dvh', () => {
    // content-box makes the panel `100dvh + inset-top + inset-bottom` tall on
    // a notched phone — taller than the screen — and the footer holding Sign
    // out sits below the fold with nothing to scroll. This app installs to a
    // home screen; that phone is the target device.
    expect(panel).toMatch(/height: 100dvh/);
    expect(panel).toMatch(/box-sizing: border-box/);
  });

  it('keeps the closed panel out of the tab order with visibility, not opacity', () => {
    expect(panel).toMatch(/visibility: hidden/);
  });
});
