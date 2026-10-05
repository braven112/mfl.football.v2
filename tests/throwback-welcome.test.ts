import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildThrowbackWelcome } from '../src/utils/throwback-welcome';
import { buildFranchiseBandBrands } from '../src/utils/franchise-band-brand';

// TheLeague's throwback week is NFL Week 4 (registry), which became current
// on 2026-09-29 and kicked off 2026-10-01 17:15 PT. The AFL's is Week 8.
const BEFORE_KICKOFF = new Date('2026-09-30T18:00:00Z');
const AFTER_KICKOFF = new Date('2026-10-03T18:00:00Z');
const WEEK_AFTER = new Date('2026-10-10T18:00:00Z');
const AFL_WEEK_8 = new Date('2026-10-28T18:00:00Z');

describe('buildThrowbackWelcome', () => {
  it('announces the identity and offers the picker before the first kickoff', () => {
    const w = buildThrowbackWelcome({ league: 'theleague', franchiseId: '0001', now: BEFORE_KICKOFF, overrides: {} });
    expect(w).not.toBeNull();
    expect(w!.week).toBe(4);
    expect(w!.locked).toBe(false);
    expect(w!.storageKey).toBe('throwback-welcome:theleague:2026:w4');
  });

  it('still announces after kickoff, but locked', () => {
    const w = buildThrowbackWelcome({ league: 'theleague', franchiseId: '0001', now: AFTER_KICKOFF, overrides: {} });
    expect(w?.locked).toBe(true);
  });

  it('is silent outside the throwback week', () => {
    expect(buildThrowbackWelcome({ league: 'theleague', franchiseId: '0001', now: WEEK_AFTER, overrides: {} })).toBeNull();
    // Week 8 is the AFL's, not TheLeague's.
    expect(buildThrowbackWelcome({ league: 'theleague', franchiseId: '0001', now: AFL_WEEK_8, overrides: {} })).toBeNull();
  });

  it('uses each league\'s own week and its own storage key', () => {
    const w = buildThrowbackWelcome({ league: 'afl', franchiseId: '0001', now: AFL_WEEK_8, overrides: {} });
    expect(w?.week).toBe(8);
    expect(w?.storageKey).toBe('throwback-welcome:afl:2026:w8');
  });

  it('is silent with no session franchise, or for a league with no Throwback Week', () => {
    expect(buildThrowbackWelcome({ league: 'theleague', franchiseId: null, now: BEFORE_KICKOFF, overrides: {} })).toBeNull();
    expect(buildThrowbackWelcome({ league: 'bb1', franchiseId: '0001', now: BEFORE_KICKOFF, overrides: {} })).toBeNull();
  });

  it('shows exactly the identity the page\'s band map resolves (one chokepoint)', () => {
    const band = buildFranchiseBandBrands('theleague', { throwbackActive: true, throwbackOverrides: {} });
    for (const [id, brand] of Object.entries(band.teams)) {
      const w = buildThrowbackWelcome({ league: 'theleague', franchiseId: id, now: BEFORE_KICKOFF, overrides: {} });
      expect(w?.name).toBe(brand.name);
      expect(w?.crest).toBe(brand.crest);
    }
  });
});

describe('ThrowbackWeekModal wiring', () => {
  const layout = readFileSync('src/layouts/TheLeagueLayout.astro', 'utf8');
  const modal = readFileSync('src/components/shared/ThrowbackWeekModal.astro', 'utf8');

  it('the layout keys it off the SESSION franchise and the real week', () => {
    expect(layout).toMatch(/franchiseId:\s*sessionFranchiseId/);
    expect(layout).toMatch(/searchParams\.delete\('week'\)/);
  });

  it('the client gate names its league (cross-league swaps reuse the id)', () => {
    expect(modal).toMatch(/data-league=\{leagueSlug\}/);
    expect(modal).toMatch(/astro:page-load/);
    expect(modal).not.toMatch(/DOMContentLoaded/);
  });
});

describe('formatThrowbackEraYears', () => {
  it("formats an era as '08–'11, and a single season as '08", async () => {
    const { formatThrowbackEraYears } = await import('../src/utils/throwback-welcome');
    expect(formatThrowbackEraYears(2008, 2011)).toBe('’08–’11');
    expect(formatThrowbackEraYears(2003, 2003)).toBe('’03');
  });

  it('every franchise that throws back gets its era years', () => {
    const w = buildThrowbackWelcome({ league: 'theleague', franchiseId: '0001', now: BEFORE_KICKOFF, overrides: {} });
    expect(w?.years).toMatch(/^’\d\d(–’\d\d)?$/);
  });
});
