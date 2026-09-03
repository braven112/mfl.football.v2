/**
 * What does MFL let an owner DO to a claim that is already filed?
 *
 * Its add/drop page renders a "Current Waiver Claims for Round" table whose
 * rows offer "Edit | Copy To Round N | Delete". This prints those controls and
 * the URLs behind them, plus any form the Edit target renders, so a reorder
 * feature is built against what MFL actually exposes.
 *
 * That matters because the obvious mechanism is gone: `import?TYPE=waiverRequest`
 * with `REPLACE=1` — which MFL documents as replacing a round's entries — was
 * tested live on 2026-09-02 against a real filed claim and is INERT for this
 * league. Empty 200, picks unchanged, timestamp unchanged.
 *
 * Read-only. GET only. Writes nothing.
 */
import { mflFetch } from './lib/mfl-api.mjs';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { getNonEmpty } from './lib/env.mjs';

const slug = getNonEmpty(process.argv.find((a) => a.startsWith('--league='))?.split('=')[1]) || DEFAULT_LEAGUE_SLUG;
const league = getLeagueBySlug(slug);
if (!league) { console.error(`Unknown league slug: ${slug}`); process.exit(1); }
const cookie = getNonEmpty(process.env.MFL_USER_ID);
if (!cookie) { console.error('MFL_USER_ID is required.'); process.exit(1); }
const year = Number(getNonEmpty(process.env.MFL_YEAR)) || new Date().getFullYear();

const fetchPage = async (url) => {
  const res = await mflFetch({ url, cookies: { MFL_USER_ID: cookie }, timeoutMs: 20_000 });
  return { status: res.status, html: await res.text() };
};

const url = `https://${league.mflHost}/${year}/add_drop?L=${league.id}`;
const { status, html } = await fetchPage(url);
console.log(`GET ${url} -> ${status}, ${html.length} bytes`);

// The claims table sits under this heading; slice to it so the nav never wins.
const at = html.search(/Current Waiver Claims/i);
if (at < 0) {
  console.log('NO "Current Waiver Claims" SECTION — nothing is filed, so there is nothing to inspect.');
  process.exit(0);
}
const region = html.slice(at, at + 6000);

console.log('\n--- LINKS IN THE CLAIMS TABLE');
for (const m of region.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,60}?)<\/a>/gi)) {
  console.log(`  ${m[2].replace(/<[^>]*>/g, '').trim()}  ->  ${m[1]}`);
}
console.log('\n--- CONTROLS IN THE CLAIMS TABLE');
for (const m of region.matchAll(/<(?:input|select|button)[^>]*>/gi)) {
  console.log('  ', m[0].replace(/\s+/g, ' ').slice(0, 200));
}
console.log('\n--- TABLE COPY');
console.log(region.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 900));
