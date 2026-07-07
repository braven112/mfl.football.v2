/**
 * Dark-mode NFL logo swap — CSS generator validation.
 *
 * Locks in the contract of src/utils/nfl-logo-dark-css.ts:
 * - every canonical NFL team gets an `html.dark` swap to ESPN's 500-dark cut,
 * - both ESPN 500 PNGs and local SVGs (canonical + legacy alias filenames) are
 *   keyed, so non-normalized roster srcs like WAS.svg / LVR.svg are covered,
 * - the dark variant never appears as a match key (no self-referential swap),
 * - the light↔dark URL pair stays in lockstep with the logo helpers.
 */
import { describe, it, expect } from 'vitest';
import { buildNflLogoDarkCss } from '../src/utils/nfl-logo-dark-css';
import { getAllNFLTeamCodes, getNFLTeamLogo, normalizeTeamCode, TEAM_CODE_MAP } from '../src/utils/nfl-logo';
import { getNflLogoUrl } from '../src/constants/roster-constants';

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

  it('swaps the ESPN light logo to the 500-dark variant', () => {
    const light = getNFLTeamLogo('DAL'); // .../500/DAL.png
    const dark = getNFLTeamLogo('DAL', 'dark'); // .../500-dark/DAL.png
    expect(css).toContain(`html.dark img[src="${light}"] { content: url("${dark}"); }`);
  });

  it('swaps the canonical local NFL SVG to the ESPN dark variant too', () => {
    const svg = getNflLogoUrl('SF'); // /assets/nfl-logos/SF.svg
    const dark = getNFLTeamLogo('SF', 'dark');
    expect(css).toContain(`html.dark img[src="${svg}"] { content: url("${dark}"); }`);
  });

  it('covers legacy alias SVG filenames the rosters page renders (WAS, LVR)', () => {
    // rosters.astro normalizes Washington to WAS (not WSH) and hardcodes
    // /assets/nfl-logos/LVR.svg — both must map to the canonical dark PNG.
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/WAS.svg"] { content: url("${getNFLTeamLogo('WSH', 'dark')}"); }`,
    );
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/LVR.svg"] { content: url("${getNFLTeamLogo('LV', 'dark')}"); }`,
    );
  });

  it('skips shield aliases (FA/UFA → NFL) — no dark shield to swap to', () => {
    expect(css).not.toContain('/assets/nfl-logos/FA.svg');
    expect(css).not.toContain('/assets/nfl-logos/UFA.svg');
  });

  it('never keys a rule on a 500-dark src (no self-referential swap)', () => {
    for (const line of lines) {
      const src = line.match(/img\[src="([^"]+)"\]/)?.[1] ?? '';
      expect(src).not.toContain('500-dark');
    }
  });

  it('covers every canonical team code', () => {
    for (const code of getAllNFLTeamCodes()) {
      expect(css).toContain(getNFLTeamLogo(code, 'dark'));
    }
  });
});
