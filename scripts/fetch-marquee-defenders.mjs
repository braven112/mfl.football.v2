#!/usr/bin/env node

/**
 * Fetch the previous season's Pro Bowl + All-Pro DEFENDERS from Wikipedia and
 * write them to src/data/theleague/def-marquee-defenders.json.
 *
 * This is the "always include" star list that fetch-def-spotlight-players.mjs
 * pins to the front of each team's DEF spotlight pool. Pro Bowl / All-Pro is the
 * star-reputation signal that raw counting stats miss (a shutdown corner gets
 * few tackles because QBs avoid him), and ESPN's API doesn't expose those
 * rosters — hence Wikipedia.
 *
 * The Pro Bowl / All-Pro classes turn over every year, so this runs annually via
 * GitHub Actions (marquee-defenders-sync.yml), after both are finalized (~Feb).
 *
 * Page titles are derived from the season year and are stable across years:
 *   All-Pro:  "{season} All-Pro Team"        e.g. 2025 All-Pro Team
 *   Pro Bowl: "{season + 1} Pro Bowl Games"  e.g. 2026 Pro Bowl Games
 *
 * On both pages, every defender is a wiki-link immediately followed by their
 * team-season link — `[[Player]], [[YYYY <Team> season|City]]` — inside a
 * "Defense" table that ends at "Special teams". We anchor on exactly that, so
 * offensive players are never picked up. If the parse yields implausibly few
 * names (Wikipedia changed format), the script FAILS rather than overwriting a
 * good list with garbage.
 *
 * Usage:
 *   node scripts/fetch-marquee-defenders.mjs
 *   node scripts/fetch-marquee-defenders.mjs --season 2025
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const OUT_PATH = path.join(root, 'src/data/theleague/def-marquee-defenders.json');

// If a parse returns fewer defenders than this, treat it as a broken scrape and
// bail (a normal season yields ~33 All-Pro + ~40 Pro Bowl → ~48 unique, so 40 is
// close to normal while still catching one malformed table).
const MIN_DEFENDERS = 40;

const args = process.argv.slice(2);
const seasonArg = args.indexOf('--season');
const SEASON_OVERRIDE = seasonArg !== -1 && args[seasonArg + 1] ? Number(args[seasonArg + 1]) : undefined;

// Most recent completed NFL season. Before September, last year's season is the
// most recent completed one (its Pro Bowl / All-Pro publish the following Jan–Feb).
function mostRecentCompletedSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function fetchWikitext(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': 'mfl-football/marquee-defenders-sync' } });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status} for "${title}"`);
  const data = await res.json();
  const text = data?.parse?.wikitext;
  if (!text) throw new Error(`No wikitext for "${title}" (${JSON.stringify(data?.error) || 'missing page?'})`);
  return typeof text === 'string' ? text : text['*'];
}

// Pull every `[[Player]], [[… season …]]` display name out of EVERY Defense
// table on the page. The Pro Bowl page has two (AFC + NFC); the All-Pro page has
// one. Each table starts at a "Defense" caption/heading whose next ~60 chars
// mention "Position" and ends at the following "Special teams" section — so
// offensive players are never captured.
function parseDefenders(wikitext) {
  const lower = wikitext.toLowerCase();
  // Player wiki-link immediately followed by their team-season wiki-link.
  const re = /\[\[([^\]]+?)\]\]\s*,\s*\[\[[^\]]*?season\b/g;
  const names = [];

  const marker = /Defense/gi;
  let m;
  while ((m = marker.exec(wikitext))) {
    if (!/Position/i.test(wikitext.slice(m.index, m.index + 60))) continue;
    let end = lower.indexOf('special teams', m.index);
    if (end === -1) end = Math.min(wikitext.length, m.index + 4000);
    const region = wikitext.slice(m.index, end);
    let mm;
    re.lastIndex = 0;
    while ((mm = re.exec(region))) {
      const display = mm[1].split('|').pop().trim(); // text after pipe if piped
      if (display) names.push(display);
    }
  }
  return names;
}

// Dedup by a loose key (case/diacritic/suffix-insensitive), keeping first display.
function normalizeKey(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function main() {
  const season = SEASON_OVERRIDE || mostRecentCompletedSeason();
  const allProTitle = `${season} All-Pro Team`;
  const proBowlTitle = `${season + 1} Pro Bowl Games`;
  console.log(`Season ${season}: fetching "${allProTitle}" + "${proBowlTitle}"…`);

  const [allProWt, proBowlWt] = await Promise.all([
    fetchWikitext(allProTitle),
    fetchWikitext(proBowlTitle),
  ]);

  const allPro = parseDefenders(allProWt);
  const proBowl = parseDefenders(proBowlWt);
  console.log(`  All-Pro defenders: ${allPro.length}, Pro Bowl defenders: ${proBowl.length}`);

  // Union, All-Pro display forms first, deduped.
  const seen = new Map(); // key -> display
  for (const name of [...allPro, ...proBowl]) {
    const key = normalizeKey(name);
    if (key && !seen.has(key)) seen.set(key, name);
  }
  const names = [...seen.values()].sort((a, b) => a.localeCompare(b));

  if (names.length < MIN_DEFENDERS) {
    throw new Error(
      `Only parsed ${names.length} marquee defenders (<${MIN_DEFENDERS}); ` +
      `Wikipedia format likely changed. Refusing to overwrite ${path.relative(root, OUT_PATH)}.`
    );
  }

  const payload = {
    season,
    updatedAt: new Date().toISOString(),
    note: 'Auto-generated by scripts/fetch-marquee-defenders.mjs. Pro Bowl + All-Pro defenders, refreshed yearly.',
    sources: {
      allPro: `https://en.wikipedia.org/wiki/${allProTitle.replace(/ /g, '_')}`,
      proBowl: `https://en.wikipedia.org/wiki/${proBowlTitle.replace(/ /g, '_')}`,
    },
    names,
  };

  // Atomic write: temp file in the same dir, then rename over the destination so
  // an interrupted run can't leave a truncated JSON file.
  const tmp = `${OUT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(tmp, OUT_PATH);
  console.log(`\n✓ Wrote ${names.length} marquee defenders (season ${season}) → ${path.relative(root, OUT_PATH)}`);
}

main().catch((err) => {
  console.error('fetch-marquee-defenders failed:', err.message);
  process.exit(1);
});
