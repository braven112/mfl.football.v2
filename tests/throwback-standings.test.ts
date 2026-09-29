import { describe, it, expect } from 'vitest';
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
