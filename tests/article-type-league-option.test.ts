import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * Every article type's `buildPost` must honour the `{ league }` option it is
 * given, in BOTH the permalink and the feed tag.
 *
 * THE BUG THIS EXISTS FOR (issue #1086 F4). `scripts/schefter-weekly-articles.mjs`
 * has always passed `{ league }` into `buildPost` (`--league afl-fantasy` is a
 * supported invocation, and the workflow uses it for the types that run in both
 * leagues). Seven article types declared `buildPost(aiOutput, enrichment,
 * articleId)` — no fourth parameter at all — and hardcoded
 * `link: '/theleague/news/<id>'` and `league: 'theleague'`. Run for the AFL,
 * they wrote a post into the AFL's feed carrying a TheLeague permalink for a
 * post that only exists in the AFL's, tagged as a TheLeague post.
 *
 * The recap hero was made immune by CONSTRUCTING its href from the reader's
 * league (`src/utils/hero-recap-destination.ts`), but that only protects the
 * hero. Anything else reading the feed believes the tag and follows the link.
 *
 * DERIVED, NOT LISTED. The type set is read from the directory, so a new
 * article type is covered the day it lands rather than whenever someone
 * remembers to extend a list here.
 */
const TYPES_DIR = path.resolve(__dirname, '../scripts/article-types');

const AI_OUTPUT = {
  headline: 'Headline',
  excerpt: 'Excerpt',
  content: ['<p>Body</p>'],
};

function articleTypeFiles(): string[] {
  return readdirSync(TYPES_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
}

describe('article types honour their { league } option', () => {
  it('finds the article types on disk (sanity)', () => {
    // If the directory moves, every assertion below passes vacuously — which is
    // the failure mode to catch.
    const files = articleTypeFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('waiver-pickups.mjs');
  });

  for (const file of articleTypeFiles()) {
    const type = file.replace(/\.mjs$/, '');

    // NOT asserted by arity. `Function.length` stops counting at the first
    // parameter with a default, so a correct
    // `buildPost(a, b, c, { league = X } = {})` reports 3 — the same as the
    // broken three-parameter form. Only behaviour separates them.
    it(`${type} — writes the AFL's slug into link and league`, async () => {
      const mod = await import(path.join(TYPES_DIR, file));
      const afl = LEAGUES['afl-fantasy'].slug;

      const post = mod.buildPost(AI_OUTPUT, {}, `sf_2026_${type.replace(/-/g, '_')}_w05`, {
        league: 'afl-fantasy',
      });

      expect(post.league, `${type} tagged the post for the wrong league`).toBe(afl);
      // Some types build an absolute URL through the registry and some a
      // league-prefixed path; both are fine, but neither may name TheLeague.
      expect(String(post.link), `${type} built a TheLeague permalink`).not.toContain('theleague');
      expect(String(post.link)).toContain(afl);
    });

    it(`${type} — still defaults to TheLeague when given no option`, async () => {
      const mod = await import(path.join(TYPES_DIR, file));
      const post = mod.buildPost(AI_OUTPUT, {}, `sf_2026_${type.replace(/-/g, '_')}_w05`);
      expect(post.league).toBe(LEAGUES['theleague'].slug);
    });

    /**
     * The tag is only half of it. `buildFactSheet` decides what the article
     * SAYS, and `loadTeams(projectRoot)` defaults to TheLeague — so an
     * `--league afl-fantasy` run built AFL prose out of TheLeague's franchise
     * names. That mismatch is invisible rather than loud, because both leagues
     * have a franchise 0001, so every id resolves to a real-looking wrong team.
     *
     * Asserted on the source because reaching the behaviour needs both
     * leagues' feed files on disk; the call shape is the whole rule.
     */
    it(`${type} — loads franchise names for the league, not the default`, () => {
      const src = readFileSync(path.join(TYPES_DIR, file), 'utf8');
      const bareCalls = src.match(/loadTeams\(\s*projectRoot\s*\)/g) ?? [];
      expect(bareCalls, `${file} calls loadTeams without a league`).toEqual([]);
    });
  }
});
