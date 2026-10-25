#!/usr/bin/env node
/**
 * Builds the place list the Owner Map's hometown picker searches:
 * src/data/owner-map-places.json.
 *
 * Run by hand, not in prebuild: the source data (GeoNames, via the
 * `all-the-cities` package, CC-BY) does not change between builds, and the
 * output is a static file the page loads only when someone opens the picker.
 *
 *   node scripts/build-owner-map-places.mjs
 *
 * What goes in:
 *   - every US state, placed at its middle (for "pin the middle of New Mexico")
 *   - every US city of 2,000 people or more
 *   - every city elsewhere of 100,000 or more
 *
 * Each row is [name, region, lat, lng, kind] where region is a state code in
 * the US and a country name elsewhere, and kind is 'state' or 'city'. Sorted
 * by population so the search can return the first matches it finds.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');
const states = require('us-atlas/states-10m.json');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/owner-map-places.json');

const US_MIN_POPULATION = 2000;
const WORLD_MIN_POPULATION = 100000;

const STATE_CODES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

const round = (n) => Math.round(n * 1000) / 1000;

/** Area-weighted centroid of a state's largest ring, which is the mainland for every state. */
function stateMiddle(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const polygon of polygons) {
    const ring = polygon[0];
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (!best || Math.abs(area) > Math.abs(best.area)) best = { area, lng: cx / (3 * area), lat: cy / (3 * area) };
  }
  return best;
}

const countryName = new Intl.DisplayNames(['en'], { type: 'region' });

const rows = [];
for (const f of feature(states, states.objects.states).features) {
  const code = STATE_CODES[f.properties.name];
  if (!code) continue;
  const middle = stateMiddle(f.geometry);
  rows.push({ row: [f.properties.name, 'US', round(middle.lat), round(middle.lng), 'state'], population: Infinity });
}
for (const city of cities) {
  const us = city.country === 'US';
  if (city.population < (us ? US_MIN_POPULATION : WORLD_MIN_POPULATION)) continue;
  const [lng, lat] = city.loc.coordinates;
  const region = us ? city.adminCode : countryName.of(city.country) ?? city.country;
  rows.push({ row: [city.name, region, round(lat), round(lng), 'city'], population: city.population });
}
rows.sort((a, b) => b.population - a.population);

fs.writeFileSync(OUT, `${JSON.stringify(rows.map((r) => r.row))}\n`);
console.log(`[owner-map-places] wrote ${rows.length} places to ${path.relative(ROOT, OUT)}`);
