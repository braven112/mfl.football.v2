#!/usr/bin/env node
/**
 * Schedule Strength ("The Gauntlet") — weekly derived data for both leagues.
 *
 * For each franchise, computes remaining-schedule and past-schedule difficulty
 * from opponent strength (shared composite in scripts/lib/team-strength.mjs:
 * 50% season ppg + 25% all-play + 25% rolling-3wk form), plus the week-by-week
 * heat map, schedule-luck gaps, and trap weeks. Writes
 * data/<league>/derived/schedule-strength-<year>-w<NN>.json — the single
 * source of truth for the dashboard pages AND the weekly Schefter article.
 *
 * Usage:
 *   node scripts/compute-schedule-strength.mjs                    # both leagues, current season/week
 *   node scripts/compute-schedule-strength.mjs --league theleague
 *   node scripts/compute-schedule-strength.mjs --league afl-fantasy --year 2023 --week 8
 *   node scripts/compute-schedule-strength.mjs --dry-run
 *
 * "Week N" = the upcoming week (last completed week + 1). Past difficulty is
 * computed over completed weeks; remaining difficulty over scheduled weeks
 * >= N. Trends diff against the most recent earlier week's file BEFORE the
 * new write; superseded weekly files are then pruned so exactly one file per
 * year survives (the dashboards eager-glob this directory).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { getSeasonYear, getCompletedWeek } from './article-utils/week-resolver.mjs';
import {
  computeTeamStrengths,
  difficultyStep,
  buildOpponentGrid,
} from './lib/team-strength.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const LEAGUE_CONFIG_PATHS = {
  theleague: 'src/data/theleague.config.json',
  'afl-fantasy': 'data/afl-fantasy/afl.config.json',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { league: null, year: null, week: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--league': opts.league = args[++i]; break;
      case '--year': opts.year = parseInt(args[++i], 10); break;
      case '--week': opts.week = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  if (opts.league && !LEAGUE_CONFIG_PATHS[opts.league]) {
    console.error(`Unknown --league ${opts.league} (expected: ${Object.keys(LEAGUE_CONFIG_PATHS).join(' | ')})`);
    process.exit(1);
  }
  return opts;
}

async function loadJSON(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function tryLoadJSON(p) {
  try { return await loadJSON(p); } catch { return null; }
}

const num = (v, f = 0) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : f; };
const int = (v, f = 0) => { const n = typeof v === 'number' ? v : parseInt(v, 10); return Number.isFinite(n) ? n : f; };

function derivedPath(league, year, week) {
  return path.join(projectRoot, league.dataPath, 'derived',
    `schedule-strength-${year}-w${String(week).padStart(2, '0')}.json`);
}

/** Most recent earlier week's derived file for trend deltas. */
async function loadPreviousWeek(league, year, week) {
  for (let w = week - 1; w >= 1; w--) {
    const prior = await tryLoadJSON(derivedPath(league, year, w));
    if (prior?.runIn?.length) return prior;
  }
  return null;
}

/** W-L-T record over completed weeks from the opponent grid + weekly scores. */
function computeRecord(grid, weeklyResults, fid, throughWeek) {
  const scoresByWeek = new Map();
  for (const w of (weeklyResults?.weeks || [])) scoresByWeek.set(int(w.week), w.scores || {});
  let wins = 0, losses = 0, ties = 0;
  const opps = grid.get(fid);
  if (!opps) return { wins, losses, ties };
  for (const [wk, oppId] of opps) {
    if (wk > throughWeek) continue;
    const scores = scoresByWeek.get(wk);
    const mine = num(scores?.[fid], NaN);
    const theirs = num(scores?.[oppId], NaN);
    if (!Number.isFinite(mine) || !Number.isFinite(theirs)) continue;
    if (mine > theirs) wins++;
    else if (mine < theirs) losses++;
    else ties++;
  }
  return { wins, losses, ties };
}

