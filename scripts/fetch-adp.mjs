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

// IS_KEEPER takes league-type letter codes. Production verdict (2026-07-21):
// N (redraft) is ACCEPTED and returns data; D was REJECTED with
// `{"error":{"$t":"Invalid value for IS_KEEPER"}}` — and the crons committed
// that error payload over both leagues' adp-dynasty.json, which is why the
// error-payload guard below now refuses to write a payload with no players.
// The old numeric values (IS_KEEPER=0 / omitted) were silently ignored
// (both files carried the SAME unfiltered dataset), so DO NOT revert to
// numbers. The dynasty letter code still needs live verification against
// MFL (dev-sandbox egress to MFL is proxy-blocked) — until then the dynasty
// fetch fails loudly and the committed file stays at its last good state.
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
      // Error-payload guard: MFL returns HTTP 200 with an `error` body for a
      // rejected param (seen live: "Invalid value for IS_KEEPER"). Writing
      // that over a good feed breaks every ADP consumer AND the test suite —
      // keep the last good file instead and surface the failure loudly.
      const players = data?.adp?.player;
      if (data?.error || !players) {
        const reason = data?.error?.$t ?? 'no adp.player in response';
        console.warn(`::warning::${key} fetch returned no usable data (${reason}) — keeping the existing file.`);
        continue;
      }
      const file = path.join(outDir, String(currentYear), `${key}.json`);
      writeJson(file, data);
      payloads[key] = data;
      const count = Array.isArray(players) ? players.length : 1;
      console.log(`  ${key} → ${count} players`);
    } catch (err) {
      console.error(`  Failed ${key}: ${err.message}`);
    }
  }

  // Identical-payload guard: redraft and dynasty are DIFFERENT populations of
  // leagues; byte-identical player data means the IS_KEEPER filter regressed
  // (that's exactly how the pre-July-2026 bug shipped). Warn loudly — don't
  // fail, this also runs in prebuild and a deploy shouldn't die over ADP.
  const adpPlayers = (data) => data?.adp?.player ?? [];
  const adpFingerprint = (data) =>
    JSON.stringify(adpPlayers(data).map((p) => [p.id, p.averagePick]).sort());
  if (
    payloads['adp-redraft'] && payloads['adp-dynasty'] &&
    // Two legitimately-empty feeds (early offseason) are not a filter
    // regression — only warn when identical AND non-empty.
    adpPlayers(payloads['adp-redraft']).length > 0 &&
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
