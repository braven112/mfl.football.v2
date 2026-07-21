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
import { fetchWithRetry } from './lib/fetch-retry.mjs';

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

const fetchJson = (url, retries = 3) =>
  fetchWithRetry(url, {
    attempts: retries,
    baseDelayMs: 1500,
    parse: 'json',
    onRetry: (err, attempt, wait) =>
      console.warn(`  Retry ${attempt + 1} for ${url} in ${wait}ms (${err.message})`),
  });

const writeJson = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// ── ADP endpoints ───────────────────────────────────────────────────────────

// IS_KEEPER takes league-type letter codes (per MFL api_info for TYPE=adp):
// N = redraft (non-keeper), K = keeper, D = dynasty, R = rookie-only.
// Letter codes were confirmed from behavior (numeric values = unfiltered),
// not verified live (dev-sandbox egress to MFL is proxy-blocked) — the
// identical-payload guard below is the tripwire if they're wrong.
// The old numeric values (IS_KEEPER=0 / omitted) were silently ignored, so
// both files carried the SAME unfiltered dataset — every "dynasty ADP"
// consumer was actually reading redraft-ish data. The identical-payload
// guard below keeps that regression from going unnoticed again.
const adpEndpoints = (yr) => [
  {
    key: 'adp-redraft',
    url: `${host}/${yr}/export?TYPE=adp&IS_PPR=1&IS_KEEPER=N&IS_MOCK=0&JSON=1`,
  },
  {
    key: 'adp-dynasty',
    url: `${host}/${yr}/export?TYPE=adp&IS_PPR=1&IS_KEEPER=D&IS_MOCK=0&JSON=1`,
  },
];

// ── Main ────────────────────────────────────────────────────────────────────

const run = async () => {
  const outDir = path.join('data', 'theleague', 'mfl-feeds');

  // 1. Fetch current-year ADP
  console.log(`Fetching ${currentYear} ADP data...`);
  const payloads = {};
  for (const { key, url } of adpEndpoints(currentYear)) {
    try {
      const data = await fetchJson(url);
      const file = path.join(outDir, String(currentYear), `${key}.json`);
      writeJson(file, data);
      payloads[key] = data;
      const count = Array.isArray(data?.adp?.player) ? data.adp.player.length : 0;
      console.log(`  ${key} → ${count} players`);
    } catch (err) {
      console.error(`  Failed ${key}: ${err.message}`);
    }
  }

  // Identical-payload guard: redraft and dynasty are DIFFERENT populations of
  // leagues; byte-identical player data means the IS_KEEPER filter regressed
  // (that's exactly how the pre-July-2026 bug shipped). Warn loudly — don't
  // fail, this also runs in prebuild and a deploy shouldn't die over ADP.
  const adpFingerprint = (data) =>
    JSON.stringify((data?.adp?.player ?? []).map((p) => [p.id, p.averagePick]).sort());
  if (
    payloads['adp-redraft'] && payloads['adp-dynasty'] &&
    adpFingerprint(payloads['adp-redraft']) === adpFingerprint(payloads['adp-dynasty'])
  ) {
    console.warn(
      '::warning::adp-redraft and adp-dynasty returned IDENTICAL data — the ' +
      'IS_KEEPER league-type filter is likely being ignored again. Dynasty ' +
      'ADP consumers (cut-watch blend, hero casting) are degraded to redraft data.',
    );
  }

  console.log('ADP fetch complete.');
};

run().catch((err) => {
  console.error('ADP fetch failed:', err);
  process.exit(1);
});
