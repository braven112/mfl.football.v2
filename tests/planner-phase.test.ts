import { describe, it, expect } from 'vitest';
import { getPlannerPhase } from '../src/utils/planner-phase';
import type { PlannerPhase } from '../src/utils/planner-phase';

/**
 * Key 2025-26 dates (from league-event-resolver and league-year-config):
 *
 * 2025 NFL Season:
 *   - Labor Day 2025: Sep 1, 2025
 *   - NFL Kickoff 2025: Sep 4, 2025 (Thursday after Labor Day)
 *   - Friday before Week 11: Sep 4 + 10*7 - 6 = Nov 7, 2025
 *   - Championship (Week 17): Sep 4 + 16*7 = Dec 25, 2025 (Thursday)
 *
 * 2026 Planning Year:
 *   - Last day to release: Feb 14, 2026 @ 8:45 PM (20:45)
 *   - New season starts: Feb 15, 2026
 *   - NFL Draft: Apr 23, 2026 (configured)
 *   - Rookie Draft: May 2, 2026 (Saturday after next week from NFL Draft)
 *   - Rookie Draft + 14 days: May 16, 2026
 *
 * 2026 NFL Season:
 *   - Labor Day 2026: Sep 7, 2026
 *   - NFL Kickoff 2026: Sep 10, 2026
 *   - Friday before Week 11: Sep 10 + 10*7 - 6 = Nov 13, 2026
 *   - Championship (Week 17): Dec 31, 2026
 *
 * Phase timeline:
 *   default: May 16, 2026 → Nov 7, 2025 (wait — this is the CURRENT cycle's friday-before-w11)
 *   Actually for the 2025-2026 cycle:
 *     extensions-and-tags: Nov 7, 2025 → Feb 14, 2026
 *     free-agency: Feb 15, 2026 → Apr 22, 2026
 *     draft: Apr 23, 2026 → May 16, 2026
 *     default: May 16, 2026 → Nov 13, 2026 (next cycle's friday-before-w11)
 *   Then for the 2026-2027 cycle:
 *     extensions-and-tags: Nov 13, 2026 → Feb 14, 2027
 */

