/**
 * Dark-mode college logo swap — CSS generator validation.
 *
 * Locks in the contract of src/utils/college-logo-dark-css.ts:
 * - every rule is scoped to html.dark and swaps to a 500-dark ncaa cut,
 * - rules are deduped by light src (shared logos across name spellings),
 * - the dark variant never appears as a match key (no self-referential swap),
 * - a known school (Alabama) produces its expected light→dark rule.
 */
import { describe, it, expect } from 'vitest';
import { buildCollegeLogoDarkCss } from '../src/utils/college-logo-dark-css';
import collegeLogos from '../src/data/college-logos.json';

describe('buildCollegeLogoDarkCss', () => {
  const css = buildCollegeLogoDarkCss();
  const lines = css.split('\n').filter(Boolean);

  it('emits a non-empty, html.dark-scoped rule set', () => {
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) {
      expect(line.startsWith('html.dark img[src="')).toBe(true);
      expect(line).toContain('/ncaa/500-dark/');
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

  it('never keys a rule on a 500-dark src (no self-referential swap)', () => {
    for (const line of lines) {
      const src = line.match(/img\[src="([^"]+)"\]/)?.[1] ?? '';
      expect(src).not.toContain('500-dark');
    }
  });

  it('swaps a known school (Alabama) to its dark variant', () => {
    const bama = (collegeLogos as Record<string, { logo: string; logoDark: string }>)['Alabama'];
    expect(css).toContain(
      `html.dark img[src="${bama.logo}"] { content: url("${bama.logoDark}"); }`,
    );
  });
});
