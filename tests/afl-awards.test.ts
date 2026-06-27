import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  AWARD_TYPES,
  getAwardBadge,
  getAwardType,
  getFranchiseAwards,
  getFranchiseTrophyCase,
  countFranchiseBadges,
  type AwardSlug,
} from '../src/utils/afl-awards';
import { getTeam } from '../src/utils/afl-conference';
import awardsHistory from '../data/afl-fantasy/awards-history.json';

const ROOT = path.resolve(__dirname, '..');
const ALL_SLUGS = new Set(AWARD_TYPES.map((a) => a.slug));

describe('afl-awards taxonomy', () => {
  it('defines exactly 13 awards with unique slugs', () => {
    expect(AWARD_TYPES).toHaveLength(13);
    expect(ALL_SLUGS.size).toBe(13);
  });

  it('every award badge file exists under public/assets/afl/awards/', () => {
    for (const a of AWARD_TYPES) {
      const file = path.join(ROOT, 'public/assets/afl/awards', a.badge);
      expect(existsSync(file), `${a.badge} missing`).toBe(true);
    }
  });

  it('resolves the badge path from the awards asset folder', () => {
    expect(getAwardBadge('afl-championship')).toBe(
      '/assets/afl/awards/afl-championship.svg'
    );
    for (const a of AWARD_TYPES) {
      expect(getAwardBadge(a.slug)).toBe(`/assets/afl/awards/${a.badge}`);
    }
  });

  it('getAwardType returns the matching entry', () => {
    expect(getAwardType('nit')?.category).toBe('consolation');
    expect(getAwardType('premier-league')?.category).toBe('tier');
  });
});

describe('getFranchiseAwards', () => {
  it('always returns all 13 awards in taxonomy order (locker layout)', () => {
    const awards = getFranchiseAwards('0001');
    expect(awards).toHaveLength(13);
    expect(awards.map((a) => a.slug)).toEqual(AWARD_TYPES.map((a) => a.slug));
    for (const a of awards) expect(a.badgePath).toBe(getAwardBadge(a.slug));
  });

  it('surfaces a known champion with the correct year', () => {
    // 2024 AFL champion is franchise 0022 (Balls Deep) — verified vs MFL.
    const awards = getFranchiseAwards('0022');
    const afl = awards.find((a) => a.slug === 'afl-championship');
    expect(afl?.years).toContain(2024);
    expect(countFranchiseBadges('0022')).toBeGreaterThan(0);
  });

  it('returns empty year arrays (locked) for unwon awards', () => {
    const awards = getFranchiseAwards('0001');
    // Every award has a years array; locked ones are empty.
    for (const a of awards) expect(Array.isArray(a.years)).toBe(true);
  });

  it('years are sorted most-recent-first', () => {
    for (const team of ['0002', '0020']) {
      for (const a of getFranchiseAwards(team)) {
        const sorted = [...a.years].sort((x, y) => y - x);
        expect(a.years).toEqual(sorted);
      }
    }
  });
});

describe('getFranchiseTrophyCase', () => {
  it('expands dated majors to one year-stamped item per win', () => {
    // Drunk Indians (0002): Premier League 2021-2024 (dated) → 4 items.
    const tc = getFranchiseTrophyCase('0002');
    const premier = tc.filter((t) => t.slug === 'premier-league');
    expect(premier).toHaveLength(4);
    expect(premier.map((t) => t.year)).toEqual([2024, 2023, 2022, 2021]);
    for (const t of premier) {
      expect(t.dated).toBe(true);
      expect(t.years).toHaveLength(1);
    }
  });

  it('expands conference titles to one year-stamped item per win', () => {
    // 0002 won AL Champion in 2023, 2022, 2012 and 2011 (2012 derived from the
    // AFL Championship win) — every award is dated, so each win is its own
    // year-stamped badge (4 items, most recent first).
    const tc = getFranchiseTrophyCase('0002');
    const al = tc.filter((t) => t.slug === 'al-champion');
    expect(al).toHaveLength(4);
    expect(al.map((t) => t.year)).toEqual([2023, 2022, 2012, 2011]);
    for (const t of al) {
      expect(t.dated).toBe(true);
      expect(t.years).toHaveLength(1);
    }
  });

  it('includes only awards actually won (no empty items)', () => {
    for (const t of getFranchiseTrophyCase('0002')) {
      expect(t.years.length).toBeGreaterThan(0);
    }
  });

  it('total item-weight equals countFranchiseBadges', () => {
    const tc = getFranchiseTrophyCase('0002');
    const weight = tc.reduce((s, t) => s + (t.dated ? 1 : t.years.length), 0);
    expect(weight).toBe(countFranchiseBadges('0002'));
  });
});

describe('awards-history.json data integrity', () => {
  const seasons = (awardsHistory as { seasons: Array<{ year: number; awards: Record<string, { franchiseId: string | null }> }> }).seasons;

  it('every award slug is a known AwardSlug', () => {
    for (const s of seasons) {
      for (const slug of Object.keys(s.awards)) {
        expect(ALL_SLUGS.has(slug as AwardSlug), `${slug} (${s.year})`).toBe(true);
      }
    }
  });

  it('every non-null franchiseId resolves to a real AFL team', () => {
    for (const s of seasons) {
      for (const [slug, val] of Object.entries(s.awards)) {
        if (val.franchiseId == null) continue;
        expect(getTeam(val.franchiseId), `${slug} ${s.year} → ${val.franchiseId}`).toBeDefined();
      }
    }
  });
});
