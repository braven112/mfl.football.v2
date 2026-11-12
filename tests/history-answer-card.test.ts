import { describe, expect, it } from 'vitest';
import { askAtLabel, buildAnswerCardTree, clipWords, headlineSize, teamIcon, ANSWER_CARD_HEIGHT, ANSWER_CARD_WIDTH } from '../src/utils/league-history/answer-card';
import { shareText } from '../src/utils/league-history/share-answer';

describe('Ask the History share card', () => {
  it('is portrait (Brandon, 2026-11-12: landscape cards look bad shared on a phone)', () => {
    expect(ANSWER_CARD_HEIGHT).toBeGreaterThan(ANSWER_CARD_WIDTH);
    const tree = buildAnswerCardTree({ leagueName: 'L', question: 'q?', headline: null, answer: 'a', askAt: 'x.com/history/ask' });
    expect(tree.props.style).toMatchObject({ width: ANSWER_CARD_WIDTH, height: ANSWER_CARD_HEIGHT });
  });

  it('clips long text at a word, with an ellipsis', () => {
    const out = clipWords('one two three four five six seven', 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(clipWords('short', 20)).toBe('short');
  });

  it('shrinks the headline as it gets longer', () => {
    expect(headlineSize('12')).toBeGreaterThan(headlineSize('249.30 pts'));
    expect(headlineSize('249.30 pts')).toBeGreaterThan(headlineSize('a very long headline'));
  });

  it("takes the team's logo from the answer's season, else its latest", () => {
    const data = { seasons: [{ y: 2007, teams: { '0001': { i: '/a.png' } } }, { y: 2008, teams: { '0001': { i: '/b.png' } } }] };
    expect(teamIcon(data, '0001', 2007)).toBe('/a.png');
    expect(teamIcon(data, '0001', null)).toBe('/b.png');
    expect(teamIcon(data, '0009', 2007)).toBeNull();
    expect(teamIcon(null, '0001', 2007)).toBeNull();
  });

  it('prints the ask link without a scheme or www', () => {
    expect(askAtLabel('https://www.theleague.us/history/ask')).toBe('theleague.us/history/ask');
  });

  it('ends the share text with the link, so GroupMe cannot autolink punctuation into it', () => {
    const url = 'https://www.theleague.us/history/ask/abcdefghij';
    expect(shareText('Who won?', url).endsWith(url)).toBe(true);
  });
});
