/**
 * Max Insider's realism kit (scripts/lib/beat-reporter-examples.mjs): the
 * example bank, the news-picks-the-style map, the openers memory, and the
 * callbacks to his own columns — plus where each lands in a prompt.
 */
import { describe, expect, it } from 'vitest';
import {
  BEAT_EXAMPLES,
  BEAT_LANES,
  beatExamplesBlock,
  callbackLinks,
  lanesForNews,
  pickBeatExamples,
  recentPersonaOpeners,
} from '../scripts/lib/beat-reporter-examples.mjs';
import { buildMovePrompt } from '../scripts/lib/schefter-move-story.mjs';
import { buildPersonaBlock } from '../scripts/article-utils/ai-client.mjs';
import { linkDirective } from '../scripts/article-utils/article-links.mjs';
import { BEAT_REPORTER_PERSONA, DEFAULT_PERSONA } from '../src/utils/persona.mjs';

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe('the example bank', () => {
  const all = BEAT_LANES.flatMap((l) => BEAT_EXAMPLES[l]);

  it('never names a real reporter or borrows a catchphrase', () => {
    for (const e of all) expect(e).not.toMatch(/Schefter|Glazer|Rapoport|Pelissero|Fowler|Stephen|Boom|Officially official/i);
  });

  it('uses placeholders, never a team name', () => {
    for (const e of all) expect(e).toMatch(/\[(TEAM|OWNER|PLAYER|N)\]|^What I am hearing/);
  });

  it('draws without repeats, preferring the lanes the news picked', () => {
    const picks = pickBeatExamples({ lanes: ['measured'], count: 3, random: seeded(7) });
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
    expect(BEAT_EXAMPLES.measured).toContain(picks[0]);
    expect(BEAT_EXAMPLES.measured).toContain(picks[1]);
  });

  it('lets the news pick the style', () => {
    expect(lanesForNews('IR')).toEqual(['measured']);
    expect(lanesForNews('TRADE')[0]).toBe('numbers');
    expect(lanesForNews('pecking-order')).toContain('hot-take');
    expect(lanesForNews('unknown')).toEqual([]);
  });

  it('fences the examples as rhythm only', () => {
    expect(beatExamplesBlock([])).toBe('');
    expect(beatExamplesBlock(['[TEAM] placed [PLAYER] on IR.'])).toMatch(/placeholders, nothing here is a fact/);
  });
});

describe('the openers memory', () => {
  const posts = [
    { authorId: 'claude', timestamp: '2026-11-10T00:00:00Z', body: 'The Yetis are adding a running back tonight.' },
    { authorId: 'vegas-vic', timestamp: '2026-11-12T00:00:00Z', body: 'Lines moved.' },
    { timestamp: '2026-11-11T00:00:00Z', body: '<p>Word around the league is the SeaBirds are sellers.</p>' },
  ];

  it("reads only the persona's own posts, newest first, with team names masked", () => {
    expect(recentPersonaOpeners(posts, ['Yetis', 'SeaBirds'])).toEqual([
      'Word around the league is',
      'The [TEAM] are adding a',
    ]);
  });
});

describe('callbacks to earlier columns', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  const posts = [
    { id: 'a', type: 'article', authorId: 'claude', timestamp: '2026-11-14T16:00:00Z', headline: 'Preview', link: '/archies/news/a' },
    { id: 'b', type: 'article', authorId: 'claude', timestamp: '2026-10-01T16:00:00Z', headline: 'Old', link: '/archies/news/b' },
    { id: 'c', type: 'transaction', timestamp: '2026-11-14T16:00:00Z', headline: 'Move', link: '/archies/news/c' },
    { id: 'd', type: 'article', authorId: 'claude', timestamp: '2026-11-13T16:00:00Z', headline: 'This one', link: '/archies/news/d' },
  ];

  it('offers recent columns only, never the one being written', () => {
    expect(callbackLinks(posts, { now, excludeId: 'd' }).map((l) => l.href)).toEqual(['/archies/news/a']);
  });

  it('gets its own optional section in the link directive', () => {
    const text = linkDirective(callbackLinks(posts, { now }));
    expect(text).toMatch(/YOUR EARLIER REPORTING — call back to AT MOST ONE/);
    expect(text).toContain('<a href="/archies/news/a">Preview</a> (published 2026-11-14)');
    expect(text).not.toMatch(/LINK THESE TOO/);
  });
});

describe('where it lands', () => {
  const facts = { leagueName: "Archie's", kind: 'waiver claim', team: '{{TEAM:0001}}', added: [], dropped: [], price: null };

  it("keeps Schefter's move prompt byte-for-byte", () => {
    expect(buildMovePrompt(facts).system).toBe(buildMovePrompt(facts, { persona: DEFAULT_PERSONA, examples: ['x'] }).system);
    expect(buildMovePrompt(facts).system).toMatch(/^You are Claude Schefter/);
  });

  it('gives the house reporter his voice, examples and openers', () => {
    const { system } = buildMovePrompt(facts, {
      persona: BEAT_REPORTER_PERSONA,
      examples: ['[TEAM] placed [PLAYER] on IR.'],
      recentOpeners: ['Word around the league is'],
    });
    expect(system).toMatch(/^You are Max Insider/);
    expect(system).toContain(BEAT_REPORTER_PERSONA.voice);
    expect(system).toContain('[TEAM] placed [PLAYER] on IR.');
    expect(system).toContain('"Word around the league is"');
    expect(system).toContain('HARD RULES');
  });

  it('adds examples and openers to the article persona block only when given', () => {
    const plain = buildPersonaBlock(BEAT_REPORTER_PERSONA);
    expect(plain).not.toMatch(/EXAMPLES|RECENT OPENERS/);
    const rich = buildPersonaBlock({ ...BEAT_REPORTER_PERSONA, examples: ['[TEAM] officially added [PLAYER].'], recentOpeners: ['Per a league source'] });
    expect(rich).toMatch(/EXAMPLES OF YOUR DELIVERY/);
    expect(rich).toMatch(/RECENT OPENERS/);
  });
});
