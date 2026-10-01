import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The player card's Season Results table shipped unreadable in dark mode
 * (Oct 2026): unplayed weeks were coloured `--color-gray-300` and byes faded
 * to `opacity: 0.4`. Dark themes map gray-300 to a navy one shade off the
 * card surface, so the whole upcoming schedule vanished. gray-400 is the
 * next-faintest step and fails contrast on both grounds, so the table's text
 * floor is gray-500. On a phone it also scrolled sideways with "Rank vs QB"
 * cut off — the long half of each header is hidden below 640px.
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

describe('Season Results table stays readable', () => {
  it('finds the table rules (scan is not vacuous)', () => {
    expect(weeklyRules().length).toBeGreaterThan(10);
  });

  it('never colours its text gray-300 or gray-400', () => {
    const offenders = weeklyRules()
      .filter((r) => /(^|[^-])color:\s*var\(--color-gray-(300|400)\b/.test(r.body))
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
    const phone = SRC.slice(SRC.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.weekly-results-table \.wr-hdr-long\s*\{\s*display:\s*none/);
  });
});
