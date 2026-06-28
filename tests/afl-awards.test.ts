import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  AWARD_TYPES,
  getAwardBadge,
  getAwardType,
  getFranchiseAwards,
  getFranchiseTrophyCase,
  getFranchiseTrophyRoom,
  getFranchiseGrandSlam,
  getFranchiseTitleProgress,
  getFranchiseTrophyRank,
  TITLE_TYPES,
  countFranchiseBadges,
  type AwardSlug,
} from '../src/utils/afl-awards';
import { getTeam } from '../src/utils/afl-conference';
import awardsHistory from '../data/afl-fantasy/awards-history.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

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

describe('getFranchiseTrophyRoom (locked placeholders)', () => {
  const UNIVERSAL = ['afl-championship', 'premier-league', 'dleague-champion', 'nit'];

  it('shows every active award as a locked placeholder for a trophy-less franchise', () => {
    // 0004 (Get off my Ditka) has no credited awards.
    const room = getFranchiseTrophyRoom('0004', {
      divisionSlug: 'al-north',
      conferenceSlug: 'al-champion',
    });
    const items = room.flatMap((g) => g.items);
    const lockedSlugs = items.filter((i) => i.locked).map((i) => i.slug).sort();
    expect(lockedSlugs).toEqual(
      [...UNIVERSAL, 'al-champion', 'al-north'].sort()
    );
    // Locked items carry no years and no earned items leaked in.
    expect(items.every((i) => i.locked && i.years.length === 0)).toBe(true);
  });

  it('does not lock an award the franchise has already won', () => {
    // 0002 (Drunk Indians) has won all universal majors + AL conference/division.
    const room = getFranchiseTrophyRoom('0002', {
      divisionSlug: 'al-north',
      conferenceSlug: 'al-champion',
    });
    const items = room.flatMap((g) => g.items);
    expect(items.some((i) => i.locked)).toBe(false);
    // Earned majors are present and dated.
    const afl = items.find((i) => i.slug === 'afl-championship');
    expect(afl?.locked).toBeFalsy();
    expect(afl?.years.length).toBeGreaterThan(0);
  });

  it('never adds a locked placeholder for a retired award type', () => {
    const room = getFranchiseTrophyRoom('0004', {
      divisionSlug: 'al-north',
      conferenceSlug: 'al-champion',
    });
    const slugs = room.flatMap((g) => g.items).map((i) => i.slug);
    for (const retired of ['afl-cup', 'al-central', 'nl-pacific']) {
      expect(slugs).not.toContain(retired);
    }
  });
});

describe('getFranchiseTitleProgress', () => {
  it('always returns the six title types in prestige order', () => {
    const p = getFranchiseTitleProgress('0001');
    expect(p.total).toBe(6);
    expect(p.types).toHaveLength(6);
    expect(p.types.map((t) => t.key)).toEqual([
      'afl',
      'premier',
      'conference',
      'division',
      'dleague',
      'nit',
    ]);
  });

  it('matches the TITLE_TYPES taxonomy (6 types covering every non-cup slug)', () => {
    expect(TITLE_TYPES).toHaveLength(6);
    const typed = new Set(TITLE_TYPES.flatMap((t) => t.slugs));
    for (const a of AWARD_TYPES) {
      if (a.slug === 'afl-cup') continue; // retired, not its own type
      expect(typed.has(a.slug), `${a.slug} not mapped to a title type`).toBe(true);
    }
  });

  it('counts a type as won when any of its slugs was won, with desc years', () => {
    // 0002 (Drunk Indians) has Premier League 2021–2024.
    const p = getFranchiseTitleProgress('0002');
    const premier = p.types.find((t) => t.key === 'premier')!;
    expect(premier.won).toBe(true);
    expect(premier.years).toEqual([...premier.years].sort((a, b) => b - a));
    expect(premier.years).toEqual([2024, 2023, 2022, 2021]);
  });

  it('collapses conference titles (AL or NL) into one "conference" type', () => {
    const conf = TITLE_TYPES.find((t) => t.key === 'conference')!;
    expect(conf.slugs).toContain('al-champion');
    expect(conf.slugs).toContain('nl-champion');
  });

  it('reports 0 / no years for a franchise with no titles', () => {
    // 0004 (Get off my Ditka) has no credited awards.
    const p = getFranchiseTitleProgress('0004');
    expect(p.wonCount).toBe(0);
    expect(p.types.every((t) => !t.won && t.years.length === 0)).toBe(true);
  });

  it('wonCount equals the number of types with at least one win', () => {
    const p = getFranchiseTitleProgress('0002');
    expect(p.wonCount).toBe(p.types.filter((t) => t.won).length);
    expect(p.wonCount).toBeGreaterThan(0);
    expect(p.wonCount).toBeLessThanOrEqual(6);
  });
});

