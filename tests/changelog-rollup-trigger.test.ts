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

  it('gates every publishing step on the gate, not just the rollup itself', () => {
    // The rollup, the commit, the live-check and the notification must all sit
    // behind the same condition. Gating only the first would still commit an
    // empty change and still fire a notification for an article nobody wrote.
    const gated = WORKFLOW.match(/if: steps\.gate\.outputs\.publish == 'true'/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(4);
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
