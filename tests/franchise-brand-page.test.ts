/**
 * The franchise Brand Book page's load-bearing rules.
 *
 * Every assertion here is a bug that the NFL half of this page already had to
 * learn, transposed onto the franchise half — which is exactly why they are
 * pinned rather than trusted to survive the next edit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allFranchiseBrands,
  franchiseBrand,
  bandSlot,
  inkOn,
  sameIdentity,
} from '../src/utils/franchise-marks';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = read('src/components/shared/brand/FranchiseBrandPage.astro');
const INDEX = read('src/components/shared/brand/BrandPage.astro');
const CSS = read('src/styles/brand-book.css');

describe('FranchiseBrandPage — ONE template with the club page', () => {
  /**
   * The franchise half was briefly a parallel set of `bb__` classes and rules,
   * and the parallel set re-shipped a bug the club template had already fixed:
   * the layout's global `:global(h1),:global(h2) { color: … }` BEATS an
   * inherited colour, so the hero heading rendered in the site's accent blue on
   * top of a red hero. One template means that fix exists once.
   */
  it('renders through the club page\'s classes, not a parallel set', () => {
    for (const src of [PAGE, INDEX]) {
      expect(src).not.toMatch(/\bbb__/);
    }
    expect(PAGE).toContain('class="cb"');
    expect(PAGE).toContain('cb__nick');
    expect(PAGE).toContain('cb__h2');
    // The index's franchise tiles are the NFL tiles.
    expect(INDEX).toContain('class="brand__tile"');
  });

  it('draws its colour swatches with the club page\'s grid', () => {
    // The franchise half briefly had a taller card of its own — swatch, label,
    // note and a button each. Same grid now: a swatch over its hex, with the
    // hex itself as the copy target so the row keeps the club page's shape
    // rather than growing a control beside every colour.
    const CLUB = read('src/components/shared/brand/ClubBrandPage.astro');
    for (const src of [PAGE, CLUB]) {
      expect(src).toContain('class="cb__swatches"');
      expect(src).toContain('class="cb__swatch"');
    }
    // The one line a franchise needs and a club does not: the ROLE, because
    // these hexes each mean something different to the site and "Chart hue" is
    // the one nothing may treat as brand identity.
    expect(PAGE).toContain('cb__swatch-role');
    expect(CLUB).not.toContain('cb__swatch-role');
    // The hex stays copyable, and styled as the club page's bare <code>.
    expect(PAGE).toContain('cb-copy--hex');
    expect(CSS).toMatch(/\.cb-copy--hex \{[\s\S]{0,200}?border: 0;/);
  });

  it('keeps the themed-heading fix in exactly one place', () => {
    // `color: inherit` is what beats the layout's global h1 rule. If it ever
    // leaves the sheet, every hero heading on both halves goes accent blue.
    expect(CSS).toMatch(/\.cb__nick \{[\s\S]{0,400}?color: inherit;/);
    // And the h2 is a small uppercase eyebrow, so it never has that fight.
    expect(CSS).toMatch(/\.cb__h2 \{[\s\S]{0,400}?text-transform: uppercase;/);
  });

  it('is the only stylesheet either half imports', () => {
    for (const src of [PAGE, INDEX, read('src/components/shared/brand/ClubBrandPage.astro')]) {
      expect(src).toContain("styles/brand-book.css");
    }
    // The club page's scoped block is gone — two copies is how they drift.
    expect(read('src/components/shared/brand/ClubBrandPage.astro')).not.toMatch(/^<style>/m);
  });
});

describe('FranchiseBrandPage — the dark-swap opt-out', () => {
  /**
   * `buildTeamIconDarkCss` emits `html.dark img[src="<light>"] { content:
   * url(<dark cut>) }` for every franchise shipping an `iconDark`. On any other
   * page that is the point; on a page whose subject is the side-by-side
   * comparison it renders one mark twice for a dark-mode reader.
   */
  it('opts every ground-declaring surface out of the swap', () => {
    // In the SHARED sheet, not a scoped block — it is the same rule for both
    // halves, and two copies of a rule whose failure is invisible in light
    // mode is exactly how they drift apart.
    for (const sel of [
      '.cb__hero img',
      '.cb__film img',
      '.cb__grounds img',
      '.cb__eras img',
      '.cb__situ .cb__pane.is-light img',
      '.cb__situ .cb__pane.is-dark img',
    ]) {
      expect(CSS, sel).toContain(`html.dark ${sel}`);
    }
    expect(CSS).toMatch(/content: normal !important/);
    expect(PAGE).toContain('styles/brand-book.css');
  });

  it('opts the index tiles out too', () => {
    // Each tile paints the franchise's own colour and must look the same in
    // both themes; without this the dark-mode reader sees a different cut.
    expect(INDEX).toContain('html.dark :global(.brand__art img)');
    expect(INDEX).toMatch(/content: normal !important/);
  });

  it('resets the ring on LIGHT grounds only, never across the board', () => {
    /**
     * A blanket `filter: none` also killed `--nfl-logo-ring`, which
     * `nfl-logo-dark-css.ts` emits TWICE — once guarded by `html.dark`, and
     * once with no guard at all for the dark cuts of stroked clubs. Resetting
     * the unguarded rule inside an `html.dark` block gave Carolina a ring in
     * light mode and none in dark, which is the exact theme dependency this
     * opt-out exists to remove.
     */
    const ringReset = CSS.slice(CSS.indexOf('The RING reset'));
    for (const sel of [
      '.cb__cut-box.is-light img',
      '.cb__ground.is-light .cb__ground-art img',
      '.cb__situ .cb__pane.is-light img',
    ]) {
      expect(ringReset, sel).toContain(`html.dark ${sel}`);
    }
    // A dark or band ground WANTS its ring and is left alone.
    expect(ringReset).not.toMatch(/html\.dark \.cb__hero img[^{]*\{[^}]*filter: none/);
    // The index resets no filter at all — every tile there is a club colour.
    expect(INDEX).not.toMatch(/filter: none !important/);
    // `revert-layer` cannot restore an inline style: the style attribute is
    // not a cascade layer, so it rolls back to the UA value `none`.
    expect(CSS).not.toMatch(/^\s*filter: revert-layer/m);
    expect(INDEX).not.toMatch(/^\s*filter: revert-layer/m);
  });

  it('puts the band demo inside the swap opt-out', () => {
    // Without a ground class it matched neither opt-out selector. Five
    // franchises have a LIGHT band slot plus an `iconDark`, so their band demo
    // silently changed cut in dark mode.
    expect(PAGE).toContain('class="cb__pane is-band"');
    expect(CSS).toContain('html.dark .cb__situ .cb__pane.is-band img');
  });

  it('prints the franchise name WHOLE in the page heading', () => {
    // An NFL club name IS "City Nick", so the club page splits it and the
    // heading still identifies the club. A franchise name is not: splitting it
    // left headings reading "Chaos", "Walking", "Pain" and "Me".
    expect(PAGE).toMatch(/<h1 class="cb__nick cb__nick--franchise">\{brand\.name\}<\/h1>/);
  });

  it('uses a visually-hidden class that actually exists', () => {
    // A live region styled by a class defined nowhere renders as visible body
    // text reading "Copied https://…".
    expect(PAGE).toContain('class="visually-hidden" id="cb-copy-status"');
    expect(PAGE).not.toContain('class="sr-only"');
    const utilities = read('src/styles/utilities.css');
    expect(utilities).toMatch(/\.visually-hidden\s*\{/);
  });

  it('never tells a measured-illegible crest that it measured legible', () => {
    // `iconStrokeDark: false` is a human's opt-OUT and outranks the
    // measurement, so a franchise can be measured illegible and wear no ring.
    // Copy keyed on `ringed` alone said the opposite of the manifest.
    const dm = franchiseBrand('theleague', '0015');
    expect(dm?.measuredIllegible).toBe(true);
    expect(dm?.ringed).toBe(false);
    expect(PAGE).toContain('brand.measuredIllegible');
  });

  it('does not opt the whole page out', () => {
    // Scoped to the surfaces that DECLARE a ground. A page-wide opt-out would
    // freeze anything else on the page onto light artwork against a dark card
    // — the exact bug the swap exists to prevent.
    // Scoped to the surfaces that DECLARE a ground, never `img` wholesale: a
    // page-wide opt-out would freeze everything else onto light artwork
    // against a dark card, the exact bug the swap exists to prevent.
    expect(CSS).not.toMatch(/html\.dark img \{/);
    expect(CSS).not.toMatch(/^html\.dark \.cb img \{\s*\n\s*content/m);
    // And the franchise page keeps no scoped block of its own to drift with.
    expect(PAGE).not.toMatch(/^<style>/m);
  });
});

describe('FranchiseBrandPage — client script lifecycle', () => {
  /**
   * `document` is one of the two nodes the ClientRouter does not replace, so a
   * listener registered on it survives every navigation. An init that does not
   * hold and replace its registration stacks a second copy on every arrival.
   */
  it('registers on document exactly once, replacing any prior handler', () => {
    expect(PAGE).toMatch(/window\.__brandBookCopy/);
    expect(PAGE).toMatch(/document\.removeEventListener\('click', window\.__brandBookCopy\)/);
    expect(PAGE).toMatch(/document\.addEventListener\('click', onClick\)/);
  });

  it('gates on a node the swap replaced, never a window global', () => {
    // The Sept 2026 lineup outage was a gate on a `window` global: it survived
    // the swap, so the departing page's listener ran on the arriving page.
    expect(PAGE).toMatch(/document\.querySelector\('\.cb'\)/);
  });

  it('falls back off the clipboard API rather than failing silently on http', () => {
    expect(PAGE).toMatch(/isSecureContext/);
    expect(PAGE).toMatch(/execCommand\('copy'\)/);
  });
});

describe('FranchiseBrandPage — what it renders', () => {
  it('renders the REAL components rather than lookalikes', () => {
    // A hand-rolled copy is a second implementation that drifts from the real
    // one silently, which is the opposite of what this section is for.
    expect(PAGE).toContain("import TeamIconCell from");
    expect(PAGE).toContain("import CompositeHero from");
    expect(PAGE).toContain('resolveHeroFranchiseBackdrop');
  });

  it('hands each pane the artwork its GROUND calls for', () => {
    // The page opts out of the swap, so a component left to derive its own src
    // would draw the same cut in both panes and the comparison would collapse.
    expect(PAGE).toMatch(/is-light[\s\S]{0,400}icon=\{light\?\.url\}/);
    expect(PAGE).toMatch(/is-dark[\s\S]{0,400}icon=\{dark\?\.url\}/);
  });

  it('takes the franchise gradient through the resolver, never hand-built', () => {
    // The resolver reads `broadcastGradient` verbatim when there is one, floors
    // the derived pair for white text when there is not, and clears the accent,
    // pill and CTA inks against the gradient that is ACTUALLY rendered.
    expect(PAGE).toMatch(/franchise=\{heroBackdrop\}/);
    expect(PAGE).not.toMatch(/linear-gradient\(115deg/);
  });

  it('links the searchable file list, which nothing else reaches', () => {
    expect(PAGE).toContain('/brand/files');
    expect(INDEX).toContain('/brand/files');
  });
});

describe('FranchiseBrandPage — tokens', () => {
  it('gives every token fallback in the shared sheet a literal', () => {
    // A `var(--x)` naming a property defined nowhere renders its fallback in
    // BOTH themes — light looks perfect, dark ships white-on-black.
    // Comments stripped first — this file's own doc block talks ABOUT
    // `var(--x)`, and a scanner that reads prose as code fails on the
    // explanation of the rule it is enforcing.
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const bare = [...code.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    // The locals each page sets inline are the only legitimate bare vars.
    const LOCALS = ['--chip', '--tile-bg', '--tile-ink', '--hero-bg', '--hero-ink', '--era-bg'];
    expect(bare.filter((v) => !LOCALS.includes(v))).toEqual([]);
  });

  it('paints the comparison grounds with literals, not theme tokens', () => {
    // A "light" pane drawn on `--card-bg` follows the viewer's theme and goes
    // near-black in dark mode, which is the comparison gone.
    expect(CSS).toMatch(/\.cb__cut-box\.is-light \{[\s\S]{0,200}?background: #f/i);
    expect(CSS).toMatch(/\.cb__dcell\.is-light \{[\s\S]{0,200}?background: #ffffff;/);
    expect(CSS).toMatch(/\.cb__dcell\.is-dark \{[\s\S]{0,200}?background: #262626;/);
  });
});

describe('franchise-marks — the data the page reads', () => {
  it('reads the band ground off the BRAND primary, not the chart hue', () => {
    // A surface that anchored on `color` opened a black-and-red franchise in
    // pink: the chart hue is picked for distinctness on a graph, not identity.
    const pigskins = franchiseBrand('theleague', '0001');
    expect(pigskins?.bandColor).toBe('#bd1f2b');
    expect(pigskins?.colors.find((c) => c.key === 'color')?.hex).toBe('#cc2936');
  });

  it('uses the same luminance threshold both halves of the page use', () => {
    expect(bandSlot('#181818')).toBe('dark');
    expect(bandSlot('#ffcd00')).toBe('light');
    expect(inkOn('#181818')).toBe('#ffffff');
    expect(inkOn('#ffcd00')).toBe('#10141a');
  });

  it('never claims a cut the config does not ship', () => {
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      for (const b of allFranchiseBrands(league)) {
        for (const m of b.marks) {
          expect(m.url, `${b.name} ${m.id}`).toMatch(/^(\/|https?:)/);
        }
        // `hasDarkCut` is what the page's copy keys on; it has to agree with
        // the mark list or the page tells the reader the opposite of the truth.
        const shipsDark = b.marks.some((m) => m.id === 'iconDark' || m.id === 'groupMeDark');
        expect(b.hasDarkCut, b.name).toBe(shipsDark);
      }
    }
  });

  it('carries the hero payload the resolvers read, not a rebuilt one', () => {
    // The crest ORDER (groupMeDark → iconDark → groupMe → icon) and the
    // `iconStrokeDark` opt-out live in the resolvers; a page reassembling the
    // object from the mark list would re-derive that order by hand.
    const b = franchiseBrand('theleague', '0001');
    expect(b?.heroTeam.icon).toBe('/assets/theleague/icons/pigskins.png');
    expect(b?.heroTeam.groupMeDark).toBe('/assets/theleague/group-me/pigskins_dark.png');
    expect(b?.heroTeam.broadcastGradient).toMatch(/^linear-gradient/);
  });

  it('files an era by whether it wore TODAY\'s name', () => {
    // An era that wore this name is an older cut of the SAME mark and belongs
    // beside the current ones under "Marks on file". An era that wore a
    // different name is a different club on the same slot and gets its own
    // section. Pacific Pigskins is the pure case: two eras, both its own name.
    const pigskins = franchiseBrand('theleague', '0001');
    expect(pigskins?.formerIdentities).toEqual([]);
    expect(pigskins?.past.length).toBe(4); // two eras × icon + banner
    expect(pigskins?.past.every((m) => m.era)).toBe(true);

    // And the mixed case: one era folded in, one kept separate.
    const mcm = allFranchiseBrands('theleague').find((b) => b.name.includes('Music City'));
    expect(mcm?.formerIdentities.map((e) => e.name)).toEqual(['LBer-DeCleaters']);
    expect(mcm?.past.length).toBeGreaterThan(0);
  });

  it('does not split a franchise from its own past over case or an article', () => {
    // The configs spell a franchise's own name inconsistently across history[].
    // A strict === files a team's own past under "former identities", which is
    // the exact thing the split exists to avoid.
    expect(sameIdentity('Running Down The Dream', 'Running down the Dream')).toBe(true);
    expect(sameIdentity('The Music City Mafia', 'Music City Mafia')).toBe(true);
    // Conservative in the other direction: a rename that might be a real
    // rebrand is NOT merged away, because guessing wrong there silently hides
    // a genuinely separate identity.
    expect(sameIdentity('Smokane', 'Smokane FC')).toBe(false);
    expect(sameIdentity('Swifty 4 Life', 'Swiftie 4 Life')).toBe(false);
    expect(sameIdentity('', '')).toBe(false);
  });

  it('never lists a retired cut that is still the current one', () => {
    // An era whose icon IS today's icon has nothing retired about it, and
    // listing it would show the same file twice in one section.
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      for (const b of allFranchiseBrands(league)) {
        const current = new Set(b.marks.map((m) => m.url));
        for (const m of b.past) {
          expect(current.has(m.url), `${b.name} ${m.label}`).toBe(false);
        }
      }
    }
  });

  it('renders the retired cuts inside Marks on file, not a section of their own', () => {
    expect(PAGE).toContain('Retired cuts of this same mark');
    expect(PAGE).toContain('brand.past.map');
    // The former-identities section reads the FILTERED list, never every era —
    // otherwise a team's own past shows up twice on the page.
    expect(PAGE).toContain('brand.formerIdentities.map');
    expect(PAGE).not.toMatch(/brand\.eras\.map\(/);
  });

  it('reads eras from the same history[] the throwback picker reads', () => {
    const b = franchiseBrand('theleague', '0001');
    expect(b?.eras.length).toBeGreaterThan(0);
    expect(b?.eras.map((e) => e.yearStart)).toEqual([...(b?.eras.map((e) => e.yearStart) ?? [])].sort((x, y) => x - y));
    // An era with no `eraLabel` shows its years alone rather than printing
    // them twice.
    for (const e of b?.eras ?? []) expect(e.label === null || e.label !== e.years).toBe(true);
  });
});

describe('franchise-marks — the colours the site actually paints', () => {
  /**
   * The config hex is the INPUT, never what lands on screen. Every surface
   * floors the colour against the ground it is about to sit on, which is why
   * the page shows both and says which is which — an owner reading
   * "Primary #000000" otherwise has no way to learn that nothing paints it.
   *
   * Bring The Pain is the fixture because the gap is at its widest here: the
   * config says black and the dark card paints near-white. Its primary was
   * #181818 until Sep 2026, when the last clubs sharing that value were given
   * colours of their own — Pain took pure black, the Wabbits #222222.
   */
  it('reads the derived values from the real resolvers', () => {
    const pain = franchiseBrand('theleague', '0008');
    expect(pain?.colors.find((c) => c.key === 'colorPrimary')?.hex).toBe('#000000');
    const accent = pain?.derived.find((d) => d.label === 'Accent token');
    // The whole point: the dark-theme accent is nothing like the config hex.
    expect(accent?.dark).not.toBe('#000000');
    expect(accent?.dark.toLowerCase()).toBe('#e9e9e9');
  });

  it('keeps the live bar FILL and INK apart', () => {
    // They are not the same number: the fill clears ΔE against the card
    // (perceptual distance, right for a block of colour) and the ink clears
    // WCAG AA (luminance, the only metric for reading). A colour can pass as a
    // bar and be unreadable as a score — that shipped coloured bars beside
    // grey numbers.
    const smokane = franchiseBrand('afl-fantasy', '0001');
    const fill = smokane?.derived.find((d) => d.label === 'Live bar fill');
    const ink = smokane?.derived.find((d) => d.label === 'Live bar ink');
    expect(fill).toBeDefined();
    expect(ink).toBeDefined();
    expect(ink?.light).not.toBe(fill?.light);
    expect(ink?.dark).not.toBe(fill?.dark);
  });

  it('gives every franchise all three derived families in both themes', () => {
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      for (const b of allFranchiseBrands(league)) {
        expect(b.derived.map((d) => d.label), b.name).toEqual([
          'Accent token',
          'Live bar fill',
          'Live bar ink',
        ]);
        for (const d of b.derived) {
          expect(d.light, `${b.name} ${d.label} light`).toMatch(/^#[0-9a-f]{6}$/i);
          expect(d.dark, `${b.name} ${d.label} dark`).toMatch(/^#[0-9a-f]{6}$/i);
        }
        // The token name a foreground use must read, never the raw hex.
        expect(b.accentProperty).toBe(`--team-accent-${b.franchiseId}`);
      }
    }
  });

  it('names the accent TOKEN in the usage table, not a hex', () => {
    // docs/claude/rules/theming-and-assets.md: a team colour used as foreground
    // must come from the token, which carries an html.dark override floored to
    // 3:1. Several franchises land ~1.1:1 on a dark card raw.
    expect(PAGE).toContain('teamAccentVar(franchiseId)');
    expect(PAGE).toContain('brand.accentProperty');
  });
});
