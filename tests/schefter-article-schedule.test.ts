/**
 * `schefterArticleDecision` — which Schefter column is due on a Vercel tick.
 *
 * The slots are written in Pacific time so daylight saving is the zone's job.
 * The old GitHub schedule needed a DST pair (18:00 and 19:00 UTC) for the one
 * Saturday 11am PT preview; these cases pin both sides of the change, and that
 * each slot matches exactly ONE five-minute tick.
 */
import { describe, it, expect } from 'vitest';
import {
  schefterArticleDecision,
  SCHEFTER_ARTICLE_SLOTS,
  TICK_MINUTES,
  intervalJobDecision,
  INTERVAL_JOBS,
} from '../src/utils/sync-cadence';

const due = (iso: string) => schefterArticleDecision(new Date(iso)).types;

describe('schefterArticleDecision', () => {
  it('fires the Saturday preview at 11am PT under PST (19:00 UTC)', () => {
    expect(due('2026-11-14T19:00:20Z')).toEqual(['matchup-preview']);
    expect(due('2026-11-14T18:00:20Z')).toEqual([]);
  });

  it('fires the Saturday preview at 11am PT under PDT (18:00 UTC)', () => {
    expect(due('2026-10-03T18:00:20Z')).toEqual(['matchup-preview']);
    expect(due('2026-10-03T19:00:20Z')).toEqual([]);
  });

  it('matches exactly one tick per slot', () => {
    expect(due('2026-11-14T19:04:59Z')).toEqual(['matchup-preview']);
    expect(due('2026-11-14T19:05:00Z')).toEqual([]);
    expect(due('2026-11-14T18:59:59Z')).toEqual([]);
  });

  it('keeps schedule-release off the preview tick', () => {
    expect(due('2026-11-14T19:30:10Z')).toEqual(['schedule-release']);
    // Daily: a Monday too.
    expect(due('2026-11-16T19:30:10Z')).toEqual(['schedule-release']);
  });

  it('maps every weekly column to its Pacific weekday and hour', () => {
    expect(due('2026-11-17T15:00:00Z')).toEqual(['pecking-order']); // Tue 7am PST
    expect(due('2026-11-18T17:00:00Z')).toEqual(['schedule-strength']); // Wed 9am PST
    expect(due('2026-11-19T16:00:00Z')).toEqual(['waiver-pickups']); // Thu 8am PST
    expect(due('2026-11-19T06:00:00Z')).toEqual([]); // Wed 10pm PST: no longer the slot
    expect(due('2026-08-02T15:00:00Z')).toEqual(['cut-watch']); // Sun 8am PDT
  });

  it('skips an ordinary tick', () => {
    const d = schefterArticleDecision(new Date('2026-11-14T20:15:00Z'));
    expect(d.types).toEqual([]);
    expect(d.reason).toMatch(/No column due/);
  });

  it('puts every slot on a tick boundary, with no two slots sharing a tick', () => {
    const keys = new Set<string>();
    for (const s of SCHEFTER_ARTICLE_SLOTS) {
      expect(s.minute % TICK_MINUTES, s.type).toBe(0);
      // A daily slot collides with every weekday at that time.
      const days = s.weekday === null ? [0, 1, 2, 3, 4, 5, 6] : [s.weekday];
      for (const d of days) {
        const key = `${d}-${s.hour}-${s.minute}`;
        expect(keys.has(key), `two columns share ${key}`).toBe(false);
        keys.add(key);
      }
    }
  });
});

describe('intervalJobDecision', () => {
  it('keeps each job on its old cadence', () => {
    const at = (iso: string, job: Parameters<typeof intervalJobDecision>[0]) =>
      intervalJobDecision(job, new Date(iso)).dispatch;
    expect(at('2026-11-14T19:30:05Z', 'apply-pending-contracts')).toBe(true);
    expect(at('2026-11-14T19:15:05Z', 'apply-pending-contracts')).toBe(false);
    expect(at('2026-11-14T19:45:05Z', 'schefter-rumor-scan')).toBe(true);
    expect(at('2026-11-14T19:50:05Z', 'schefter-rumor-scan')).toBe(false);
  });

  it('gates the seasonal jobs on the Pacific month, not UTC', () => {
    // 2027-05-01 03:00 UTC is still April 30 in Pacific time.
    expect(intervalJobDecision('sync-draft-pick-contracts', new Date('2027-05-01T03:00:00Z')).dispatch).toBe(false);
    expect(intervalJobDecision('sync-draft-pick-contracts', new Date('2027-05-01T08:05:00Z')).dispatch).toBe(true);
    expect(intervalJobDecision('apply-august-cuts', new Date('2027-08-15T20:45:00Z')).dispatch).toBe(true);
    expect(intervalJobDecision('apply-august-cuts', new Date('2027-09-15T20:45:00Z')).dispatch).toBe(false);
  });

  it('uses intervals that are multiples of the tick and divide the hour', () => {
    for (const [job, { intervalMinutes }] of Object.entries(INTERVAL_JOBS)) {
      expect(intervalMinutes % TICK_MINUTES, job).toBe(0);
      expect(60 % intervalMinutes, job).toBe(0);
    }
  });
});
