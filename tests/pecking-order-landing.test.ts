import { describe, it, expect } from 'vitest';
import {
  resolvePeckingOrderLanding,
  sortIssues,
  isRetroactivelyGenerated,
  resolveIssuePermalink,
} from '../src/utils/pecking-order-landing';

const issue = (year: number, week: number) => ({ year, week, data: { year, week } as any });

// The Pecking Order launched Aug 2026, a month before the AFL's first real
// issue, and the landing page rendered last season's rankings with no hint
// they were stale. These lock the two states apart.
describe('resolvePeckingOrderLanding', () => {
  const PRESEASON = new Date('2026-08-18T14:00:00Z');
  const IN_SEASON = new Date('2026-11-17T14:00:00Z');

  it('is a preview when the newest issue is from a finished season', () => {
    const state = resolvePeckingOrderLanding([issue(2025, 14), issue(2025, 13)], PRESEASON);
    expect(state.mode).toBe('preview');
    expect(state.latest).toMatchObject({ year: 2025, week: 14 });
    expect(state.older).toHaveLength(1);
  });

  it('names the season opener in preview so the copy can promise a date', () => {
    const { firstIssueDate } = resolvePeckingOrderLanding([issue(2025, 14)], PRESEASON);
    // 2026 kickoff is Thu Sep 10; the first issue is the Tuesday after.
    expect(firstIssueDate?.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('stays a preview after kickoff until week 1 actually has an issue', () => {
    // Season is underway, but the newest issue on file is still last year's.
    const state = resolvePeckingOrderLanding([issue(2025, 14)], new Date('2026-09-12T14:00:00Z'));
    expect(state.mode).toBe('preview');
    expect(state.firstIssueDate?.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('goes live the moment an issue from the season in progress exists', () => {
    const state = resolvePeckingOrderLanding([issue(2026, 10), issue(2025, 14)], IN_SEASON);
    expect(state.mode).toBe('live');
    expect(state.latest).toMatchObject({ year: 2026, week: 10 });
    expect(state.firstIssueDate).toBeNull();
  });

  it('treats a league with no issues as a preview, not an error state', () => {
    const state = resolvePeckingOrderLanding([], PRESEASON);
    expect(state.mode).toBe('preview');
    expect(state.latest).toBeNull();
    expect(state.older).toEqual([]);
  });

  it('drops back to preview in the offseason that follows a live season', () => {
    const state = resolvePeckingOrderLanding([issue(2026, 17)], new Date('2027-06-01T14:00:00Z'));
    expect(state.mode).toBe('preview');
    expect(state.firstIssueDate?.toISOString().slice(0, 10)).toBe('2027-09-14');
  });

  it('does not mutate the caller array', () => {
    const input = [issue(2025, 13), issue(2025, 14)];
    resolvePeckingOrderLanding(input, PRESEASON);
    expect(input[0].week).toBe(13);
  });
});

describe('sortIssues', () => {
  it('orders newest season first, then newest week', () => {
    const sorted = sortIssues([issue(2025, 3), issue(2026, 1), issue(2025, 17)]);
    expect(sorted.map(i => `${i.year}-${i.week}`)).toEqual(['2026-1', '2025-17', '2025-3']);
  });
});

// Every issue committed today was generated on 2026-08-15 as a launch seed,
// months after the week it covers — so its publishedAt is a file-write date,
// not a publication date. Rendering it as a dateline stamped a Week 14 2025
// issue "August 14, 2026", which reads as this morning's column.
describe('isRetroactivelyGenerated', () => {
  it('flags the committed launch seeds', () => {
    expect(isRetroactivelyGenerated({ year: 2025, week: 14, publishedAt: '2026-08-15T05:07:36.669Z' })).toBe(true);
    expect(isRetroactivelyGenerated({ year: 2025, week: 17, publishedAt: '2026-08-15T22:44:53.209Z' })).toBe(true);
  });

  it('trusts an issue published on its own Tuesday', () => {
    // Week 1 of 2026 publishes Tue Sept 15; week 5 four weeks later.
    expect(isRetroactivelyGenerated({ year: 2026, week: 1, publishedAt: '2026-09-15T14:02:00Z' })).toBe(false);
    expect(isRetroactivelyGenerated({ year: 2026, week: 5, publishedAt: '2026-10-13T14:02:00Z' })).toBe(false);
  });

  it('tolerates a late or re-run cron inside the grace window', () => {
    expect(isRetroactivelyGenerated({ year: 2026, week: 1, publishedAt: '2026-09-22T14:00:00Z' })).toBe(false);
  });

  it('treats a missing or unparseable date as untrustworthy', () => {
    expect(isRetroactivelyGenerated({ year: 2026, week: 1 })).toBe(true);
    expect(isRetroactivelyGenerated({ year: 2026, week: 1, publishedAt: 'not a date' })).toBe(true);
  });
});

describe('resolveIssuePermalink', () => {
  const issues = [issue(2026, 5), issue(2026, 4), issue(2025, 17)];
  const IN_SEASON = new Date('2026-10-20T14:00:00Z');

  it('calls the newest in-season issue current, so no archive note shows', () => {
    expect(resolveIssuePermalink(issues, { year: 2026, week: 5 }, IN_SEASON).isCurrent).toBe(true);
  });

  it('archives everything behind it', () => {
    expect(resolveIssuePermalink(issues, { year: 2026, week: 4 }, IN_SEASON).isCurrent).toBe(false);
    expect(resolveIssuePermalink(issues, { year: 2025, week: 17 }, IN_SEASON).isCurrent).toBe(false);
  });

  it('archives the newest issue too once its season is over', () => {
    // Preseason: the landing page calls this a sample, so the permalink must
    // not call it current — that disagreement was the bug.
    const state = resolveIssuePermalink([issue(2025, 14)], { year: 2025, week: 14 }, new Date('2026-08-18T14:00:00Z'));
    expect(state.isCurrent).toBe(false);
  });

  it('walks to the neighbouring issues in both directions', () => {
    const state = resolveIssuePermalink(issues, { year: 2026, week: 4 }, IN_SEASON);
    expect(state.older).toMatchObject({ year: 2025, week: 17 });
    expect(state.newer).toMatchObject({ year: 2026, week: 5 });
  });

  it('has no neighbours at the ends', () => {
    expect(resolveIssuePermalink(issues, { year: 2026, week: 5 }, IN_SEASON).newer).toBeNull();
    expect(resolveIssuePermalink(issues, { year: 2025, week: 17 }, IN_SEASON).older).toBeNull();
  });
});
