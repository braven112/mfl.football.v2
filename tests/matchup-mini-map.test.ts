import { describe, expect, it } from 'vitest';
import { buildMiniMap, milesBetween, MINI_MAP_HEIGHT, MINI_MAP_WIDTH } from '../src/utils/matchup-mini-map';

const SPOKANE = { lat: 47.66, lng: -117.43 };
const DES_MOINES = { lat: 41.59, lng: -93.62 };
const SEATTLE = { lat: 47.61, lng: -122.33 };
const SYDNEY = { lat: -33.87, lng: 151.21 };

const inFrame = (p: { x: number; y: number }) =>
  p.x >= 0 && p.x <= MINI_MAP_WIDTH && p.y >= 0 && p.y <= MINI_MAP_HEIGHT;

describe('matchup mini map', () => {
  it('needs both hometowns', () => {
    expect(buildMiniMap(SPOKANE, null)).toBeNull();
    expect(buildMiniMap(undefined, DES_MOINES)).toBeNull();
  });

  it('measures great-circle miles', () => {
    expect(milesBetween(SPOKANE, DES_MOINES)).toBeGreaterThan(1220);
    expect(milesBetween(SPOKANE, DES_MOINES)).toBeLessThan(1260);
    expect(milesBetween(SEATTLE, SEATTLE)).toBe(0);
  });

  it('frames both pins inside the picture and draws the land around them', () => {
    const map = buildMiniMap(SPOKANE, DES_MOINES)!;
    expect(inFrame(map.a) && inFrame(map.b)).toBe(true);
    expect(map.land.length).toBeGreaterThan(100);
    expect(map.states.length).toBeGreaterThan(100);
    expect(map.route).toMatch(/^M[\d.-]+ [\d.-]+Q/);
  });

  it('crops the outlines instead of shipping the whole world', () => {
    const map = buildMiniMap(SPOKANE, DES_MOINES)!;
    const bytes = map.land.length + map.states.length;
    expect(bytes).toBeLessThan(20_000);
  });

  it('pushes two teams from one city apart so their badges do not stack', () => {
    const map = buildMiniMap(SEATTLE, SEATTLE)!;
    expect(Math.hypot(map.a.x - map.b.x, map.a.y - map.b.y)).toBeGreaterThanOrEqual(39);
    expect(map.miles).toBe(0);
  });

  it('takes the short way across the Pacific', () => {
    const map = buildMiniMap(SEATTLE, SYDNEY)!;
    expect(inFrame(map.a) && inFrame(map.b)).toBe(true);
    // Seattle sits right of Sydney when the frame crosses the Pacific.
    expect(map.a.x).toBeGreaterThan(map.b.x);
  });
});