describe('getPlannerPhase', () => {
  const assertPhase = (date: string, expected: PlannerPhase) => {
    const result = getPlannerPhase(new Date(date));
    expect(result.phase).toBe(expected);
  };

  describe('extensions-and-tags phase (Friday before Week 11 → Feb 14)', () => {
    it('returns extensions-and-tags on Friday before Week 11 (Nov 7, 2025)', () => {
      assertPhase('2025-11-07T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags in mid-November', () => {
      assertPhase('2025-11-15T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags on championship day (Dec 25, 2025)', () => {
      assertPhase('2025-12-25T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags in late December', () => {
      assertPhase('2025-12-31T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags in January', () => {
      assertPhase('2026-01-15T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags on Feb 14 before deadline', () => {
      assertPhase('2026-02-14T12:00:00', 'extensions-and-tags');
    });

    it('has showDualDraftCards = false', () => {
      const result = getPlannerPhase(new Date('2026-01-15T12:00:00'));
      expect(result.showDualDraftCards).toBe(false);
    });

    it('has correct label', () => {
      const result = getPlannerPhase(new Date('2026-01-15T12:00:00'));
      expect(result.label).toBe('Extensions & Tags');
    });
  });

  describe('free-agency phase', () => {
    it('returns free-agency on Feb 15', () => {
      assertPhase('2026-02-15T12:00:00', 'free-agency');
    });

    it('returns free-agency in March', () => {
      assertPhase('2026-03-15T12:00:00', 'free-agency');
    });

    it('returns free-agency on Apr 22 (day before NFL Draft)', () => {
      assertPhase('2026-04-22T12:00:00', 'free-agency');
    });

    it('has showDualDraftCards = true', () => {
      const result = getPlannerPhase(new Date('2026-03-15T12:00:00'));
      expect(result.showDualDraftCards).toBe(true);
    });

    it('has correct label', () => {
      const result = getPlannerPhase(new Date('2026-03-15T12:00:00'));
      expect(result.label).toBe('Free Agency');
    });
  });

  describe('draft phase', () => {
    it('returns draft on NFL Draft day (Apr 23, 2026)', () => {
      assertPhase('2026-04-23T12:00:00', 'draft');
    });

    it('returns draft during rookie draft (May 2, 2026)', () => {
      assertPhase('2026-05-02T12:00:00', 'draft');
    });

    it('returns draft 13 days after rookie draft (May 15)', () => {
      assertPhase('2026-05-15T12:00:00', 'draft');
    });

    it('has showDualDraftCards = true', () => {
      const result = getPlannerPhase(new Date('2026-04-25T12:00:00'));
      expect(result.showDualDraftCards).toBe(true);
    });

    it('has correct label', () => {
      const result = getPlannerPhase(new Date('2026-04-25T12:00:00'));
      expect(result.label).toBe('Draft');
    });
  });

  describe('default phase (post-draft through regular season, extensions at bottom)', () => {
    it('returns default after rookie draft + 14 days (May 16)', () => {
      assertPhase('2026-05-16T12:00:00', 'default');
    });

    it('returns default during summer', () => {
      assertPhase('2026-07-01T12:00:00', 'default');
    });

    it('returns default during early regular season (Oct 15)', () => {
      assertPhase('2026-10-15T12:00:00', 'default');
    });

    it('has showDualDraftCards = false', () => {
      const result = getPlannerPhase(new Date('2026-07-01T12:00:00'));
      expect(result.showDualDraftCards).toBe(false);
    });

    it('has correct label', () => {
      const result = getPlannerPhase(new Date('2026-07-01T12:00:00'));
      expect(result.label).toBe('Overview');
    });
  });

  describe('phase transitions', () => {
    it('transitions from default to extensions at Friday before Week 11', () => {
      // Nov 6, 2025 is Thursday (day before friday-before-week-11)
      const nov6 = getPlannerPhase(new Date('2025-11-06T12:00:00'));
      const nov7 = getPlannerPhase(new Date('2025-11-07T12:00:00'));
      expect(nov6.phase).toBe('default');
      expect(nov7.phase).toBe('extensions-and-tags');
    });

    it('transitions from extensions to free-agency between Feb 14 and Feb 15', () => {
      const feb14 = getPlannerPhase(new Date('2026-02-14T12:00:00'));
      const feb15 = getPlannerPhase(new Date('2026-02-15T12:00:00'));
      expect(feb14.phase).toBe('extensions-and-tags');
      expect(feb15.phase).toBe('free-agency');
    });

    it('transitions from free-agency to draft at NFL Draft start', () => {
      const apr22 = getPlannerPhase(new Date('2026-04-22T12:00:00'));
      const apr23 = getPlannerPhase(new Date('2026-04-23T12:00:00'));
      expect(apr22.phase).toBe('free-agency');
      expect(apr23.phase).toBe('draft');
    });

    it('transitions from draft to default at rookie draft + 14', () => {
      const may15 = getPlannerPhase(new Date('2026-05-15T12:00:00'));
      const may16 = getPlannerPhase(new Date('2026-05-16T12:00:00'));
      expect(may15.phase).toBe('draft');
      expect(may16.phase).toBe('default');
    });
  });

  describe('next season cycle (2026-2027)', () => {
    it('returns default in early November 2026 (before week 11)', () => {
      // 2026 NFL season: Labor Day Sep 7, Kickoff Sep 10
      // Friday before Week 11 = Sep 10 + 64 = Nov 13, 2026
      assertPhase('2026-11-01T12:00:00', 'default');
    });

    it('returns extensions-and-tags after Friday before Week 11 of 2026 season', () => {
      // Nov 13, 2026 is Friday before Week 11 of 2026 NFL season
      assertPhase('2026-11-13T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags on Christmas 2026', () => {
      assertPhase('2026-12-25T12:00:00', 'extensions-and-tags');
    });

    it('returns extensions-and-tags in January 2027', () => {
      assertPhase('2027-01-10T12:00:00', 'extensions-and-tags');
    });
  });

  describe('defaults to current date when no referenceDate provided', () => {
    it('returns a valid phase with no arguments', () => {
      const result = getPlannerPhase();
      expect(['extensions-and-tags', 'free-agency', 'draft', 'default']).toContain(result.phase);
      expect(result.label).toBeTruthy();
      expect(typeof result.showDualDraftCards).toBe('boolean');
    });
  });
});
