/**
 * Owner Map hometown picker: the search over the bundled place list, and the
 * server's lookup that turns a name and region into coordinates.
 */
import { describe, expect, it } from 'vitest';
import places from '../src/data/owner-map-places.json';
import { searchPlaces } from '../src/components/shared/owner-map/owner-map-picker';
import { findPlace, type PlaceRow } from '../src/utils/owner-hometowns';

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
