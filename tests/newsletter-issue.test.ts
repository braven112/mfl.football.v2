import { describe, expect, it } from 'vitest';
import {
  buildMonthlyIssue,
  issueSubject,
  MAX_ITEMS,
  previousMonth,
  selectItems,
  type WhatsNewEntry,
} from '../src/utils/newsletter-issue';

const articleUrl = (id: string) => `https://example.test/whats-new/${id}`;
const assetUrl = (file: string) => `https://example.test/assets/whats-new/${file}`;

const entry = (over: Partial<WhatsNewEntry>): WhatsNewEntry => ({
  id: 'weekly-rollup-2026-09-07',
  date: '2026-09-07',
  title: 'A headline',
  summary: 'One line.',
  image: 'shot.webp',
  leagues: ['theleague'],
  ...over,
});

describe('previousMonth', () => {
  it('returns the month before, across a year boundary', () => {
    expect(previousMonth(new Date('2026-10-02T17:00:00Z'))).toEqual({ year: 2026, month: 9 });
    expect(previousMonth(new Date('2027-01-02T17:00:00Z'))).toEqual({ year: 2026, month: 12 });
  });
});

describe('selectItems', () => {
  it("reads only TheLeague's copy of each week, in date order", () => {
    const items = selectItems(
      [
        entry({ id: 'b', date: '2026-09-14', title: 'Second' }),
        entry({ id: 'b-afl', date: '2026-09-14', title: 'Second (AFL)', leagues: ['afl'] }),
        entry({ id: 'a', date: '2026-09-07', title: 'First' }),
        entry({ id: 'oct', date: '2026-10-05', title: 'Next month' }),
        entry({ id: 'aug', date: '2026-08-31', title: 'Last month' }),
      ],
      2026,
      9,
      articleUrl,
      assetUrl,
    );
    expect(items.map((i) => i.title)).toEqual(['First', 'Second']);
    expect(items[0].url).toBe('https://example.test/whats-new/a');
    expect(items[0].imageUrl).toBe('https://example.test/assets/whats-new/shot.webp');
  });

  it('caps the issue length', () => {
    const many = Array.from({ length: MAX_ITEMS + 3 }, (_, i) =>
      entry({ id: `e${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}` }),
    );
    expect(selectItems(many, 2026, 9, articleUrl, assetUrl)).toHaveLength(MAX_ITEMS);
  });
});

describe('selectItems ranking', () => {
  it('keeps weekly rollups and launches over enhancements, and drops fixes-only rollups', () => {
    const items = selectItems(
      [
        entry({ id: 'fixes', date: '2026-09-07', category: 'bug-fix' }),
        entry({ id: 'wk', date: '2026-09-28', category: 'weekly' }),
        entry({ id: 'launch', date: '2026-09-04', category: 'new-page' }),
        ...Array.from({ length: MAX_ITEMS }, (_, i) =>
          entry({ id: `enh${i}`, date: `2026-09-${String(10 + i)}`, category: 'enhancement' }),
        ),
      ],
      2026,
      9,
      articleUrl,
      assetUrl,
    );
    const ids = items.map((i) => i.url.split('/').pop());
    expect(ids).toHaveLength(MAX_ITEMS);
    expect(ids).toContain('wk');
    expect(ids).toContain('launch');
    expect(ids).not.toContain('fixes');
    expect(ids[0]).toBe('launch');
    expect(ids[ids.length - 1]).toBe('wk');
  });
});

describe('buildMonthlyIssue', () => {
  it('returns null for a month with no articles', () => {
    expect(buildMonthlyIssue([entry({ date: '2026-08-03' })], 2026, 9, articleUrl, assetUrl)).toBeNull();
  });

  it('builds a subject keyed to the month and escapes article text', () => {
    const issue = buildMonthlyIssue(
      [entry({ title: 'Trades <b>& more</b>', summary: 'Say "hi"' })],
      2026,
      9,
      articleUrl,
      assetUrl,
    )!;
    expect(issue.subject).toBe(issueSubject(2026, 9));
    expect(issue.subject).toContain('September 2026');
    expect(issue.html).toContain('Trades &lt;b&gt;&amp; more&lt;/b&gt;');
    expect(issue.html).toContain('Say &quot;hi&quot;');
    expect(issue.html).not.toContain('<b>&');
  });
});
