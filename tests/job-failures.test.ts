/**
 * The scheduled-job failure watch: which runs get alerted on, and who hears.
 *
 * This job exists because 25 crons could fail with no signal anywhere. Its own
 * failure modes are therefore the interesting ones — a watch that alerts on
 * everything gets muted inside a week, and a watch that alerts on nothing looks
 * exactly like a healthy repo. Both are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  MAX_ALERTS,
  buildAlerts,
  buildFailureNotification,
  isFirstRun,
  nextWatermark,
  selectNewFailures,
} from '../scripts/lib/job-failures.mjs';
import { adminFranchiseIds } from '../scripts/lib/ops-alert.mjs';
import { LEAGUES } from '../src/config/leagues';

const ROOT = path.resolve(__dirname, '..');

/** A run as the Actions API returns it, with only the fields we read. */
function run(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Roster Sync',
    event: 'schedule',
    conclusion: 'failure',
    updated_at: '2026-09-06T12:00:00Z',
    workflow_id: 100,
    run_attempt: 1,
    html_url: 'https://github.com/o/r/actions/runs/1',
    ...over,
  };
}

const WATERMARK = '2026-09-06T00:00:00Z';

describe('which runs are worth an alert', () => {
  it('takes a failed scheduled run finished since the watermark', () => {
    expect(selectNewFailures([run()], { watermark: WATERMARK })).toHaveLength(1);
  });

  it('ignores successes and runs that finished before the watermark', () => {
    const runs = [
      run({ id: 2, conclusion: 'success' }),
      run({ id: 3, updated_at: '2026-09-05T12:00:00Z' }),
    ];
    expect(selectNewFailures(runs, { watermark: WATERMARK })).toEqual([]);
  });

  it('ignores PR and push checks — those already announce themselves', () => {
    // Alerting on CI would bury the signal that has no other home. This is the
    // scoping decision the whole job rests on, so it is pinned rather than
    // left to a comment.
    for (const event of ['pull_request', 'push']) {
      expect(selectNewFailures([run({ event })], { watermark: WATERMARK })).toEqual([]);
    }
  });

  it('includes workflow_dispatch — that is a human retrying a broken cron', () => {
    expect(
      selectNewFailures([run({ event: 'workflow_dispatch' })], { watermark: WATERMARK }),
    ).toHaveLength(1);
  });

  it('sends ONE alert for a workflow that failed repeatedly, newest first', () => {
    // A 15-minute cron failing all day is one broken thing. Without this it is
    // 96 notifications, and the category gets turned off.
    const runs = [
      run({ id: 10, updated_at: '2026-09-06T10:00:00Z' }),
      run({ id: 11, updated_at: '2026-09-06T11:00:00Z' }),
      run({ id: 12, updated_at: '2026-09-06T09:00:00Z' }),
    ];
    const picked = selectNewFailures(runs, { watermark: WATERMARK });
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe(11);
  });

  it('keeps distinct workflows apart', () => {
    const runs = [run({ id: 20, workflow_id: 1 }), run({ id: 21, workflow_id: 2 })];
    expect(selectNewFailures(runs, { watermark: WATERMARK })).toHaveLength(2);
  });

  it('treats a missing watermark as a first run rather than "alert on everything"', () => {
    expect(isFirstRun(null)).toBe(true);
    expect(isFirstRun('')).toBe(true);
    expect(isFirstRun(WATERMARK)).toBe(false);
  });
});

describe('the watermark', () => {
  it('advances to the newest run seen, not to "now"', () => {
    // A run finishing while this script is mid-flight would land before a
    // `now` watermark and never be alerted on — a silent miss by the very job
    // that exists to stop silent misses.
    const runs = [
      run({ updated_at: '2026-09-06T10:00:00Z' }),
      run({ updated_at: '2026-09-06T11:30:00Z' }),
    ];
    expect(nextWatermark(runs)).toBe('2026-09-06T11:30:00.000Z');
  });

  it('returns null with nothing to advance to, so the caller leaves it alone', () => {
    expect(nextWatermark([])).toBeNull();
  });
});

describe('what the alert says', () => {
  it('names the workflow and links its log', () => {
    const n = buildFailureNotification(run({ name: 'Schefter Scan' }));
    expect(n.title).toContain('Schefter Scan');
    expect(n.url).toBe('https://github.com/o/r/actions/runs/1');
  });

  it('gives a re-run its own tag, so it does not collapse into the first failure', () => {
    const first = buildFailureNotification(run({ id: 1 }));
    const retry = buildFailureNotification(run({ id: 2, run_attempt: 2 }));
    expect(retry.tag).not.toBe(first.tag);
    expect(retry.body).toContain('attempt 2');
  });

  it('collapses a mass failure into one alert that says so', () => {
    // An expired credential fails every cron at once. Twenty notifications all
    // meaning "the token died" is worse than one.
    const many = Array.from({ length: MAX_ALERTS + 3 }, (_, i) =>
      run({ id: 100 + i, workflow_id: 100 + i }),
    );
    const alerts = buildAlerts(many, { repoUrl: 'https://github.com/o/r' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain(`${many.length} scheduled jobs failed`);
  });

  it('sends them individually below the cap', () => {
    const few = [run({ id: 1, workflow_id: 1 }), run({ id: 2, workflow_id: 2 })];
    expect(buildAlerts(few)).toHaveLength(2);
  });

  it('sends nothing for nothing', () => {
    expect(buildAlerts([])).toEqual([]);
  });
});

describe('who receives an ops alert', () => {
  it('resolves admins by NAV slug, which is not the registry slug', () => {
    // The AFL is `afl-fantasy` in the registry and `afl` in nav-config. Passing
    // the wrong one returns an empty list and the alert reaches nobody —
    // silently, which is why this is pinned.
    expect(adminFranchiseIds(LEAGUES['afl-fantasy'])).toContain('0001');
    expect(adminFranchiseIds(LEAGUES.theleague)).toContain('0001');
  });

  it('returns an empty list rather than guessing for an unknown league', () => {
    expect(adminFranchiseIds({} as never)).toEqual([]);
    expect(adminFranchiseIds({ navSlug: 'nope' } as never)).toEqual([]);
  });

  it('never addresses an ops alert to the whole league', () => {
    // The failure this guards is a sender reaching for the broadcast helper,
    // which is how these alerts would land back in every owner's pocket —
    // the group-chat problem again, with a worse delivery mechanism.
    const src = readFileSync(path.join(ROOT, 'scripts/lib/ops-alert.mjs'), 'utf8');
    // The CALL and the IMPORT, not the word — the file's own header explains
    // why it must never broadcast, and a guard that trips on prose about a
    // rule teaches people to delete the prose.
    expect(src).not.toMatch(/\bbroadcast\s*\(/);
    expect(src).not.toMatch(/import[^;]*\bbroadcast\b[^;]*from/);
  });
});

describe('the send door decides admin-ness itself', () => {
  it('resolves it from the franchise id, never from the caller', () => {
    // /api/cron/push-fanout takes its notification list from a request body.
    // If sendPushToFranchise trusted a caller-supplied flag, one authenticated
    // cron call could address the plumbing alerts to all twelve owners.
    const src = readFileSync(path.join(ROOT, 'src/utils/push-sender.ts'), 'utf8');
    expect(src).toMatch(/isAdminFranchise\(franchiseId, league\.navSlug\)/);
    // The recipient must be built locally, not lifted off a parameter.
    expect(src).not.toMatch(/recipient\s*[,)]\s*$/m);
  });
});
