/**
 * Retention policy — the rules deciding which daily roster snapshots and
 * What's New entries survive pruning (scripts/lib/retention-policy.mjs).
 *
 * The load-bearing bit is the July keeper window: the AFL keeper page globs
 * `roster-history/rosters-*-07-{1[6-9],[2-3][0-9]}.json` and those files are
 * the official keeper record, so the policy must retain every date that glob
 * matches — the last test derives the expectation from the page's actual
 * glob pattern so the two files cannot drift apart silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isKeeperWindowDate,
  isWeeklyKeyframeDate,
  shouldRetainSnapshot,
} from '../scripts/lib/retention-policy.mjs';

describe('isKeeperWindowDate', () => {
  it('accepts July 16-31 in any year', () => {
    expect(isKeeperWindowDate('2026-07-16')).toBe(true);
    expect(isKeeperWindowDate('2024-07-25')).toBe(true);
    expect(isKeeperWindowDate('2031-07-31')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isKeeperWindowDate('2026-07-15')).toBe(false);
    expect(isKeeperWindowDate('2026-08-01')).toBe(false);
    expect(isKeeperWindowDate('2026-06-16')).toBe(false);
    expect(isKeeperWindowDate('not-a-date')).toBe(false);
    expect(isKeeperWindowDate('2026-7-16')).toBe(false);
  });
});

describe('isWeeklyKeyframeDate', () => {
  it('keeps Tuesdays and drops other weekdays', () => {
    expect(isWeeklyKeyframeDate('2026-08-11')).toBe(true); // a Tuesday
    expect(isWeeklyKeyframeDate('2026-08-12')).toBe(false); // Wednesday
    expect(isWeeklyKeyframeDate('2026-08-16')).toBe(false); // Sunday
    expect(isWeeklyKeyframeDate('garbage')).toBe(false);
  });
});

describe('shouldRetainSnapshot', () => {
  const bounds = { first: '2025-03-01', last: '2026-02-10' };

  it('keeps season endpoint snapshots', () => {
    expect(shouldRetainSnapshot('2025-03-01', bounds)).toBe(true);
    expect(shouldRetainSnapshot('2026-02-10', bounds)).toBe(true);
  });

  it('keeps keeper-window and Tuesday snapshots, drops ordinary days', () => {
    expect(shouldRetainSnapshot('2025-07-20', bounds)).toBe(true); // keeper window
    expect(shouldRetainSnapshot('2025-11-25', bounds)).toBe(true); // a Tuesday
    expect(shouldRetainSnapshot('2025-11-26', bounds)).toBe(false); // Wednesday
  });
});

describe('policy stays in sync with the AFL keeper page glob', () => {
  it('retains exactly the July dates the keeper-analysis glob matches', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/afl-fantasy/keeper-analysis.astro'),
      'utf8'
    );
    const globMatch = source.match(/roster-history\/rosters-\*-07-(\{[^}]+\})\.json/);
    expect(globMatch, 'keeper-analysis.astro no longer globs July roster snapshots — update the retention policy').toBeTruthy();

    // Expand the day brace ({1[6-9],[2-3][0-9]}) into the concrete day list.
    const dayPattern = globMatch![1]
      .replace(/[{}]/g, '')
      .split(',')
      .map((alt) => new RegExp(`^${alt.replace(/\[([^\]]+)\]/g, '[$1]')}$`));
    for (let day = 1; day <= 31; day++) {
      const dd = String(day).padStart(2, '0');
      const globMatches = dayPattern.some((re) => re.test(dd));
      expect(
        isKeeperWindowDate(`2026-07-${dd}`),
        `policy and keeper glob disagree on July ${dd}`
      ).toBe(globMatches);
    }
  });
});
