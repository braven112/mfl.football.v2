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

const extractPlayerIds = (willGiveUp) => {
  if (!willGiveUp) return [];
  const ids = typeof willGiveUp === 'string'
    ? willGiveUp.split(',').map((id) => id.trim())
    : [String(willGiveUp)];
  return ids.filter((id) => id && /^\d{4,}$/.test(id));
};

/**
 * Parse the MFL tradeBait response into two shapes:
 *   - flat: unique player-id array (legacy; UI consumes this)
 *   - byFranchise: { [franchiseId]: { playerIds, willGiveUpComment, willTakeComment } }
 *     Fresh shape needed by the Schefter trade-bait detector so it can
 *     diff per-franchise activity instead of league-wide aggregates.
 */
const parseTradeBait = (data) => {
  const playerIds = new Set();
  const byFranchise = {};
  if (typeof data !== 'object' || data === null) {
    return { flat: [], byFranchise };
  }
  let tradeBaitArray = data?.tradeBaits?.tradeBait;
  if (tradeBaitArray && !Array.isArray(tradeBaitArray)) {
    tradeBaitArray = [tradeBaitArray];
  }
  if (!Array.isArray(tradeBaitArray)) return { flat: [], byFranchise };

  for (const item of tradeBaitArray) {
    const ids = extractPlayerIds(item?.willGiveUp);
    ids.forEach((id) => playerIds.add(id));

    // MFL uses `franchise_id` on tradeBait entries. Fall back to other
    // common capitalizations just in case the API changes.
    const franchiseId = String(
      item?.franchise_id ?? item?.franchiseId ?? item?.franchise ?? '',
    ).trim();
    if (!franchiseId) continue;

    byFranchise[franchiseId] = {
      playerIds: ids,
      willGiveUpComment: typeof item?.willGiveUpComments === 'string'
        ? item.willGiveUpComments.trim()
        : '',
      willTakeComment: typeof item?.willTakeComments === 'string'
        ? item.willTakeComments.trim()
        : '',
    };
  }
  return { flat: Array.from(playerIds), byFranchise };
};

const url = `${host}/${year}/export?TYPE=tradeBait&L=${leagueId}&JSON=1`;
console.log(`Fetching trade bait for ${leagueName} ${year} from ${url}`);

try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const { flat, byFranchise } = parseTradeBait(JSON.parse(text));
  const file = path.join(outDir, 'tradeBait.json');
  fs.writeFileSync(file, JSON.stringify(flat, null, 2), 'utf8');
  console.log(`Saved ${flat.length} trade bait player(s) -> ${file}`);

  const byFranchiseFile = path.join(outDir, 'tradeBait-by-franchise.json');
  const byFranchisePayload = {
    fetchedAt: Date.now(),
    franchises: byFranchise,
  };
  fs.writeFileSync(byFranchiseFile, JSON.stringify(byFranchisePayload, null, 2), 'utf8');
  const franchiseCount = Object.keys(byFranchise).length;
  console.log(`Saved per-franchise trade bait (${franchiseCount} franchise(s)) -> ${byFranchiseFile}`);
} catch (err) {
  console.error(`Failed to fetch trade bait: ${err.message}`);
  // Don't fail the build — trade bait is non-critical
  process.exit(0);
}
