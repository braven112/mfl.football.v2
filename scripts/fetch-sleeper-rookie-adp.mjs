/**
 * Fetch Sleeper rookie ADP and write a normalized JSON file to
 * data/adp/sleeper-rookies-<year>.json.
 *
 * Sleeper's players catalog (~5 MB) gives us rookie status via
 * `years_exp === 0` plus the player's name, position, and team. Sleeper does
 * not expose a clean rookie-only ADP endpoint publicly, so we use their
 * dynasty ADP research endpoint and filter by rookie status.
 *
 * The mock-draft auto-pick fallback reads this file at session creation time.
 *
 * Usage:
 *   node scripts/fetch-sleeper-rookie-adp.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';
const OUT_DIR = path.join(process.cwd(), 'data', 'adp');

const getLaborDay = (yr) => {
  const sept1 = new Date(yr, 8, 1);
  const dow = sept1.getDay();
  const offset = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return new Date(yr, 8, 1 + offset);
};
const now = new Date();
const calendarYear = now.getFullYear();
const laborDay = getLaborDay(calendarYear);
const leagueYear = now >= laborDay ? calendarYear : calendarYear - 1;

// Fantasy-relevant positions only
const KEEP_POS = new Set(['QB', 'RB', 'WR', 'TE']);

async function fetchJson(url, timeoutMs = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sleeper returns rankings as an object keyed by player_id. We want rookies
 * only (years_exp === 0), ordered by search_rank (Sleeper's composite
 * popularity/ADP signal).
 */
function extractRookies(catalog) {
  const rows = [];
  for (const [sleeperId, p] of Object.entries(catalog)) {
    if (!p || p.years_exp !== 0) continue;
    const pos = (p.position || p.fantasy_positions?.[0] || '').toUpperCase();
    if (!KEEP_POS.has(pos)) continue;
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!name) continue;
    rows.push({
      sleeperId,
      name,
      position: pos,
      team: (p.team || '').toUpperCase() || null,
      college: p.college || null,
      searchRank: Number.isFinite(p.search_rank) ? p.search_rank : null,
    });
  }
  // Sort by search_rank ascending; nulls go to the end
  rows.sort((a, b) => {
    const ar = a.searchRank ?? Number.POSITIVE_INFINITY;
    const br = b.searchRank ?? Number.POSITIVE_INFINITY;
    return ar - br;
  });
  // Assign our own 1-indexed rank based on the final order
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

async function main() {
  console.log('[sleeper-rookies] Fetching Sleeper player catalog…');
  const catalog = await fetchJson(SLEEPER_PLAYERS_URL);
  const rookies = extractRookies(catalog);
  if (rookies.length === 0) {
    console.warn('[sleeper-rookies] No rookies found — output not written');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `sleeper-rookies-${leagueYear}.json`);
  const payload = {
    source: 'sleeper',
    leagueYear,
    fetchedAt: new Date().toISOString(),
    count: rookies.length,
    players: rookies,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[sleeper-rookies] Wrote ${rookies.length} rookies → ${outPath}`);
}

main().catch((err) => {
  console.error('[sleeper-rookies] Failed:', err.message);
  process.exit(1);
});
