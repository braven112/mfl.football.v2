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
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  buildCollegeLogoDarkCss,
  resolveCollegeDarkLogoUrl,
  KNOWN_MISSING_NCAA_DARK_IDS,
} from '../src/utils/college-logo-dark-css';
import collegeLogos from '../src/data/college-logos.json';
import darkLogoManifest from '../src/data/college-dark-logos-manifest.json';
import { collectCollegeDarkLogos, NCAA_DARK_URL_RE } from '../scripts/fetch-college-dark-logos.mjs';

describe('buildCollegeLogoDarkCss', () => {
  const css = buildCollegeLogoDarkCss();
  const lines = css.split('\n').filter(Boolean);
  // The failed-logo rules (base hide + dark un-hide) ride along with the
  // swap rules; split them out so the swap assertions stay precise.
  const swapLines = lines.filter((l) => !l.includes('college-logo-failed'));

  it('emits a non-empty, html.dark-scoped rule set', () => {
    // Non-empty only — the exact count is locked by the dedupe test below, so
    // this stays green when college-logos.json gains or loses schools.
    expect(swapLines.length).toBeGreaterThan(0);
    for (const line of swapLines) {
      expect(line.startsWith('html.dark img[src="')).toBe(true);
      // Dark target is either the self-hosted mirror or the ESPN 500-dark cut.
      expect(
        line.includes('/ncaa/500-dark/') || line.includes('/assets/college-logos/dark/'),
      ).toBe(true);
    }
  });

  it('dedupes by light src (one rule per distinct light logo with a resolvable dark cut)', () => {
    // Entries whose dark cut is in the curated known-missing list emit no
    // rule at all (light logo in dark mode beats a rule pointing at a 404).
    const distinctLight = new Set(
      Object.values(collegeLogos as Record<string, { logo?: string | null; logoDark?: string | null }>)
        .filter((e) => e?.logo && e?.logoDark && resolveCollegeDarkLogoUrl(e.logoDark) !== null)
        .map((e) => e.logo as string),
    );
    expect(swapLines).toHaveLength(distinctLight.size);
  });

  it('hides failed logos, un-hiding them in dark mode only where a swap provides pixels', () => {
    // COLLEGE_LOGO_ONERROR tags a failed img with .college-logo-failed; the
    // base rule hides it (visibility keeps layout). Imgs whose dark swap
    // renders from content:url() are un-hidden under html.dark — their pixels
    // don't depend on the failed light src. Mirrors the NFL failed-logo rules.
    expect(css).toContain('img.college-logo-failed { visibility: hidden; }');
    const unhide = lines.find((l) => l.includes('college-logo-failed:is('));
    expect(unhide).toBeDefined();
    expect(unhide).toContain('html.dark img.college-logo-failed:is(');
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

  it('returns null (emit no rule) for ids in the curated known-missing list', () => {
    // ESPN never published dark cuts for a few small schools — those swap
    // rules always pointed at a permanent 404 (broken icon in dark mode on
    // every connection), so the builder skips them entirely.
    expect(resolveCollegeDarkLogoUrl(espnDark, [], ['333'])).toBeNull();
    // On-disk presence wins over the missing list.
    expect(resolveCollegeDarkLogoUrl(espnDark, ['333'], ['333'])).toBe(
      '/assets/college-logos/dark/333.png',
    );
    // The real curated ids are skipped by default.
    for (const id of KNOWN_MISSING_NCAA_DARK_IDS) {
      expect(
        resolveCollegeDarkLogoUrl(`https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png`, []),
      ).toBeNull();
    }
  });
});

describe('college dark-logo mirror inputs', () => {
  it('the NCAA dark URL pattern covers the college-logos.json data (wholesale-drift guard)', () => {
    // A single school whose dark URL uses a different-but-valid shape is
    // tolerated by design — the mirror skips it and that school keeps its
    // remote swap (see fetch-college-dark-logos.mjs). What must never happen
    // silently is wholesale drift (ESPN changes the URL shape, the regex
    // matches nothing, and every college swap quietly stays remote), so
    // assert broad coverage rather than per-URL perfection.
    const darks = Object.values(
      collegeLogos as Record<string, { logoDark?: string | null }>,
    )
      .map((e) => e?.logoDark)
      .filter((u): u is string => !!u);
    const mirrorable = darks.filter((u) => NCAA_DARK_URL_RE.test(u));
    expect(darks.length).toBeGreaterThan(0);
    expect(mirrorable.length / darks.length).toBeGreaterThanOrEqual(0.9);
  });

  it('collectCollegeDarkLogos yields one item per distinct mirrorable dark URL, keyed by ESPN id', () => {
    const items = collectCollegeDarkLogos(collegeLogos);
    const distinctMirrorable = new Set(
      Object.values(collegeLogos as Record<string, { logoDark?: string | null }>)
        .map((e) => e?.logoDark)
        .filter((u): u is string => !!u && NCAA_DARK_URL_RE.test(u)),
    );
    expect(items).toHaveLength(distinctMirrorable.size);
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

  it('resolver and fetch script agree on the mirrorable URL shape (regex lockstep)', () => {
    // The NCAA dark-URL regex is duplicated in the fetch script (.mjs, can't
    // import the TS util) and the resolver. If they drift, the mirror fills
    // the manifest but the resolver never matches — every college swap
    // silently stays remote. This locks them together: every URL the script
    // considers mirrorable must resolve to that key's local path.
    for (const item of collectCollegeDarkLogos(collegeLogos)) {
      expect(resolveCollegeDarkLogoUrl(item.url, [item.key])).toBe(
        `/assets/college-logos/dark/${item.key}.png`,
      );
    }
  });

  it('every committed manifest id has its mirrored PNG on disk', () => {
    // The manifest is tracked but the PNGs it vouches for are gitignored, so
    // a populated manifest must never be committed: any checkout that didn't
    // run the prebuild fetch (CI, a teammate's astro dev) would emit CSS
    // pointing at files it doesn't have — broken icons in dark mode, the bug
    // this system exists to prevent. In CI the committed manifest is empty
    // and this passes trivially; after a local prebuild the files exist.
    const darkDir = path.join(__dirname, '..', 'public', 'assets', 'college-logos', 'dark');
    for (const id of darkLogoManifest.ids) {
      expect(
        fs.existsSync(path.join(darkDir, `${id}.png`)),
        `manifest lists ${id} but public/assets/college-logos/dark/${id}.png is missing — ` +
          'a populated manifest must not be committed (the PNGs are gitignored)',
      ).toBe(true);
    }
  });
});
