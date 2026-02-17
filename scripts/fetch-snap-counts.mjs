/**
 * Fetch NFL snap count data from NFLverse and match to MFL player IDs.
 *
 * Downloads per-game snap counts from the NFLverse GitHub releases,
 * aggregates to season totals, and fuzzy-matches players to MFL IDs.
 *
 * ── Snap Count Lifecycle ────────────────────────────────────────────────────
 *
 * Snap count data follows the NFL regular season calendar:
 *
 *   Offseason (Feb – Labor Day):
 *     Use cached data from the most recent completed season.
 *     No fetches needed — run once at end of season and reuse all offseason.
 *
 *   Regular Season (Labor Day – end of Week 18):
 *     Fetch weekly on Tuesdays at noon (after games finalize).
 *     NFLverse updates their CSV after each week's games.
 *     Use --force to overwrite the cached file with latest weekly data.
 *
 *   After Season Ends:
 *     Final fetch captures the complete season. This becomes the cached
 *     data used through the following offseason until the next NFL season.
 *
 * Year selection:
 *   - Before Labor Day: uses previous calendar year (last completed season)
 *   - After Labor Day: uses current calendar year (active season)
 *   - Override with --year flag for manual control
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/fetch-snap-counts.mjs              # Auto-detect year, use cache
 *   node scripts/fetch-snap-counts.mjs --force      # Re-fetch current year
 *   node scripts/fetch-snap-counts.mjs --year 2024  # Specific year
 *
 * Output: data/theleague/nfl-cache/snap-counts-{YEAR}.json
 *
 * ── Scheduled Usage (CI / Cron) ─────────────────────────────────────────────
 *
 *   During regular season, schedule weekly:
 *     0 12 * * 2 node scripts/fetch-snap-counts.mjs --force
 *     (Every Tuesday at noon)
 *
 *   No schedule needed during offseason — cached data is reused automatically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

// ── Config ──────────────────────────────────────────────────────────────────
const force = process.argv.includes('--force');

// ── Year calculation ────────────────────────────────────────────────────────
// Snap counts follow the NFL season year:
// Before Labor Day → previous year (completed season)
// After Labor Day → current year (active season)

const getLaborDay = (yr) => {
  const sept1 = new Date(yr, 8, 1);
  const dow = sept1.getDay();
  const offset = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return new Date(yr, 8, 1 + offset);
};

const now = new Date();
const calendarYear = now.getFullYear();
const laborDay = getLaborDay(calendarYear);
const autoYear = now >= laborDay ? calendarYear : calendarYear - 1;

const yearFlag = process.argv.find((_, i, a) => a[i - 1] === '--year');
const SNAP_YEAR = yearFlag ? parseInt(yearFlag, 10) : autoYear;

const NFLVERSE_URL = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${SNAP_YEAR}.csv.gz`;

// MFL data — use current league year for player ID matching
const getCurrentLeagueYear = () => {
  const febCutoff = new Date(calendarYear, 1, 14, 16, 45, 0, 0);
  const baseYear = now >= laborDay ? calendarYear : calendarYear - 1;
  return now >= febCutoff ? baseYear + 1 : baseYear;
};
const leagueYear = getCurrentLeagueYear();

const MFL_PLAYERS_PATH = path.join('data', 'theleague', 'mfl-feeds', String(leagueYear), 'players.json');
const MFL_PLAYERS_FALLBACK = path.join('data', 'theleague', 'mfl-feeds', String(leagueYear - 1), 'players.json');

const OUT_DIR = path.join('data', 'theleague', 'nfl-cache');
const OUT_FILE = path.join(OUT_DIR, `snap-counts-${SNAP_YEAR}.json`);

// ── NFLverse team code → standard code mapping ─────────────────────────────
// NFLverse uses standard 2-3 letter codes, but some need normalization
const NFLVERSE_TEAM_MAP = {
  LA: 'LAR',   // NFLverse uses LA for Rams
  OAK: 'LV',   // Historical
  SD: 'LAC',   // Historical
  STL: 'LAR',  // Historical
};

// MFL uses non-standard team codes — map to standard
const MFL_TEAM_MAP = {
  GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO',
  SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU',
  BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', JAC: 'JAX',
};

function normalizeMflTeam(code) {
  if (!code) return '';
  return MFL_TEAM_MAP[code] || code;
}

function normalizeNflverseTeam(code) {
  if (!code) return '';
  return NFLVERSE_TEAM_MAP[code] || code;
}

// ── Name normalization (mirrors rankings-importer.ts) ───────────────────────
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/\s+jr\.?$/i, '')
    .replace(/\s+sr\.?$/i, '')
    .replace(/\s+iii$/i, '')
    .replace(/\s+ii$/i, '')
    .replace(/\s+iv$/i, '')
    .replace(/\s+v$/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── CSV Parser ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split (snap count data doesn't have commas in values)
    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

// ── Aggregate snap counts per player ────────────────────────────────────────
function aggregateSnapCounts(rows) {
  const playerMap = new Map();

  for (const row of rows) {
    const name = row.player || '';
    const team = normalizeNflverseTeam(row.team || '');
    const position = row.position || '';
    const offenseSnaps = parseInt(row.offense_snaps, 10) || 0;
    const offensePct = parseFloat(row.offense_pct) || 0;
    const gameType = row.game_type || '';

    // Only count regular season games
    if (gameType !== 'REG') continue;
    // Skip players with no offense snaps (defensive/ST-only players)
    if (offenseSnaps === 0 && offensePct === 0) continue;
    // Only fantasy-relevant positions
    if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(position)) continue;

    const key = `${name}|${team}|${position}`;
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        name,
        team,
        position: position === 'K' ? 'PK' : position,
        totalOffenseSnaps: 0,
        offensePctSum: 0,
        gamesPlayed: 0,
      });
    }

    const entry = playerMap.get(key);
    entry.totalOffenseSnaps += offenseSnaps;
    entry.offensePctSum += offensePct;
    entry.gamesPlayed += 1;
  }

  // Calculate averages
  const result = [];
  for (const entry of playerMap.values()) {
    result.push({
      name: entry.name,
      team: entry.team,
      position: entry.position,
      offenseSnaps: entry.totalOffenseSnaps,
      offensePct: entry.gamesPlayed > 0
        ? Math.round((entry.offensePctSum / entry.gamesPlayed) * 1000) / 10
        : 0,
      gamesPlayed: entry.gamesPlayed,
    });
  }

  return result;
}

// ── Match to MFL player IDs ────────────────────────────────────────────────
function matchToMflPlayers(snapPlayers, mflPlayers) {
  // Build lookup by normalized name + position
  const mflByNamePos = new Map();
  for (const p of mflPlayers) {
    if (!p.id || !p.name || !p.position) continue;
    const pos = p.position === 'Def' ? 'DEF' : p.position;

    // MFL name format: "LastName, FirstName"
    const parts = p.name.split(', ');
    const fullName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : p.name;
    const normalized = normalizeName(fullName);
    const team = normalizeMflTeam(p.team || '');

    // Primary key: name + position (most reliable)
    const key = `${normalized}|${pos}`;
    if (!mflByNamePos.has(key)) {
      mflByNamePos.set(key, []);
    }
    mflByNamePos.get(key).push({ id: p.id, name: fullName, team });
  }

  const matched = {};
  let matchCount = 0;
  let missCount = 0;

  for (const snap of snapPlayers) {
    const normalizedSnapName = normalizeName(snap.name);
    const key = `${normalizedSnapName}|${snap.position}`;
    const candidates = mflByNamePos.get(key);

    if (candidates && candidates.length > 0) {
      // If multiple matches, prefer same team
      let best = candidates[0];
      if (candidates.length > 1) {
        const sameTeam = candidates.find(c => c.team === snap.team);
        if (sameTeam) best = sameTeam;
      }

      matched[best.id] = {
        offenseSnaps: snap.offenseSnaps,
        offensePct: snap.offensePct,
        gamesPlayed: snap.gamesPlayed,
      };
      matchCount++;
    } else {
      missCount++;
    }
  }

  console.log(`Matched ${matchCount} players to MFL IDs (${missCount} unmatched)`);
  return matched;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`Snap count year: ${SNAP_YEAR} (auto-detected from ${now >= laborDay ? 'active season' : 'last completed season'})`);

  // Check cache
  if (!force && fs.existsSync(OUT_FILE)) {
    console.log(`Snap counts for ${SNAP_YEAR} already cached at ${OUT_FILE}; use --force to refetch.`);
    return;
  }

  // Load MFL players for matching
  const mflPath = fs.existsSync(MFL_PLAYERS_PATH) ? MFL_PLAYERS_PATH : MFL_PLAYERS_FALLBACK;
  if (!fs.existsSync(mflPath)) {
    console.error(`No MFL players.json found at ${MFL_PLAYERS_PATH} or ${MFL_PLAYERS_FALLBACK}`);
    console.error('Run "node scripts/fetch-mfl-feeds.mjs" first.');
    process.exit(1);
  }

  console.log(`Loading MFL players from ${mflPath}`);
  const mflData = JSON.parse(fs.readFileSync(mflPath, 'utf8'));
  const mflPlayers = mflData?.players?.player || [];
  console.log(`Loaded ${mflPlayers.length} MFL players`);

  // Download snap counts
  console.log(`Downloading snap counts from ${NFLVERSE_URL}`);
  const response = await fetch(NFLVERSE_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download snap counts: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${(buffer.length / 1024).toFixed(0)} KB, decompressing...`);

  const csvText = gunzipSync(buffer).toString('utf8');
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} snap count records`);

  // Aggregate to season totals
  const snapPlayers = aggregateSnapCounts(rows);
  console.log(`Aggregated ${snapPlayers.length} unique player-seasons`);

  // Match to MFL IDs
  const matched = matchToMflPlayers(snapPlayers, mflPlayers);

  // Write output
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = {
    season: SNAP_YEAR,
    fetchedAt: new Date().toISOString(),
    source: NFLVERSE_URL,
    players: matched,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Saved snap counts -> ${OUT_FILE} (${Object.keys(matched).length} players)`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
