import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAllNFLTeamCodes } from '../src/utils/nfl-logo';
import { buildNflLogoDarkCss, resolveNflDarkLogoUrl } from '../src/utils/nfl-logo-dark-css';
// @ts-expect-error — plain .mjs script lib, no types
import { MARK_IDS, MARK_SOURCES, assignedMark, resolveMark } from '../scripts/lib/nfl-mark-sources.mjs';

/**
 * Per-club mark assignments (phase 1 of docs/plans/nfl-mark-assignments.md).
 *
 * `src/data/nfl-mark-assignments.json` says which cut each club draws on each
 * ground. Three clubs deviate from the default today; every other club resolves
 * to the default, which is exactly what shipped before this existed.
 *
 * What this pins, and why each one is a way it could break silently:
 *
 * 1. Every club key is a canonical code and every mark id is real. A typo'd id
 *    must fail the build — `resolveMark` throws rather than falling back,
 *    because a silent fallback ships the wrong artwork with nothing to notice.
 * 2. Every assigned mark actually resolves to a URL in the committed brand kit.
 * 3. The DEFAULT is still what the site did before: light `primary`, dark
 *    `espnDark`. A change here moves all 29 unassigned clubs at once.
 * 4. A club whose dark cut is SVG gets a `.svg` in the emitted swap. The
 *    builder used to hardcode `.png`; with an SVG cut that emits
 *    `content: url()` pointing at a file that does not exist, and a CSS
 *    content replacement has no error fallback — it renders a broken-image
 *    icon on every dark-mode page view.
 */

const ROOT = process.cwd();
const assignments = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'nfl-mark-assignments.json'), 'utf-8'),
) as { defaults: Record<string, string>; clubs: Record<string, Record<string, string>> };

describe('nfl-mark-assignments.json', () => {
  it('keeps the defaults the site already shipped', () => {
    expect(assignments.defaults).toEqual({ light: 'primary', dark: 'espnDark' });
  });

  it('only names canonical club codes', () => {
    const canonical = new Set(getAllNFLTeamCodes());
    for (const code of Object.keys(assignments.clubs)) {
      expect(canonical.has(code), `${code} is not a canonical club code`).toBe(true);
    }
  });

  it('only names mark ids that exist, on grounds that exist', () => {
    for (const [code, entry] of Object.entries(assignments.clubs)) {
      for (const [ground, markId] of Object.entries(entry)) {
        expect(['light', 'dark'], `${code}: unknown ground "${ground}"`).toContain(ground);
        expect(MARK_IDS, `${code}.${ground}: unknown mark id "${markId}"`).toContain(markId);
      }
    }
  });

  it('resolves every club-and-ground to real artwork in the brand kit', () => {
    for (const code of getAllNFLTeamCodes()) {
      for (const ground of ['light', 'dark']) {
        const markId = assignedMark(code, ground);
        const resolved = resolveMark(code, markId);
        expect(resolved.format, `${code}.${ground}`).toMatch(/^(svg|png)$/);
        // `primary` is the committed file rather than a fetch, so it has no URL.
        if (!resolved.committed) {
          expect(resolved.url, `${code}.${ground} (${markId})`).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it('rejects an unknown mark id instead of falling back', () => {
    expect(() => resolveMark('ARI', 'notAMark')).toThrow(/unknown mark id/);
  });

  it('declares a format for every mark source', () => {
    for (const [id, spec] of Object.entries(MARK_SOURCES as Record<string, { format: string }>)) {
      expect(spec.format, `${id} has no format`).toMatch(/^(svg|png)$/);
    }
  });
});

describe('always-dark surfaces do not depend on the theme', () => {
  /**
   * A surface that is dark in BOTH themes cannot use the `html.dark`-guarded
   * swap: for a light-theme viewer it never fires, and the LIGHT mark renders
   * on a near-black ground — the dissolving case the dark pipeline exists to
   * prevent. Those surfaces ask `nflLogoUrl(code, 'dark')` for the cut
   * directly. Named here so a new always-dark surface is a deliberate
   * addition rather than a silently theme-dependent one.
   */
  const ALWAYS_DARK = [
    'src/components/shared/live-broadcast/BroadcastPlayerStrip.tsx',
    'src/components/shared/sunday-ticket/SundayTicketBox.astro',
    'src/components/shared/sunday-ticket/SundayTicketBoard.astro',
  ];

  it.each(ALWAYS_DARK)('%s asks for the dark ground, not the light src', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    expect(src, `${file}: should resolve through nflLogoUrl`).toContain("nflLogoUrl(");
    expect(src, `${file}: should ask for the dark ground`).toMatch(/nflLogoUrl\([^)]*,\s*'dark'\)/);
    // A hand-built light path here is the regression: it reintroduces the
    // theme dependency this rule removes.
    expect(
      /`\/assets\/nfl-logos\/\$\{[^}]+\}\.svg`/.test(src),
      `${file}: builds a light /assets/nfl-logos/*.svg path by hand`,
    ).toBe(false);
  });

  it('keeps the dark resolver same-origin so a snapshot never fetches a CDN', async () => {
    const { nflLogoUrl } = await import('../src/utils/live/nfl-logo-url');
    // With the committed empty manifest there is no mirror, so the dark ground
    // must fall back to the local light mark rather than to ESPN's CDN.
    const url = nflLogoUrl('CHI', 'dark');
    expect(url.startsWith('/'), `expected a same-origin path, got ${url}`).toBe(true);
    expect(nflLogoUrl('CHI')).toBe('/assets/nfl-logos/CHI.svg');
    expect(nflLogoUrl('')).toBe('');
  });
});

describe('the shared mirror stays PNG-shaped for its other caller', () => {
  it('leaves the college manifest without a formats field', () => {
    // scripts/lib/dark-logo-mirror.mjs is shared with fetch-college-dark-logos.mjs.
    // `formats` is written ONLY when a cut is not a PNG, so an all-PNG mirror
    // writes exactly the manifest it wrote before the field existed. If this
    // fails, the NFL change leaked into the college pipeline.
    const college = JSON.parse(
      readFileSync(join(ROOT, 'src', 'data', 'college-dark-logos-manifest.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(Object.keys(college)).toEqual(['ids']);
  });
});

describe('a non-PNG dark cut reaches the CSS with its real extension', () => {
  it('resolves the manifest format rather than assuming .png', () => {
    const formats = { CHI: 'svg' };
    expect(resolveNflDarkLogoUrl('CHI', ['CHI'], [], '/assets/nfl-logos/dark', formats)).toBe(
      '/assets/nfl-logos/dark/CHI.svg',
    );
    // A code with no format entry still resolves to PNG — the all-PNG builds
    // and the committed empty manifest must behave exactly as before.
    expect(resolveNflDarkLogoUrl('ARI', ['ARI'], [], '/assets/nfl-logos/dark', formats)).toBe(
      '/assets/nfl-logos/dark/ARI.png',
    );
  });

  it('emits the .svg swap in the built stylesheet', () => {
    const css = buildNflLogoDarkCss({
      manifestCodes: ['CHI', 'ARI'],
      manifestFormats: { CHI: 'svg' },
    });
    expect(css).toContain('url("/assets/nfl-logos/dark/CHI.svg")');
    expect(css).toContain('url("/assets/nfl-logos/dark/ARI.png")');
    expect(css).not.toContain('/assets/nfl-logos/dark/CHI.png');
  });
});
