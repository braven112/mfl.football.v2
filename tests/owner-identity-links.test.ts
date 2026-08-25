/**
 * Former Identities → owner pages.
 *
 * The strip on each franchises index page listed every historical name in the
 * league and, before the owners feature, had nowhere correct to send them:
 * franchise detail pages filter their eras to seasons the CURRENT owner is
 * attributed, so an identity held by a prior owner of the slot has no anchor
 * to land on. TheLeague's strip therefore resolved 0 of 23 links to an era and
 * fell through to the Asset Library for all of them; the AFL's sent all 95 to
 * one `#name-history` section on whichever slot holds that name today.
 *
 * These tests pin the fix in both directions:
 *   - every identity in BOTH leagues resolves to an owner page (the data
 *     contract — a name the index can't resolve is a dead link again), and
 *   - the two lookup keys are both required (dropping either silently
 *     regresses a subset).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { foldForFilter, ownerSlugForIdentity } from '../src/utils/owner-links';
import { buildHistoricalIdentities } from '../src/utils/franchise-eras';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const REPO_ROOT = process.cwd();
const readJson = (p: string) =>
  fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;

interface LeagueFixture {
  slug: string;
  teams: any[];
  identityIndex: Record<string, string>;
  ownerSlugs: Set<string>;
}

const fixtures: LeagueFixture[] = [];
for (const league of Object.values(LEAGUES) as any[]) {
  const tenures = readJson(
    path.join(REPO_ROOT, league.dataPath, 'derived/owner-tenures.json')
  );
  // Leagues that don't run the franchise-history pipeline have no owners file.
  // Structural skip, exactly as the other owners suites do it.
  if (!tenures) continue;
  const config = readJson(path.join(REPO_ROOT, league.configPath));
  const teams = Array.isArray(config.teams)
    ? config.teams
    : Object.values(config.teams ?? config);
  fixtures.push({
    slug: league.slug,
    teams,
    identityIndex: tenures.identityIndex,
    ownerSlugs: new Set(tenures.owners.map((o: any) => o.slug)),
  });
}

it('found at least both full-management leagues to check', () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(2);
});

describe.each(fixtures)('Former Identities strip — $slug', (fixture) => {
  const identities = buildHistoricalIdentities(fixture.teams as any[]);

  it('has identities to resolve', () => {
    expect(identities.length).toBeGreaterThan(0);
  });

  it('resolves EVERY historical identity to an owner page', () => {
    const unresolved = identities
      .filter((h) => !ownerSlugForIdentity(fixture.identityIndex, h.name, h.yearStart))
      .map((h) => `${h.name} (${h.yearStart}, franchise ${h.franchiseId})`);
    expect(unresolved).toEqual([]);
  });

  it('only ever points at an owner that exists in the file', () => {
    for (const h of identities) {
      const slug = ownerSlugForIdentity(fixture.identityIndex, h.name, h.yearStart);
      expect(fixture.ownerSlugs.has(slug as string), `${h.name} → ${slug}`).toBe(true);
    }
  });
});

describe('ownerSlugForIdentity — both keys are load-bearing', () => {
  const index = {
    'witch city warlocks|2007': 'witch-city-warlocks-2007',
    'devil dogs|2011': 'devil-dogs-2011',
  };

  it('resolves on the identity name as written', () => {
    expect(ownerSlugForIdentity(index, 'Witch City Warlocks', 2007)).toBe(
      'witch-city-warlocks-2007'
    );
  });

  /**
   * buildHistoricalIdentities joins a multi-name group as "Foo / Bar" while
   * owner-tenures.json indexes each name on its own, so the combined string
   * misses and the DOMINANT name — the first segment — is what hits. Exactly
   * one real identity needs this branch (TheLeague's "Poker in the Rear /
   * Generals", 2012); without it that one link silently dies, which is why the
   * real-data test above fails too when this fallback is removed.
   */
  it('falls back to the dominant name of a combined "A / B" identity', () => {
    expect(ownerSlugForIdentity(index, 'Devil Dogs / Semper Fido', 2011)).toBe(
      'devil-dogs-2011'
    );
  });

  it('normalizes case and punctuation the way the index is keyed', () => {
    expect(ownerSlugForIdentity(index, 'The  WITCH City Warlocks', 2007)).toBe(
      'witch-city-warlocks-2007'
    );
  });

  it('returns null rather than a wrong owner when the year differs', () => {
    expect(ownerSlugForIdentity(index, 'Witch City Warlocks', 2008)).toBeNull();
  });

  it('returns null for a name nobody held', () => {
    expect(ownerSlugForIdentity(index, 'Never Existed', 2007)).toBeNull();
  });
});

/**
 * The owners filter is the only way to find a former owner in a table of 65,
 * and it was matching raw lowercase text. MFL hands back names exactly as the
 * owner typed them, so its export spells Rick O’Keefe with a CURLY apostrophe
 * — and `"rick o’keefe".includes("rick o'keefe")` is false. Typing his name
 * the obvious way returned "No owners match that filter".
 *
 * Caught by Copilot on PR #615. These pin the fold in both directions: the
 * three spellings must collapse to one key, and the fold must be applied to
 * the query as well, or the mismatch simply moves.
 */
describe('foldForFilter', () => {
  it('makes the three spellings of an apostrophe one key', () => {
    const curly = foldForFilter('Rick O’Keefe');
    expect(foldForFilter("Rick O'Keefe")).toBe(curly);
    expect(foldForFilter('Rick OKeefe')).toBe(curly);
    expect(curly).toBe('rick okeefe');
  });

  it('finds the owner however the searcher types it', () => {
    // What the row carries, built from the registry's curly spelling.
    const rowKey = foldForFilter('Rick O’Keefe');
    for (const typed of ["O'Keefe", 'O’Keefe', 'okeefe', 'RICK O’KEEFE ']) {
      expect(rowKey.includes(foldForFilter(typed)), `"${typed}" should match`).toBe(true);
    }
  });

  it('folds punctuation in team names too', () => {
    expect(foldForFilter("Habanero's")).toBe('habaneros');
    expect(foldForFilter('M.L. Maniacs')).toBe('ml maniacs');
    expect(foldForFilter('P-89s')).toBe('p89s');
    expect(foldForFilter("Dan Marino's Tan Isotoners")).toBe('dan marinos tan isotoners');
  });

  it('keeps word boundaries so a two-word query still behaves', () => {
    expect(foldForFilter('  Tim   Barlos ')).toBe('tim barlos');
    expect(foldForFilter('Tim Barlos').includes(foldForFilter('tim bar'))).toBe(true);
  });

  it('does not fold two different people onto one key', () => {
    expect(foldForFilter('Tim Barlos')).not.toBe(foldForFilter('Paul Tarsney'));
  });
});
