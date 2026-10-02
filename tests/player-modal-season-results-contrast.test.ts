import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The player card's Season Results table shipped unreadable in dark mode
 * (Oct 2026): unplayed weeks were coloured `--color-gray-300` and byes faded
 * to `opacity: 0.4`. Dark themes map gray-300 to a navy one shade off the
 * card surface, so the whole upcoming schedule vanished. No raw gray step is
 * safe as muted TEXT here — even gray-500 is 4.4:1 on the default dark card —
 * so the table's text floor is the semantic `--content-text-muted`. On a
 * phone it also scrolled sideways with "Rank vs QB" cut off: below 640px the
 * long half of each header is visually hidden (still read aloud) and the
 * opponent column drops its min-width.
 *
 * The rest of the card had the same flaw (follow-up #1289): its labels,
 * section titles and descriptions used raw gray-400/500. gray-400 is only
 * 2.5:1 on the LIGHT card and 2.8:1 on the dark one, so the modal-wide
 * check below forbids a raw gray-300/400/500 text colour anywhere in the file.
 *
 * Rule: docs/claude/rules/theming-and-assets.md § "Muted text in the player
 * card".
 */
const SRC = readFileSync(
  resolve(__dirname, '../src/components/theleague/PlayerDetailsModal.astro'),
  'utf8',
);

/** Every declaration block whose selector targets the weekly-results table. */
function weeklyRules(): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]*weekly-results-table[^{}]*)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC))) rules.push({ selector: m[1].trim(), body: m[2] });
  return rules;
}

/** The body of one @media block, brace-matched (not sliced to EOF). */
function mediaBlock(header: string): string {
  const at = SRC.indexOf(header);
  expect(at, `${header} not found`).toBeGreaterThan(-1);
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open + 1, i);
  }
  throw new Error(`${header} is unterminated`);
}

describe('Season Results table stays readable', () => {
  it('finds the table rules (scan is not vacuous)', () => {
    expect(weeklyRules().length).toBeGreaterThan(10);
  });

  it('never colours its text a raw gray-300/400/500 step', () => {
    const offenders = weeklyRules()
      .filter((r) => /(^|[^-])color:\s*var\(--color-gray-(300|400|500)\b/.test(r.body))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  it('never mutes a row with opacity', () => {
    const offenders = weeklyRules()
      .filter((r) => /-row\b/.test(r.selector) && /opacity\s*:/.test(r.body))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  it('shortens its headers on a phone so the table does not scroll sideways', () => {
    expect(SRC).toMatch(/<th class="wr-rank" id="wr-rank-header">Rank<span class="wr-hdr-long">/);
    const phone = mediaBlock('@media (max-width: 640px)');
    const hide = phone.match(/\.weekly-results-table \.wr-hdr-long\s*\{([^}]*)\}/);
    expect(hide, 'header-shortening rule must live inside the phone media query').toBeTruthy();
    // Visually hidden, never display:none — the full header stays in the a11y tree.
    const decls = hide![1].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(decls).not.toMatch(/display\s*:\s*none/);
    expect(hide![1]).toMatch(/clip/);
    expect(phone).toMatch(/\.weekly-results-table :global\(\.wr-opp\)\s*\{\s*min-width:\s*0/);
  });
});

describe('the whole player card keeps muted text readable', () => {
  it('never colours text a raw gray-300/400/500 step, anywhere in the modal', () => {
    // Strip comments first: the explanatory notes name these steps on purpose.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const offenders = code
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => /(^|[^-])color\s*:\s*var\(--color-gray-(300|400|500)\b/.test(text));
    expect(offenders).toEqual([]);
  });

  it('routes its muted labels through --content-text-muted (scan is not vacuous)', () => {
    for (const sel of ['.pdm-owner__label', '.pdm-metric__label', '.pdm-section__title', '.pdm-detail__label']) {
      const at = SRC.indexOf(`  ${sel} {`);
      expect(at, `${sel} rule not found`).toBeGreaterThan(-1);
      const body = SRC.slice(at, SRC.indexOf('}', at));
      expect(body, sel).toMatch(/color:\s*var\(--content-text-muted\b/);
    }
  });
});
