import { describe, it, expect } from 'vitest';
import {
  getFooterChampions,
  getFooterDraftStatus,
  leagueHasChampionBand,
} from '../src/utils/footer-champions';

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
