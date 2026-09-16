/**
 * The What's New rollup announces WITH the release, not a week behind it.
 *
 * The bug is a LATE announcement, not an early one. The plan doc says early;
 * measured on 2026-09-16 it is not, because the rollup runs on `main` and reads
 * MAIN's queue, while a feature PR stages its entry on `staging` — so the cron
 * structurally never sees an unpromoted feature. The correction is written up
 * in scripts/changelog-rollup-gate.mjs.
 *
 * What actually happens: a release's worth of entries lands on main all at once
 * at the promotion, and nothing publishes them until the next Monday. Worse,
 * the id is `weekly-rollup-<monday>` and the rollup refuses a second article
 * for the same week, so a Monday cron the night before a promotion burns the
 * week's id on hotfixes alone and defers the release's entries a further week.
 *
 * The fix has three moving parts and all three are load-bearing, which is why
 * they are pinned here rather than left to the workflow comments:
 *
 *   1. The release tag triggers the rollup (`push: tags: ['v*']`). `/promote`
 *      pushes that tag right after fast-forwarding `main`, so the article lands
 *      the same day as the code and cannot precede it.
 *   2. The cron survives as a FLOOR for hotfix-only weeks — changes that bypass
 *      the train, have no promotion to wait for, and are already live.
 *   3. The gate makes (2) safe. Without it the cron takes the week's id every
 *      week and the release article is permanently one week behind.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldPublish, fetchAheadBy } from '../scripts/changelog-rollup-gate.mjs';
import { isLive, thisWeeksArticleUrls } from '../scripts/wait-for-whats-new-live.mjs';

const ROOT = resolve(__dirname, '..');
const WORKFLOW = readFileSync(
  resolve(ROOT, '.github/workflows/weekly-changelog-rollup.yml'),
  'utf-8',
);

describe('the rollup workflow is wired to the release, not only to the clock', () => {
  it('fires on the release tag /promote pushes', () => {
    expect(WORKFLOW).toMatch(/push:\s*\n\s*tags:\s*\n\s*- 'v\*'/);
  });

  it('keeps the Monday cron as a floor for hotfix-only weeks', () => {
    expect(WORKFLOW).toContain('cron: "0 4 * * 2"');
  });

  it('checks out main, because a tag push would otherwise commit to a detached HEAD', () => {
    expect(WORKFLOW).toMatch(/ref:\s*main/);
  });

  it('gates the publishing steps on the gate, and only those', () => {
    // Two conditions, deliberately, because they answer different questions.
    // `gate.publish` is "may this run publish at all" and belongs to the rollup
    // and to the check that reads whether it wrote anything. `published.new` is
    // "did an article actually land" and is what wait/notify hang off — see the
    // suite below. The cap step is under NEITHER, on purpose.
    const onGate = WORKFLOW.match(/if: steps\.gate\.outputs\.publish == 'true'/g) ?? [];
    expect(onGate.length).toBe(2);
    const onPublished = WORKFLOW.match(/if: steps\.published\.outputs\.new == 'true'/g) ?? [];
    expect(onPublished.length).toBe(2);
  });

  it('waits for the permalink before notifying', () => {
    const waitAt = WORKFLOW.indexOf('wait-for-whats-new-live.mjs');
    const notifyAt = WORKFLOW.indexOf('push-weekly-changelog.mjs');
    expect(waitAt).toBeGreaterThan(-1);
    expect(notifyAt).toBeGreaterThan(-1);
    expect(waitAt).toBeLessThan(notifyAt);
  });
});

describe('shouldPublish', () => {
  it('publishes on a tag push without consulting the branches', () => {
    expect(shouldPublish({ trigger: 'push', aheadBy: 99 }).publish).toBe(true);
  });

  it('publishes on a manual dispatch', () => {
    expect(shouldPublish({ trigger: 'workflow_dispatch', aheadBy: 99 }).publish).toBe(true);
  });

  it('STANDS DOWN on the cron when a release is pending', () => {
    // staging ahead of main means a promotion is coming. Publishing now would
    // spend `weekly-rollup-<monday>` on the hotfixes alone, and the rollup's
    // own alreadyPublished guard would then refuse the release's article —
    // deferring it to the Monday after the features went live.
    const { publish, reason } = shouldPublish({ trigger: 'schedule', aheadBy: 12 });
    expect(publish).toBe(false);
    expect(reason).toMatch(/release is pending/i);
  });

  it('publishes on the cron when nothing is waiting on staging', () => {
    // The hotfix-only week: everything staged is already live on main, so the
    // floor does its job.
    expect(shouldPublish({ trigger: 'schedule', aheadBy: 0 }).publish).toBe(true);
  });

  it('FAILS OPEN when the comparison cannot be made', () => {
    // Same rule as scripts/vercel-ignore-build.mjs: a scheduling optimisation
    // that can silently suppress the week's announcement forever is worse than
    // the thing it optimises. Failing open costs one release's article a week —
    // which is exactly the behaviour this replaces, so the floor is the status
    // quo rather than silence.
    const { publish, reason } = shouldPublish({ trigger: 'schedule', aheadBy: null });
    expect(publish).toBe(true);
    expect(reason).toMatch(/fails open/i);
  });
});

describe('fetchAheadBy', () => {
  it('reads ahead_by from the compare API', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ahead_by: 7 }) });
    expect(await fetchAheadBy({ repo: 'o/r', token: 't', fetchImpl })).toBe(7);
  });

  it('treats a missing staging branch as nothing pending, not as an error', async () => {
    // A repo without the release train has nothing to wait for. Returning null
    // here would be fail-open anyway, but 0 says what is actually true.
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchAheadBy({ repo: 'o/r', token: 't', fetchImpl })).toBe(0);
  });

  it('returns null (fail open) on an API error', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchAheadBy({ repo: 'o/r', token: 't', fetchImpl })).toBeNull();
  });

  it('returns null (fail open) when it throws', async () => {
    const fetchImpl = async () => {
      throw new Error('network');
    };
    expect(await fetchAheadBy({ repo: 'o/r', token: 't', fetchImpl })).toBeNull();
  });

  it('returns null (fail open) with no token', async () => {
    expect(await fetchAheadBy({ repo: 'o/r', token: '' })).toBeNull();
  });
});

describe('isLive — the live-check contract', () => {
  // The whole point of this probe is to not notify owners about a page that is
  // not deployed yet. Every case below is a way that could silently go wrong.
  const probe = (status: number) => async () => ({ status });

  it('200 means the article is really there', async () => {
    expect(await isLive('https://x/a', { fetchImpl: probe(200) })).toBe(true);
  });

  it('a 3xx is NOT live — the [id] route redirects an unknown id to /whats-new', async () => {
    // This is why `redirect: 'manual'` is load-bearing. Following redirects
    // would turn this exact case into a 200 on the listing page and declare an
    // undeployed article live.
    expect(await isLive('https://x/a', { fetchImpl: probe(302) })).toBe(false);
    expect(await isLive('https://x/a', { fetchImpl: probe(301) })).toBe(false);
  });

  it('passes redirect: manual to fetch', async () => {
    let seen: any = null;
    await isLive('https://x/a', {
      fetchImpl: async (_u: string, init?: any) => {
        seen = init;
        return { status: 200 };
      },
    });
    expect(seen?.redirect).toBe('manual');
    expect(seen?.signal).toBeDefined();
  });

  it('a 404 or 5xx reads as not-yet, never as live', async () => {
    expect(await isLive('https://x/a', { fetchImpl: probe(404) })).toBe(false);
    expect(await isLive('https://x/a', { fetchImpl: probe(503) })).toBe(false);
  });

  it('a thrown fetch (DNS, TLS, abort) reads as not-yet rather than crashing', async () => {
    const boom = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await isLive('https://x/a', { fetchImpl: boom })).toBe(false);
  });
});

describe('thisWeeksArticleUrls', () => {
  const MONDAY = '2026-09-14';

  it('builds one absolute URL per league that actually published', () => {
    const entries = [
      { id: `weekly-rollup-${MONDAY}` },
      { id: `weekly-rollup-${MONDAY}-afl` },
    ];
    const urls = thisWeeksArticleUrls({ entries, monday: MONDAY });
    expect(urls).toHaveLength(2);
    // Absolute, and each on its own league's apex — built by leagueUrl(),
    // never by concatenating an origin with a path.
    for (const u of urls) expect(u.url).toMatch(/^https:\/\/[^/]+\/whats-new\/weekly-rollup-/);
    expect(urls.map((u) => u.id)).toEqual(entries.map((e) => e.id));
  });

  it('skips a league with no article this week rather than inventing a URL', () => {
    // A league can legitimately not publish — the rollup skips one whose
    // staged changes are empty. Waiting on a URL nobody wrote would burn the
    // whole timeout and warn for no reason.
    const urls = thisWeeksArticleUrls({ entries: [{ id: `weekly-rollup-${MONDAY}` }], monday: MONDAY });
    expect(urls).toHaveLength(1);
    expect(urls[0].id).toBe(`weekly-rollup-${MONDAY}`);
  });

  it('returns nothing when this week published nothing at all', () => {
    expect(thisWeeksArticleUrls({ entries: [{ id: 'weekly-rollup-2020-01-06' }], monday: MONDAY })).toEqual([]);
  });
});

describe('the workflow only notifies for an article this run actually wrote', () => {
  it('gates wait + notify on the published step, not on the gate', () => {
    // `publish == true` is not "an article landed": the rollup exits 0 without
    // writing on an empty queue and again when the week's id is already taken.
    // Notifying on those pushes owners at an article this run did not write.
    expect(WORKFLOW).toMatch(/id: published/);
    const waitBlock = WORKFLOW.slice(WORKFLOW.indexOf('Wait for the article to be live'));
    expect(waitBlock).toMatch(/if: steps\.published\.outputs\.new == 'true'/);
    const notifyBlock = WORKFLOW.slice(WORKFLOW.indexOf('Notify owners'));
    expect(notifyBlock).toMatch(/if: steps\.published\.outputs\.new == 'true'/);
  });

  it('re-enforces the cap on EVERY run, not only when it publishes', () => {
    // The rollup exits at its no-changes check long before enforcing the cap,
    // so an empty-queue week never re-enforces — which is the exact red of
    // 2026-09-16. An unconditional step is the only placement that covers it.
    const capIdx = WORKFLOW.indexOf('Re-enforce the active cap');
    const after = WORKFLOW.slice(capIdx, capIdx + 400);
    expect(after).not.toMatch(/if: steps\./);
  });

  it('serializes itself — three triggers now write the same files on main', () => {
    expect(WORKFLOW).toMatch(/concurrency:\s*\n\s*group: weekly-changelog-rollup/);
    expect(WORKFLOW).toMatch(/cancel-in-progress: false/);
  });
});
