#!/usr/bin/env node

/**
 * Fetch Fantasy Points Allowed by Position from MFL
 *
 * Uses MFL's pointsAllowed endpoint, which returns season-total fantasy
 * points each NFL defense has allowed per position, scored using the
 * league's own scoring rules. We divide by games played to get per-game
 * averages, then rank all 32 teams for each position.
 *
 * Runs weekly via GitHub Actions (weekly-stats-sync.yml).
 *
 * Env variables:
 *   MFL_LEAGUE_ID (optional; used when --league is absent, defaults to the
 *                  registry's default league)
 *   MFL_YEAR      (optional, auto-detected from league calendar)
 *
 * Usage:
 *   node scripts/fetch-fantasy-points-allowed.mjs
 *   node scripts/fetch-fantasy-points-allowed.mjs --league=afl
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNonEmpty } from './lib/env.mjs';
import {
  DEFAULT_LEAGUE_ID,
  getLeagueById,
  getLeagueBySlug,
  DEFAULT_LEAGUE_SLUG,
  ALL_LEAGUES,
} from '../src/config/leagues-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const MFL_HOST = 'https://api.myfantasyleague.com';

/**
 * MFL → standard team code mapping.
 * The pointsAllowed endpoint returns MFL-style codes; the consumer
 * (weekly-player-results.ts) expects standard abbreviations.
 */
const MFL_TO_STANDARD = {
  KCC: 'KC',
  GBP: 'GB',
  NEP: 'NE',
  NOS: 'NO',
  SFO: 'SF',
  TBB: 'TB',
  LVR: 'LV',
  HST: 'HOU',
  BLT: 'BAL',
  CLV: 'CLE',
  ARZ: 'ARI',
};

function normalizeTeamCode(mflCode) {
  if (!mflCode) return '';
  const upper = mflCode.toUpperCase();
  return MFL_TO_STANDARD[upper] ?? upper;
}

/**
 * Calculate current season year (same logic as league-year.ts).
 * Before Labor Day → previous calendar year; after → current.
 */
function getCurrentSeasonYear() {
  const now = new Date();
  const year = now.getFullYear();
  // Labor Day = first Monday of September
  const sept1 = new Date(year, 8, 1);
  const dayOfWeek = sept1.getDay();
  const laborDayDate = dayOfWeek === 1 ? 1 : dayOfWeek === 0 ? 2 : 1 + (8 - dayOfWeek);
  const laborDay = new Date(year, 8, laborDayDate);
  return now >= laborDay ? year : year - 1;
}

/**
 * Determine how many regular-season weeks are complete by looking at
 * the weekly results data on disk. Each file that has matchup data
 * with player scores counts as a completed week.
 */
function getCompletedWeeks(year, leagueName) {
  const weeklyResultsPath = path.join(
    root,
    `data/${leagueName}/mfl-feeds/${year}/weekly-results-raw.json`
  );

  try {
    const raw = JSON.parse(fs.readFileSync(weeklyResultsPath, 'utf-8'));
    const weeks = Array.isArray(raw) ? raw : [];
    let completed = 0;

    for (const weekPayload of weeks) {
      const wr = weekPayload?.weeklyResults;
      if (!wr) continue;
      const weekNum = parseInt(wr.week, 10);
      if (isNaN(weekNum) || weekNum < 1 || weekNum > 18) continue;

      // Check if this week has actual scores (not all zeros / no players)
      const matchups = Array.isArray(wr.matchup)
        ? wr.matchup
        : wr.matchup ? [wr.matchup] : [];

      const hasScores = matchups.some((m) => {
        const franchises = Array.isArray(m.franchise)
          ? m.franchise
          : m.franchise ? [m.franchise] : [];
        return franchises.some((f) => {
          const players = Array.isArray(f.player)
            ? f.player
            : f.player ? [f.player] : [];
          return players.some((p) => parseFloat(p.score) > 0);
        });
      });

      if (hasScores && weekNum > completed) {
        completed = weekNum;
      }
    }

    return completed;
  } catch {
    // If no weekly results file, fall back to 17 (full season)
    return 17;
  }
}

/**
 * Fetch pointsAllowed from MFL API.
 * Returns the raw JSON response.
 */
