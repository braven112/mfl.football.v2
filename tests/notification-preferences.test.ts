/**
 * Notification command center: the category registry, preference storage, and
 * the filter inside sendPushToFranchise.
 *
 * The invariant that matters most: an alert an owner has turned off must not
 * arrive anyway. That can fail three ways — a sender that forgets to declare a
 * category, a category that no longer exists, and a league that cannot send
 * the category at all — so all three are pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
let redisAvailable = true;
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () =>
    redisAvailable
      ? {
          get: async (k: string) => store.get(k) ?? null,
          set: async (k: string, v: unknown) => {
            store.set(k, v);
            return 'OK';
          },
        }
      : null,
}));

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_GROUPS,
  categoriesForLeague,
  visibleCategoriesForLeague,
  defaultPreferences,
  isCategoryEnabled,
  notificationCategoryIds,
  getNotificationCategory,
} from '../src/config/notification-categories';
import {
  preferencesKey,
  readPreferences,
  writePreferences,
  resolvePreferences,
  sanitize,
} from '../src/utils/push-preferences';
import { LEAGUES } from '../src/config/leagues';

// The gates take the LEAGUE, not its feature block: poll enablement lives in
// the registry's `ownersPoll` entry, outside `features`, and passing features
// alone made it unreachable — which is how the AFL came to be offered three
// Owners' Poll toggles (one ON by default) for a poll it does not run.
const FEATURES = LEAGUES.theleague;
const AFL_FEATURES = LEAGUES['afl-fantasy'];
// A league that genuinely runs no poll. Best Ball, not the AFL: the AFL was
// the original example here and started running the poll in Sep 2026, at which
// point using it as the negative case would have tested nothing.
const NO_POLL_FEATURES = LEAGUES['best-ball-1'];

beforeEach(() => {
  store.clear();
  redisAvailable = true;
});

describe('the category registry', () => {
  it('has unique ids and a known group for every category', () => {
    const ids = notificationCategoryIds();
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(NOTIFICATION_GROUPS.map((g) => g.id));
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(groups.has(c.group), `${c.id} has unknown group ${c.group}`).toBe(true);
    }
  });

  it('keeps the default-on set small and personal', () => {
    // An owner who never opens the page should get only what is waiting on
    // them or costs them if missed. A default-on firehose is how push
    // permission gets revoked, and permission is hard to win back.
    const on = visibleCategoriesForLeague(FEATURES).filter((c) => c.defaultOn);
    expect(on.length).toBeLessThanOrEqual(5);
    for (const c of on) {
      expect(c.cadence, `${c.id} is on by default but high volume`).not.toMatch(/firehose/i);
    }
  });

  it('describes every category and its volume, so an owner can decide', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(c.description.length, `${c.id}`).toBeGreaterThan(10);
      expect(c.cadence.length, `${c.id}`).toBeGreaterThan(3);
    }
  });

  it('hides categories that have no sender yet', () => {
    // A toggle that silently does nothing is worse than an absent one.
    const shown = new Set(visibleCategoriesForLeague(FEATURES).map((c) => c.id));
    for (const c of NOTIFICATION_CATEGORIES) {
      if (!c.live) expect(shown.has(c.id), `${c.id} is not live but is shown`).toBe(false);
    }
  });

  it('hides the system-test category from the settings page', () => {
    // It exists so the test button travels the same path as a real alert;
    // a toggle for it would be a control whose only effect is breaking that.
    expect(getNotificationCategory('system-test')?.hidden).toBe(true);
    expect(visibleCategoriesForLeague(FEATURES).some((c) => c.id === 'system-test')).toBe(false);
    // …but it IS a real category, so the sender's filter lets it through.
    expect(isCategoryEnabled('system-test', {}, FEATURES)).toBe(true);
  });

  it('only offers a feature-gated category where the league has the feature', () => {
    const lineup = getNotificationCategory('lineup-deadline')!;
    expect(lineup.requiresFeature).toBe('liveLineups');
    const withOut = { ...FEATURES, features: { ...FEATURES.features, liveLineups: false } };
    expect(categoriesForLeague(withOut).some((c) => c.id === 'lineup-deadline')).toBe(false);
    expect(isCategoryEnabled('lineup-deadline', { 'lineup-deadline': true }, withOut)).toBe(false);
  });

  it('offers a sensible set to a league with different features', () => {
    expect(visibleCategoriesForLeague(AFL_FEATURES).length).toBeGreaterThan(3);
  });

  /**
   * A league that runs no Owners' Poll (`ownersPoll.enabled: false`) must not
   * be offered its toggles — that is a switch that can never fire, and
   * `poll-result` is defaultOn, so it would be ON for every owner of it. The
   * AFL was the case that shipped this bug; Best Ball is the case that keeps
   * testing it now that the AFL runs the poll.
   */
  it('hides the Owners\' Poll categories from a league that does not run it', () => {
    const shown = new Set(visibleCategoriesForLeague(NO_POLL_FEATURES).map((c) => c.id));
    for (const id of ['poll-result', 'poll-open', 'poll-reminder']) {
      expect(shown.has(id), `${id} offered to a league with no poll`).toBe(false);
      // And refused at the SEND door, not merely hidden from the page.
      expect(isCategoryEnabled(id, { [id]: true }, NO_POLL_FEATURES)).toBe(false);
    }
  });

  it('offers them to EVERY league that runs it, the AFL included', () => {
    // The poll gate is `ownersPoll.enabled`, deliberately not a `features`
    // flag — so the AFL gets all three despite having liveLineups off.
    for (const league of [FEATURES, AFL_FEATURES]) {
      const shown = new Set(visibleCategoriesForLeague(league).map((c) => c.id));
      for (const id of ['poll-result', 'poll-open', 'poll-reminder']) {
        expect(shown.has(id), `${id} missing from ${league.slug}`).toBe(true);
      }
      expect(isCategoryEnabled('poll-result', {}, league)).toBe(true);
    }
  });
});

