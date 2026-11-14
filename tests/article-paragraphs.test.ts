import { describe, it, expect } from 'vitest';
import {
  articleParagraphs,
  articleTypeOf,
  shortenParagraphs,
  splitSentences,
  MAX_PAIRED_CHARS,
} from '../src/utils/article-paragraphs.mjs';

describe('splitSentences', () => {
  it('splits on sentence ends and keeps abbreviations, initials and decimals whole', () => {
    expect(
      splitSentences('<p>T.J. Watt and St. Brown went 3-0 vs. the Ninjas at 22.4 points. Boom! "Wow," he said.</p>'),
    ).toEqual(['T.J. Watt and St. Brown went 3-0 vs. the Ninjas at 22.4 points.', 'Boom!', '"Wow," he said.']);
  });

  it('never splits inside a link', () => {
    expect(splitSentences('Check <a href="/x">it. Now</a> please. Then go.')).toEqual([
      'Check <a href="/x">it. Now</a> please.',
      'Then go.',
    ]);
  });

  it('keeps a closing quote with its sentence', () => {
    expect(splitSentences('He said "go." Then left.')).toEqual(['He said "go."', 'Then left.']);
  });
});

describe('shortenParagraphs', () => {
  it('never puts three sentences in one paragraph', () => {
    const out = shortenParagraphs(['<p>One. Two. Three. Four. Five.</p>']);
    expect(out).toEqual(['One. Two.', 'Three. Four.', 'Five.']);
  });

  it('keeps a long sentence on its own', () => {
    const long = `Big ${'word '.repeat(Math.ceil(MAX_PAIRED_CHARS / 5)).trim()}.`;
    expect(shortenParagraphs([`Short one. ${long} Tail.`])).toEqual(['Short one.', long, 'Tail.']);
  });

  it('never joins sentences across the paragraphs the writer chose', () => {
    expect(shortenParagraphs(['<p>A.</p>', '<p>B.</p>'])).toEqual(['A.', 'B.']);
  });
});

describe('articleParagraphs', () => {
  it('re-flows the two preview types and nothing else', () => {
    const content = ['<p>One. Two. Three.</p>'];
    expect(articleTypeOf({ id: 'sf_2026_weekend_preview_w09' })).toBe('weekend-preview');
    expect(articleTypeOf({ id: 'sf_2026_matchup_preview_w09' })).toBe('matchup-preview');
    expect(articleParagraphs({ id: 'sf_2026_weekend_preview_w09', content })).toHaveLength(2);
    expect(articleParagraphs({ id: 'sf_2026_week_recap_w09', content })).toBe(content);
  });
});
