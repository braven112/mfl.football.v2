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

    /**
     * The PERSONA is the third place a league can be named, and it was the
     * last to be fixed. `BASE_SYSTEM_PROMPT` used to open "beat reporter and
     * league insider for TheLeague — a 16-team dynasty fantasy football
     * league" for every type and every league. That is not a cosmetic
     * mis-naming: the AFL is 24 teams in two conferences, so the model was
     * handed a league size to reason from that was wrong by eight teams.
     *
     * It survived the #1086 F4 pass because the runner called
     * `mod.getSystemPrompt()` with NO arguments — a type had nothing to
     * honour. Both halves are pinned here: the call must accept the option,
     * and the prompt must use it.
     */
    it(`${type} — names the reader's league in its system prompt`, async () => {
      const mod = await import(path.join(TYPES_DIR, file));
      const text = mod
        .getSystemPrompt({ league: 'afl-fantasy' })
        .map((b: { text: string }) => b.text)
        .join('');

      expect(text, `${type} never names the AFL`).toContain(LEAGUES['afl-fantasy'].name);
      expect(text, `${type} names TheLeague in an AFL prompt`).not.toContain(
        LEAGUES['theleague'].name,
      );
      // The old hardcode, and the specific claim that made it more than a typo.
      expect(text, `${type} still asserts a hardcoded league size`).not.toMatch(/\d+-team/);
    });
  }
});

/**
 * The shared preamble carries `cache_control: ephemeral`, so it is tokenized
 * once and reused across every article generation in the window. It is shared
 * across LEAGUES too, which is why the league is named in the second block
 * instead of baked into this one: a league name here would fork one cache
 * entry into one per league, and each league's first article of a window would
 * pay full tokenization for a preamble identical apart from a proper noun.
 *
 * `scripts/lib/pecking-order-ai.mjs` reached this conclusion first and names
 * its league inline in the per-issue text, passing no `league` — so the
 * no-option call must keep working, unnamed, rather than throwing.
 */
describe('the cached preamble stays league-neutral', () => {
  it('is byte-identical for both leagues, and names neither', async () => {
    const { buildCachedSystem } = await import('../scripts/article-utils/ai-client.mjs');

    const cachedFor = (league: string) =>
      buildCachedSystem('TYPE TEXT', { league }).find(
        (b: { cache_control?: unknown }) => b.cache_control,
      )!.text;

    expect(cachedFor('theleague')).toBe(cachedFor('afl-fantasy'));
    for (const slug of ['theleague', 'afl-fantasy'] as const) {
      expect(cachedFor(slug)).not.toContain(LEAGUES[slug].name);
    }
    expect(cachedFor('theleague')).not.toMatch(/\d+-team/);
  });

  it('still builds without a league, for the caller that names its own', async () => {
    const { buildCachedSystem } = await import('../scripts/article-utils/ai-client.mjs');
    const blocks = buildCachedSystem('TYPE TEXT');
    expect(blocks).toHaveLength(2);
    expect(blocks[1].text).toBe('TYPE TEXT');
  });

  it('refuses a league the registry does not have', async () => {
    const { buildCachedSystem } = await import('../scripts/article-utils/ai-client.mjs');
    expect(() => buildCachedSystem('TYPE TEXT', { league: 'not-a-league' })).toThrow(
      /Unknown league/,
    );
  });
});
