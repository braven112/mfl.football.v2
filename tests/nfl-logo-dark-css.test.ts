/**
 * Dark-mode NFL logo swap — CSS generator validation.
 *
 * Locks in the contract of src/utils/nfl-logo-dark-css.ts:
 * - every canonical NFL team gets an `html.dark` swap to a dark logo variant,
 * - both ESPN 500 PNGs and local SVGs (canonical + legacy alias filenames) are
 *   keyed, so non-normalized roster srcs like WAS.svg / LVR.svg are covered,
 * - the dark variant never appears as a match key (no self-referential swap),
 * - the dark URL is self-hosted (/assets/nfl-logos/dark/) for teams listed in
 *   the prebuild manifest and falls back to ESPN's 500-dark CDN cut otherwise
 *   — a swap target must never point at a local file the build doesn't have,
 *   because `content: url(...)` renders a broken-image icon on load failure
 *   (the Aug 2026 AFL players-page bug this system now guards against).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { buildNflLogoDarkCss, resolveNflDarkLogoUrl } from '../src/utils/nfl-logo-dark-css';
import { getAllNFLTeamCodes, getNFLTeamLogo, normalizeTeamCode, TEAM_CODE_MAP } from '../src/utils/nfl-logo';
import { getNflLogoUrl } from '../src/constants/roster-constants';
import { NFL_TEAM_CODES } from '../scripts/fetch-nfl-dark-logos.mjs';
import darkLogoManifest from '../src/data/nfl-dark-logos-manifest.json';

describe('buildNflLogoDarkCss', () => {
  const css = buildNflLogoDarkCss();
  const lines = css.split('\n');

  it('emits ESPN + local-svg rules (canonical teams and legacy aliases), all html.dark', () => {
    const canonical = getAllNFLTeamCodes();
    // 1 ESPN rule per canonical team, plus 1 local-svg rule for every canonical
    // code and every non-shield alias filename.
    const localCodes = new Set([...canonical, ...Object.keys(TEAM_CODE_MAP)]);
    const localRules = [...localCodes].filter((c) => {
      const n = normalizeTeamCode(c);
      return n && n !== 'NFL';
    }).length;
    expect(lines).toHaveLength(canonical.length + localRules);
    for (const line of lines) {
      expect(line.startsWith('html.dark img[src="')).toBe(true);
    }
  });

  it('swaps the ESPN light logo to the resolved dark variant', () => {
    const light = getNFLTeamLogo('DAL'); // .../500/DAL.png
    const dark = resolveNflDarkLogoUrl('DAL');
    expect(css).toContain(`html.dark img[src="${light}"] { content: url("${dark}"); }`);
  });

  it('swaps the canonical local NFL SVG to the resolved dark variant too', () => {
    const svg = getNflLogoUrl('SF'); // /assets/nfl-logos/SF.svg
    expect(css).toContain(`html.dark img[src="${svg}"] { content: url("${resolveNflDarkLogoUrl('SF')}"); }`);
  });

  it('covers legacy alias SVG filenames the rosters page renders (WAS, LVR)', () => {
    // rosters.astro normalizes Washington to WAS (not WSH) and hardcodes
    // /assets/nfl-logos/LVR.svg — both must map to the canonical dark logo.
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/WAS.svg"] { content: url("${resolveNflDarkLogoUrl('WSH')}"); }`,
    );
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/LVR.svg"] { content: url("${resolveNflDarkLogoUrl('LV')}"); }`,
    );
  });

  it('skips shield aliases (FA/UFA → NFL) — no dark shield to swap to', () => {
    expect(css).not.toContain('/assets/nfl-logos/FA.svg');
    expect(css).not.toContain('/assets/nfl-logos/UFA.svg');
  });

  it('never keys a rule on a dark-variant src (no self-referential swap)', () => {
    for (const line of lines) {
      const src = line.match(/img\[src="([^"]+)"\]/)?.[1] ?? '';
      expect(src).not.toContain('500-dark');
      expect(src).not.toContain('/assets/nfl-logos/dark/');
    }
  });

  it('covers every canonical team code', () => {
    for (const code of getAllNFLTeamCodes()) {
      expect(css).toContain(resolveNflDarkLogoUrl(code));
    }
  });
});

describe('resolveNflDarkLogoUrl', () => {
  it('serves the self-hosted mirror for manifest-listed teams', () => {
    expect(resolveNflDarkLogoUrl('DEN', ['DEN', 'GB'])).toBe('/assets/nfl-logos/dark/DEN.png');
  });

  it('falls back to the ESPN 500-dark URL for teams the build could not fetch', () => {
    expect(resolveNflDarkLogoUrl('DEN', [])).toBe(getNFLTeamLogo('DEN', 'dark'));
  });

  it('returns null (emit no rule) for teams whose dark cut 404s upstream', () => {
    // A retried 404 means the dark cut does not exist on ESPN — a swap rule
    // pointing at it would render a broken icon on every connection, so the
    // builder must skip the rule and keep the light logo in dark mode.
    expect(resolveNflDarkLogoUrl('DEN', [], ['DEN'])).toBeNull();
    // On-disk presence wins over a stale missing marker.
    expect(resolveNflDarkLogoUrl('DEN', ['DEN'], ['DEN'])).toBe('/assets/nfl-logos/dark/DEN.png');
  });
});

describe('nfl-dark-logos manifest + fetch script', () => {
  it('fetch script team list stays in lockstep with getAllNFLTeamCodes', () => {
    // The .mjs script cannot import the TS helper, so it carries its own copy
    // of the canonical list — this is the sync guard.
    expect([...NFL_TEAM_CODES].sort()).toEqual([...getAllNFLTeamCodes()].sort());
  });

  it('manifest only ever lists canonical team codes', () => {
    const canonical = new Set(getAllNFLTeamCodes());
    for (const code of darkLogoManifest.codes) {
      expect(canonical.has(code)).toBe(true);
    }
  });

  it('every committed manifest code has its mirrored PNG on disk', () => {
    // The manifest is tracked but the PNGs it vouches for are gitignored, so
    // a populated manifest must never be committed: any checkout that didn't
    // run the prebuild fetch (CI, a teammate's astro dev) would emit CSS
    // pointing at files it doesn't have — broken icons in dark mode, the bug
    // this system exists to prevent. In CI the committed manifest is empty
    // and this passes trivially; after a local prebuild the files exist.
    const darkDir = path.join(__dirname, '..', 'public', 'assets', 'nfl-logos', 'dark');
    for (const code of darkLogoManifest.codes) {
      expect(
        fs.existsSync(path.join(darkDir, `${code}.png`)),
        `manifest lists ${code} but public/assets/nfl-logos/dark/${code}.png is missing — ` +
          'a populated manifest must not be committed (the PNGs are gitignored)',
      ).toBe(true);
    }
  });
});
