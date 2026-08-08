/**
 * Dark-mode college logo swap — CSS generator validation.
 *
 * Locks in the contract of src/utils/college-logo-dark-css.ts:
 * - every rule is scoped to html.dark and swaps to a dark ncaa cut,
 * - rules are deduped by light src (shared logos across name spellings),
 * - the dark variant never appears as a match key (no self-referential swap),
 * - a known school (Alabama) produces its expected light→dark rule,
 * - the dark URL is self-hosted (/assets/college-logos/dark/{id}.png) for ids
 *   listed in the prebuild manifest and stays the ESPN URL otherwise — a swap
 *   target must never point at a local file the build doesn't have, because
 *   `content: url(...)` renders a broken-image icon on load failure (the Aug
 *   2026 dark-mode logo bug this system guards against).
 */
import { describe, it, expect } from 'vitest';
import { buildCollegeLogoDarkCss, resolveCollegeDarkLogoUrl } from '../src/utils/college-logo-dark-css';
import collegeLogos from '../src/data/college-logos.json';
import darkLogoManifest from '../src/data/college-dark-logos-manifest.json';
import { collectCollegeDarkLogos, NCAA_DARK_URL_RE } from '../scripts/fetch-college-dark-logos.mjs';

describe('buildCollegeLogoDarkCss', () => {
  const css = buildCollegeLogoDarkCss();
  const lines = css.split('\n').filter(Boolean);

  it('emits a non-empty, html.dark-scoped rule set', () => {
    // Non-empty only — the exact count is locked by the dedupe test below, so
    // this stays green when college-logos.json gains or loses schools.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith('html.dark img[src="')).toBe(true);
      // Dark target is either the self-hosted mirror or the ESPN 500-dark cut.
      expect(
        line.includes('/ncaa/500-dark/') || line.includes('/assets/college-logos/dark/'),
      ).toBe(true);
    }
  });

  it('dedupes by light src (one rule per distinct light logo)', () => {
    const distinctLight = new Set(
      Object.values(collegeLogos as Record<string, { logo?: string | null; logoDark?: string | null }>)
        .filter((e) => e?.logo && e?.logoDark)
        .map((e) => e.logo as string),
    );
    expect(lines).toHaveLength(distinctLight.size);
  });

  it('never keys a rule on a dark-variant src (no self-referential swap)', () => {
    for (const line of lines) {
      const src = line.match(/img\[src="([^"]+)"\]/)?.[1] ?? '';
      expect(src).not.toContain('500-dark');
      expect(src).not.toContain('/assets/college-logos/dark/');
    }
  });

  it('swaps a known school (Alabama) to its resolved dark variant', () => {
    const bama = (collegeLogos as Record<string, { logo: string; logoDark: string }>)['Alabama'];
    expect(css).toContain(
      `html.dark img[src="${bama.logo}"] { content: url("${resolveCollegeDarkLogoUrl(bama.logoDark)}"); }`,
    );
  });
});

describe('resolveCollegeDarkLogoUrl', () => {
  const espnDark = 'https://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png';

  it('serves the self-hosted mirror for manifest-listed ids', () => {
    expect(resolveCollegeDarkLogoUrl(espnDark, ['333'])).toBe('/assets/college-logos/dark/333.png');
  });

  it('keeps the ESPN URL for ids the build could not fetch', () => {
    expect(resolveCollegeDarkLogoUrl(espnDark, [])).toBe(espnDark);
  });

  it('leaves non-ESPN-pattern dark URLs untouched regardless of manifest', () => {
    const odd = 'https://example.com/custom-dark.png';
    expect(resolveCollegeDarkLogoUrl(odd, ['333'])).toBe(odd);
  });
});

describe('college dark-logo mirror inputs', () => {
  it('every logoDark in college-logos.json is mirrorable (matches the NCAA dark URL pattern)', () => {
    // If ESPN URLs in the data ever drift from the pattern, those schools
    // silently keep the remote swap — surface the drift here instead.
    const darks = Object.values(
      collegeLogos as Record<string, { logoDark?: string | null }>,
    )
      .map((e) => e?.logoDark)
      .filter((u): u is string => !!u);
    for (const url of darks) {
      expect(url, `unexpected logoDark shape: ${url}`).toMatch(NCAA_DARK_URL_RE);
    }
  });

  it('collectCollegeDarkLogos yields one item per distinct dark URL, keyed by ESPN id', () => {
    const items = collectCollegeDarkLogos(collegeLogos);
    const distinctDark = new Set(
      Object.values(collegeLogos as Record<string, { logoDark?: string | null }>)
        .map((e) => e?.logoDark)
        .filter(Boolean),
    );
    expect(items).toHaveLength(distinctDark.size);
    for (const item of items) {
      expect(item.url).toBe(`https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${item.key}.png`);
    }
  });

  it('manifest only ever lists ids present in college-logos.json', () => {
    const validIds = new Set(collectCollegeDarkLogos(collegeLogos).map((i) => i.key));
    for (const id of darkLogoManifest.ids) {
      expect(validIds.has(id)).toBe(true);
    }
  });
});
