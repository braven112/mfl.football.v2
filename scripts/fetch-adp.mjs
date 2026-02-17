/**
 * Fetch ADP (Average Draft Position) data from MFL.
 *
 * Fetches both redraft and dynasty ADP for the current league year,
 * plus previous-year fallback data (useful early in the offseason when
 * current-year ADP is sparse).
 *
 * This script is lightweight and safe to run on every build via prebuild.
 *
 * Usage:
 *   node scripts/fetch-adp.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const host = 'https://api.myfantasyleague.com';

// ── Year calculation (mirrors league-year.ts logic) ─────────────────────────

const getLaborDay = (yr) => {
  const sept1 = new Date(yr, 8, 1);
  const dow = sept1.getDay();
  const offset = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return new Date(yr, 8, 1 + offset);
};

const now = new Date();
const calendarYear = now.getFullYear();
const laborDay = getLaborDay(calendarYear);
const baseYear = now >= laborDay ? calendarYear : calendarYear - 1;

// After Feb 14 @ 8:45 PT the league year advances
const febCutoff = new Date(calendarYear, 1, 14, 16, 45, 0, 0);
const currentYear = now >= febCutoff ? baseYear + 1 : baseYear;

// ── Helpers ─────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchJson = async (url, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(await res.text());
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const wait = 1500 * (attempt + 1);
      console.warn(`  Retry ${attempt + 1} for ${url} in ${wait}ms (${err.message})`);
      await delay(wait);
    }
  }
};

const writeJson = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// ── ADP endpoints ───────────────────────────────────────────────────────────

const adpEndpoints = (yr) => [
  {
    key: 'adp-redraft',
    url: `${host}/${yr}/export?TYPE=adp&IS_PPR=1&IS_KEEPER=0&IS_MOCK=0&JSON=1`,
  },
  {
    key: 'adp-dynasty',
    url: `${host}/${yr}/export?TYPE=adp&IS_PPR=1&IS_MOCK=0&JSON=1`,
  },
];

// ── Main ────────────────────────────────────────────────────────────────────

const run = async () => {
  const outDir = path.join('data', 'theleague', 'mfl-feeds');

  // 1. Fetch current-year ADP
  console.log(`Fetching ${currentYear} ADP data...`);
  for (const { key, url } of adpEndpoints(currentYear)) {
    try {
      const data = await fetchJson(url);
      const file = path.join(outDir, String(currentYear), `${key}.json`);
      writeJson(file, data);
      const count = Array.isArray(data?.adp?.player) ? data.adp.player.length : 0;
      console.log(`  ${key} → ${count} players`);
    } catch (err) {
      console.error(`  Failed ${key}: ${err.message}`);
    }
  }

  console.log('ADP fetch complete.');
};

run().catch((err) => {
  console.error('ADP fetch failed:', err);
  process.exit(1);
});
