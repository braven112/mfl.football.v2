#!/usr/bin/env node
/**
 * Build League History
 *
 * Extracts historical season data from raw MFL standings files and populates
 * data/theleague/league-history.json with the factual skeleton (records, PF stats).
 *
 * Manually curated fields (lore[], notableEvents[], notableTrades[], awards[], champion
 * details like firstChampionship, summary, playoff participants) are PRESERVED from
 * the existing file and never overwritten.
 *
 * Champion is estimated from standings (highest wins → highest PF as tiebreaker).
 * Entries marked with _estimated: true should be manually verified.
 *
 * Run:   node scripts/build-league-history.mjs
 * Output: data/theleague/league-history.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const HISTORY_PATH = path.join(projectRoot, 'data', 'theleague', 'league-history.json');
const CONFIG_PATH = path.join(projectRoot, 'src', 'data', 'theleague.config.json');
const FEEDS_DIR = path.join(projectRoot, 'data', 'theleague', 'mfl-feeds');

const FIRST_YEAR = 2007;
const CURRENT_YEAR = new Date().getFullYear();

// ── Team name resolution ──────────────────────────────────────────────────────

/** Returns the period-correct team name for a given franchiseId and year */
function getTeamName(config, franchiseId, year) {
  const team = config.teams.find(t => t.franchiseId === franchiseId);
  if (!team) return franchiseId;

  // Check historical names first
  if (team.history) {
    const historical = team.history.find(
      h => year >= (h.yearStart ?? 0) && year <= (h.yearEnd ?? 9999)
    );
    if (historical?.name) return historical.name;
  }

  return team.name;
}

// ── Standings extraction ──────────────────────────────────────────────────────

/** Parse W-L-T string and return wins as integer */
function parseWins(wlt) {
  if (!wlt) return 0;
  const parts = wlt.split('-');
  return parseInt(parts[0], 10) || 0;
}

/** Parse W-L-T string and return losses as integer */
function parseLosses(wlt) {
  if (!wlt) return 0;
  const parts = wlt.split('-');
  return parseInt(parts[1], 10) || 0;
}

/**
 * Build a season entry from a standings file.
 * Preserves any manually curated fields from the existing entry.
 */
