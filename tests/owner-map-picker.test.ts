/**
 * Owner Map hometown picker: the search over the bundled place list, and the
 * server's lookup that turns a name and region into coordinates.
 */
import { describe, expect, it } from 'vitest';
import places from '../src/data/owner-map-places.json';
import { searchPlaces } from '../src/components/shared/owner-map/owner-map-picker';
import { findPlace, parseHometownImport, placeFromText, type PlaceRow } from '../src/utils/owner-hometowns';

const rows = places as PlaceRow[];

describe('owner map place search', () => {
  it('finds the big city first for a plain name', () => {
    expect(searchPlaces(rows, 'spokane')[0].slice(0, 2)).toEqual(['Spokane', 'WA']);
    expect(searchPlaces(rows, 'nashville')[0].slice(0, 2)).toEqual(['Nashville', 'TN']);
  });

  it('narrows by region after a comma', () => {
    expect(searchPlaces(rows, 'ames, ia')[0].slice(0, 2)).toEqual(['Ames', 'IA']);
  });

  it('offers a whole state', () => {
    const [nm] = searchPlaces(rows, 'new mexico');
    expect(nm[4]).toBe('state');
  });

  it('offers a whole country', () => {
    const [au] = searchPlaces(rows, 'australia');
    expect(au[4]).toBe('country');
    expect(findPlace('Australia', '')).not.toBeNull();
  });

  it('finds a small town', () => {
    expect(searchPlaces(rows, 'long beach, wa')[0].slice(0, 2)).toEqual(['Long Beach', 'WA']);
  });

  it('ignores a one-letter search', () => {
    expect(searchPlaces(rows, 'a')).toEqual([]);
  });
});

describe('owner map place lookup', () => {
  it('resolves a bundled place', () => {
    expect(findPlace('Iowa City', 'IA')?.slice(0, 2)).toEqual(['Iowa City', 'IA']);
  });

  it('refuses anything not in the list', () => {
    expect(findPlace('<script>', 'XX')).toBeNull();
    expect(findPlace('Boston', 'Narnia')).toBeNull();
  });
});

describe('owner map commissioner import', () => {
  it('reads a city, a city abroad, a state and a country', () => {
    expect(placeFromText('Seattle, WA')?.slice(0, 2)).toEqual(['Seattle', 'WA']);
    expect(placeFromText('Sydney, Australia')?.slice(0, 2)).toEqual(['Sydney', 'Australia']);
    expect(placeFromText('New Mexico')?.slice(0, 2)).toEqual(['New Mexico', 'US']);
    expect(placeFromText('United Kingdom')?.slice(0, 2)).toEqual(['United Kingdom', '']);
  });

  it('parses one team per line and ignores comments and blank lines', () => {
    const { rows, errors } = parseHometownImport('0001 Seattle, WA   # Pacific Pigskins\n\n# a note\n0018 New Mexico\n');
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.franchiseId, r.place[0]])).toEqual([
      ['0001', 'Seattle'],
      ['0018', 'New Mexico'],
    ]);
  });

  it('reports every bad line with its number', () => {
    const { rows, errors } = parseHometownImport('0001 Seattle, WA\nSeattle, WA\n0002 Narnia\n0001 Boston, MA');
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
});

describe('owner map import against the league roster', () => {
  it('refuses a team id the league does not have', () => {
    const { errors } = parseHometownImport('0001 Seattle, WA\n0099 Boston, MA', new Set(['0001', '0002']));
    expect(errors).toEqual([{ line: 2, text: '0099 Boston, MA', message: "Team 0099 isn't in this league." }]);
  });
});
