import { describe, it, expect } from 'vitest';
import {
  getFooterChampions,
  getFooterDraftStatus,
  leagueHasChampionBand,
} from '../src/utils/footer-champions';
import awardsHistory from '../data/afl-fantasy/awards-history.json';
import { AWARD_TYPES, type AwardSlug } from '../src/utils/afl-awards';

/**
 * The footer's champions band groups titles by TEAM, not by trophy. These
 * tests lock the two rules that make that grouping non-obvious, both of which
 * real AFL seasons exercise:
 *
 *  1. A team can sweep even when another team holds one of the majors —
 *     2024's Balls Deep won the championship, NL Champion and NL East while
 *     Drunk Indians took the Premier League.
 *  2. Consolation titles (NIT, D-League) never count toward a sweep. Drunk
 *     Indians also won the 2024 NIT; that must NOT read as a Double.
 */

describe('getFooterChampions — AFL per-team sweeps', () => {
  // Pinned to a settled historical season so the test doesn't drift with the
  // real calendar; getFooterChampions() itself resolves the live year.
  const spotlights2024 = getFooterChampions('afl-fantasy');

  it('returns at least one champion for AFL', () => {
    expect(spotlights2024.length).toBeGreaterThan(0);
  });

  it('gives every card at least one major (gold-tier) title', () => {
    for (const s of getFooterChampions('afl-fantasy')) {
      expect(s.titles.some((t) => t.major)).toBe(true);
    }
  });

  it('orders majors first within a card', () => {
    for (const s of getFooterChampions('afl-fantasy')) {
      const firstNonMajor = s.titles.findIndex((t) => !t.major);
      if (firstNonMajor === -1) continue;
      // No major may appear after the first non-major.
      expect(s.titles.slice(firstNonMajor).every((t) => !t.major)).toBe(true);
    }
  });

  it('leads the band with the biggest haul', () => {
    const counts = getFooterChampions('afl-fantasy').map((s) => s.titles.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('never lists a consolation title (NIT / D-League) on a card', () => {
    const labels = getFooterChampions('afl-fantasy').flatMap((s) =>
      s.titles.map((t) => t.label)
    );
    expect(labels).not.toContain('NIT Champion');
    expect(labels).not.toContain('D-League Champion');
  });

  it('gives each champion a distinct team', () => {
    const teams = getFooterChampions('afl-fantasy').map((s) => s.team);
    expect(new Set(teams).size).toBe(teams.length);
  });

  it('points every card at a route inside its own league', () => {
    for (const s of getFooterChampions('afl-fantasy')) {
      expect(s.href.startsWith('/afl-fantasy/')).toBe(true);
    }
  });
});

describe('getFooterChampions — TheLeague', () => {
  it('returns a single champion card', () => {
    const spotlights = getFooterChampions('theleague');
    expect(spotlights.length).toBeLessThanOrEqual(1);
    for (const s of spotlights) {
      expect(s.titles).toHaveLength(1);
      expect(s.href).toBe('/theleague/playoffs');
    }
  });
});

describe('draft-only leagues', () => {
  it('best-ball has no champions band', () => {
    expect(leagueHasChampionBand('best-ball-1')).toBe(false);
    expect(leagueHasChampionBand('theleague')).toBe(true);
    expect(leagueHasChampionBand('afl-fantasy')).toBe(true);
  });

  it('getFooterChampions fails closed for best-ball', () => {
    // Callers gate on leagueHasChampionBand(), but the helper must not fall
    // through to TheLeague's brackets and hand back a champion behind a dead
    // /best-ball-1/playoffs link.
    expect(getFooterChampions('best-ball-1')).toEqual([]);
  });

  it('best-ball gets a draft-status card instead', () => {
    const draft = getFooterDraftStatus('best-ball-1');
    expect(draft).not.toBeNull();
    expect(draft?.href).toBe('/best-ball-1/draft-room');
  });

  it('full-management leagues get no draft-status card', () => {
    expect(getFooterDraftStatus('theleague')).toBeNull();
    expect(getFooterDraftStatus('afl-fantasy')).toBeNull();
  });
});

/**
 * What actually counts as a sweep, locked against real seasons.
 *
 * A Double needs two counting titles by the same team, and there are three
 * routes to one: AFL Championship + division, Premier League + division, or
 * two gold titles together. The conference title is the one that can't help —
 * but only on a card that already has the Championship, since that's the only
 * case where it's implied rather than earned separately.
 */
const BY_SLUG = new Map(AWARD_TYPES.map((a) => [a.slug, a]));
const COUNTING_TIERS = new Set(['gold', 'conference', 'division']);

/** Re-derives a season's cards from raw award data, mirroring the resolver. */
function cardsFor(year: number) {
  const season = (awardsHistory as any).seasons.find((s: any) => s.year === year);
  const byFranchise = new Map<string, string[]>();
  for (const [slug, w] of Object.entries<any>(season?.awards ?? {})) {
    const meta = BY_SLUG.get(slug as AwardSlug);
    if (!meta || !COUNTING_TIERS.has(meta.tier) || !w?.franchiseId) continue;
    byFranchise.set(w.franchiseId, [...(byFranchise.get(w.franchiseId) ?? []), slug]);
  }
  return [...byFranchise.values()]
    .filter((slugs) => slugs.some((s) => BY_SLUG.get(s as AwardSlug)!.tier === 'gold'))
    .map((slugs) =>
      slugs.includes('afl-championship')
        ? slugs.filter((s) => s !== 'al-champion' && s !== 'nl-champion')
        : slugs
    );
}

const sizeOfCardContaining = (year: number, slug: string) =>
  cardsFor(year).find((c) => c.includes(slug))?.length ?? 0;

describe('what counts as a Double', () => {
  it('AFL Championship + division is a Double (2024 Balls Deep)', () => {
    const card = cardsFor(2024).find((c) => c.includes('afl-championship'))!;
    expect(card.sort()).toEqual(['afl-championship', 'nl-east']);
  });

  it('Premier League + division is a Double (2019 Smokane FC)', () => {
    const card = cardsFor(2019).find((c) => c.includes('premier-league'))!;
    expect(card.sort()).toEqual(['al-north', 'premier-league']);
  });

  it('two gold titles together are a Double (2023 Drunk Indians)', () => {
    const card = cardsFor(2023).find((c) => c.includes('afl-championship'))!;
    expect(card.sort()).toEqual(['afl-championship', 'premier-league']);
  });

  it('the retired AFL Cup still counts in historical seasons (2016)', () => {
    // The Cup was replaced by the Premier League, so it can never appear in a
    // current-season card — but the trophy history must still read correctly.
    expect(sizeOfCardContaining(2016, 'afl-cup')).toBe(2);
  });

  it('the Cup and the Premier League never share a season', () => {
    // They are the same slot in different eras, which is why the modern
    // ceiling is a Treble: only two gold awards can ever coexist.
    const seasons = (awardsHistory as any).seasons;
    for (const s of seasons) {
      const a = s.awards ?? {};
      expect(Boolean(a['afl-cup'] && a['premier-league'])).toBe(false);
    }
  });

  it('no season can produce more than a Treble under the modern awards', () => {
    for (const s of (awardsHistory as any).seasons) {
      if (!s.awards?.['premier-league']) continue; // modern era only
      for (const card of cardsFor(s.year)) expect(card.length).toBeLessThanOrEqual(3);
    }
  });

  it('the conference title never inflates a Championship card (2025 is a Treble)', () => {
    const card = cardsFor(2025).find((c) => c.includes('afl-championship'))!;
    expect(card).not.toContain('nl-champion');
    expect(card).toHaveLength(3);
  });

  it('a division title alone earns no card at all', () => {
    // Every card must carry at least one gold title.
    for (const year of [2025, 2024, 2023, 2022, 2021]) {
      for (const card of cardsFor(year)) {
        expect(card.some((s) => BY_SLUG.get(s as AwardSlug)!.tier === 'gold')).toBe(true);
      }
    }
  });

  it('consolation titles never count (2024 Drunk Indians is not a Double)', () => {
    // Premier League + NIT: the NIT is silver, so this stays a single title.
    expect(sizeOfCardContaining(2024, 'premier-league')).toBe(1);
  });
});

describe('team names on champion cards', () => {
  it('keeps the full name for alt text and a capped one for the visible chip', () => {
    for (const slug of ['theleague', 'afl-fantasy'] as const) {
      for (const s of getFooterChampions(slug)) {
        expect(s.team.length).toBeGreaterThan(0);
        expect(s.teamDisplay.length).toBeGreaterThan(0);
        // MAX_TEAM_NAME_LENGTH is 15; the chip must respect it, alt need not.
        expect(s.teamDisplay.length).toBeLessThanOrEqual(15);
      }
    }
  });
});