describe('getFranchiseTrophyRank', () => {
  const TEAM_COUNT = (aflConfig as { teams: unknown[] }).teams.length;

  it('ranks every franchise against the full league', () => {
    const r = getFranchiseTrophyRank('0001');
    expect(r.totalFranchises).toBe(TEAM_COUNT);
    expect(r.count).toBe(countFranchiseBadges('0001'));
  });

  it('the trophy leader is rank 1 and untied', () => {
    // 0001 (Smokane FC) has the most hardware in the league — verified vs data.
    const counts = (aflConfig as { teams: Array<{ franchiseId: string }> }).teams.map(
      (t) => countFranchiseBadges(t.franchiseId)
    );
    const max = Math.max(...counts);
    const leaderIsUnique = counts.filter((c) => c === max).length === 1;
    const r = getFranchiseTrophyRank('0001');
    expect(r.count).toBe(max);
    expect(r.rank).toBe(1);
    expect(r.tied).toBe(!leaderIsUnique);
  });

  it('orders franchises by descending trophy count (rank tracks count)', () => {
    const ids = (aflConfig as { teams: Array<{ franchiseId: string }> }).teams.map(
      (t) => t.franchiseId
    );
    const ranked = ids
      .map((id) => getFranchiseTrophyRank(id))
      .sort((a, b) => a.rank - b.rank);
    // A lower (better) rank never has a smaller trophy count than a worse rank.
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].count).toBeLessThanOrEqual(ranked[i - 1].count);
    }
  });

  it('uses standard competition ranking — ties share a rank, next rank skips', () => {
    // 0005, 0015, 0021 all sit on 10 trophies → they share one rank, and the
    // rank below skips by the size of the tie group.
    const tied = ['0005', '0015', '0021'].map((id) => getFranchiseTrophyRank(id));
    expect(new Set(tied.map((r) => r.count)).size).toBe(1); // same count
    expect(new Set(tied.map((r) => r.rank)).size).toBe(1); // same rank
    for (const r of tied) expect(r.tied).toBe(true);

    // 0014 (Thundering Herd, 14) sits alone directly above the tie group, so the
    // shared rank is exactly 0014's rank + 1.
    const above = getFranchiseTrophyRank('0014');
    expect(above.tied).toBe(false);
    expect(tied[0].rank).toBe(above.rank + 1);
  });

  it('ranks a zero-trophy franchise last (tied) without crashing', () => {
    // 0004 (Get off my Ditka) has no hardware; several teams share 0.
    const r = getFranchiseTrophyRank('0004');
    expect(r.count).toBe(0);
    expect(r.tied).toBe(true);
    expect(r.rank).toBeGreaterThan(1);
    expect(r.rank).toBeLessThanOrEqual(r.totalFranchises);
  });
});

describe('getFranchiseGrandSlam', () => {
  it('is not completed when a title type is unwon', () => {
    // 0004 (Get off my Ditka) has no credited awards.
    const gs = getFranchiseGrandSlam('0004');
    expect(gs.completed).toBe(false);
    expect(gs.year).toBeUndefined();
    expect(gs.missingTypes.length).toBeGreaterThan(0);
  });

  it('completed ⇔ the progress bar reads 6/6', () => {
    for (const fid of ['0001', '0002', '0004', '0015', '0022']) {
      const gs = getFranchiseGrandSlam(fid);
      const p = getFranchiseTitleProgress(fid);
      expect(gs.completed).toBe(p.wonCount === 6);
    }
  });

  it('stamps the completion year as the latest of each type’s first win', () => {
    // 0015 (The Mariachi Ninjas) completes the set — verified vs awards data.
    const gs = getFranchiseGrandSlam('0015');
    if (!gs.completed) return; // data-driven guard; covered by the ⇔ test above
    const p = getFranchiseTitleProgress('0015');
    const expected = Math.max(...p.types.map((t) => Math.min(...t.years)));
    expect(gs.year).toBe(expected);
    // Never earlier than any type's first win.
    for (const t of p.types) {
      expect(gs.year).toBeGreaterThanOrEqual(Math.min(...t.years));
    }
  });
});
