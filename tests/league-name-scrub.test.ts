import { describe, expect, it } from 'vitest';
import {
  scrubLeagueNames,
  scrubPostLeagueNames,
  foreignNames,
} from '../scripts/article-utils/league-name-scrub.mjs';
import { buildCachedSystem } from '../scripts/article-utils/ai-client.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

// Resolved from the registry, never a slug literal: the league whose name is
// an ordinary English phrase, and one that is not it.
const PHRASE_LEAGUE = Object.keys(LEAGUES).find((s) => /^The\s/.test(LEAGUES[s].name))!;
const PHRASE = LEAGUES[PHRASE_LEAGUE].name;
const ACRONYM_LEAGUE = Object.keys(LEAGUES).find((s) => /^[A-Z]{2,}$/.test(LEAGUES[s].name))!;
const ACRONYM = LEAGUES[ACRONYM_LEAGUE].name;

describe('league-name scrub', () => {
  it("rewrites the AFL's Week 5 Gauntlet headline that shipped", () => {
    expect(scrubLeagueNames(`Week 5 Wall: ${PHRASE} Hits the Gauntlet`, ACRONYM_LEAGUE)).toBe(
      `Week 5 Wall: The ${ACRONYM} Hits the Gauntlet`,
    );
  });

  it('lower-cases the article mid-sentence and catches the run-together spelling', () => {
    const glued = PHRASE.replace(/\s+/g, '');
    expect(scrubLeagueNames(`Nobody in ${PHRASE} and ${glued}'s rivals`, ACRONYM_LEAGUE)).toBe(
      `Nobody in the ${ACRONYM} and the ${ACRONYM}'s rivals`,
    );
  });

  it('leaves markup alone and only touches text', () => {
    const html = `<p><a href="/x" title="${PHRASE}">${PHRASE}</a></p>`;
    expect(scrubLeagueNames(html, ACRONYM_LEAGUE)).toBe(
      `<p><a href="/x" title="${PHRASE}">The ${ACRONYM}</a></p>`,
    );
  });

  it('never rewrites a league\'s own name, nor lower-case "the league"', () => {
    expect(scrubLeagueNames(`${PHRASE} Hits the Gauntlet`, PHRASE_LEAGUE)).toBe(`${PHRASE} Hits the Gauntlet`);
    expect(scrubLeagueNames('the league-wide wall', ACRONYM_LEAGUE)).toBe('the league-wide wall');
  });

  it('only treats "The X" names as collisions', () => {
    expect(foreignNames(PHRASE_LEAGUE)).not.toContain(ACRONYM);
    expect(foreignNames(ACRONYM_LEAGUE)).toContain(PHRASE);
  });

  it('scrubs every reader-facing field of a post and reports which', () => {
    const post = {
      headline: `${PHRASE} Hits the Wall`,
      body: 'clean',
      content: [`<p>${PHRASE} is tough.</p>`, '<p>ok</p>'],
    };
    expect(scrubPostLeagueNames(post, ACRONYM_LEAGUE)).toEqual(['headline', 'content']);
    expect(post.headline).toBe(`The ${ACRONYM} Hits the Wall`);
    expect(post.content[0]).toBe(`<p>The ${ACRONYM} is tough.</p>`);
  });

  it("tells the model the other league's name is off limits, only off its own league", () => {
    const text = (slug: string) => buildCachedSystem('X', { league: slug }).at(-1)!.text;
    expect(text(ACRONYM_LEAGUE)).toContain(`"${PHRASE}" is the name of a different league`);
    expect(text(PHRASE_LEAGUE)).not.toContain('is the name of a different league');
  });
});
