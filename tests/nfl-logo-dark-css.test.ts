/**
 * Dark-mode NFL logo swap — CSS generator validation.
 *
 * Locks in the contract of src/utils/nfl-logo-dark-css.ts:
 * - every canonical NFL team gets an `html.dark` swap to ESPN's 500-dark cut,
 * - both light srcs our helpers render (ESPN 500 PNG + local SVG) are keyed,
 * - the dark variant never appears as a match key (no self-referential swap),
 * - the light↔dark URL pair stays in lockstep with the logo helpers.
 */
import { describe, it, expect } from 'vitest';
import { buildNflLogoDarkCss } from '../src/utils/nfl-logo-dark-css';
import { getAllNFLTeamCodes, getNFLTeamLogo } from '../src/utils/nfl-logo';
import { getNflLogoUrl } from '../src/constants/roster-constants';

describe('buildNflLogoDarkCss', () => {
  const css = buildNflLogoDarkCss();
  const lines = css.split('\n');

  it('emits two rules per team (ESPN png + local svg), all scoped to html.dark', () => {
    const codes = getAllNFLTeamCodes();
    expect(lines).toHaveLength(codes.length * 2);
    for (const line of lines) {
      expect(line.startsWith('html.dark img[src="')).toBe(true);
    }
  });

  it('swaps the ESPN light logo to the 500-dark variant', () => {
    const light = getNFLTeamLogo('DAL'); // .../500/DAL.png
    const dark = getNFLTeamLogo('DAL', 'dark'); // .../500-dark/DAL.png
    expect(css).toContain(`html.dark img[src="${light}"] { content: url("${dark}"); }`);
  });

  it('swaps the local NFL SVG to the ESPN dark variant too', () => {
    const svg = getNflLogoUrl('SF'); // /assets/nfl-logos/SF.svg
    const dark = getNFLTeamLogo('SF', 'dark');
    expect(css).toContain(`html.dark img[src="${svg}"] { content: url("${dark}"); }`);
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
