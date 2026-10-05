import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyThrowbackToStandingsConfig } from '../src/utils/throwback-standings';
import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

const ACTIVE = { throwbackActive: true, throwbackOverrides: {} };
const INACTIVE = { throwbackActive: false, throwbackOverrides: {} };

describe('applyThrowbackToStandingsConfig', () => {
  for (const [league, config] of [
    ['theleague', theleagueConfig],
    ['afl', aflConfig],
  ] as const) {
    describe(league, () => {
      it('swaps the art to the era and keeps TODAY’s name for the second line', () => {
        const { config: out, todayNames } = applyThrowbackToStandingsConfig(
          league,
          config as any,
          ACTIVE,
          { isCurrentSeason: true },
        );
        expect(todayNames).toBeDefined();
        for (const t of (config as any).teams) {
          expect(todayNames![t.franchiseId]).toBe(t.name);
        }
        // At least one club actually throws back — otherwise the sweep is vacuous.
        const changed = out.teams.filter(
          (t: any, i: number) => t.banner !== (config as any).teams[i].banner,
        );
        expect(changed.length).toBeGreaterThan(0);
      });

      it('is a no-op outside a throwback week', () => {
        const res = applyThrowbackToStandingsConfig(league, config as any, INACTIVE, {
          isCurrentSeason: true,
        });
        expect(res.config).toBe(config);
        expect(res.todayNames).toBeUndefined();
      });

      it('leaves archived seasons wearing their own year’s identity', () => {
        const res = applyThrowbackToStandingsConfig(league, config as any, ACTIVE, {
          isCurrentSeason: false,
        });
        expect(res.config).toBe(config);
        expect(res.todayNames).toBeUndefined();
      });
    });
  }

  it('never throws back a league that does not run Throwback Week', () => {
    const res = applyThrowbackToStandingsConfig('bb1', theleagueConfig as any, ACTIVE, {
      isCurrentSeason: true,
    });
    expect(res.todayNames).toBeUndefined();
  });
});

// Both standings routes must read ONE clock: the default year, the fallback
// redirect and the throwback gate all follow ?testDate=. The gate once read the
// test clock while the default year read the real one, so a preview disagreed
// with itself (#1273), and /rollover-check could not drive the page by date.
// TheLeague resolves its season in the page; the AFL family resolves it in
// resolveStandingsRoute and gates throwback in the shared StandingsPage.
describe('standings pages share one season clock', () => {
  const read = (f: string) => readFileSync(f, 'utf8');
  const seasonResolvers = {
    'src/pages/theleague/standings.astro': read('src/pages/theleague/standings.astro'),
    'src/utils/afl-family-standings.ts': read('src/utils/afl-family-standings.ts'),
  };

  for (const [file, src] of Object.entries(seasonResolvers)) {
    it(`${file}: the default year follows ?testDate=`, () => {
      expect(src).toMatch(/const testDate = getTestDateFromSearchParams\((Astro\.)?url\.searchParams\);/);
      expect(src).toMatch(/const currentSeasonYear = getCurrentSeasonYear\(testDate \?\? undefined\);/);
      // No second, real-clock season year.
      expect(src).not.toMatch(/getCurrentSeasonYear\(\)/);
    });

    it(`${file}: every fallback redirect keeps the test clock`, () => {
      const redirects = src.match(/(Astro\.redirect\(|redirect: )`[^`]*`/g) ?? [];
      expect(redirects.length).toBeGreaterThan(0);
      for (const r of redirects) expect(r).toContain('${testDateQuery}');
    });
  }

  it('TheLeague: the throwback gate reads that same year', () => {
    expect(seasonResolvers['src/pages/theleague/standings.astro']).toMatch(
      /isCurrentSeason: selectedYear === currentSeasonYear/,
    );
  });

  it('AFL family: the throwback gate reads the test clock too', () => {
    const page = read('src/components/shared/standings/AflFamilyStandingsPage.astro');
    expect(page).toMatch(
      /getCurrentSeasonYear\(getTestDateFromSearchParams\(Astro\.url\.searchParams\) \?\? undefined\)/,
    );
    expect(page).not.toMatch(/getCurrentSeasonYear\(\)/);
  });
});
