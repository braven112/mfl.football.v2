import { describe, it, expect } from 'vitest';
import {
  LEAGUES,
  ALL_LEAGUES,
  DEFAULT_LEAGUE_SLUG,
  getLeagueBySlug,
  getLeagueById,
  getLeagueByPath,
  leagueHasFeature,
  buildHostToSlugMap,
} from '../src/config/leagues';
import { HOST_TO_SLUG } from '../src/utils/league-host-map';
import { getLeagueContext } from '../src/utils/league-context';

describe('league registry', () => {
  it('has unique ids and slugs', () => {
    const ids = ALL_LEAGUES.map((l) => l.id);
    const slugs = ALL_LEAGUES.map((l) => l.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('keys match each entry slug', () => {
    for (const [key, league] of Object.entries(LEAGUES)) {
      expect(league.slug).toBe(key);
    }
  });

  it('every league lists bare and www domain variants', () => {
    for (const league of ALL_LEAGUES) {
      const bare = league.domains.filter((d) => !d.startsWith('www.'));
      for (const d of bare) {
        expect(league.domains, `${league.slug} missing www.${d}`).toContain(`www.${d}`);
      }
    }
  });

  it('resolves known leagues', () => {
    expect(getLeagueBySlug('theleague')?.id).toBe('13522');
    expect(getLeagueBySlug('afl-fantasy')?.id).toBe('19621');
    expect(getLeagueBySlug('best-ball-1')?.id).toBe('37610');
    expect(getLeagueById('13522')?.slug).toBe('theleague');
    expect(getLeagueById('19621')?.slug).toBe('afl-fantasy');
    expect(getLeagueById('37610')?.slug).toBe('best-ball-1');
    expect(getLeagueBySlug('nope')).toBeNull();
    expect(getLeagueById('0000')).toBeNull();
  });

  it('marks best-ball leagues and keeps management features off for them', () => {
    const bb1 = getLeagueBySlug('best-ball-1')!;
    expect(bb1.bestBall).toBe(true);
    expect(bb1.navSlug).toBe('bb1');
    // Draft-only league: every management-shaped feature must stay off.
    expect(bb1.features.contracts).toBe(false);
    expect(bb1.features.salaryCap).toBe(false);
    expect(bb1.features.keepers).toBe(false);
    expect(bb1.features.liveLineups).toBe(false);
    // Live scoring is results-shaped, not management-shaped — best ball is
    // all scoreboard watching, so it stays ON.
    expect(bb1.features.liveScoring).toBe(true);
    // Full-format leagues are NOT best-ball.
    expect(getLeagueBySlug('theleague')!.bestBall).toBeUndefined();
    expect(getLeagueBySlug('afl-fantasy')!.bestBall).toBeUndefined();
  });

  it('resolves paths with prefix-boundary safety', () => {
    expect(getLeagueByPath('/afl-fantasy/rosters').slug).toBe('afl-fantasy');
    expect(getLeagueByPath('/afl-fantasy').slug).toBe('afl-fantasy');
    expect(getLeagueByPath('/afl-fantasyX').slug).toBe(DEFAULT_LEAGUE_SLUG);
    expect(getLeagueByPath('/theleague/rosters').slug).toBe('theleague');
    expect(getLeagueByPath('/best-ball-1/draft-room').slug).toBe('best-ball-1');
    expect(getLeagueByPath('/').slug).toBe(DEFAULT_LEAGUE_SLUG);
  });

  it('exposes feature flags', () => {
    expect(leagueHasFeature('theleague', 'contracts')).toBe(true);
    expect(leagueHasFeature('afl-fantasy', 'contracts')).toBe(false);
    expect(leagueHasFeature('afl-fantasy', 'keepers')).toBe(true);
    expect(leagueHasFeature('theleague', 'liveScoring')).toBe(true);
    expect(leagueHasFeature('afl-fantasy', 'liveScoring')).toBe(false);
    expect(leagueHasFeature('nope', 'contracts')).toBe(false);
  });
});

describe('host map derived from registry', () => {
  it('preserves the pre-registry HOST_TO_SLUG entries', () => {
    expect(HOST_TO_SLUG['theleague.us']).toBe('theleague');
    expect(HOST_TO_SLUG['www.theleague.us']).toBe('theleague');
    expect(HOST_TO_SLUG['afl-fantasy.com']).toBe('afl-fantasy');
    expect(HOST_TO_SLUG['www.afl-fantasy.com']).toBe('afl-fantasy');
  });

  it('buildHostToSlugMap covers every league domain', () => {
    const map = buildHostToSlugMap();
    for (const league of ALL_LEAGUES) {
      for (const d of league.domains) {
        expect(map[d]).toBe(league.slug);
      }
    }
  });
});

describe('getLeagueContext via registry', () => {
  it('returns the same shape and values as before the refactor', () => {
    const tl = getLeagueContext(new URL('https://theleague.us/theleague/rosters'));
    expect(tl).toMatchObject({
      leagueId: '13522',
      name: 'The League',
      slug: 'theleague',
      dataPath: 'data/theleague',
    });

    const afl = getLeagueContext(new URL('https://example.com/afl-fantasy/lineup'));
    expect(afl).toMatchObject({
      leagueId: '19621',
      name: 'AFL',
      slug: 'afl-fantasy',
      dataPath: 'data/afl-fantasy',
    });

    // Unprefixed paths default to theleague (backward compatibility)
    const root = getLeagueContext(new URL('https://example.com/'));
    expect(root.slug).toBe('theleague');
  });
});
