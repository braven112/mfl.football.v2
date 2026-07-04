import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module shared with node cron scripts
import { normalizeWeeklyResults } from '../scripts/lib/normalize-weekly-results.mjs';

describe('normalizeWeeklyResults', () => {
  it('reads the modern matchup[] shape', () => {
    const raw = [
      {
        weeklyResults: {
          week: '1',
          matchup: [
            { franchise: [{ id: '0001', score: '100.5' }, { id: '0002', score: '90.25' }] },
            { franchise: [{ id: '0003', score: '80' }, { id: '0004', score: '70' }] },
          ],
        },
      },
    ];
    expect(normalizeWeeklyResults(raw)).toEqual({
      weeks: [
        { week: 1, scores: { '0001': 100.5, '0002': 90.25, '0003': 80, '0004': 70 } },
      ],
    });
  });

  it('reads the older flat franchise[] shape (archive-year regular seasons)', () => {
    const raw = [
      {
        weeklyResults: {
          week: '3',
          franchise: [
            { id: '0001', score: '119.32', starters: 'x', opt_pts: '139.76' },
            { id: '0002', score: '88.1' },
          ],
        },
      },
    ];
    expect(normalizeWeeklyResults(raw)).toEqual({
      weeks: [{ week: 3, scores: { '0001': 119.32, '0002': 88.1 } }],
    });
  });

  it('reads a mixed payload (some weeks matchup, some flat, one week both)', () => {
    const raw = [
      { weeklyResults: { week: '1', franchise: [{ id: '0001', score: '10' }] } },
      { weeklyResults: { week: '14', matchup: [{ franchise: [{ id: '0001', score: '20' }] }] } },
      {
        // 2018 W16 style: playoff matchups PLUS consolation teams as a flat list
        weeklyResults: {
          week: '16',
          matchup: [{ franchise: [{ id: '0001', score: '30' }, { id: '0002', score: '25' }] }],
          franchise: [{ id: '0003', score: '15' }],
        },
      },
    ];
    expect(normalizeWeeklyResults(raw)).toEqual({
      weeks: [
        { week: 1, scores: { '0001': 10 } },
        { week: 14, scores: { '0001': 20 } },
        { week: 16, scores: { '0001': 30, '0002': 25, '0003': 15 } },
      ],
    });
  });

  it('normalizes MFL single-object collections (bare matchup / bare franchise)', () => {
    const raw = [
      {
        weeklyResults: {
          week: '17',
          matchup: { franchise: { id: '0001', score: '42' } },
        },
      },
    ];
    expect(normalizeWeeklyResults(raw)).toEqual({
      weeks: [{ week: 17, scores: { '0001': 42 } }],
    });
  });

  it('skips franchises without a score and handles empty/missing payloads', () => {
    const raw = [
      { weeklyResults: { week: '2', franchise: [{ id: '0001' }, { id: '0002', score: '5' }] } },
      { weeklyResults: { week: '4' } },
      {},
    ];
    expect(normalizeWeeklyResults(raw)).toEqual({
      weeks: [
        { week: 2, scores: { '0002': 5 } },
        { week: 4, scores: {} },
        { week: undefined, scores: {} },
      ],
    });
  });
});
