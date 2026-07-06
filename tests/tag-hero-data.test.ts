import { describe, it, expect } from 'vitest';
import { parseExpiringContractStars } from '../src/utils/hero-data/tag-hero-data';

/**
 * Tag-window hero data — expiring-contract star parse.
 *
 * Fixture-driven so assertions don't depend on the cron-regenerated rosters
 * feed. Covers the contractYear filter, salary DESC sort, and MFL's
 * single-vs-array shape on both `franchise` and `player`.
 */
describe('parseExpiringContractStars', () => {
  it('keeps only ROSTER + contractYear "4" players', () => {
    const data = {
      rosters: {
        franchise: [
          {
            id: '0001',
            player: [
              { id: 'a', status: 'ROSTER', contractYear: '4', salary: '100.00' },
              { id: 'b', status: 'ROSTER', contractYear: '3', salary: '999.00' }, // not final year
              { id: 'c', status: 'INJURED_RESERVE', contractYear: '4', salary: '500.00' }, // not ROSTER
              { id: 'd', status: 'ROSTER', contractYear: '4', salary: '200.00' },
            ],
          },
        ],
      },
    };
    const stars = parseExpiringContractStars(data);
    expect(stars.map((s) => s.playerId)).toEqual(['d', 'a']); // b, c excluded
  });

  it('sorts by salary DESC', () => {
    const data = {
      rosters: {
        franchise: [
          {
            id: '0001',
            player: [
              { id: 'cheap', status: 'ROSTER', contractYear: '4', salary: '100000.00' },
              { id: 'rich', status: 'ROSTER', contractYear: '4', salary: '5000000.00' },
              { id: 'mid', status: 'ROSTER', contractYear: '4', salary: '1000000.00' },
            ],
          },
        ],
      },
    };
    const stars = parseExpiringContractStars(data);
    expect(stars.map((s) => s.playerId)).toEqual(['rich', 'mid', 'cheap']);
    expect(stars[0].salary).toBe(5_000_000);
  });

  it('carries the owning franchise id', () => {
    const data = {
      rosters: {
        franchise: [
          { id: '0007', player: { id: 'x', status: 'ROSTER', contractYear: '4', salary: '10.00' } },
        ],
      },
    };
    const stars = parseExpiringContractStars(data);
    expect(stars[0]).toEqual({ playerId: 'x', franchiseId: '0007', salary: 10 });
  });

  it('handles a single franchise object (not array)', () => {
    const data = {
      rosters: {
        franchise: {
          id: '0002',
          player: [
            { id: 'p1', status: 'ROSTER', contractYear: '4', salary: '300.00' },
            { id: 'p2', status: 'ROSTER', contractYear: '4', salary: '400.00' },
          ],
        },
      },
    };
    const stars = parseExpiringContractStars(data);
    expect(stars.map((s) => s.playerId)).toEqual(['p2', 'p1']);
  });

  it('handles a single player object (not array)', () => {
    const data = {
      rosters: {
        franchise: [
          { id: '0003', player: { id: 'solo', status: 'ROSTER', contractYear: '4', salary: '50.00' } },
        ],
      },
    };
    const stars = parseExpiringContractStars(data);
    expect(stars).toHaveLength(1);
    expect(stars[0].playerId).toBe('solo');
  });

  it('defaults missing/invalid salary to 0', () => {
    const data = {
      rosters: {
        franchise: [
          {
            id: '0004',
            player: [
              { id: 'nosalary', status: 'ROSTER', contractYear: '4' },
              { id: 'withsalary', status: 'ROSTER', contractYear: '4', salary: '999.00' },
            ],
          },
        ],
      },
    };
    const stars = parseExpiringContractStars(data);
    // withsalary leads (999 > 0)
    expect(stars.map((s) => s.playerId)).toEqual(['withsalary', 'nosalary']);
    expect(stars.find((s) => s.playerId === 'nosalary')!.salary).toBe(0);
  });

  it('returns [] for empty / malformed feeds', () => {
    expect(parseExpiringContractStars(null)).toEqual([]);
    expect(parseExpiringContractStars({})).toEqual([]);
    expect(parseExpiringContractStars({ rosters: {} })).toEqual([]);
    expect(parseExpiringContractStars({ rosters: { franchise: [] } })).toEqual([]);
  });

  it('collects final-year players across multiple franchises', () => {
    const data = {
      rosters: {
        franchise: [
          { id: '0001', player: { id: 'a', status: 'ROSTER', contractYear: '4', salary: '100.00' } },
          { id: '0002', player: { id: 'b', status: 'ROSTER', contractYear: '4', salary: '900.00' } },
        ],
      },
    };
    const stars = parseExpiringContractStars(data);
    expect(stars.map((s) => `${s.franchiseId}:${s.playerId}`)).toEqual(['0002:b', '0001:a']);
  });
});
