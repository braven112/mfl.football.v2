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
import { allFranchiseBrands, franchiseBrand, bandSlot, inkOn } from '../src/utils/franchise-marks';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = read('src/components/shared/brand/FranchiseBrandPage.astro');
const INDEX = read('src/components/shared/brand/BrandPage.astro');
const CSS = read('src/styles/brand-book.css');

describe('FranchiseBrandPage — the dark-swap opt-out', () => {
  /**
   * `buildTeamIconDarkCss` emits `html.dark img[src="<light>"] { content:
   * url(<dark cut>) }` for every franchise shipping an `iconDark`. On any other
   * page that is the point; on a page whose subject is the side-by-side
   * comparison it renders one mark twice for a dark-mode reader.
   */
  it('opts every ground-declaring surface out of the swap', () => {
    for (const sel of [
      '.bb__hero img',
      '.bb__cut-box img',
      '.bb__ground-art img',
      '.bb__era-art img',
      '.bb__pane img',
    ]) {
      expect(PAGE, sel).toContain(`html.dark :global(${sel})`);
    }
    expect(PAGE).toMatch(/content: normal !important/);
  });

  it('opts the index tiles out too', () => {
    // Each tile paints the franchise's own colour and must look the same in
    // both themes; without this the dark-mode reader sees a different cut.
    expect(INDEX).toContain('html.dark :global(.bb__art img)');
    expect(INDEX).toMatch(/content: normal !important/);
  });

  it('keeps the inline measured ring, which the blanket filter reset would strip', () => {
    // The ring is applied INLINE by the caller precisely so it outranks the
    // global `html.dark` rule and a crest can never wear two. A blanket
    // `filter: none` in the opt-out would undo that.
    for (const src of [PAGE, INDEX]) {
      expect(src).toMatch(/filter: none !important/);
      expect(src).toMatch(/img\[style\*='drop-shadow'\]/);
      expect(src).toMatch(/filter: revert-layer !important/);
    }
  });

  it('does not opt the whole page out', () => {
    // Scoped to the surfaces that DECLARE a ground. A page-wide opt-out would
    // freeze anything else on the page onto light artwork against a dark card
    // — the exact bug the swap exists to prevent.
    expect(PAGE).not.toMatch(/html\.dark :global\(img\)/);
    expect(PAGE).not.toMatch(/html\.dark :global\(\.bb img\) \{\s*content/);
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
    expect(PAGE).toMatch(/document\.querySelector\('\.bb'\)/);
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
    expect(bare.filter((v) => !['--chip', '--tile-bg', '--tile-ink', '--hero-bg', '--hero-ink', '--era-bg'].includes(v))).toEqual([]);
  });

  it('paints the comparison grounds with literals, not theme tokens', () => {
    // A "light" pane drawn on `--card-bg` follows the viewer's theme and goes
    // near-black in dark mode, which is the comparison gone.
    expect(CSS).toMatch(/\.bb__cut-box\.is-light \{\s*\n\s*background: #ffffff;/);
    expect(CSS).toMatch(/\.bb__cut-box\.is-dark \{\s*\n\s*background: #10141a;/);
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

  it('reads eras from the same history[] the throwback picker reads', () => {
    const b = franchiseBrand('theleague', '0001');
    expect(b?.eras.length).toBeGreaterThan(0);
    expect(b?.eras.map((e) => e.yearStart)).toEqual([...(b?.eras.map((e) => e.yearStart) ?? [])].sort((x, y) => x - y));
    // An era with no `eraLabel` shows its years alone rather than printing
    // them twice.
    for (const e of b?.eras ?? []) expect(e.label === null || e.label !== e.years).toBe(true);
  });
});
