import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripTakeLabel } from '../scripts/lib/schefter-take-label.mjs';

describe('stripTakeLabel', () => {
  it('drops the label the card already prints', () => {
    expect(stripTakeLabel("Schefter's Take: Dark Magicians win this one.")).toBe('Dark Magicians win this one.');
    expect(stripTakeLabel('Max Insider’s Take — sell high.')).toBe('sell high.');
    expect(stripTakeLabel('Take: buy low.')).toBe('buy low.');
  });

  it('leaves a take without a label alone, including one that mentions a take later', () => {
    const plain = "Bring The Pain gets a steady veteran. That's my take: B+.";
    expect(stripTakeLabel(plain)).toBe(plain);
    expect(stripTakeLabel('Takeaway: nobody wins.')).toBe('Takeaway: nobody wins.');
  });

  it('keeps leading markup intact', () => {
    expect(stripTakeLabel("<p>Schefter's Take: grade A.</p>")).toBe('<p>grade A.</p>');
  });

  it('runs on every surface that labels the take, and on write', () => {
    for (const file of [
      'src/components/shared/SchefterPostCard.astro',
      'src/components/shared/transactions/TransactionsPage.astro',
      'scripts/schefter-scan.mjs',
    ]) {
      expect(readFileSync(file, 'utf8'), file).toContain('stripTakeLabel(');
    }
  });
});
