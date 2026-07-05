import { describe, it, expect } from 'vitest';
import type { WhatsNewEntry } from '../src/types/whats-new';
import { mergeAndRankEntries } from '../src/utils/whats-new-cross-league';

/** Helper to create a minimal WhatsNewEntry */
function makeEntry(overrides?: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: overrides?.id ?? 'test-entry',
    date: overrides?.date ?? '2026-02-16',
    title: overrides?.title ?? 'Test Entry',
    summary: overrides?.summary ?? 'A test summary',
    description: overrides?.description ?? ['Test description'],
    category: overrides?.category ?? 'new-feature',
    leagues: ['theleague'],
    ...overrides,
  };
}

describe('mergeAndRankEntries', () => {
  it('dedupes a both-league entry that appears in both slices', () => {
    const shared = makeEntry({ id: 'shared', leagues: ['theleague', 'afl'] });
    const result = mergeAndRankEntries([[shared], [shared]], 6);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('shared');
  });

  it('sorts newest-first and respects the limit', () => {
    const theleague = [
      makeEntry({ id: 'a', date: '2026-06-01' }),
      makeEntry({ id: 'b', date: '2026-06-20' }),
    ];
    const afl = [
      makeEntry({ id: 'c', date: '2026-06-10', leagues: ['afl'] }),
      makeEntry({ id: 'd', date: '2026-06-30', leagues: ['afl'] }),
    ];
    const result = mergeAndRankEntries([theleague, afl], 3);
    expect(result.map((e) => e.id)).toEqual(['d', 'b', 'c']);
  });

  it('builds detailPath from the entry league', () => {
    const result = mergeAndRankEntries(
      [
        [makeEntry({ id: 'tl-only', leagues: ['theleague'] })],
        [makeEntry({ id: 'afl-only', leagues: ['afl'] })],
      ],
      6,
    );
    const byId = Object.fromEntries(result.map((e) => [e.id, e.detailPath]));
    expect(byId['tl-only']).toBe('/theleague/whats-new/tl-only');
    expect(byId['afl-only']).toBe('/afl-fantasy/whats-new/afl-only');
  });

  it('routes both-league entries to the theleague detail path', () => {
    const shared = makeEntry({ id: 'shared', leagues: ['theleague', 'afl'] });
    const result = mergeAndRankEntries([[shared], [shared]], 6);
    expect(result[0].detailPath).toBe('/theleague/whats-new/shared');
  });

  it('excludes admin-only entries', () => {
    const result = mergeAndRankEntries(
      [[makeEntry({ id: 'admin-thing', visibility: 'admin' }), makeEntry({ id: 'public' })]],
      6,
    );
    expect(result.map((e) => e.id)).toEqual(['public']);
  });

  it('populates formattedDate', () => {
    const result = mergeAndRankEntries([[makeEntry({ date: '2026-07-03' })]], 6);
    expect(result[0].formattedDate).toBe('Jul 3, 2026');
  });
});
