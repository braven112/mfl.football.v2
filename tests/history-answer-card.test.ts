import { describe, expect, it } from 'vitest';
import { askAtLabel, buildAnswerCardTree, cardTeams, MAX_TIE_LOGOS, clipWords, headlineSize, teamIcon, ANSWER_CARD_HEIGHT, ANSWER_CARD_WIDTH } from '../src/utils/league-history/answer-card';
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

  describe('tied teams (Brandon, 2026-11-12: show both logos side by side)', () => {
    const row = (fid: string | null, titles: number, year: number | null = null) => ({ cells: ['x', titles, 2020], franchiseId: fid, year });
    it('shows every team tied on the headline number', () => {
      const table = { rows: [row('0007', 3), row('0008', 3), row('0015', 2)] };
      expect(cardTeams(table, { value: '3 titles' }).map((t) => t.franchiseId)).toEqual(['0007', '0008']);
    });
    it('shows one team when nothing ties', () => {
      const table = { rows: [row('0002', 3), row('0007', 2)] };
      expect(cardTeams(table, { value: '3 titles' }).map((t) => t.franchiseId)).toEqual(['0002']);
    });
    it('falls back to the top team when the headline has no number in the row', () => {
      const table = { rows: [row('0002', 3), row('0007', 3)] };
      expect(cardTeams(table, { value: 'Drunk Indians' }).map((t) => t.franchiseId)).toEqual(['0002']);
      expect(cardTeams(table, null).map((t) => t.franchiseId)).toEqual(['0002']);
    });
    it('reads numbers with commas and counts each team once, capped', () => {
      const rows = ['1', '2', '3', '4', '5', '1'].map((f) => ({ cells: [1021], franchiseId: f, year: null }));
      expect(cardTeams({ rows }, { value: '1,021 pts' })).toHaveLength(MAX_TIE_LOGOS);
    });
    it('names no team when the top row has none', () => {
      expect(cardTeams({ rows: [row(null, 3)] }, { value: '3' })).toEqual([]);
      expect(cardTeams(null, { value: '3' })).toEqual([]);
    });
  });
});
