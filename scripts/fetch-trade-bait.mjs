/**
 * Lightweight trade-bait-only fetch for prebuild.
 * Pulls the tradeBait endpoint from MFL and writes it to
 * data/<league>/mfl-feeds/<year>/tradeBait.json.
 *
 * Usage:
 *   MFL_LEAGUE_ID=13522 MFL_LEAGUE_SLUG=theleague node scripts/fetch-trade-bait.mjs
 *
 * Env variables:
 *   MFL_LEAGUE_ID (required)
 *   MFL_LEAGUE_SLUG (optional, defaults to 'theleague')
 *   MFL_YEAR (optional, auto-detects based on league calendar)
 *   MFL_HOST (optional, defaults to https://api.myfantasyleague.com)
 */
import fs from 'node:fs';
import path from 'node:path';

const getNonEmpty = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const getLaborDay = (year) => {
  const septemberFirst = new Date(year, 8, 1);
  const dayOfWeek = septemberFirst.getDay();
  let daysUntilMonday;
  if (dayOfWeek === 1) daysUntilMonday = 0;
  else if (dayOfWeek === 0) daysUntilMonday = 1;
  else daysUntilMonday = 8 - dayOfWeek;
  return new Date(year, 8, 1 + daysUntilMonday, 0, 0, 0, 0);
};

const calculateBaseYear = (date) => {
  const calendarYear = date.getFullYear();
  const laborDay = getLaborDay(calendarYear);
  return date >= laborDay ? calendarYear : calendarYear - 1;
};

const leagueId = getNonEmpty(process.env.MFL_LEAGUE_ID);
if (!leagueId) {
  console.error('Missing MFL_LEAGUE_ID env var');
  process.exit(1);
}

const leagueName = getNonEmpty(process.env.MFL_LEAGUE_SLUG) ||
  (leagueId === '19621' ? 'afl-fantasy' : 'theleague');
const host = getNonEmpty(process.env.MFL_HOST) || 'https://api.myfantasyleague.com';

// Determine year (same logic as fetch-mfl-feeds.mjs)
const now = new Date();
const manualYear = getNonEmpty(process.env.MFL_YEAR) || getNonEmpty(process.env.MFL_SEASON);
const baseYear = manualYear ? parseInt(manualYear, 10) : calculateBaseYear(now);
const febCutoff = new Date(now.getFullYear(), 1, 14, 16, 45, 0, 0);
const year = String(now >= febCutoff ? Math.max(baseYear + 1, now.getFullYear()) : baseYear);

const outDir = path.join('data', leagueName, 'mfl-feeds', year);
fs.mkdirSync(outDir, { recursive: true });

const parseTradeBait = (data) => {
  const playerIds = new Set();
  if (typeof data === 'object' && data !== null) {
    let tradeBaitArray = data?.tradeBaits?.tradeBait;
    if (tradeBaitArray && !Array.isArray(tradeBaitArray)) {
      tradeBaitArray = [tradeBaitArray];
    }
    if (Array.isArray(tradeBaitArray)) {
      tradeBaitArray.forEach((item) => {
        if (item.willGiveUp) {
          const ids = typeof item.willGiveUp === 'string'
            ? item.willGiveUp.split(',').map(id => id.trim())
            : [item.willGiveUp];
          ids.forEach((id) => {
            if (id && /^\d{4,}$/.test(id)) {
              playerIds.add(id);
            }
          });
        }
      });
    }
  }
  return Array.from(playerIds);
};

const url = `${host}/${year}/export?TYPE=tradeBait&L=${leagueId}&JSON=1`;
console.log(`Fetching trade bait for ${leagueName} ${year} from ${url}`);

try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const parsed = parseTradeBait(JSON.parse(text));
  const file = path.join(outDir, 'tradeBait.json');
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2), 'utf8');
  console.log(`Saved ${parsed.length} trade bait player(s) -> ${file}`);
} catch (err) {
  console.error(`Failed to fetch trade bait: ${err.message}`);
  // Don't fail the build — trade bait is non-critical
  process.exit(0);
}
