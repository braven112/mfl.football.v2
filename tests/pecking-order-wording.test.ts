import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spellOutShorthand } from '../src/utils/pecking-order-wording.mjs';

// Owners read "W2" / "L3" as a puzzle; the Pecking Order says it in words.
describe('spellOutShorthand', () => {
  it('spells out winning and losing streaks', () => {
    expect(spellOutShorthand('an L3 streak')).toBe('a 3-game losing streak');
    expect(spellOutShorthand('with a W6 active streak')).toBe('with a 6-game winning streak');
    expect(spellOutShorthand('An L8 streak sinks them')).toBe('An 8-game losing streak sinks them');
    expect(spellOutShorthand('and an L7 losing streak that')).toBe('and a 7-game losing streak that');
  });

  // The window's wording rotates (Brandon: "2-2 record", "a 2-2 mark over the
  // last three", "2-2 performance over the last few weeks", "2-2 over the last
  // three weeks"), so these pin the grammar, not one phrasing.
  const NOUN = '(record over the last three weeks|mark over the last three|performance over the last few weeks)';
  const BARE = '(over the last three weeks|over the last three)';
  const windows = (t: string) => (t.match(/over (?:the|their) last (?:three|few)/g) ?? []).length;

  it('gives a score used as a noun a noun, never "a 2-2 last three weeks"', () => {
    for (const [input, lead, tail] of [
      ['but a 2-2 last three weeks and a two-game skid', 'but a 2-2 ', ' and a two-game skid'],
      ['with a dominant 3-0 last-three record and 151.9 PPG', 'with a dominant 3-0 ', ' and 151.9 PPG'],
      ['on a 3-1 rolling record and a W2 streak', 'on a 3-1 ', ' and a 2-game winning streak'],
      ['their 2-3 L3 record leaves room', 'their 2-3 ', ' leaves room'],
      ['with a 2-2 L3 and weak 51.9% all-play', 'with a 2-2 ', ' and weak 51.9% all-play'],
      ['a perfect 4-0 L3 and a W5 active, posting', 'a perfect 4-0 ', ' and a 5-game winning streak, posting'],
    ]) {
      expect(spellOutShorthand(input), input).toMatch(new RegExp(`^${lead}${NOUN}${tail}$`));
    }
  });

  it('says the window in words where no noun is needed', () => {
    expect(spellOutShorthand('going 0-3 L3 and')).toMatch(new RegExp(`^going 0-3 ${BARE} and$`));
    expect(spellOutShorthand('their 95.7 PPG L3 is')).toMatch(new RegExp(`^their 95.7 PPG ${BARE} is$`));
    expect(spellOutShorthand('a league-leading 151.9 PPG rolling average. Boom.')).toMatch(new RegExp(`^a league-leading 151.9 PPG ${BARE}\\. Boom\\.$`));
    expect(spellOutShorthand('elite 131.3 PPG over last-three makes them')).toBe('elite 131.3 PPG over the last three makes them');
    expect(spellOutShorthand('3-0 over their last 3 at 127.8 PPG.')).toBe('3-0 over their last three at 127.8 PPG.');
  });

  it('names the window once per blurb', () => {
    const out = spellOutShorthand('Vitside moves up on a 3-1 rolling record and a W3 streak, averaging 124.4 PPG over the last three weeks. Boom.');
    expect(windows(out)).toBe(1);
    expect(out).toMatch(/averaging 124\.4 PPG\. Boom\.$/);
    expect(windows(spellOutShorthand('on a 2-2 rolling record and 112.2 PPG over the last three weeks.'))).toBe(1);
    // a different claim, kept
    expect(spellOutShorthand('2-1 L3 and 149.8 PPG over their last three games.')).toContain('over their last three games');
  });

  it('is stable for a blurb and varies across a column', () => {
    const t = 'but a 2-2 last three weeks and a two-game skid';
    expect(spellOutShorthand(t)).toBe(spellOutShorthand(t));
    const picks = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((x) => spellOutShorthand(`${x} sits on a 2-2 L3.`).replace(/^. /, '')));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('leaves "rolling" alone when it is not the window', () => {
    expect(spellOutShorthand('keeps the win train rolling with')).toBe('keeps the win train rolling with');
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
