import { describe, it, expect } from 'vitest';
import { attachGameStories, buildPost, validate, getUserPrompt } from '../scripts/article-types/matchup-preview.mjs';

// Two cards in stakes order; the fact sheet numbers pairings in schedule order.
const visuals = {
  year: 2026,
  week: 11,
  gameOfWeek: 0,
  matchups: [
    { a: { franchiseId: '0003' }, b: { franchiseId: '0004' }, series: null },
    { a: { franchiseId: '0001' }, b: { franchiseId: '0002' }, series: null },
  ],
};
// MATCHUP 1 = 0001 v 0002, MATCHUP 2 = 0004 v 0003.
const pairKeys = ['0001-0002', '0003-0004'];

describe('attachGameStories', () => {
  it('puts each write-up on the card for its MATCHUP number, as plain text', () => {
    const out = attachGameStories(
      visuals,
      [
        { matchup: 2, paragraphs: ['<p>The big one. <a href="/x">Read</a> it.</p>', 'Pick: 0003.'] },
        { matchup: 1, paragraphs: ['Quick hitter.'] },
      ],
      pairKeys,
      { closing: ['Watch <b>BUF</b> at KC.'] },
    );
    expect(out.matchups[0].story).toEqual(['The big one. Read it.', 'Pick: 0003.']);
    expect(out.matchups[1].story).toEqual(['Quick hitter.']);
    expect(out.closing).toEqual(['Watch BUF at KC.']);
    // The snapshot passed in is not mutated.
    expect(visuals.matchups[0]).not.toHaveProperty('story');
  });

  it('drops a number with no card and empty write-ups', () => {
    const out = attachGameStories(visuals, [{ matchup: 9, paragraphs: ['Nope.'] }, { matchup: 1, paragraphs: [''] }], pairKeys);
    expect(out.matchups.every((m: { story?: string[] }) => !m.story)).toBe(true);
    expect(out).not.toHaveProperty('closing');
  });
});

describe('matchup preview post', () => {
  it('carries the stories on matchupVisuals and keeps the opener short', () => {
    const post = buildPost(
      {
        headline: 'H',
        excerpt: 'E',
        content: ['<p>Opener.</p>'],
        games: [{ matchup: 1, paragraphs: ['Quick hitter.'] }],
        closing: ['Watch this.'],
      },
      { visuals, pairKeys },
      'sf_2026_matchup_preview_w11',
      { league: 'theleague' },
    );
    expect(post.content).toEqual(['<p>Opener.</p>']);
    expect(post.matchupVisuals.matchups[1].story).toEqual(['Quick hitter.']);
    expect(post.matchupVisuals.closing).toEqual(['Watch this.']);
  });

  it('requires per-game write-ups', () => {
    expect(validate({ headline: 'H', excerpt: 'E', content: ['<p>x</p>'] })).toContain('Missing per-game write-ups');
    expect(validate({ headline: 'H', excerpt: 'E', content: ['<p>x</p>'], games: [{ matchup: 1, paragraphs: ['x'] }] })).toEqual([]);
  });

  it('asks for a long featured game and quick hitters for the rest', () => {
    const prompt = getUserPrompt('FACTS');
    expect(prompt).toMatch(/FEATURED GAME gets the long write-up: about 10 sentences/);
    expect(prompt).toMatch(/quick hitter: 2-5 sentences/);
  });
});