async function fetchPointsAllowed(year, leagueId) {
  const url = `${MFL_HOST}/${year}/export?TYPE=pointsAllowed&L=${leagueId}&JSON=1`;
  console.log(`   URL: ${url}\n`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MFL API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Transform MFL pointsAllowed response into our FPA format.
 *
 * MFL returns season totals per team per position. We divide by
 * completed weeks to get per-game averages, then rank 1-32.
 *
 * Rank 1 = fewest points allowed (best defense vs that position).
 */
function transformPointsAllowed(mflData, completedWeeks) {
  const teams = mflData?.pointsAllowed?.team;
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error('No team data in pointsAllowed response');
  }

  const gamesPlayed = Math.max(completedWeeks, 1);
  const positionsWeTrack = new Set(['QB', 'RB', 'WR', 'TE', 'PK']);

  // Step 1: Parse season totals into per-game averages
  const teamAverages = {};

  for (const team of teams) {
    const code = normalizeTeamCode(team.id);
    if (!code) continue;

    const positions = Array.isArray(team.position)
      ? team.position
      : team.position ? [team.position] : [];

    const posData = {};
    for (const pos of positions) {
      const posName = (pos.name || '').toUpperCase();
      if (!positionsWeTrack.has(posName)) continue;

      const totalPoints = parseFloat(pos.points);
      if (isNaN(totalPoints)) continue;

      posData[posName] = {
        avg: +(totalPoints / gamesPlayed).toFixed(1),
      };
    }

    if (Object.keys(posData).length > 0) {
      teamAverages[code] = posData;
    }
  }

  // Step 2: Rank teams per position (1 = fewest pts allowed = best D)
  for (const pos of positionsWeTrack) {
    const sorted = Object.entries(teamAverages)
      .filter(([, data]) => data[pos] != null)
      .map(([teamCode, data]) => ({ teamCode, avg: data[pos].avg }))
      .sort((a, b) => a.avg - b.avg);

    sorted.forEach((item, index) => {
      teamAverages[item.teamCode][pos].rank = index + 1;
    });
  }

  return teamAverages;
}

/**
 * The league named by `--league=<slug>`, or null when the flag is absent.
 * `afl` is accepted for `afl-fantasy`, the same alias the other multi-league
 * scripts take. An unknown slug is fatal rather than a silent fall back to
 * TheLeague — writing one league's numbers into another league's directory is
 * exactly the failure this flag exists to prevent.
 */
function resolveLeagueArg() {
  const arg = process.argv.find((a) => a.startsWith('--league='))?.slice('--league='.length);
  if (!arg) return null;
  const league = getLeagueBySlug(arg === 'afl' ? 'afl-fantasy' : arg);
  if (!league) {
    console.error(
      `Unknown --league=${arg}. Known: ${ALL_LEAGUES.map((l) => l.slug).join(', ')} (or the alias 'afl').`,
    );
    process.exit(1);
  }
  return league;
}

async function main() {
  console.log('═'.repeat(50));
  console.log('  Fantasy Points Allowed (MFL)');
  console.log('═'.repeat(50));
  console.log('');

  // `--league=<slug>` resolves the id THROUGH THE REGISTRY, so a caller that
  // wants the AFL's file never has to name '19621'. That matters because the
  // caller is a GitHub workflow, and workflow YAML cannot import
  // leagues-data.mjs — the alternative is a hardcoded id in the YAML plus an
  // exemption in tests/league-literal-guard.test.ts.
  //
  // AN EXPLICIT FLAG BEATS AMBIENT ENV. The per-league loop in
  // weekly-stats-sync.yml asks for a specific league by name, and if
  // MFL_LEAGUE_ID happened to be set in the environment it would answer both
  // iterations with the same league: TheLeague's file written twice, the AFL's
  // never created, exit 0 and a green check over a job that did half its work.
  // MFL_LEAGUE_ID still drives the script on its own, for anyone invoking it
  // by env the old way.
  const league = resolveLeagueArg();
  const leagueId = league?.id || getNonEmpty(process.env.MFL_LEAGUE_ID) || DEFAULT_LEAGUE_ID;
  const year = getNonEmpty(process.env.MFL_YEAR) || String(getCurrentSeasonYear());
  const leagueName = getLeagueById(leagueId)?.slug ?? DEFAULT_LEAGUE_SLUG;

  console.log(`   League: ${leagueName} (${leagueId})`);
  console.log(`   Year:   ${year}`);

  const completedWeeks = getCompletedWeeks(year, leagueName);
  console.log(`   Weeks:  ${completedWeeks} completed\n`);

  try {
    console.log('Fetching pointsAllowed from MFL...');
    const mflData = await fetchPointsAllowed(year, leagueId);

    const fantasyPointsAllowed = transformPointsAllowed(mflData, completedWeeks);
    const teamCount = Object.keys(fantasyPointsAllowed).length;

    if (teamCount < 30) {
      console.error(`Only got ${teamCount} teams — expected 32. Aborting.`);
      process.exit(1);
    }

    // Print a sample
    console.log(`\n   Parsed ${teamCount} teams. Sample:\n`);
    const sample = Object.entries(fantasyPointsAllowed).slice(0, 5);
    for (const [team, positions] of sample) {
      const qb = positions.QB ? `QB #${positions.QB.rank} (${positions.QB.avg})` : 'QB n/a';
      const rb = positions.RB ? `RB #${positions.RB.rank} (${positions.RB.avg})` : 'RB n/a';
      const wr = positions.WR ? `WR #${positions.WR.rank} (${positions.WR.avg})` : 'WR n/a';
      console.log(`   ${team.padEnd(4)} ${qb.padEnd(18)} ${rb.padEnd(18)} ${wr}`);
    }
    console.log('   ...\n');

    // Write output
    const outputDir = path.join(root, `data/${leagueName}/mfl-feeds/${year}`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = path.join(outputDir, 'fantasyPointsAllowed.json');
    const output = {
      fantasyPointsAllowed,
      completedWeeks,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`Saved to ${outputFile}`);
    console.log('Fantasy points allowed data updated!\n');

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
