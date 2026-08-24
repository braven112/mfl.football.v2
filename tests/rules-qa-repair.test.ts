/**
 * Guards the stored-answer repair path (scripts/fix-rules-qa-answer.mjs).
 *
 * The write it performs replaces the ENTIRE `rules-qa:all` array — every
 * stored Ask Roger answer since launch — under one key, so the interesting
 * failure isn't "the repair didn't apply", it's "the repair applied and took
 * something else with it". These tests pin the in-place contract: only
 * `answer` changes, order and every other field survive byte-identical, and
 * re-running is a no-op.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesSearch,
  summarizeEntry,
  applyRepairs,
  assertOnlyAnswersChanged,
} from '../scripts/lib/rules-qa-repair.mjs';

const entries = () => [
  {
    id: 'qa_alpha',
    question: 'Can I change a position?',
    answer: 'Old ruling: the commissioner decides.',
    askedBy: '0001',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'qa_beta',
    question: 'What is the cap?',
    answer: '$45 million.',
    askedBy: '0004',
    createdAt: '2026-08-02T00:00:00.000Z',
  },
];

describe('matchesSearch', () => {
  it('matches question and answer case-insensitively', () => {
    expect(matchesSearch(entries()[0], 'POSITION')).toBe(true);
    expect(matchesSearch(entries()[0], 'commissioner')).toBe(true);
    expect(matchesSearch(entries()[0], 'rotowire')).toBe(false);
  });

  it('an empty term matches everything', () => {
    expect(matchesSearch(entries()[1], undefined)).toBe(true);
    expect(matchesSearch(entries()[1], '')).toBe(true);
  });

  it('survives an entry with no answer yet', () => {
    expect(matchesSearch({ id: 'x', question: 'hi' }, 'nope')).toBe(false);
  });
});

describe('summarizeEntry', () => {
  it('truncates the answer and never spans lines', () => {
    const long = { ...entries()[0], answer: 'a\n'.repeat(200) };
    const summary = summarizeEntry(long, { answerChars: 20 });
    expect(summary).toContain('id:        qa_alpha');
    expect(summary.split('\n')).toHaveLength(4);
    expect(summary).toContain('…');
  });

  it('labels a seeded card rather than printing undefined', () => {
    const seed = { id: 'seed_x', question: 'q', answer: 'a', askedBy: null };
    expect(summarizeEntry(seed)).toContain('(seed/unknown)');
  });

  it('renders askedBy as a team, not [object Object]', () => {
    // askedBy is { franchiseId, teamName } (src/types/rules-qa.ts). The first
    // real --list run printed "[object Object]" for every owner-asked card —
    // the one column you read to tell whose answer you are about to rewrite.
    const asked = {
      id: 'qa_x',
      question: 'q',
      answer: 'a',
      askedBy: { franchiseId: '0001', teamName: 'Pacific Pigskins' },
    };
    const summary = summarizeEntry(asked);
    expect(summary).toContain('Pacific Pigskins (0001)');
    expect(summary).not.toContain('[object Object]');
  });

  it('falls back to whichever half of askedBy is present', () => {
    expect(summarizeEntry({ id: 'a', askedBy: { teamName: 'Maverick' } })).toContain(
      'Maverick',
    );
    expect(summarizeEntry({ id: 'b', askedBy: { franchiseId: '0004' } })).toContain(
      '0004',
    );
  });
});

describe('applyRepairs', () => {
  it('rewrites only the answer, preserving id/askedBy/createdAt and order', () => {
    const before = entries();
    const { updated, results } = applyRepairs(before, [
      { id: 'qa_alpha', answer: 'New ruling: the owner picks.' },
    ]);

    expect(results).toEqual([
      expect.objectContaining({ id: 'qa_alpha', status: 'updated' }),
    ]);
    expect(updated.map((e) => e.id)).toEqual(['qa_alpha', 'qa_beta']);
    expect(updated[0]).toEqual({
      ...before[0],
      answer: 'New ruling: the owner picks.',
    });
    expect(updated[1]).toBe(before[1]);
    // The input array is untouched — the caller still holds the pre-repair
    // snapshot it backs up before writing.
    expect(before[0].answer).toBe('Old ruling: the commissioner decides.');
  });

  it('reports an already-repaired answer as unchanged (re-running is a no-op)', () => {
    const before = entries();
    const { updated, results } = applyRepairs(before, [
      { id: 'qa_beta', answer: '$45 million.' },
    ]);
    expect(results[0].status).toBe('unchanged');
    expect(updated).toEqual(before);
  });

  it('reports an unknown id instead of appending a new card', () => {
    const before = entries();
    const { updated, results } = applyRepairs(before, [
      { id: 'qa_typo', answer: 'anything' },
    ]);
    expect(results[0]).toEqual({ id: 'qa_typo', status: 'not-found' });
    expect(updated).toHaveLength(2);
  });

  it('refuses a stored value that is not an array', () => {
    expect(() => applyRepairs(null, [])).toThrow(/not an array/);
  });
});

describe('assertOnlyAnswersChanged', () => {
  it('passes when only answers moved', () => {
    const before = entries();
    const { updated } = applyRepairs(before, [{ id: 'qa_alpha', answer: 'new' }]);
    expect(() => assertOnlyAnswersChanged(before, updated)).not.toThrow();
  });

  it('catches a dropped or altered field', () => {
    const before = entries();
    const mangled = before.map((e) => ({ ...e, createdAt: '2026-01-01T00:00:00.000Z' }));
    expect(() => assertOnlyAnswersChanged(before, mangled)).toThrow(/createdAt/);
  });

  it('catches a lost entry', () => {
    const before = entries();
    expect(() => assertOnlyAnswersChanged(before, [before[0]])).toThrow(
      /number of stored answers/,
    );
  });
});
