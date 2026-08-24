/**
 * fetch-owner-names.mjs — the authenticated path to owner names.
 *
 * MFL's `league` export returns owner names only to a commissioner cookie,
 * which is why every league.json committed here carries none and why the
 * feature shipped anonymous. The same response also carries EMAIL ADDRESSES.
 *
 * These tests cover the two rules that matter and can be checked without a
 * network or credentials:
 *
 *   1. Nothing email-shaped can reach the registry.
 *   2. A tenure MFL reports two owners for is left alone, not named after
 *      whichever appeared more — that is a tenure that should be SPLIT, and
 *      quietly picking a winner buries the boundary the registry exists for.
 */
import { describe, it, expect } from 'vitest';
import {
  cleanName,
  assertNoContactInfo,
  foldNamesOntoTenures,
} from '../scripts/fetch-owner-names.mjs';

describe('cleanName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanName('  Ross   Lawrence ')).toBe('Ross Lawrence');
  });

  it('rejects non-strings and blanks', () => {
    expect(cleanName(undefined)).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42 as any)).toBeNull();
  });

  it('keeps a co-owned "A and B" string whole rather than inventing two people', () => {
    // Splitting here would fabricate registry claims. Co-ownership is
    // expressed with two PEOPLE and `shared: true`, by a human.
    expect(cleanName('Ross Lawrence and Shawn Klezovich')).toBe(
      'Ross Lawrence and Shawn Klezovich'
    );
  });
});

describe('assertNoContactInfo', () => {
  it('throws on anything email-shaped', () => {
    expect(() => assertNoContactInfo('someone@example.com', 'own-0001')).toThrow(/contact info/);
  });

  it('throws on a URL', () => {
    expect(() => assertNoContactInfo('http://example.com/u/1', 'own-0001')).toThrow(/contact info/);
  });

  it('allows an ordinary name', () => {
    expect(() => assertNoContactInfo('Ross Lawrence', 'own-0001')).not.toThrow();
    expect(() => assertNoContactInfo("Shawn O'Brien-Klezovich", 'own-0002')).not.toThrow();
  });

  it('ignores non-strings rather than throwing', () => {
    expect(() => assertNoContactInfo(undefined, 'x')).not.toThrow();
    expect(() => assertNoContactInfo(null, 'x')).not.toThrow();
  });
});

describe('foldNamesOntoTenures', () => {
  const person = (id: string, claims: any[], displayName: string | null = null) => ({
    id,
    slug: id,
    displayName,
    claims,
  });
  const claim = (league: string, franchiseId: string, yearStart: number, yearEnd: number) => ({
    league,
    franchiseId,
    yearStart,
    yearEnd,
  });

  it('names a tenure when every observed season agrees', () => {
    const registry = { people: [person('own-1', [claim('theleague', '0010', 2007, 2010)])] };
    const observed = new Map([
      ['theleague|0010|2007', 'Ross Lawrence'],
      ['theleague|0010|2008', 'Ross Lawrence'],
      ['theleague|0010|2010', 'Ross Lawrence'],
    ]);
    const { proposals, conflicts } = foldNamesOntoTenures(registry, observed);
    expect(conflicts).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].name).toBe('Ross Lawrence');
  });

  /** The rule that keeps a mis-merged tenure visible instead of plausible. */
  it('refuses to name a tenure MFL reports two owners for', () => {
    const registry = { people: [person('own-1', [claim('theleague', '0010', 2007, 2010)])] };
    const observed = new Map([
      ['theleague|0010|2007', 'Ross Lawrence'],
      ['theleague|0010|2008', 'Ross Lawrence'],
      ['theleague|0010|2009', 'Somebody Else'],
      ['theleague|0010|2010', 'Somebody Else'],
    ]);
    const { proposals, conflicts } = foldNamesOntoTenures(registry, observed);
    expect(proposals).toEqual([]);
    expect(conflicts).toHaveLength(1);
    // The report names both, with how many seasons each covered, so a human
    // can see where to split.
    expect(conflicts[0].names.sort()).toEqual(['Ross Lawrence (2y)', 'Somebody Else (2y)']);
  });

  it('never overwrites a name a human already set', () => {
    const registry = {
      people: [person('own-1', [claim('theleague', '0010', 2007, 2010)], 'Hand Typed')],
    };
    const observed = new Map([['theleague|0010|2007', 'Something Else']]);
    const { proposals, conflicts } = foldNamesOntoTenures(registry, observed);
    expect(proposals).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it('leaves a tenure with no observations alone', () => {
    const registry = { people: [person('own-1', [claim('theleague', '0010', 2007, 2010)])] };
    const { proposals, conflicts } = foldNamesOntoTenures(registry, new Map());
    expect(proposals).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it('spans a cross-league person, and only counts their own claims', () => {
    const registry = {
      people: [
        person('own-1', [
          claim('afl-fantasy', '0014', 2007, 2009),
          claim('theleague', '0014', 2018, 2019),
        ]),
        person('own-2', [claim('theleague', '0011', 2018, 2019)]),
      ],
    };
    const observed = new Map([
      ['afl-fantasy|0014|2007', 'Ross Lawrence'],
      ['theleague|0014|2018', 'Ross Lawrence'],
      ['theleague|0011|2018', 'Someone Different'],
    ]);
    const { proposals } = foldNamesOntoTenures(registry, observed);
    expect(proposals.map((p: any) => [p.person.id, p.name]).sort()).toEqual([
      ['own-1', 'Ross Lawrence'],
      ['own-2', 'Someone Different'],
    ]);
  });

  it('clamps an open-ended claim instead of looping to year 9999', () => {
    const registry = { people: [person('own-1', [claim('theleague', '0010', 2020, 9999)])] };
    const observed = new Map([['theleague|0010|2020', 'Ross Lawrence']]);
    const { proposals } = foldNamesOntoTenures(registry, observed);
    expect(proposals).toHaveLength(1);
  });

  it('propagates the PII guard rather than writing a contact string', () => {
    const registry = { people: [person('own-1', [claim('theleague', '0010', 2007, 2007)])] };
    const observed = new Map([['theleague|0010|2007', 'leaked@example.com']]);
    expect(() => foldNamesOntoTenures(registry, observed)).toThrow(/contact info/);
  });
});
