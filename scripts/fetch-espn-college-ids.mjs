/**
 * Fetch ESPN college athlete IDs for MFL draft prospects.
 *
 * Maps MFL player IDs to ESPN college athlete IDs so the headshot fallback
 * chain can show college photos for rookies who don't yet have NFL headshots.
 *
 * Data sources (tried in order):
 *   1. ESPN Draft Prospects API — covers top ~150 prospects
 *   2. ESPN College Rosters API — covers remaining players by college
 *
 * Output: data/theleague/espn-college-ids.json
 *
 * Usage:
 *   node scripts/fetch-espn-college-ids.mjs [--year 2026]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRAFT_YEAR = (() => {
  const idx = process.argv.indexOf('--year');
  return idx !== -1 ? Number(process.argv[idx + 1]) : new Date().getFullYear();
})();

const MFL_PLAYERS_PATH = path.join(ROOT, `data/theleague/mfl-feeds/${DRAFT_YEAR}/players.json`);
const COLLEGE_LOGOS_PATH = path.join(ROOT, 'src/data/college-logos.json');
const OUTPUT_PATH = path.join(ROOT, 'data/theleague/espn-college-ids.json');

const DRAFT_API = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${DRAFT_YEAR}/draft/athletes`;
const COLLEGE_ROSTER_API = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams';

// Rate-limit delay between API calls (ms)
const DELAY = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------
const SUFFIXES = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i;

/** Normalize a name to "first last" lowercase, stripping suffixes. */
function normalizeName(name) {
  if (!name) return '';
  let n = name.trim();

  // MFL format: "Last, First" → "First Last"
  if (n.includes(',')) {
    const [last, first] = n.split(',').map((s) => s.trim());
    n = `${first} ${last}`;
  }

  return n.toLowerCase().replace(SUFFIXES, '').replace(/[.''-]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// College name normalization (MFL college names don't always match ESPN)
// ---------------------------------------------------------------------------
const COLLEGE_ALIASES = {
  'miami': 'miami',
  'miami (fl)': 'miami',
  'miami (oh)': 'miami (oh)',
  'usc': 'usc',
  'southern california': 'usc',
  'lsu': 'lsu',
  'louisiana state': 'lsu',
  'ole miss': 'ole miss',
  'mississippi': 'ole miss',
  'pitt': 'pittsburgh',
  'umass': 'massachusetts',
  'smu': 'smu',
  'southern methodist': 'smu',
  'tcu': 'tcu',
  'texas christian': 'tcu',
  'ucf': 'ucf',
  'central florida': 'ucf',
  'uab': 'uab',
  'alabama-birmingham': 'uab',
  'byu': 'byu',
  'brigham young': 'byu',
  'unlv': 'unlv',
  'utep': 'utep',
  'utsa': 'utsa',
  'uconn': 'connecticut',
  'colordado state': 'colorado state', // MFL typo
  'north dakota state': 'north dakota state',
  'ndsu': 'north dakota state',
};

function normalizeCollege(college) {
  if (!college) return '';
  const lower = college.toLowerCase().trim();
  return COLLEGE_ALIASES[lower] || lower;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Step 1: Load MFL prospects
// ---------------------------------------------------------------------------
function loadMflProspects() {
  console.log(`\nLoading MFL players from ${MFL_PLAYERS_PATH}...`);
  const raw = JSON.parse(fs.readFileSync(MFL_PLAYERS_PATH, 'utf-8'));
  const allPlayers = raw.players?.player || [];

  const prospects = allPlayers.filter(
    (p) => p.draft_year === String(DRAFT_YEAR) && !p.espn_id
  );

  console.log(`  Found ${prospects.length} prospects for ${DRAFT_YEAR} without espn_id`);
  return prospects;
}

// ---------------------------------------------------------------------------
// Step 2: Fetch ESPN draft prospects
// ---------------------------------------------------------------------------
async function fetchDraftProspects() {
  console.log(`\nFetching ESPN ${DRAFT_YEAR} draft prospects...`);

  // Get all $ref links (paginate)
  const firstPage = await fetchJSON(`${DRAFT_API}?limit=500`);
  const totalCount = firstPage.count || 0;
  console.log(`  Total draft prospects: ${totalCount}`);

  const refs = (firstPage.items || []).map((item) => item.$ref);

  // If there are more pages, fetch them too
  if (totalCount > 500) {
    let page = 2;
    while (refs.length < totalCount) {
      const nextPage = await fetchJSON(`${DRAFT_API}?limit=500&page=${page}`);
      for (const item of nextPage.items || []) refs.push(item.$ref);
      page++;
    }
  }

  console.log(`  Fetching ${refs.length} individual prospect profiles...`);

  // Fetch each prospect profile to get name + college athlete ID
  const prospects = [];
  for (const ref of refs) {
    await sleep(DELAY);
    try {
      const data = await fetchJSON(ref);

      // Extract college athlete ID from the athlete $ref link
      // e.g. ".../college-football/athletes/4837248"
      let collegeAthleteId = null;
      const athleteRef = data.athlete?.$ref || '';
      const match = athleteRef.match(/athletes\/(\d+)/);
      if (match) collegeAthleteId = match[1];

      prospects.push({
        espnDraftId: String(data.id),
        fullName: data.fullName || data.displayName || '',
        collegeAthleteId,
        position: data.position?.abbreviation || '',
        college: data.college?.name || '',
      });
    } catch (err) {
      console.warn(`  Warning: Failed to fetch ${ref}: ${err.message}`);
    }
  }

  console.log(`  Loaded ${prospects.length} draft prospect profiles`);
  return prospects;
}

// ---------------------------------------------------------------------------
// Step 3: Fetch college rosters for remaining unmatched prospects
// ---------------------------------------------------------------------------
async function fetchCollegeRosters(colleges) {
  console.log(`\nFetching college rosters for ${colleges.length} schools...`);

  const collegeLogos = JSON.parse(fs.readFileSync(COLLEGE_LOGOS_PATH, 'utf-8'));

  // Build a map: normalized college name → ESPN team ID
  const collegeTeamIds = {};
  for (const [name, data] of Object.entries(collegeLogos)) {
    collegeTeamIds[normalizeCollege(name)] = data.espnId;
  }

  const allPlayers = [];
  for (const college of colleges) {
    const normalized = normalizeCollege(college);
    const teamId = collegeTeamIds[normalized];
    if (!teamId) {
      console.warn(`  No ESPN team ID for college: "${college}" (normalized: "${normalized}")`);
      continue;
    }

    await sleep(DELAY);
    try {
      const data = await fetchJSON(`${COLLEGE_ROSTER_API}/${teamId}/roster`);

      // Roster API returns position groups: [{ position: "offense", items: [...] }, ...]
      const positionGroups = data.athletes || [];
      for (const group of positionGroups) {
        for (const athlete of group.items || []) {
          allPlayers.push({
            espnCollegeId: String(athlete.id),
            fullName: athlete.fullName || athlete.displayName || '',
            position: athlete.position?.abbreviation || '',
            college,
          });
        }
      }
    } catch (err) {
      console.warn(`  Warning: Failed to fetch roster for ${college} (teamId=${teamId}): ${err.message}`);
    }
  }

  console.log(`  Loaded ${allPlayers.length} college roster players`);
  return allPlayers;
}

// ---------------------------------------------------------------------------
// Step 4: Match MFL prospects to ESPN athletes
// ---------------------------------------------------------------------------
function matchProspects(mflProspects, draftProspects, collegeRosterPlayers) {
  console.log('\nMatching MFL prospects to ESPN athletes...');

  const matched = {};
  const unmatched = [];

  // Build lookup maps by normalized name
  const draftByName = new Map();
  for (const p of draftProspects) {
    const key = normalizeName(p.fullName);
    if (!draftByName.has(key)) draftByName.set(key, []);
    draftByName.get(key).push(p);
  }

  const rosterByName = new Map();
  for (const p of collegeRosterPlayers) {
    const key = normalizeName(p.fullName);
    if (!rosterByName.has(key)) rosterByName.set(key, []);
    rosterByName.get(key).push(p);
  }

  for (const mfl of mflProspects) {
    const mflName = normalizeName(mfl.name);
    const mflCollege = normalizeCollege(mfl.college);
    const mflPos = (mfl.position || '').toUpperCase();

    // Try draft prospects first (higher confidence)
    let espnMatch = findBestMatch(draftByName.get(mflName), mflCollege, mflPos);

    if (espnMatch) {
      // Convert MFL name "Last, First" → display name
      const [last, first] = mfl.name.split(',').map((s) => s.trim());
      matched[mfl.id] = {
        espnCollegeId: espnMatch.collegeAthleteId || espnMatch.espnCollegeId,
        name: `${first} ${last}`,
        college: mfl.college,
      };
      continue;
    }

    // Try college roster players
    espnMatch = findBestMatch(rosterByName.get(mflName), mflCollege, mflPos);

    if (espnMatch) {
      const [last, first] = mfl.name.split(',').map((s) => s.trim());
      matched[mfl.id] = {
        espnCollegeId: espnMatch.espnCollegeId,
        name: `${first} ${last}`,
        college: mfl.college,
      };
      continue;
    }

    unmatched.push({
      mflId: mfl.id,
      name: mfl.name,
      college: mfl.college || 'Unknown',
      position: mfl.position || 'Unknown',
    });
  }

  console.log(`  Matched: ${Object.keys(matched).length}`);
  console.log(`  Unmatched: ${unmatched.length}`);

  return { matched, unmatched };
}

/**
 * Pick the best match from a list of candidates using college and position as tiebreakers.
 */
function findBestMatch(candidates, mflCollege, mflPos) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Prefer same college
  const collegeMatches = candidates.filter(
    (c) => normalizeCollege(c.college) === mflCollege
  );
  if (collegeMatches.length === 1) return collegeMatches[0];
  if (collegeMatches.length > 1) {
    // Further tiebreak by position
    const posMatch = collegeMatches.find((c) => c.position?.toUpperCase() === mflPos);
    return posMatch || collegeMatches[0];
  }

  // No college match — try position
  const posMatch = candidates.find((c) => c.position?.toUpperCase() === mflPos);
  return posMatch || candidates[0];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`=== ESPN College ID Mapper (Draft Year: ${DRAFT_YEAR}) ===`);

  // Step 1: Load MFL prospects
  const mflProspects = loadMflProspects();
  if (mflProspects.length === 0) {
    console.log('\nNo unmatched prospects found. Nothing to do.');
    return;
  }

  // Step 2: Fetch ESPN draft prospects
  const draftProspects = await fetchDraftProspects();

  // Step 3: Do a first-pass match with draft prospects
  const { matched: firstPassMatched, unmatched: firstPassUnmatched } =
    matchProspects(mflProspects, draftProspects, []);

  // Step 4: For unmatched players, try college rosters
  const unmatchedColleges = [...new Set(firstPassUnmatched.map((p) => p.college).filter(Boolean))];

  let finalMatched = { ...firstPassMatched };
  let finalUnmatched = firstPassUnmatched;

  if (unmatchedColleges.length > 0) {
    const rosterPlayers = await fetchCollegeRosters(unmatchedColleges);

    // Re-match only the previously unmatched
    const unmatchedMfl = mflProspects.filter((p) => !firstPassMatched[p.id]);
    const secondPass = matchProspects(unmatchedMfl, [], rosterPlayers);

    finalMatched = { ...firstPassMatched, ...secondPass.matched };
    finalUnmatched = secondPass.unmatched;
  }

  // Step 5: Write output
  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      draftYear: DRAFT_YEAR,
      matchedCount: Object.keys(finalMatched).length,
      unmatchedCount: finalUnmatched.length,
    },
    players: finalMatched,
    unmatched: finalUnmatched,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`  Matched: ${output.meta.matchedCount}`);
  console.log(`  Unmatched: ${output.meta.unmatchedCount}`);

  if (finalUnmatched.length > 0) {
    console.log('\nUnmatched players:');
    for (const p of finalUnmatched) {
      console.log(`  ${p.name} (${p.position}) — ${p.college}`);
    }
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
