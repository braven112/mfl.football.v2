import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byeWeeksByTeam } from '../src/utils/nfl-bye-lookup';

const file = { seasons: { '2026': { GBP: 5, KCC: 10, WAS: 12, JAC: '8', ARI: 14 } } };

describe('byeWeeksByTeam', () => {
  const byes = byeWeeksByTeam(file, new Date('2026-09-25T12:00:00Z'));

  it("finds a team by MFL's code (TheLeague's rows)", () => {
    expect(byes.GBP).toBe(5);
    expect(byes.KCC).toBe(10);
    expect(byes.WAS).toBe(12);
  });

  it("finds the same team by ESPN's code (the AFL's rows)", () => {
    expect(byes.GB).toBe(5);
    expect(byes.KC).toBe(10);
    expect(byes.WSH).toBe(12);
    expect(byes.JAX).toBe(8);
  });

  it("reads the calendar year's season, and nothing for a season not yet published", () => {
    expect(byeWeeksByTeam(file, new Date('2027-03-01T12:00:00Z'))).toEqual({});
  });

  it('covers every team a Free Agents row can carry, in both dialects', () => {
    const real = JSON.parse(readFileSync(join(__dirname, '..', 'data/nfl/bye-weeks.json'), 'utf8'));
    const live = byeWeeksByTeam(real, new Date('2026-10-01T12:00:00Z'));
    for (const t of ['GB', 'KC', 'JAX', 'LV', 'NE', 'NO', 'SF', 'TB', 'WAS', 'GBP', 'KCC', 'JAC', 'LVR', 'NEP', 'NOS', 'SFO', 'TBB']) {
      expect(live[t], t).toBeGreaterThan(0);
    }
  });
});
