import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The TYPED module, not leagues-data.mjs: `LeagueDefinition` declares
// `bestBall?: boolean`, where the .mjs infers its element type from the object
// literal — and the leagues WITHOUT the flag then have "no properties in
// common" with a `{ bestBall?: boolean }` annotation, which is a weak-type
// error rather than the assertion anyone meant. This is also the exact module
// the layout reads, so the test sees what it sees.
import { ALL_LEAGUES } from '../src/config/leagues';

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

  it('registers its DOCUMENT listeners once per session, not once per navigation', () => {
    // `document` is never replaced by the router, but the hamburger IS — so a
    // `dataset` flag on the button cannot guard a document listener. Bound
    // inside init, `keydown` accumulated one listener per navigation, each
    // closed over a detached panel; the stale one fires first, strips the open
    // class off the live <html>, and leaves the real hamburger announcing
    // aria-expanded="true" with the drawer shut.
    const initBody = script.slice(
      script.indexOf('function initMflMenu()'),
      script.indexOf('document.addEventListener(\'keydown\''),
    );
    expect(initBody).not.toContain('document.addEventListener');
    // …and exactly one keydown registration exists in the whole script.
    expect(script.match(/document\.addEventListener\('keydown'/g) ?? []).toHaveLength(1);
  });

  it('re-queries the live nodes instead of closing over the swapped ones', () => {
    // A document listener that survives the swap must not hold the panel or
    // button it saw at registration time.
    expect(script).toMatch(/function panelEl\(\)/);
    expect(script).toMatch(/function buttonEl\(\)/);
    expect(script).toMatch(/function onKeydown\(event\)[\s\S]{0,400}panelEl\(\)/);
  });

  it('does not restore focus to <body>', () => {
    // Safari does not focus a <button> on click, so activeElement is <body> —
    // which passes document.contains() and is not focusable, so the fallback
    // to the hamburger never engages and focus is silently lost.
    expect(script).toMatch(/active !== document\.body/);
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

describe('the league links skip draft-only leagues', () => {
  const layout = read(LAYOUT);

  it('filters on the registry flag, never on a slug literal', () => {
    // Same derivation as BOTH_LEAGUES in weekly-changelog-format.mjs, so a
    // new best-ball league drops out of this menu without anyone editing it.
    expect(layout).toMatch(/ALL_LEAGUES\.filter\(\(league\) => !league\.bestBall\)/);
    // Comments stripped: the rule is cited by name in the prose above the
    // filter, and a doc reference is not a hardcoded league constant.
    const code = layout
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/best-ball-\d/);
  });

  it('leaves at least one league to link, and no best-ball one', () => {
    // Guards both directions: a filter that matched everything would empty
    // the menu silently, and the whole point is that draft-only leagues go.
    const linked = ALL_LEAGUES.filter((l) => !l.bestBall);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.some((l) => l.bestBall)).toBe(false);
    expect(ALL_LEAGUES.length).toBeGreaterThan(linked.length);
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

  it('suppresses the OPEN animation too under prefers-reduced-motion', () => {
    // A media query adds no specificity, so a bare `.mfl-menu__panel` inside it
    // loses to the `html.mfl-menu-open .mfl-menu__panel` open-state rule — and
    // reduced-motion users still got the full slide-IN, which is the direction
    // that actually plays on a tap.
    const rm = menu.slice(menu.indexOf('@media (prefers-reduced-motion'));
    const block = rm.slice(0, rm.indexOf('\n\t}') + 3);
    expect(block).toMatch(/html\.mfl-menu-open\) \.mfl-menu__panel/);
    expect(block).toMatch(/html\.mfl-menu-open\) \.mfl-menu__backdrop/);
  });
});
