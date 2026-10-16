import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spellOutShorthand } from '../src/utils/pecking-order-wording.mjs';

// Owners read "W2" / "L3" as a puzzle; the Pecking Order says it in words.
describe('spellOutShorthand', () => {
  it('spells out winning and losing streaks', () => {
    expect(spellOutShorthand('on a 3-1 rolling record and a W2 streak')).toBe('on a 3-1 rolling record and a 2-game winning streak');
    expect(spellOutShorthand('an L3 streak')).toBe('a 3-game losing streak');
    expect(spellOutShorthand('with a W6 active streak')).toBe('with a 6-game winning streak');
    expect(spellOutShorthand('An L8 streak sinks them')).toBe('An 8-game losing streak sinks them');
    expect(spellOutShorthand('and an L7 losing streak that')).toBe('and a 7-game losing streak that');
    expect(spellOutShorthand('a perfect 4-0 L3 and a W5 active, posting')).toBe('a perfect 4-0 over the last three weeks and a 5-game winning streak, posting');
  });

  it('says "last three weeks" for the L3 window', () => {
    expect(spellOutShorthand('their 2-3 L3 record leaves room')).toBe('their 2-3 record over the last three weeks leaves room');
    expect(spellOutShorthand('going 0-3 L3 and')).toBe('going 0-3 over the last three weeks and');
    expect(spellOutShorthand('their 95.7 PPG L3 is')).toBe('their 95.7 PPG over the last three weeks is');
    expect(spellOutShorthand('3-0 over their last 3 at 127.8 PPG.')).toBe('3-0 over their last three at 127.8 PPG.');
  });

  it('leaves ordinary prose alone', () => {
    const text = 'Boom. They scored 147.5 and moved up 3 spots to #4 in Week 6.';
    expect(spellOutShorthand(text)).toBe(text);
    expect(spellOutShorthand(undefined)).toBe(undefined);
  });

  it('is applied by the page, the templated writer and the AI path', () => {
    for (const f of ['src/components/shared/PeckingOrderIssue.astro', 'scripts/generate-pecking-order.mjs', 'scripts/lib/pecking-order-ai.mjs']) {
      expect(readFileSync(f, 'utf8'), f).toContain('spellOutShorthand(');
    }
  });

  it('the fact sheet the writer reads carries no shorthand', () => {
    const src = readFileSync('scripts/lib/pecking-order-ai.mjs', 'utf8');
    expect(src).not.toMatch(/PPG L3|\} L3`|streak\.type\}\$\{/);
  });
});