function buildSeasonFromStandings(franchises, year, config, existingSeason) {
  // Sort by wins desc, then PF desc as tiebreaker
  const sorted = [...franchises].sort((a, b) => {
    // Modern years have vp (victory points including playoffs) — most reliable
    if (a.vp != null && b.vp != null) {
      const diff = parseInt(b.vp, 10) - parseInt(a.vp, 10);
      if (diff !== 0) return diff;
    }
    // Fall back to regular season wins
    const winDiff = parseWins(b.h2hwlt) - parseWins(a.h2hwlt);
    if (winDiff !== 0) return winDiff;
    // Then by PF
    return parseFloat(b.pf || 0) - parseFloat(a.pf || 0);
  });

  const bestTeam = sorted[0];
  const worstTeam = sorted[sorted.length - 1];

  // Most/least points (by season total PF)
  const byPF = [...franchises].sort(
    (a, b) => parseFloat(b.pf || 0) - parseFloat(a.pf || 0)
  );
  const mostPF = byPF[0];
  const leastPF = byPF[byPF.length - 1];

  // Build regularSeason block
  const regularSeason = {
    bestRecord: {
      franchiseId: bestTeam.id,
      teamName: getTeamName(config, bestTeam.id, year),
      record: bestTeam.h2hwlt || `${bestTeam.h2hw ?? '?'}-${bestTeam.h2hl ?? '?'}-0`,
      pf: parseFloat(bestTeam.pf || 0),
    },
    worstRecord: {
      franchiseId: worstTeam.id,
      teamName: getTeamName(config, worstTeam.id, year),
      record: worstTeam.h2hwlt || `${worstTeam.h2hw ?? '?'}-${worstTeam.h2hl ?? '?'}-0`,
      pf: parseFloat(worstTeam.pf || 0),
    },
    mostPointsScored: {
      franchiseId: mostPF.id,
      teamName: getTeamName(config, mostPF.id, year),
      pf: parseFloat(mostPF.pf || 0),
    },
    leastPointsScored: {
      franchiseId: leastPF.id,
      teamName: getTeamName(config, leastPF.id, year),
      pf: parseFloat(leastPF.pf || 0),
    },
  };

  // High/low single week scores (only available in modern standings)
  const withMaxPF = franchises.filter(f => f.maxpf != null);
  if (withMaxPF.length > 0) {
    const highestWeek = withMaxPF.reduce((best, f) =>
      parseFloat(f.maxpf) > parseFloat(best.maxpf || 0) ? f : best
    );
    regularSeason.highestSingleWeek = {
      franchiseId: highestWeek.id,
      teamName: getTeamName(config, highestWeek.id, year),
      score: parseFloat(highestWeek.maxpf),
    };

    const lowestWeek = withMaxPF.reduce((worst, f) =>
      parseFloat(f.minpf) < parseFloat(worst.minpf || 999) ? f : worst
    );
    regularSeason.lowestSingleWeek = {
      franchiseId: lowestWeek.id,
      teamName: getTeamName(config, lowestWeek.id, year),
      score: parseFloat(lowestWeek.minpf),
    };
  }

  // Preserve manually curated biggestUpset if it exists
  if (existingSeason?.regularSeason?.biggestUpset) {
    regularSeason.biggestUpset = existingSeason.regularSeason.biggestUpset;
  }

  // Champion: use existing curated data if present, else estimate from standings
  let champion;
  if (existingSeason?.champion && !existingSeason.champion._estimated) {
    // Manually curated — preserve it exactly
    champion = existingSeason.champion;
  } else {
    const useVP = franchises.some(f => f.vp != null);
    champion = {
      franchiseId: bestTeam.id,
      teamName: getTeamName(config, bestTeam.id, year),
      record: bestTeam.h2hwlt || `${bestTeam.h2hw ?? '?'}-${bestTeam.h2hl ?? '?'}-0`,
      // Preserve manually set fields from prior estimated entry
      ...(existingSeason?.champion?.firstChampionship != null
        ? { firstChampionship: existingSeason.champion.firstChampionship }
        : {}),
      ...(existingSeason?.champion?.note ? { note: existingSeason.champion.note } : {}),
      _estimated: true,
      _estimatedBy: useVP
        ? 'highest vp (victory points, includes playoff wins)'
        : 'highest regular season wins + PF — verify against actual playoff results',
    };
  }

  return {
    year,
    summary: existingSeason?.summary ?? '',
    champion,
    playoffs: existingSeason?.playoffs ?? { participants: [], _note: 'Needs manual curation' },
    toiletBowl: existingSeason?.toiletBowl ?? null,
    regularSeason,
    awards: existingSeason?.awards ?? [],
    notableTrades: existingSeason?.notableTrades ?? [],
    notableEvents: existingSeason?.notableEvents ?? [],
    lore: existingSeason?.lore ?? [],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load config
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));

  // Load existing history (to preserve curated fields)
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
  } catch {
    existing = { meta: {}, seasons: [] };
  }

  const existingByYear = Object.fromEntries(
    (existing.seasons ?? []).map(s => [s.year, s])
  );

  const years = Array.from(
    { length: CURRENT_YEAR - FIRST_YEAR + 1 },
    (_, i) => FIRST_YEAR + i
  );

  const seasons = [];
  let extracted = 0;
  let skipped = 0;

  for (const year of years) {
    const standingsPath = path.join(FEEDS_DIR, String(year), 'standings.json');

    let standings;
    try {
      standings = JSON.parse(await fs.readFile(standingsPath, 'utf8'));
    } catch {
      // No standings file for this year — include stub if we have curated data
      const existingSeason = existingByYear[year];
      if (existingSeason) {
        seasons.push(existingSeason);
        console.log(`  ${year}: using existing curated entry (no standings file)`);
      } else {
        console.log(`  ${year}: skipped (no standings file)`);
        skipped++;
      }
      continue;
    }

    const franchises = standings?.leagueStandings?.franchise;
    if (!Array.isArray(franchises) || franchises.length === 0) {
      console.log(`  ${year}: skipped (no franchise data in standings)`);
      skipped++;
      continue;
    }

    const existingSeason = existingByYear[year];
    const season = buildSeasonFromStandings(franchises, year, config, existingSeason);
    seasons.push(season);
    extracted++;

    const champName = season.champion.teamName;
    const flag = season.champion._estimated ? ' (est.)' : ' ✓';
    console.log(`  ${year}: champion=${champName}${flag}, teams=${franchises.length}`);
  }

  // Sort newest first
  seasons.sort((a, b) => b.year - a.year);

  const output = {
    meta: {
      leagueId: 13522,
      leagueName: 'TheLeague',
      founded: 2007,
      lastUpdated: new Date().toISOString().split('T')[0],
      dataVersion: '1.0',
      generatedBy: 'scripts/build-league-history.mjs',
      notes: [
        'Auto-generated from raw MFL standings data.',
        'champion fields marked with _estimated:true are heuristic (best regular season record).',
        'Modern years (where vp field is present) use victory points which include playoff wins.',
        'lore[], notableEvents[], notableTrades[], awards[] require manual curation.',
        'Run: node scripts/build-league-history.mjs to regenerate.',
      ].join(' '),
      schemaDoc: 'data/theleague/league-history/README.md',
    },
    seasons,
  };

  await fs.writeFile(HISTORY_PATH, JSON.stringify(output, null, 2));

  console.log('');
  console.log(`Built league-history.json:`);
  console.log(`  ${extracted} seasons extracted from standings`);
  console.log(`  ${skipped} years skipped (no data)`);
  console.log(`  ${seasons.length} total seasons in file`);
  console.log(`  Output: ${HISTORY_PATH}`);
}

main().catch(err => {
  console.error('Error building league history:', err);
  process.exit(1);
});
