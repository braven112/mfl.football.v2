import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { capSentences, splitSentences, LEDE_MAX_SENTENCES } from '../src/utils/pecking-order-lede.mjs';

/**
 * The Pecking Order's intro is at most three sentences, and the page shows the
 * rankings and nothing else after them (commissioner, 2026-10-15).
 */
describe('Pecking Order lede cap', () => {
  it('is three sentences', () => {
    expect(LEDE_MAX_SENTENCES).toBe(3);
  });

  it('does not split on a decimal score or a rank', () => {
    const lede =
      'Through Week 5, Running down the Dream sit atop the pecking order. Pigskins dropped 147.57 — the highest score in the league this week. Pigskins jump 4 spots to #4. Fire Ready slide 3 to #9.';
    expect(splitSentences(lede)).toHaveLength(4);
    expect(capSentences(lede)).toBe(
      'Through Week 5, Running down the Dream sit atop the pecking order. Pigskins dropped 147.57 — the highest score in the league this week. Pigskins jump 4 spots to #4.',
    );
  });

  it('keeps paragraph breaks and a short lede whole', () => {
    expect(capSentences('One thing.\n\nTwo things!')).toBe('One thing.\n\nTwo things!');
    expect(capSentences('One. Two.\n\nThree. Four.')).toBe('One. Two.\n\nThree.');
    expect(capSentences('')).toBe('');
  });

  it('is applied by the page, the template generator and the AI path', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');
    expect(read('src/components/shared/PeckingOrderIssue.astro')).toMatch(/capSentences\(issue\.lede/);
    expect(read('scripts/generate-pecking-order.mjs')).toMatch(/capSentences\(ledeParts/);
    expect(read('scripts/lib/pecking-order-ai.mjs')).toMatch(/capSentences\(aiOutput\.lede/);
  });

  it('renders no awards or standings tables after the rankings', () => {
    const src = readFileSync(resolve(__dirname, '../src/components/shared/PeckingOrderIssue.astro'), 'utf-8');
    const markup = src.slice(src.lastIndexOf('---'));
    expect(markup).not.toMatch(/issue\.awards|issue\.standings\.(divisions|allPlay)\.map/);
  });
});