export function computeScheduleStrength({ leagueSlug, teams, schedule, standings, weeklyResults, week, year }) {
  const completedWeek = week - 1;
  const franchiseIds = teams.map(t => t.franchiseId);
  const standingsByFid = new Map(
    (standings?.leagueStandings?.franchise || []).map(f => [f.id, f])
  );

  const strengths = computeTeamStrengths({
    franchiseIds,
    standingsByFid,
    weeklyResults,
    throughWeek: completedWeek,
  });

  const grid = buildOpponentGrid(schedule);
  const allWeeks = [...new Set(
    (schedule?.schedule?.weeklySchedule || []).map(w => int(w.week))
  )].sort((a, b) => a - b);
  const remainingWeeks = allWeeks.filter(w => w >= week);
  const playedWeeks = allWeeks.filter(w => w < week);

  const nameByFid = new Map(teams.map(t => [t.franchiseId, t.name]));
  const abbrevByFid = new Map(teams.map(t => [t.franchiseId, t.abbrev ?? t.name]));

  const perTeam = franchiseIds.map(fid => {
    const opps = grid.get(fid) ?? new Map();
    const oppFor = weeks => weeks.map(w => opps.get(w)).filter(Boolean);

    const avgOver = weeks => {
      const vals = oppFor(weeks).map(id => strengths.get(id)?.strength).filter(Number.isFinite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const avgPpgOver = weeks => {
      const vals = oppFor(weeks).map(id => strengths.get(id)?.seasonPpg).filter(Number.isFinite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const remaining = avgOver(remainingWeeks);
    const past = avgOver(playedWeeks);
    const record = computeRecord(grid, weeklyResults, fid, completedWeek);

    return {
      franchiseId: fid,
      name: nameByFid.get(fid) ?? fid,
      remainingDifficulty: remaining != null ? Math.round(remaining) : null,
      remainingOppPpg: avgPpgOver(remainingWeeks),
      pastDifficulty: past != null ? Math.round(past) : null,
      pastOppPpg: avgPpgOver(playedWeeks),
      record,
      cells: remainingWeeks.map(w => {
        const oppId = opps.get(w) ?? null;
        if (!oppId) return { week: w, bye: true, oppId: null, difficulty: null, step: 0 };
        const difficulty = strengths.get(oppId)?.strength ?? null;
        return {
          week: w,
          bye: false,
          oppId,
          oppAbbrev: abbrevByFid.get(oppId) ?? oppId,
          difficulty,
          step: difficultyStep(difficulty),
        };
      }),
    };
  });

  // Run-in ranking — hardest first.
  const runIn = perTeam
    .filter(t => t.remainingDifficulty != null)
    .sort((a, b) => b.remainingDifficulty - a.remainingDifficulty)
    .map((t, i) => ({
      rank: i + 1,
      franchiseId: t.franchiseId,
      name: t.name,
      remainingOppPpg: t.remainingOppPpg != null ? Math.round(t.remainingOppPpg * 10) / 10 : null,
      difficulty: t.remainingDifficulty,
      step: difficultyStep(t.remainingDifficulty),
      prevRank: null,
      trendDeltaRanks: null,
    }));

  // Past ranking — hardest first.
  const played = perTeam
    .filter(t => t.pastDifficulty != null)
    .sort((a, b) => b.pastDifficulty - a.pastDifficulty)
    .map((t, i) => ({
      rank: i + 1,
      franchiseId: t.franchiseId,
      name: t.name,
      pastOppPpg: t.pastOppPpg != null ? Math.round(t.pastOppPpg * 10) / 10 : null,
      difficulty: t.pastDifficulty,
      step: difficultyStep(t.pastDifficulty),
      record: `${t.record.wins}-${t.record.losses}${t.record.ties ? `-${t.record.ties}` : ''}`,
    }));

  // Schedule luck — biggest gaps between win% and past schedule difficulty.
  // Positive gap = harder schedule than the record shows (unlucky).
  const scheduleLuck = perTeam
    .filter(t => t.pastDifficulty != null)
    .map(t => {
      const games = t.record.wins + t.record.losses + t.record.ties;
      const winPct = games > 0 ? (t.record.wins + t.record.ties / 2) / games : 0.5;
      const gap = Math.round(t.pastDifficulty - winPct * 100);
      return {
        franchiseId: t.franchiseId,
        name: t.name,
        record: `${t.record.wins}-${t.record.losses}${t.record.ties ? `-${t.record.ties}` : ''}`,
        pastDifficulty: t.pastDifficulty,
        gap,
        direction: gap >= 0 ? 'unlucky' : 'lucky',
      };
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 3);

  // Trap weeks — league-average opponent difficulty per remaining week.
  const trapWeeks = remainingWeeks.map(w => {
    const vals = perTeam
      .map(t => t.cells.find(c => c.week === w))
      .filter(c => c && !c.bye && Number.isFinite(c.difficulty))
      .map(c => c.difficulty);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return { week: w, avgDifficulty: avg, step: difficultyStep(avg) };
  });

  return {
    league: leagueSlug,
    year,
    week,
    generatedAt: new Date().toISOString(),
    columnName: 'The Gauntlet',
    weeks: remainingWeeks,
    runIn,
    played,
    scheduleLuck,
    heatMap: {
      weeks: remainingWeeks,
      franchises: perTeam.map(t => ({
        franchiseId: t.franchiseId,
        name: t.name,
        cells: t.cells,
      })),
    },
    trapWeeks,
  };
}

export function attachTrends(result, previous) {
  if (!previous?.runIn?.length) return result;
  const prevRankByFid = new Map(previous.runIn.map(r => [r.franchiseId, r.rank]));
  for (const row of result.runIn) {
    const prev = prevRankByFid.get(row.franchiseId) ?? null;
    row.prevRank = prev;
    // Positive delta = moved UP the hardest-first board (schedule got harder).
    row.trendDeltaRanks = prev != null ? prev - row.rank : null;
  }
  return result;
}

async function runLeague(slug, opts) {
  const league = LEAGUES[slug];
  const configPath = path.join(projectRoot, LEAGUE_CONFIG_PATHS[slug]);
  const config = await loadJSON(configPath);
  const year = opts.year ?? getSeasonYear();
  const feedDir = path.join(projectRoot, league.dataPath, 'mfl-feeds', String(year));

  const [schedule, standings, weeklyResults] = await Promise.all([
    tryLoadJSON(path.join(feedDir, 'schedule.json')),
    tryLoadJSON(path.join(feedDir, 'standings.json')),
    tryLoadJSON(path.join(feedDir, 'weekly-results.json')),
  ]);

  if (!schedule?.schedule?.weeklySchedule?.length) {
    console.log(`  [${slug}] no schedule.json for ${year} — skipping (feed sync will backfill).`);
    return null;
  }

  const completedWeek = getCompletedWeek(weeklyResults ?? { weeks: [] }, config.teams.length);
  if (completedWeek < 1 && opts.week == null) {
    console.log(`  [${slug}] no completed weeks for ${year} — skipping until the season starts.`);
    return null;
  }
  // Past seasons are final: point "week" past the last scheduled week so the
  // run-in is empty (weekly-results can trail the schedule — e.g. playoff
  // pairings exist in schedule.json without recorded weekly results).
  const maxScheduleWeek = Math.max(
    ...schedule.schedule.weeklySchedule.map(w => int(w.week))
  );
  const isPastSeason = year < getSeasonYear();
  const week = opts.week ?? (isPastSeason ? maxScheduleWeek + 1 : completedWeek + 1);

  const result = computeScheduleStrength({
    leagueSlug: slug,
    teams: config.teams,
    schedule,
    standings,
    weeklyResults: weeklyResults ?? { weeks: [] },
    week,
    year,
  });

  const previous = await loadPreviousWeek(league, year, week);
  attachTrends(result, previous);

  const outPath = derivedPath(league, year, week);
  if (opts.dryRun) {
    console.log(`  [${slug}] dry-run — would write ${path.relative(projectRoot, outPath)}`);
    console.log(`    hardest run-in: ${result.runIn[0]?.name} (${result.runIn[0]?.difficulty})`);
    console.log(`    easiest run-in: ${result.runIn.at(-1)?.name} (${result.runIn.at(-1)?.difficulty})`);
    return result;
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`  [${slug}] wrote ${path.relative(projectRoot, outPath)} (week ${week}, ${result.runIn.length} teams)`);

  // Prune superseded weekly files for this year. Trends were already attached
  // above from the prior week's file, and next week's run only needs THIS
  // file — so one file per year is all that ever needs to exist. Without
  // pruning, the dashboards' eager import.meta.glob bundles every historical
  // weekly snapshot (17/season/league) into the server chunk forever.
  const derivedDir = path.dirname(outPath);
  const keep = path.basename(outPath);
  for (const f of await fs.readdir(derivedDir)) {
    if (f.startsWith(`schedule-strength-${year}-w`) && f !== keep) {
      await fs.unlink(path.join(derivedDir, f));
      console.log(`  [${slug}] pruned superseded ${f}`);
    }
  }
  return result;
}

async function main() {
  const opts = parseArgs();
  const slugs = opts.league ? [opts.league] : Object.keys(LEAGUE_CONFIG_PATHS);
  console.log(`\n🏈 Schedule strength (The Gauntlet) — ${slugs.join(', ')}\n`);
  for (const slug of slugs) {
    await runLeague(slug, opts);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
