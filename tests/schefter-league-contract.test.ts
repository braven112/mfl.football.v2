import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore — js-yaml ships no bundled types and @types/js-yaml is not a dep
import yaml from 'js-yaml';
// @ts-ignore — sibling .mjs module, no .d.ts
import { SCHEFTER_LEAGUES } from '../scripts/lib/schefter-leagues.mjs';

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
 * Every scheduled cron must resolve to an article type.
 *
 * The workflow maps `github.event.schedule` — the literal cron STRING — to a
 * type through a `case`. Adding a schedule entry without adding its arm gives
 * a run with `TYPE=""`, which is not an error anywhere: the job proceeds and
 * generates nothing. Splitting the owners-poll close into two DST-safe entries
 * is exactly the edit that trips this, and it tripped it.
 */
describe('schefter-articles.yml cron → article type', () => {
  const file = path.resolve(__dirname, '../.github/workflows/schefter-articles.yml');
  const src = readFileSync(file, 'utf8');
  const doc = yaml.load(src) as Record<string, any>;
  // `on:` parses as the boolean true under YAML 1.1, so the key is literally
  // `true` — indexed as a string here because TS will not take a boolean key.
  const schedule = (doc['true'] ?? doc.on)?.schedule ?? [];
  const crons: string[] = schedule.map((s: any) => s.cron);
  const mapped = new Set([...src.matchAll(/"([^"]+)"\)\s*TYPE=/g)].map((m) => m[1]));

  it('parses a non-empty schedule', () => {
    expect(crons.length).toBeGreaterThan(5);
  });

  it('maps every scheduled cron to a type', () => {
    const unmapped = crons.filter((c) => !mapped.has(c));
    expect(unmapped, `scheduled but unmapped — these runs generate nothing`).toEqual([]);
  });

  it('has no case arm for a cron that no longer exists', () => {
    const orphaned = [...mapped].filter((m) => !crons.includes(m));
    expect(orphaned, 'case arms whose cron was removed or edited').toEqual([]);
  });
});
