/**
 * /afl-fantasy/playoffs used to split its Championship and NIT tabs on
 * hardcoded bracket ids (winners 1-5, NIT 6-9). That mapping is only true from
 * 2018 on: the NIT is bracket 3 in 2005, 4 in 2006 and 5 from 2007-2017, so
 * every pre-2018 NIT rendered under the Championship tab while the NIT tab sat
 * empty — invisible until the reconstructed brackets gave those seasons games
 * to render in the first place.
 *
 * These tests run the classifier over every committed AFL bracket feed, so a
 * season whose naming breaks the assumption fails here rather than on the page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  bracketKindFromName,
  buildBracketKindResolver,
  isNitTitleBracket,
} from '../src/utils/afl-bracket-kind.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const FEEDS = path.join(path.resolve(__dirname, '..'), getLeagueBySlug('afl-fantasy').dataPath, 'mfl-feeds');
const toArray = <T,>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];

const seasons = readdirSync(FEEDS)
  .filter((d) => /^\d{4}$/.test(d))
  .filter((d) => existsSync(path.join(FEEDS, d, 'playoff-brackets.json')))
  .sort();

const metasFor = (year: string) =>
  toArray<any>(
    JSON.parse(readFileSync(path.join(FEEDS, year, 'playoff-brackets.json'), 'utf8'))
      ?.playoffBrackets?.playoffBracket
  );

describe('AFL bracket classification', () => {
  it('has feeds to classify', () => {
    expect(seasons.length).toBeGreaterThanOrEqual(20);
  });

  it.each(seasons)('%s puts the NIT on the NIT side and the title on the other', (year) => {
    const metas = metasFor(year).filter((b) => Number(b.startWeek) >= 13);
    const kindOf = buildBracketKindResolver(metas);

    const nit = metas.filter((b) => kindOf(b.id) === 'nit');
    expect(nit.length, `${year} found no NIT bracket`).toBeGreaterThan(0);
    for (const b of nit) expect(String(b.name)).toMatch(/NIT/i);

    // Exactly one NIT bracket is the actual title bracket, never zero or two —
    // the playoffs page sorts it to the front to award the NIT Champion prize.
    const titles = nit.filter((b) => isNitTitleBracket(b.name));
    expect(titles.map((b) => b.name), `${year} NIT title brackets`).toHaveLength(1);

    // Nothing named for the AFL title lands on the NIT side.
    for (const b of metas) {
      if (/^AFL Championship/i.test(String(b.name))) {
        expect(kindOf(b.id), `${year} bracket ${b.id}`).toBe('championship');
      }
    }
  });

  it('reads AL and NL as conference brackets only when they are named that way', () => {
    // 2018+ ids 2/3 are the conference brackets; the same ids in 2005 are the
    // AFL Losers Bracket and the NIT, which is exactly the collision that made
    // id-based classification wrong.
    const modern = buildBracketKindResolver(metasFor('2019'));
    expect(modern('2')).toBe('al');
    expect(modern('3')).toBe('nl');

    const old = buildBracketKindResolver(metasFor('2005'));
    expect(old('2')).toBe('championship'); // AFL Losers Bracket
    expect(old('3')).toBe('nit');
  });

  it('falls back to the modern id map only when a bracket has no name', () => {
    expect(bracketKindFromName(undefined, '6')).toBe('nit');
    expect(bracketKindFromName('', '2')).toBe('al');
    expect(bracketKindFromName('   ', '1')).toBe('championship');
    // A name always wins over the id.
    expect(bracketKindFromName('NIT Championship', '5')).toBe('nit');
    expect(bracketKindFromName('AFL Championship', '2')).toBe('championship');
  });

  it('treats the AFL Cup as its own in-season competition', () => {
    // Weeks 4-12, 2012-2016. Its ids run 9-15, so the old id split filed seven
    // empty "Bracket data not available" cards onto the NIT tab every year.
    const cup = buildBracketKindResolver(metasFor('2014'));
    expect(cup('9')).toBe('cup');
    expect(cup('15')).toBe('cup');
    expect(cup('5')).toBe('nit');
    expect(cup('1')).toBe('championship');
  });

  it('does not mistake other words for the AL/NL conferences', () => {
    // Substring matching on "NL"/"AL" would swallow "NIT Consolation" and
    // "AFL Championship"; the classifier anchors on a leading word.
    expect(bracketKindFromName('NIT Consolation 1', '7')).toBe('nit');
    expect(bracketKindFromName('AFL Consolation Bracket', '2')).toBe('championship');
    expect(bracketKindFromName('AFL 5th Place Game', '3')).toBe('championship');
  });

  it('keeps the playoffs page off hardcoded NIT id lists', () => {
    // The regression this file exists for. If a future edit reintroduces an
    // id-range split, this fails instead of silently emptying the NIT tab for
    // fifteen seasons.
    const page = readFileSync(
      path.join(path.resolve(__dirname, '..'), 'src/pages/afl-fantasy/playoffs.astro'),
      'utf8'
    );
    expect(page).toContain('buildBracketKindResolver');
    expect(page).not.toMatch(/\['6',\s*'7',\s*'8',\s*'9'\]/);
  });
});