describe('isCategoryEnabled', () => {
  it('uses the default when the owner has never chosen', () => {
    expect(isCategoryEnabled('trade-offer', {}, FEATURES)).toBe(true);
    expect(isCategoryEnabled('article', {}, FEATURES)).toBe(false);
  });

  it('honours an explicit choice in both directions', () => {
    expect(isCategoryEnabled('trade-offer', { 'trade-offer': false }, FEATURES)).toBe(false);
    expect(isCategoryEnabled('article', { article: true }, FEATURES)).toBe(true);
  });

  it('REFUSES an unknown category rather than letting it through', () => {
    // The one failure that costs push permission outright: a typo'd or removed
    // category bypassing every setting an owner has chosen.
    expect(isCategoryEnabled('not-a-category', {}, FEATURES)).toBe(false);
    expect(isCategoryEnabled('', {}, FEATURES)).toBe(false);
    expect(isCategoryEnabled('not-a-category', { 'not-a-category': true }, FEATURES)).toBe(false);
  });

  it('refuses a category that has no sender yet', () => {
    const planned = NOTIFICATION_CATEGORIES.find((c) => !c.live);
    if (!planned) return;
    expect(isCategoryEnabled(planned.id, { [planned.id]: true }, FEATURES)).toBe(false);
  });
});

describe('preference storage', () => {
  it('keys per league AND franchise — the two leagues share franchise ids', () => {
    expect(preferencesKey('13522', '0001')).toBe('push:prefs:13522:0001');
    expect(preferencesKey('13522', '0001')).not.toBe(preferencesKey('19621', '0001'));
  });

  it('round-trips explicit choices', async () => {
    await writePreferences('13522', '0001', { 'transaction-all': true, 'trade-offer': false });
    expect(await readPreferences('13522', '0001')).toEqual({
      'transaction-all': true,
      'trade-offer': false,
    });
  });

  it('stores ONLY explicit choices, so new categories keep their default', async () => {
    // A snapshot of every toggle would freeze today's defaults forever: a
    // category added next season would arrive off for every owner who had ever
    // opened this page.
    await writePreferences('13522', '0001', { 'trade-offer': true });
    const stored = await readPreferences('13522', '0001');
    expect(Object.keys(stored)).toEqual(['trade-offer']);
    expect(isCategoryEnabled('poll-result', stored, FEATURES)).toBe(true); // still the default
  });

  it('drops unknown keys and non-booleans', () => {
    expect(
      sanitize({ 'trade-offer': true, bogus: true, 'transaction-all': 'yes', nested: {} }),
    ).toEqual({ 'trade-offer': true });
  });

  it('falls back to defaults during a storage outage rather than going dark', async () => {
    // The safe direction: an owner keeps getting what they were getting.
    redisAvailable = false;
    expect(await readPreferences('13522', '0001')).toEqual({});
    expect(isCategoryEnabled('trade-offer', {}, FEATURES)).toBe(true);
    expect(await writePreferences('13522', '0001', { 'trade-offer': false })).toBe(false);
  });
});

describe('resolvePreferences', () => {
  it('returns an effective value for every offered category', () => {
    const categories = visibleCategoriesForLeague(FEATURES);
    const resolved = resolvePreferences(categories, { article: true }, FEATURES);
    expect(Object.keys(resolved).sort()).toEqual(categories.map((c) => c.id).sort());
    expect(resolved['article']).toBe(true);
    expect(resolved['trade-offer']).toBe(true); // default
    expect(resolved['column']).toBe(false); // default
  });

  it('matches defaultPreferences when nothing is stored', () => {
    const categories = visibleCategoriesForLeague(FEATURES);
    const resolved = resolvePreferences(categories, {}, FEATURES);
    const defaults = defaultPreferences(FEATURES);
    for (const c of categories) expect(resolved[c.id]).toBe(defaults[c.id]);
  });
});

// ---------------------------------------------------------------------------
// The sender guard
// ---------------------------------------------------------------------------

/**
 * Every category marked `live` must actually be sent by something.
 *
 * This is the guard that matters. A category can look completely healthy — it
 * appears on the settings page, an owner switches it on, the preference saves —
 * and still never fire, because nobody wrote the sender. Nothing at runtime
 * complains about that; the owner just concludes the page is broken.
 *
 * It caught four during the build: transactions-all, the rumor mill, league
 * deadlines and (before it was wired) the lineup warning.
 */
describe('every live category has a sender', () => {
  it('finds each live category id referenced in code that sends', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const pathMod = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..');

    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = pathMod.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mjs|astro)$/.test(entry.name)) continue;
        // The registry itself names every id; it is not a sender.
        if (full.endsWith('notification-categories.ts')) continue;
        sources.push(readFileSync(full, 'utf8'));
      }
    };
    walk(pathMod.join(root, 'src'));
    walk(pathMod.join(root, 'scripts'));
    const haystack = sources.join('\n');

    const missing = NOTIFICATION_CATEGORIES.filter(
      (c) => c.live && !haystack.includes(`'${c.id}'`) && !haystack.includes(`"${c.id}"`),
    ).map((c) => c.id);

    expect(
      missing,
      `Marked live but nothing sends them. Either wire a sender, or set ` +
        `live: false so the settings page stops offering a switch that does ` +
        `nothing:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps at least one default-on category actually live', () => {
    // Otherwise a brand-new owner enables push and never hears anything.
    const liveDefaults = NOTIFICATION_CATEGORIES.filter((c) => c.live && c.defaultOn && !c.hidden);
    expect(liveDefaults.length).toBeGreaterThan(0);
  });
});
