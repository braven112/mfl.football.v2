/**
 * Owner Map filters: the data each view draws from, for both leagues.
 *
 * The map itself is WebGL and is not rendered here; these pin what the
 * filters decide (owner-map-views.ts) and the data they decide it from
 * (buildOwnerMapData in src/utils/owner-map.ts).
 */
import { describe, expect, it } from 'vitest';
import { buildOwnerMapData, type OwnerMapHistory } from '../src/utils/owner-map';
import { computeView, subOptions } from '../src/components/shared/owner-map/owner-map-views';
import type { OwnerTenuresFile } from '../src/types/owner-tenures';
import theleagueOwners from '../data/theleague/derived/owner-tenures.json';
import theleagueHistory from '../data/theleague/derived/franchise-history.json';
import aflOwners from '../data/afl-fantasy/derived/owner-tenures.json';
import aflHistory from '../data/afl-fantasy/derived/franchise-history.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

const href = (id: string) => `/franchises/${id}`;
// Real hometowns live in Redis, never in the repo; every team gets a stand-in here.
const placeAll = (data: { owners: { currentFranchiseId: string | null }[] }) =>
  Object.fromEntries(
    data.owners
      .filter((o) => o.currentFranchiseId)
      .map((o, i) => [o.currentFranchiseId as string, { name: `Town ${i}`, region: 'WA', lat: 40 + i / 10, lng: -100 - i / 10 }]),
  );
const theleague = buildOwnerMapData(
  theleagueOwners as unknown as OwnerTenuresFile,
  theleagueHistory as unknown as OwnerMapHistory,
  { leagueSlug: 'theleague', franchiseHref: href, myFranchiseId: '0001', hometowns: placeAll(theleagueOwners) },
);
const afl = buildOwnerMapData(aflOwners as unknown as OwnerTenuresFile, aflHistory as unknown as OwnerMapHistory, {
  leagueSlug: 'afl-fantasy',
  franchiseHref: href,
  hometowns: placeAll(aflOwners),
  conferences: aflConfig.conferences.map((c, i) => ({ name: c.name, short: ['AL', 'NL'][i], divisions: c.divisions })),
});

describe('owner map data', () => {
  it('puts every current team in a division', () => {
    for (const data of [theleague, afl]) {
      expect(data.pins.every((p) => p.division && data.divisions.includes(p.division))).toBe(true);
    }
    expect(theleague.divisions).toHaveLength(4);
    expect(afl.divisions).toHaveLength(4);
  });

  it('gives the AFL conferences and TheLeague none', () => {
    expect(theleague.conferences).toEqual([]);
    expect(afl.pins.every((p) => p.conference === 'AL' || p.conference === 'NL')).toBe(true);
  });

  it('lists only completed seasons for the playoff pills', () => {
    expect(theleague.seasons.length).toBeGreaterThan(0);
    expect(theleague.seasons).toEqual([...theleague.seasons].sort((a, b) => b - a));
  });

  it('pairs each rivalry once, between two current teams', () => {
    const ids = new Set(theleague.pins.map((p) => p.franchiseId));
    const keys = theleague.rivalries.map((r) => [r.a, r.b].sort().join('-'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(theleague.rivalries.every((r) => ids.has(r.a) && ids.has(r.b))).toBe(true);
  });

  it('only names the viewer when they own a team here', () => {
    expect(theleague.myFranchiseId).toBe('0001');
    expect(afl.myFranchiseId).toBeNull();
  });
});

describe('teams without a hometown', () => {
  const bare = buildOwnerMapData(
    theleagueOwners as unknown as OwnerTenuresFile,
    theleagueHistory as unknown as OwnerMapHistory,
    { leagueSlug: 'theleague', franchiseHref: href, hometowns: {} },
  );

  it('are drawn nowhere and draw no lines', () => {
    for (const mode of ['division', 'rivalries', 'champions', 'tenure', 'hometown'] as const) {
      const view = computeView(bare, mode, 'all', null);
      expect(view.visible, mode).toEqual([]);
      expect(view.lines, mode).toEqual([]);
    }
  });
});

describe('owner map views', () => {
  it('draws every pair in a picked division', () => {
    const division = theleague.divisions[0];
    const view = computeView(theleague, 'division', division, null);
    const n = view.visible.length;
    expect(n).toBe(theleague.pins.filter((p) => p.division === division).length);
    expect(view.lines).toHaveLength((n * (n - 1)) / 2);
  });

  it('draws a tapped team’s lines to the rest of its division', () => {
    const view = computeView(theleague, 'division', 'all', 0);
    const division = theleague.pins[0].division;
    const mates = theleague.pins.filter((p) => p.division === division).length - 1;
    expect(view.lines).toHaveLength(mates);
    expect(view.lines.every((l) => l.a === 0)).toBe(true);
  });

  it('shows only title-winning owners under Champions', () => {
    const view = computeView(theleague, 'champions', '', null);
    expect(view.visible.every((i) => theleague.pins[i].titles.length > 0)).toBe(true);
  });

  it('shows each season’s playoff field', () => {
    const year = String(afl.seasons[0]);
    const view = computeView(afl, 'playoffs', year, null);
    expect(view.visible.length).toBeGreaterThan(0);
    expect(view.visible.every((i) => afl.pins[i].playoffs.some((p) => String(p.year) === year))).toBe(true);
  });

  it('offers every filter a pill row where it has one', () => {
    expect(subOptions(afl, 'conference').map((o) => o.id)).toEqual(['all', 'AL', 'NL']);
    expect(subOptions(theleague, 'division')).toHaveLength(5);
  });
});
