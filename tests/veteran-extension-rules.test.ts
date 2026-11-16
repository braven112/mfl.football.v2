/**
 * TheLeague's Veteran Extension rule (Constitution § VETERAN EXTENSIONS),
 * plus Brandon's 2026-11-14 rulings where the Constitution is silent.
 * See src/utils/veteran-extension-rules.ts for the rule text.
 */
import { describe, it, expect } from 'vitest';
import {
  veteranExtensionEligibility,
  priceVeteranExtension,
  checkVeteranExtensionRequest,
  isRookieContract,
  leagueYearOfTimestamp,
  VETERAN_EXTENSION_LAST_LEAGUE_YEAR,
} from '../src/utils/veteran-extension-rules';
import { LEAGUE_CONSTITUTION } from '../src/data/league-constitution';

const averages = { positions: { WR: { top5Average: 8_500_000 }, Def: { top5Average: 1_000_000 } } };
const vet = (over: Partial<{ contractYears: number; contractInfo: string; salary: number; position: string }> = {}) => ({
  contractYears: 2,
  contractInfo: '',
  salary: 1_000_000,
  position: 'WR',
  ...over,
});

describe('eligibility', () => {
  it('needs at least 2 years remaining', () => {
    expect(veteranExtensionEligibility(vet({ contractYears: 1 }), 2026).eligible).toBe(false);
    expect(veteranExtensionEligibility(vet({ contractYears: 2 }), 2026).eligible).toBe(true);
  });

  it('refuses every rookie contract (RC and TO) — they use the Rookie Extension', () => {
    expect(isRookieContract('RC')).toBe(true);
    expect(isRookieContract('TO')).toBe(true);
    expect(veteranExtensionEligibility(vet({ contractInfo: 'RC', contractYears: 3 }), 2026).reason).toBe('rookie-contract');
    expect(veteranExtensionEligibility(vet({ contractInfo: 'TO', contractYears: 3 }), 2026).reason).toBe('rookie-contract');
  });

  it("offers the owner's choice of 1 or 2 years, inside the 6-year cap", () => {
    expect(veteranExtensionEligibility(vet({ contractYears: 4 }), 2026).yearChoices).toEqual([1, 2]);
    expect(veteranExtensionEligibility(vet({ contractYears: 5 }), 2026).yearChoices).toEqual([1]);
    expect(veteranExtensionEligibility(vet({ contractYears: 6 }), 2026).reason).toBe('at-year-cap');
  });

  it('ends with league year 2027 (Feb 15, 2028 sunset)', () => {
    expect(VETERAN_EXTENSION_LAST_LEAGUE_YEAR).toBe(2027);
    expect(veteranExtensionEligibility(vet(), 2027).eligible).toBe(true);
    expect(veteranExtensionEligibility(vet(), 2028).reason).toBe('rule-expired');
    // If the league votes the rule longer, this test and the constant move together.
    expect(LEAGUE_CONSTITUTION).toContain('until February 15, 2028');
  });
});

describe('price — the Rookie Extension formula', () => {
  it("matches the Constitution's worked example ($8.5M top-5, 2 + 2 years)", () => {
    const price = priceVeteranExtension(vet({ salary: 0 }), 2, averages);
    // 8.5M × 2 ÷ 4 = 4.25M added to each year, +10% per year after.
    expect(price.newYears).toBe(4);
    expect(price.newSalary).toBe(4_250_000);
    expect(price.salaryByYear).toEqual([4_250_000, 4_675_000, 5_142_500, 5_656_750]);
  });

  it('prorates a 1-year extension over the new term', () => {
    const price = priceVeteranExtension(vet({ contractYears: 3 }), 1, averages);
    expect(price.newYears).toBe(4);
    expect(price.newSalary).toBe(1_000_000 + 8_500_000 / 4);
  });

  it('reads MFL\'s "Def" averages key for a DEF player', () => {
    expect(priceVeteranExtension(vet({ position: 'DEF', salary: 0 }), 2, averages).newSalary).toBe(500_000);
  });
});

describe('checkVeteranExtensionRequest — the server decision', () => {
  const base = { player: vet(), leagueYear: 2026, salaryAverages: averages };

  it('accepts a valid request and returns the server price', () => {
    const r = checkVeteranExtensionRequest({ ...base, addedYears: 2 });
    expect(r.ok && r.price.newYears).toBe(4);
  });

  it('refuses a term outside the choices', () => {
    expect(checkVeteranExtensionRequest({ ...base, addedYears: 3 }).ok).toBe(false);
    expect(checkVeteranExtensionRequest({ ...base, player: vet({ contractYears: 5 }), addedYears: 2 }).ok).toBe(false);
  });

  it('allows one veteran extension per team per season', () => {
    const r = checkVeteranExtensionRequest({ ...base, addedYears: 2, teamAlreadyUsed: { playerName: 'Someone' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Someone');
  });

  it('refuses when there is no average to price from', () => {
    expect(checkVeteranExtensionRequest({ ...base, player: vet({ position: 'QB' }), addedYears: 2 }).ok).toBe(false);
  });
});

describe('league year of a filing', () => {
  it('rolls on Feb 14 8:45pm PT, not Jan 1', () => {
    expect(leagueYearOfTimestamp('2026-11-20T18:00:00.000Z')).toBe(2026);
    expect(leagueYearOfTimestamp('2027-02-10T18:00:00.000Z')).toBe(2026);
    expect(leagueYearOfTimestamp('2027-03-01T18:00:00.000Z')).toBe(2027);
  });
});
