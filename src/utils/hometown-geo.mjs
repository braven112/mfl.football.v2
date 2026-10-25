/**
 * Hometown helpers shared by the site (TypeScript) and the article scripts
 * (plain node), so the Redis key and the "miles apart" figure a card prints
 * are the same ones Schefter is handed.
 */

/**
 * One Redis hash per league, one field per franchise: both leagues have a franchise 0001.
 * @param {string} leagueSlug
 */
export const hometownsKey = (leagueSlug) => `owner-map:hometowns:${leagueSlug}`;

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Great-circle distance between two points, rounded to the mile.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number}
 */
export function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * "Spokane, WA", "Toronto, Canada", "Florida": the Owner Map's own label (owner-map.ts#cityLabel).
 * @param {{ name: string, region: string }} place
 * @returns {string}
 */
export function placeLabel(place) {
  return place.region === 'US' || !place.region ? place.name : `${place.name}, ${place.region}`;
}
