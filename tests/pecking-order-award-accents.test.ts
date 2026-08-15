import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { contrastRatio, AA_LARGE_TEXT_RATIO } from '../src/utils/team-color-contrast';

/**
 * Three Pecking Order awards are colored by meaning rather than by the winning
 * franchise — cold blue for the cooler, hot orange-red for the heater, pink for
 * the bench blunder (commissioner, 2026-08-14). They're the one place on the
 * page that opts out of the site-wide franchise accent token, so they need
 * their own theme pair and their own guard: a single hex here would look right
 * in whichever theme it was picked in and wash out in the other.
 */

const COMPONENT = resolve(__dirname, '../src/components/theleague/PeckingOrderIssue.astro');
const source = readFileSync(COMPONENT, 'utf-8');

/** Card surfaces the award edge sits on (tokens.css / tokens-dark.css --card-bg). */
const CARD_LIGHT = '#ffffff';
const CARD_DARK = '#262626';

const AWARDS = ['cooler', 'heater', 'blunder'] as const;

/** Pull `--pr-award-<name>: #hex` out of a block of the component's CSS. */
function readAccent(name: string, block: string): string {
  const m = new RegExp(`--pr-award-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block);
  expect(m, `--pr-award-${name} not found`).toBeTruthy();
  return m![1];
}

const darkBlockStart = source.indexOf(':global(html.dark) .pr-issue');
const lightBlock = source.slice(0, darkBlockStart);
const darkBlock = source.slice(darkBlockStart);

describe('Pecking Order award accents', () => {
  it('maps the three awards to their own tokens, not the franchise accent', () => {
    expect(source).toContain("coolerOfWeek: 'var(--pr-award-cooler)'");
    expect(source).toContain("heaterOfWeek: 'var(--pr-award-heater)'");
    expect(source).toContain("benchBlunder: 'var(--pr-award-blunder)'");
  });

  it('declares a light and a dark value for each', () => {
    for (const name of AWARDS) {
      expect(readAccent(name, lightBlock)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(readAccent(name, darkBlock)).toMatch(/^#[0-9a-f]{6}$/i);
      // A pair that never diverged is the bug this test exists to catch.
      expect(readAccent(name, lightBlock)).not.toBe(readAccent(name, darkBlock));
    }
  });

  it.each(AWARDS)('%s clears 3:1 on both card surfaces', (name) => {
    expect(contrastRatio(readAccent(name, lightBlock), CARD_LIGHT)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT_RATIO,
    );
    expect(contrastRatio(readAccent(name, darkBlock), CARD_DARK)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT_RATIO,
    );
  });

  it('keeps the three hues distinguishable from each other', () => {
    // Blue vs orange-red vs pink — a copy-paste that left two the same hue
    // would read as one category to anyone scanning the awards row.
    for (const block of [lightBlock, darkBlock]) {
      const [cooler, heater, blunder] = AWARDS.map((n) => readAccent(n, block).toLowerCase());
      expect(new Set([cooler, heater, blunder]).size).toBe(3);
    }
  });
});
