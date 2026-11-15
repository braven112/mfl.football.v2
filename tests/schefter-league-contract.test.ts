import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore — js-yaml ships no bundled types and @types/js-yaml is not a dep
import yaml from 'js-yaml';
// @ts-ignore — sibling .mjs module, no .d.ts
import { SCHEFTER_LEAGUES } from '../scripts/lib/schefter-leagues.mjs';
import { SCHEFTER_ARTICLE_SLOTS } from '../src/utils/sync-cadence';

/**
 * A Schefter league object and a registry entry disagree about what `slug`
 * means: the Schefter one holds the NAV slug ('afl'), the registry one holds
 * the canonical slug ('afl-fantasy'). So anything that takes "a league" has to
 * say which shape it wants, and a caller handing over the wrong one is not a
 * type error in plain .mjs — it is a runtime throw, or worse, a silently
 * different Redis key.
 *
 * `postToGroupMeCapped` asks for `navSlug` and throws without it. Schefter
 * league objects did not carry that field, so EVERY GroupMe post from
 * schefter-scan.mjs threw — transactions and, because the guard sits above the
 * exemption check, Roger's exempt deadline reminders too. Nothing caught it:
 * the scanner's own tests stub the GroupMe layer, and the throw only happens
 * with real league objects in a real run.
 */
describe('Schefter league objects satisfy the shared-helper contract', () => {
  it('exposes navSlug, and it matches the nav slug this scanner uses', () => {
    expect(SCHEFTER_LEAGUES.length).toBeGreaterThan(0);
    for (const league of SCHEFTER_LEAGUES) {
      expect(league.navSlug, `${league.slug} is missing navSlug`).toBeTruthy();
      // Same value under both names — `slug` is what the scanners read, and
      // `navSlug` is what the shared GroupMe/push helpers read.
      expect(league.navSlug).toBe(league.slug);
    }
  });

  it('keeps navSlug and registrySlug distinct where the registry does', () => {
    const afl = SCHEFTER_LEAGUES.find((l: any) => l.navSlug === 'afl');
    expect(afl, 'no AFL Schefter league').toBeTruthy();
    // If these ever collapse to the same string the contract stops being
    // testable — the AFL is the league where the two genuinely differ.
    expect(afl.registrySlug).not.toBe(afl.navSlug);
  });

  it('would not throw the cap guard', async () => {
    // @ts-ignore — sibling .mjs module
    const { postToGroupMeCapped } = await import('../scripts/lib/groupme-capped.mjs');
    for (const league of SCHEFTER_LEAGUES) {
      await expect(
        // No bot id and an exempt kind: this returns without posting, so the
        // only thing it can fail on is the league-shape guard.
        postToGroupMeCapped({ league, kind: 'roger-reminder', botId: '', text: 'x' }),
      ).resolves.toBeDefined();
    }
  });
});

/**
 * Every scheduled column must be a type the workflow can be dispatched with.
 *
 * The schedule lives in `SCHEFTER_ARTICLE_SLOTS` (src/utils/sync-cadence.ts)
 * and Vercel's bridge dispatches `schefter-articles.yml` with `inputs.type`.
 * A slot whose type is not one of the workflow's `choice` options is refused
 * by GitHub with a 422 — on a schedule nobody reads — so the column silently
 * stops. This used to pin the cron → type `case` map, which is gone.
 */
describe('schefter-articles.yml dispatch types ↔ the slot table', () => {
  const file = path.resolve(__dirname, '../.github/workflows/schefter-articles.yml');
  const doc = yaml.load(readFileSync(file, 'utf8')) as Record<string, any>;
  // `on:` parses as the boolean true under YAML 1.1, so the key is literally
  // `true` — indexed as a string here because TS will not take a boolean key.
  const on = doc['true'] ?? doc.on;
  const options: string[] = on?.workflow_dispatch?.inputs?.type?.options ?? [];

  it('has dispatch options and slots to compare (sanity)', () => {
    expect(options.length).toBeGreaterThan(5);
    expect(SCHEFTER_ARTICLE_SLOTS.length).toBeGreaterThan(5);
  });

  it('every scheduled slot is a dispatchable type', () => {
    const missing = SCHEFTER_ARTICLE_SLOTS.map((s) => s.type).filter((t) => !options.includes(t));
    expect(missing, 'scheduled but not a workflow_dispatch option').toEqual([]);
  });

  it('the workflow has no GitHub schedule of its own', () => {
    expect(on?.schedule).toBeUndefined();
  });
});
