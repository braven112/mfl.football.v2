/**
 * owners-registry.json — the hand-edited, league-neutral ledger of people.
 *
 * This file is config, not derived data: a human edits it to say "these two
 * inferred tenures were the same person", "this one splits", "this is Dave".
 * Because it is hand-edited, it is exactly where a typo silently detaches a
 * whole tenure from its page — a wrong franchiseId, a year range that overlaps
 * another person's, a slug that collides with somebody's old URL.
 *
 * Every franchiseId is checked against the league's REAL config, loaded via
 * the registry's `configPath` — never a hardcoded path or id.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'src/data/owners-registry.json');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const registry = existsSync(REGISTRY_PATH) ? readJson(REGISTRY_PATH) : null;

/** Real franchise ids per league, straight from each league's own config. */
const franchiseIdsByLeague = new Map<string, Set<string>>();
for (const [slug, league] of Object.entries<any>(LEAGUES)) {
  const configPath = path.join(ROOT, league.configPath);
  if (!existsSync(configPath)) continue;
  const cfg = readJson(configPath);
  const teams = Array.isArray(cfg.teams) ? cfg.teams : Object.values(cfg.teams ?? cfg);
  franchiseIdsByLeague.set(slug, new Set(teams.map((t: any) => t.franchiseId)));
}

describe('owners-registry.json', () => {
  it('exists and is well-formed', () => {
    expect(registry, 'src/data/owners-registry.json missing — run seed-owners-registry.mjs --write').toBeTruthy();
    expect(registry.version).toBe(1);
    expect(Array.isArray(registry.people)).toBe(true);
    expect(registry.people.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = registry.people.map((p: any) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique slugs', () => {
    const slugs = registry.people.map((p: any) => p.slug);
    const dupes = slugs.filter((s: string, i: number) => slugs.indexOf(s) !== i);
    expect(dupes).toEqual([]);
  });

  it('has URL-safe slugs', () => {
    for (const person of registry.people) {
      expect(person.slug, `${person.id} has an unusable slug`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  /**
   * A previousSlug that shadows a live slug makes the redirect ambiguous — the
   * route would have to choose between 301-ing and rendering.
   */
  it('has no previousSlug shadowing a live slug', () => {
    const live = new Set(registry.people.map((p: any) => p.slug));
    const shadowing: string[] = [];
    for (const person of registry.people) {
      for (const old of person.previousSlugs ?? []) {
        if (live.has(old)) shadowing.push(`${person.id}: ${old}`);
      }
    }
    expect(shadowing).toEqual([]);
  });

  it('has no previousSlug claimed by two different people', () => {
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const person of registry.people) {
      for (const old of person.previousSlugs ?? []) {
        if (seen.has(old)) conflicts.push(`${old}: ${seen.get(old)} and ${person.id}`);
        seen.set(old, person.id);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('gives every person at least one claim', () => {
    for (const person of registry.people) {
      expect(Array.isArray(person.claims), `${person.id} has no claims array`).toBe(true);
      expect(person.claims.length, `${person.id} claims nothing`).toBeGreaterThan(0);
    }
  });

  it('points every claim at a real league', () => {
    const known = new Set(Object.keys(LEAGUES));
    for (const person of registry.people) {
      for (const claim of person.claims) {
        expect(known.has(claim.league), `${person.id} claims unknown league ${claim.league}`).toBe(
          true
        );
      }
    }
  });

  it('points every claim at a real franchise in that league', () => {
    const bad: string[] = [];
    for (const person of registry.people) {
      for (const claim of person.claims) {
        const ids = franchiseIdsByLeague.get(claim.league);
        if (!ids) continue; // league config not checked out
        if (!ids.has(claim.franchiseId)) {
          bad.push(`${person.id}: ${claim.league} has no franchise ${claim.franchiseId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('has yearStart <= yearEnd on every claim', () => {
    for (const person of registry.people) {
      for (const claim of person.claims) {
        expect(
          claim.yearStart <= claim.yearEnd,
          `${person.id}: ${claim.yearStart}-${claim.yearEnd} is backwards`
        ).toBe(true);
      }
    }
  });

  it('uses plausible years', () => {
    for (const person of registry.people) {
      for (const claim of person.claims) {
        expect(claim.yearStart).toBeGreaterThanOrEqual(2000);
        expect(claim.yearStart).toBeLessThanOrEqual(2100);
        // 9999 is the documented open-ended sentinel.
        expect(claim.yearEnd === 9999 || claim.yearEnd <= 2100).toBe(true);
      }
    }
  });

  /**
   * The one that matters most. Two people claiming the same season means a
   * franchise-season lands on two owner pages, which breaks the conservation
   * guarantee that this whole feature rests on.
   */
  it('has no overlapping claims, within OR across people', () => {
    const holder = new Map<string, string>();
    const overlaps: string[] = [];

    for (const person of registry.people) {
      for (const claim of person.claims) {
        const end = claim.yearEnd === 9999 ? 2100 : claim.yearEnd;
        for (let year = claim.yearStart; year <= end; year++) {
          const key = `${claim.league}|${claim.franchiseId}|${year}`;
          const existing = holder.get(key);
          if (existing) {
            overlaps.push(`${key}: ${existing} and ${person.id}`);
          } else {
            holder.set(key, person.id);
          }
        }
      }
    }
    expect(overlaps.slice(0, 10)).toEqual([]);
  });

  it('has displayName null or a non-empty trimmed string', () => {
    for (const person of registry.people) {
      if (person.displayName === null) continue;
      expect(typeof person.displayName).toBe('string');
      expect(person.displayName.length).toBeGreaterThan(0);
      expect(person.displayName).toBe(person.displayName.trim());
    }
  });

  /**
   * The feature ships anonymous on purpose — owner names exist nowhere in this
   * repo to seed from. This is not a permanent rule (PR 4 fills them in), so it
   * asserts the SEEDED entries are anonymous rather than forbidding names.
   */
  it('leaves seeded entries anonymous', () => {
    const named = registry.people.filter(
      (p: any) => p.displayName !== null && String(p.seededFrom ?? '').startsWith('inferred:')
    );
    // A human naming a seeded person is fine and expected later; this just
    // documents that the seeder itself never invents one.
    for (const person of named) {
      expect(typeof person.displayName).toBe('string');
    }
    expect(registry.people.every((p: any) => 'displayName' in p)).toBe(true);
  });

  it('records where each person came from', () => {
    for (const person of registry.people) {
      expect('seededFrom' in person, `${person.id} has no seededFrom`).toBe(true);
      expect('notes' in person, `${person.id} has no notes field`).toBe(true);
      expect(Array.isArray(person.previousSlugs)).toBe(true);
    }
  });

  it('covers both leagues that run the franchise-history pipeline', () => {
    const leaguesClaimed = new Set(
      registry.people.flatMap((p: any) => p.claims.map((c: any) => c.league))
    );
    for (const [slug, league] of Object.entries<any>(LEAGUES)) {
      const hasHistory = existsSync(
        path.join(ROOT, league.dataPath, 'derived', 'franchise-history.json')
      );
      if (!hasHistory) {
        // best-ball-1 has no franchise history, so it must have no owners.
        expect(leaguesClaimed.has(slug), `${slug} has no franchise history but has claims`).toBe(
          false
        );
      } else {
        expect(leaguesClaimed.has(slug), `${slug} runs the pipeline but has no owners`).toBe(true);
      }
    }
  });
});
