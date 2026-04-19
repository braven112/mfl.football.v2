/**
 * Fetch KeepTradeCut (KTC) rookie rankings and write a normalized JSON file
 * to data/adp/ktc-rookies-<year>.json.
 *
 * KTC doesn't publish an official API. Their dynasty-rankings page embeds a
 * JavaScript global `playersArray` that contains the full player data with
 * trade values and positional ranks. We fetch the page HTML and parse that
 * global.
 *
 * Defaults:
 *   - 1QB format (standard, most common). Pass --sf to fetch superflex.
 *   - PPR scoring.
 *   - Rookie filter applied client-side via `rookie === "Yes"`.
 *
 * Usage:
 *   node scripts/fetch-ktc-rookie-rankings.mjs
 *   node scripts/fetch-ktc-rookie-rankings.mjs --sf
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'data', 'adp');

const args = new Set(process.argv.slice(2));
const superflex = args.has('--sf') || args.has('--superflex');
const KTC_URL = superflex
  ? 'https://keeptradecut.com/dynasty-rankings?filters=QB|WR|RB|TE|RDP&format=2'
  : 'https://keeptradecut.com/dynasty-rankings?filters=QB|WR|RB|TE|RDP&format=1';

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

async function fetchText(url, timeoutMs = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        // KTC serves a different payload without a UA header
        'User-Agent':
          'Mozilla/5.0 (compatible; theleague-mock-draft/1.0; +https://theleague.football)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the `playersArray = [...]` JSON blob embedded in the KTC page HTML.
 */
function parsePlayersArray(html) {
  const marker = 'var playersArray = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('playersArray not found in KTC HTML');
  const jsonStart = start + marker.length;
  // The array ends with `];` on its own semicolon. Walk with a depth counter
  // so we don't get tripped up by brackets inside string values.
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Unterminated playersArray');
  const raw = html.slice(jsonStart, end);
  return JSON.parse(raw);
}

const KEEP_POS = new Set(['QB', 'RB', 'WR', 'TE']);

function extractRookies(playersArray) {
  const rows = [];
  for (const p of playersArray) {
    if (!p) continue;
    // KTC flags rookies with `rookie: "Yes"` (string) — also filter to
    // fantasy-relevant positions (no RDP / picks).
    const isRookie = (p.rookie ?? '').toString().toLowerCase() === 'yes';
    if (!isRookie) continue;
    const pos = (p.position || '').toUpperCase();
    if (!KEEP_POS.has(pos)) continue;
    const name = p.playerName || p.fullName || '';
    if (!name) continue;
    rows.push({
      ktcId: p.playerID ?? p.id ?? null,
      name,
      position: pos,
      team: (p.team || '').toUpperCase() || null,
      // 1QB uses oneQBValues, superflex uses superflexValues
      value: superflex
        ? (p.superflexValues?.value ?? null)
        : (p.oneQBValues?.value ?? null),
      positionalRank: superflex
        ? (p.superflexValues?.positionalRank ?? null)
        : (p.oneQBValues?.positionalRank ?? null),
      overallRank: superflex
        ? (p.superflexValues?.overallRank ?? null)
        : (p.oneQBValues?.overallRank ?? null),
    });
  }
  // Sort by value descending (higher KTC value = better)
  rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

async function main() {
  console.log(`[ktc-rookies] Fetching KTC ${superflex ? 'superflex' : '1QB'} rookie rankings…`);
  const html = await fetchText(KTC_URL);
  const all = parsePlayersArray(html);
  const rookies = extractRookies(all);
  if (rookies.length === 0) {
    console.warn('[ktc-rookies] No rookies parsed — output not written');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(
    OUT_DIR,
    `ktc-rookies-${leagueYear}${superflex ? '-sf' : ''}.json`
  );
  const payload = {
    source: 'ktc',
    format: superflex ? 'superflex' : '1qb',
    leagueYear,
    fetchedAt: new Date().toISOString(),
    count: rookies.length,
    players: rookies,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[ktc-rookies] Wrote ${rookies.length} rookies → ${outPath}`);
}

main().catch((err) => {
  console.error('[ktc-rookies] Failed:', err.message);
  process.exit(1);
});
