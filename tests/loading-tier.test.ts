/**
 * resolveLoadingTier — boundary tests at every threshold, both contexts.
 *
 * The thresholds (300 / 1000 / 10000 ms) live in src/utils/loading-tier.ts
 * and nowhere else; these tests lock the escalation rule from
 * docs/claude/loading-standards.md.
 */
import { describe, it, expect } from 'vitest';
import {
  LOADING_THRESHOLDS,
  resolveLoadingTier,
  type LoadingContext,
} from '../src/utils/loading-tier';

const CONTEXTS: LoadingContext[] = ['content', 'discreteAction'];

describe('resolveLoadingTier', () => {
  it('exposes the documented thresholds', () => {
    expect(LOADING_THRESHOLDS.optimistic).toBe(300);
    expect(LOADING_THRESHOLDS.inline).toBe(1000);
    expect(LOADING_THRESHOLDS.branded).toBe(10_000);
  });

  describe.each(CONTEXTS)('context: %s', (context) => {
    const midTier = context === 'discreteAction' ? 'buttonSpinner' : 'skeleton';

    it('0ms → none (never flash a loader)', () => {
      expect(resolveLoadingTier(0, context)).toBe('none');
    });

    it('299ms → none (just under the optimistic boundary)', () => {
      expect(resolveLoadingTier(299, context)).toBe('none');
    });

    it('300ms → optimistic (boundary is inclusive)', () => {
      expect(resolveLoadingTier(300, context)).toBe('optimistic');
    });

    it('999ms → optimistic (just under the inline boundary)', () => {
      expect(resolveLoadingTier(999, context)).toBe('optimistic');
    });

    it(`1000ms → ${midTier} (boundary is inclusive)`, () => {
      expect(resolveLoadingTier(1000, context)).toBe(midTier);
    });

    it(`9999ms → ${midTier} (just under the branded boundary)`, () => {
      expect(resolveLoadingTier(9999, context)).toBe(midTier);
    });

    it('10000ms → branded (boundary is inclusive)', () => {
      expect(resolveLoadingTier(10_000, context)).toBe('branded');
    });

    it('escalates monotonically — a longer wait never de-escalates', () => {
      const order = ['none', 'optimistic', midTier, 'branded'];
      let prevIndex = 0;
      for (let ms = 0; ms <= 12_000; ms += 50) {
        const idx = order.indexOf(resolveLoadingTier(ms, context));
        expect(idx).toBeGreaterThanOrEqual(prevIndex);
        prevIndex = idx;
      }
    });
  });

  it('defaults to the content context', () => {
    expect(resolveLoadingTier(5000)).toBe('skeleton');
  });
});
