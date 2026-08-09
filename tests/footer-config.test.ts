import { describe, it, expect } from 'vitest';
import {
  getFooterColumns,
  getDeepCuts,
  DECK_COLUMNS,
  AFL_ALL_PLAY_PATH,
} from '../src/config/footer-config';
import { D_LEAGUE, PREMIER_LEAGUE, getTierForYear } from '../src/utils/afl-tier';
import { getCurrentSeasonYear } from '../src/utils/league-year';

const findAllPlayLabel = (franchiseId: string | null) => {
  const cols = getFooterColumns('afl-fantasy', franchiseId);
  for (const col of cols) {
    const hit = col.links.find((l) => l.path === AFL_ALL_PLAY_PATH);
    if (hit) return hit.label;
  }
  return null;
};

// Pick real franchises out of the live tier history rather than hardcoding
// ids, so promotion/relegation can't silently invalidate the test.
const year = getCurrentSeasonYear();
const franchises = Array.from({ length: 24 }, (_, i) =>
  String(i + 1).padStart(4, '0')
);
const dLeagueId =
  franchises.find((id) => getTierForYear(id, year) === D_LEAGUE) ?? null;
const premierId =
  franchises.find((id) => getTierForYear(id, year) === PREMIER_LEAGUE) ?? null;

describe('AFL all-play link is named after the viewer’s tier', () => {
  it('defaults to Premier League when signed out', () => {
    expect(findAllPlayLabel(null)).toBe(PREMIER_LEAGUE);
  });

  it('says Premier League for a Premier League owner', () => {
    if (!premierId) throw new Error('no Premier League franchise in tier history');
    expect(findAllPlayLabel(premierId)).toBe(PREMIER_LEAGUE);
  });

  it('says D-League for a D-League owner', () => {
    if (!dLeagueId) throw new Error('no D-League franchise in tier history');
    expect(findAllPlayLabel(dLeagueId)).toBe(D_LEAGUE);
  });

  it('falls back to Premier League for an unknown franchise', () => {
    expect(findAllPlayLabel('9999')).toBe(PREMIER_LEAGUE);
  });

  it('never says "Table"', () => {
    for (const id of [null, premierId, dLeagueId]) {
      expect(findAllPlayLabel(id)).not.toMatch(/table/i);
    }
  });

  it('keeps the same destination for both tiers', () => {
    const cols = getFooterColumns('afl-fantasy', dLeagueId);
    const hit = cols.flatMap((c) => c.links).find((l) => l.label === D_LEAGUE);
    expect(hit?.path).toBe(AFL_ALL_PLAY_PATH);
  });
});

describe('deck columns', () => {
  it('gives both full-management leagues the same five headers in order', () => {
    for (const slug of ['theleague', 'afl-fantasy'] as const) {
      const titles = getFooterColumns(slug).map((c) => c.title);
      expect(titles).toEqual([...DECK_COLUMNS]);
    }
  });

  it('gives best-ball its own draft-only groups', () => {
    const titles = getFooterColumns('best-ball-1').map((c) => c.title);
    expect(titles).toEqual(['The Draft', 'League']);
  });

  it('never emits an admin-only page as a footer link', () => {
    for (const slug of ['theleague', 'afl-fantasy', 'best-ball-1'] as const) {
      const cols = getFooterColumns(slug);
      const paths = cols.flatMap((c) => c.links.map((l) => l.path));
      expect(paths).not.toContain('/theleague/admin');
      expect(paths).not.toContain('/css-customization');
      expect(paths).not.toContain('/insights');
    }
  });

  it('renders planned pages inert rather than as dead links', () => {
    const soon = getFooterColumns('afl-fantasy')
      .flatMap((c) => c.links)
      .filter((l) => l.soon);
    expect(soon.length).toBeGreaterThan(0);
    for (const l of soon) expect(l.path).toBeNull();
  });
});

describe('deep cuts', () => {
  it('never repeats a link already in the deck', () => {
    for (const slug of ['theleague', 'afl-fantasy', 'best-ball-1'] as const) {
      const cols = getFooterColumns(slug);
      const linked = new Set(cols.flatMap((c) => c.links.map((l) => l.path)));
      for (const cut of getDeepCuts(slug, cols)) {
        expect(linked.has(cut.path)).toBe(false);
      }
    }
  });

  it('never surfaces another league’s page', () => {
    for (const cut of getDeepCuts('afl-fantasy', getFooterColumns('afl-fantasy'))) {
      expect(cut.path!.startsWith('/afl-fantasy')).toBe(true);
    }
    for (const cut of getDeepCuts('theleague', getFooterColumns('theleague'))) {
      expect(cut.path!.startsWith('/afl-fantasy')).toBe(false);
      expect(cut.path!.startsWith('/best-ball-1')).toBe(false);
    }
  });

  it('is empty for best-ball, whose candidates are all already linked', () => {
    expect(getDeepCuts('best-ball-1', getFooterColumns('best-ball-1'))).toEqual([]);
  });
});
