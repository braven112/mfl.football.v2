import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, LEAGUES } from '../src/config/leagues-data.mjs';
import {
  FEATURE_CATALOG,
  FEATURE_GROUPS,
  FEATURE_KEYS,
  featureDependencyErrors,
} from '../src/config/league-feature-catalog.mjs';
import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  detectArchetype,
  suggestLeagueSetup,
  toRegistryFeatures,
} from '../src/config/league-archetypes.mjs';

/**
 * Settings excerpts from each league's committed MFL `TYPE=league` export
 * (data/<league>/mfl-feeds/2026/league.json, Oct 2026), trimmed to the fields
 * the detectors read. Inline rather than read from data/ so a sync commit that
 * changes an unrelated setting cannot turn this suite red.
 */
const seasons = (n: number) => ({ league: Array.from({ length: n }, (_, i) => ({ year: String(2026 - i) })) });
const teams = (n: number) => ({ count: String(n), franchise: Array.from({ length: n }, (_, i) => ({ id: String(i + 1).padStart(4, '0') })) });

const MFL_THELEAGUE = {
  usesContractYear: '1', usesSalaries: '1', salaryCapAmount: '45000000', keeperType: 'dynasty',
  taxiSquad: '3', loadRosters: 'email_draft_email_auction', auction_kind: 'email', bestLineup: 'No',
  playerLimitUnit: 'LEAGUE', franchises: teams(16), history: seasons(10),
};
const MFL_AFL = {
  usesContractYear: '0', usesSalaries: '0', maxKeepers: '7', minKeepers: '7', taxiSquad: '0',
  loadRosters: 'email_draft', bestLineup: 'No', playerLimitUnit: 'CONFERENCE', franchises: teams(24),
  history: seasons(20),
};
const MFL_ARCHIES = {
  usesContractYear: '0', usesSalaries: '0', keeperType: 'none', taxiSquad: '0', loadRosters: 'live_draft',
  bestLineup: 'No', playerLimitUnit: 'DIVISION', franchises: teams(99), history: seasons(6),
};

describe('feature catalog', () => {
  it('has exactly one entry per registry feature flag', () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
    for (const league of ALL_LEAGUES) {
      expect(Object.keys(league.features).sort(), league.slug).toEqual([...FEATURE_KEYS].sort());
    }
  });

  it('names a real group and only real prerequisites', () => {
    for (const f of FEATURE_CATALOG) {
      expect(Object.keys(FEATURE_GROUPS), f.key).toContain(f.group);
      expect(f.label.length, f.key).toBeGreaterThan(0);
      for (const req of f.requires) expect(FEATURE_KEYS, `${f.key} requires ${req}`).toContain(req);
    }
  });

  it('reports an unmet prerequisite', () => {
    const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false]));
    expect(featureDependencyErrors(features)).toEqual([]);
    expect(featureDependencyErrors({ ...features, schefterTips: true })).toEqual(['schefterTips requires schefterFeed']);
  });
});

describe('archetype presets', () => {
  it('define every feature and satisfy every prerequisite', () => {
    for (const key of ARCHETYPE_KEYS) {
      const p = ARCHETYPES[key];
      expect(Object.keys(p.features).sort(), key).toEqual([...FEATURE_KEYS].sort());
      for (const v of Object.values(p.features)) expect(typeof v).toBe('boolean');
      expect(featureDependencyErrors(p.features), key).toEqual([]);
    }
  });

  it('match the league each one is modelled on', () => {
    for (const key of ARCHETYPE_KEYS) {
      const example = ARCHETYPES[key].example;
      if (!example) continue;
      const league = (LEAGUES as Record<string, { features: Record<string, boolean>; archetype: string }>)[example];
      expect(league, `${key} example ${example}`).toBeDefined();
      expect(league.archetype, example).toBe(key);
      expect(league.features, `${example} vs ${key} preset`).toEqual(ARCHETYPES[key].features);
    }
  });

  it('are the same list as the LeagueArchetype type', () => {
    const src = readFileSync('src/config/leagues.ts', 'utf8');
    const m = src.match(/export type LeagueArchetype =([^;]+);/);
    expect(m, 'LeagueArchetype union in leagues.ts').not.toBeNull();
    const union = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(union).toEqual([...ARCHETYPE_KEYS].sort());
  });
});

describe('registry leagues', () => {
  it('each name a known archetype and carry valid features', () => {
    for (const league of ALL_LEAGUES) {
      expect(ARCHETYPE_KEYS, league.slug).toContain(league.archetype);
      expect(featureDependencyErrors(league.features), league.slug).toEqual([]);
    }
  });
});

describe('suggestLeagueSetup', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['theleague', MFL_THELEAGUE, 'dynasty-cap'],
    ['afl-fantasy', MFL_AFL, 'deluxe-keeper'],
    ['archies', MFL_ARCHIES, 'contest'],
  ];

  it.each(cases)('pre-ticks exactly what %s runs today', (slug, mfl, archetype) => {
    const s = suggestLeagueSetup(mfl);
    expect(s.archetype).toBe(archetype);
    const registry = (LEAGUES as Record<string, { features: Record<string, boolean> }>)[slug].features;
    expect(toRegistryFeatures(s.features)).toEqual(registry);
  });

  it('gives every box a reason', () => {
    const s = suggestLeagueSetup(MFL_THELEAGUE);
    for (const k of FEATURE_KEYS) expect(s.features[k].reason.length, k).toBeGreaterThan(0);
    expect(s.features.contracts.source).toBe('mfl-setting');
    expect(s.features.schefterFeed.source).toBe('preset');
  });

  it('detects best ball from the auto-set lineup', () => {
    expect(detectArchetype({ ...MFL_ARCHIES, bestLineup: 'Yes' }).archetype).toBe('best-ball');
  });

  it('falls back to standard redraft for a plain home league', () => {
    const plain = {
      usesContractYear: '0', usesSalaries: '0', keeperType: 'none', taxiSquad: '0', loadRosters: 'email_draft',
      bestLineup: 'No', playerLimitUnit: 'LEAGUE', franchises: teams(12), history: seasons(1),
    };
    const s = suggestLeagueSetup(plain);
    expect(s.archetype).toBe('standard-redraft');
    expect(s.features.keepers.on).toBe(false);
    // First season: nothing to replay, whatever the preset says.
    expect(s.features.liveScoringSample).toMatchObject({ on: false, source: 'mfl-setting' });
  });

  it('re-presets from a chosen archetype but keeps MFL-decided boxes', () => {
    const s = suggestLeagueSetup(MFL_THELEAGUE, { archetype: 'contest' });
    expect(s.archetype).toBe('contest');
    expect(s.detectedArchetype).toBe('dynasty-cap');
    expect(s.features.contracts.on).toBe(true);
    expect(s.features.accounting).toMatchObject({ on: false, source: 'preset' });
  });
});
