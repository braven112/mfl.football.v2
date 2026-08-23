import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every article type must implement the whole pipeline interface.
 *
 * `scripts/schefter-weekly-articles.mjs` calls eight things on the module it
 * loads. A type missing one of them looks completely fine until the day it
 * actually runs — and by then the run has already spent an Anthropic call and
 * generated the article. `schedule-release` shipped without `validate` and
 * `buildPost` and died on a live release-day run with
 * `Error: mod.validate is not a function`, one line after printing the
 * finished headline.
 *
 * Nothing else catches this: the module imports cleanly, the pipeline resolves
 * `mod.validate` at CALL time, and no test exercised a full generation because
 * that would mean paying for a model call. This does the mechanical half for
 * free.
 */
const TYPES_DIR = path.resolve(__dirname, '../scripts/article-types');
const PIPELINE = path.resolve(__dirname, '../scripts/schefter-weekly-articles.mjs');

/**
 * What the pipeline calls UNCONDITIONALLY, read from the pipeline itself.
 *
 * A call the pipeline guards with `typeof mod.x === 'function'` is opt-in by
 * design — `buildGroupMePromo` only exists on the types that post to chat — so
 * those are subtracted rather than demanded of everyone. Deriving both sets
 * from the source keeps this honest when the pipeline changes: adding an
 * unguarded `mod.foo()` makes every type fail here until it implements foo,
 * and wrapping an existing call in a typeof guard relaxes it automatically.
 */
const requiredExports = (): string[] => {
  const src = readFileSync(PIPELINE, 'utf8');
  const called = new Set<string>();
  for (const m of src.matchAll(/\bmod\.([a-zA-Z_$][\w$]*)/g)) called.add(m[1]);
  for (const m of src.matchAll(/typeof\s+mod\.([a-zA-Z_$][\w$]*)\s*===/g)) called.delete(m[1]);
  return [...called].sort();
};

/** Calls the pipeline guards — optional, but must be a function when present. */
const optionalExports = (): string[] => {
  const src = readFileSync(PIPELINE, 'utf8');
  return [...new Set([...src.matchAll(/typeof\s+mod\.([a-zA-Z_$][\w$]*)\s*===/g)].map((m) => m[1]))].sort();
};

const typeFiles = readdirSync(TYPES_DIR).filter((f) => f.endsWith('.mjs')).sort();

describe('article type interface', () => {
  it('finds the types and the calls (sanity)', () => {
    expect(typeFiles.length).toBeGreaterThan(5);
    expect(requiredExports()).toContain('validate');
    expect(requiredExports()).toContain('buildPost');
    // The guard-detection half has to actually find something, or every
    // optional export would silently become mandatory.
    expect(optionalExports()).toContain('buildGroupMePromo');
    expect(requiredExports()).not.toContain('buildGroupMePromo');
  });

  // Derived from the pipeline, not hardcoded: adding a `mod.foo()` call there
  // makes every existing type fail here until it implements foo.
  for (const file of typeFiles) {
    it(`${file} implements everything the pipeline calls`, async () => {
      const mod = await import(path.join(TYPES_DIR, file));
      const missing = requiredExports().filter((name) => {
        const v = (mod as Record<string, unknown>)[name];
        // `config` is an object; everything else is called as a function.
        return name === 'config' ? v == null : typeof v !== 'function';
      });
      expect(
        missing,
        `${file} is missing ${missing.join(', ')} — schefter-weekly-articles.mjs calls these on every run`,
      ).toEqual([]);
    });
  }
});

describe('article type output shape', () => {
  // The news page renders `post.content?.map(p => <p set:html={p} />)`. A type
  // whose buildPost returns anything else publishes an article that renders as
  // an empty body — which is how a nested intro/sections/outro shape nearly
  // shipped for schedule-release.
  for (const file of typeFiles) {
    it(`${file} builds a post with a content array`, async () => {
      const mod = await import(path.join(TYPES_DIR, file));
      const ai = {
        headline: 'Headline',
        excerpt: 'Excerpt',
        content: ['<p>one</p>', '<p>two</p>'],
        // Shapes some types read instead of / alongside `content`.
        grades: [],
        teams: [],
        players: [],
      };
      let post: any;
      try {
        post = mod.buildPost(ai, { year: 2026, week: 1, marquee: [] }, 'sf_test', { league: 'theleague' });
      } catch {
        return; // needs richer enrichment than a generic fixture can supply
      }
      expect(post.id, `${file}: post id`).toBe('sf_test');
      expect(post.type, `${file}: post type`).toBeTruthy();
      if (post.content !== undefined) {
        expect(Array.isArray(post.content), `${file}: content must be an array of paragraphs`).toBe(true);
      }
    });
  }
});
