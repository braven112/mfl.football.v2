#!/usr/bin/env node
/**
 * Remind the league admins about every NFL game played on a Wednesday.
 *
 * Runs inside the Schedule Release workflow, right after the NFL calendar is
 * refreshed, so a reminder lands the day the NFL publishes its schedule (mid-May)
 * — and again for any Wednesday game the NFL adds or moves later (a flex, a
 * holiday shift). See src/utils/nfl-wednesday-games.mjs for why it matters.
 *
 * WHO HEARS: each league whose MFL calendar runs waivers on a Wednesday, read
 * from the league's own synced calendar feed (never a hardcoded list), pushed
 * to that league's admins under `ops-league-setup`. Moving the run is a hand
 * edit on MFL only an admin can make, so the group chat never hears about it.
 *
 * ONCE PER GAME: data/nfl/wednesday-games.json records every Wednesday game
 * seen per season. A game is pushed only the first time it appears, and only
 * while it is still ahead. The file is written only after the push went out,
 * so a failed send is retried by the next daily run instead of being lost.
 *
 * Env:
 *   CRON_SECRET   required to push; unset logs and exits 1 (nothing recorded)
 *
 * Usage:
 *   node scripts/check-nfl-wednesday-games.mjs              # last, this and next season
 *   node scripts/check-nfl-wednesday-games.mjs --dry-run    # report only, never pushes or writes
 *   node scripts/check-nfl-wednesday-games.mjs --year=2026
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, isFullManagementLeague } from '../src/config/leagues-data.mjs';
import {
  findWednesdayGames,
  newUpcomingGames,
  runsWaiversOnWednesday,
  teamNickname,
  usualWednesdayRunTime,
  waiverRuns,
  waiverStatusOn,
} from '../src/utils/nfl-wednesday-games.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { adminFranchiseIds, sendOpsAlert } from './lib/ops-alert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'data/nfl/wednesday-games.json');
const API = 'https://api.myfantasyleague.com';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const yearArg = argv.find((a) => a.startsWith('--year='))?.slice('--year='.length);
const thisYear = new Date().getFullYear();
// Last season too: in January its final week is still ahead.
const SEASONS = yearArg ? [Number(yearArg)] : [thisYear - 1, thisYear, thisYear + 1];

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const brandTeams = readJson(path.join(ROOT, 'src/data/nfl-brand-kit.json'), {}).teams ?? {};

/** MFL's full NFL schedule for a season, or null while it is unpublished. */
async function fetchSchedule(year) {
  const res = await fetch(`${API}/${year}/export?TYPE=nflSchedule&W=ALL&JSON=1`, {
    headers: { 'User-Agent': 'mfl.football NFL Wednesday games' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${year}: HTTP ${res.status}`);
  let json;
  try {
    json = JSON.parse(await res.text());
  } catch {
    return null; // MFL serves an HTML 404 body for unpublished seasons
  }
  if (json?.error) throw new Error(`${year}: MFL error — ${json.error?.$t ?? json.error}`);
  const weeks = json?.fullNflSchedule?.nflSchedule;
  return Array.isArray(weeks) && weeks.length ? weeks : null;
}

/**
 * A league's synced MFL calendar for `year`, plus its most recent one as the
 * fallback for "which day does this league usually run waivers" — the next
 * season's calendar is often still empty when the NFL schedule lands.
 */
function leagueCalendars(league, year) {
  const dir = path.join(ROOT, league.dataPath, 'mfl-feeds');
  const years = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => a - b)
    : [];
  const read = (y) => {
    const data = readJson(path.join(dir, String(y), 'calendar.json'), null);
    return Array.isArray(data) ? data : [].concat(data?.calendar?.event ?? []);
  };
  const latestWithRuns = [...years].reverse().map(read).find((ev) => waiverRuns(ev).some((r) => r.recurring)) ?? [];
  return { season: years.includes(year) ? read(year) : [], latest: latestWithRuns };
}

const describeGame = (g) =>
  `Week ${g.week}: ${teamNickname(g.away, brandTeams)} at ${teamNickname(g.home, brandTeams)}, ${g.label}, ${g.time} PT`;

const state = readJson(STATE, {});
const nextState = { ...state };
const newBySeason = new Map();

for (const year of SEASONS) {
  let weeks;
  try {
    weeks = await fetchSchedule(year);
  } catch (err) {
    // Not fatal: tomorrow's run asks again, and nothing is recorded for it.
    console.error(`  ${year}: ${err.message} — skipping`);
    continue;
  }
  if (!weeks) {
    console.log(`  ${year}: NFL schedule not published yet`);
    continue;
  }
  const games = findWednesdayGames(weeks);
  console.log(`  ${year}: ${games.length} Wednesday game(s)${games.length ? '' : ' — nothing to move'}`);
  for (const g of games) console.log(`      ${describeGame(g)}`);
  const fresh = newUpcomingGames(state[year], games);
  if (fresh.length) newBySeason.set(year, fresh);
  nextState[year] = games;
}

// League by league: who runs waivers on a Wednesday, and what each new game hits.
const alerts = [];
for (const league of ALL_LEAGUES.filter(isFullManagementLeague)) {
  const lines = [];
  for (const [year, games] of newBySeason) {
    const { season, latest } = leagueCalendars(league, year);
    if (!runsWaiversOnWednesday(season) && !runsWaiversOnWednesday(latest)) continue;
    for (const g of games) {
      const { status, time } = waiverStatusOn(season, g.date);
      if (status === 'moved') {
        console.log(`  ${league.slug}: ${g.date} already has no waiver run — skipping`);
        continue;
      }
      const runTime = time ?? usualWednesdayRunTime(latest);
      const when = status === 'conflict' ? `waivers run ${runTime} PT that day` : `usual waiver run is Wed${runTime ? ` ${runTime} PT` : ''}`;
      lines.push(`${describeGame(g)} (${when})`);
    }
  }
  if (!lines.length) continue;
  if (!adminFranchiseIds(league).length) {
    console.warn(`  ${league.slug}: runs Wednesday waivers but has no admin franchises — nobody to remind`);
    continue;
  }
  alerts.push({ league, lines });
}

const summary = [];
let failed = false;
for (const { league, lines } of alerts) {
  const count = lines.length;
  const title = count === 1 ? 'NFL game on a Wednesday' : `${count} NFL games on a Wednesday`;
  const body = `${lines.join('\n')}\nMove ${league.name}'s waiver run on MFL so it processes before kickoff.`;
  console.log(`\n[${league.slug}] ${title}\n${body}`);
  summary.push(`### ${league.name}: ${title}`, '', ...lines.map((l) => `- ${l}`), '');
  const result = await sendOpsAlert({
    league,
    category: 'ops-league-setup',
    title,
    body,
    tag: `ops-nfl-wednesday-${[...newBySeason.keys()].join('-')}`,
    dryRun: DRY_RUN,
  });
  if (result?.skipped && !DRY_RUN) {
    console.error(`  ${league.slug}: reminder NOT delivered (${result.skipped})`);
    failed = true;
  }
}

if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Wednesday NFL games\n\n${summary.join('\n')}\n`);
}

if (DRY_RUN) {
  console.log('\n[dry-run] state file not written.');
} else if (failed) {
  // Leave the state alone so tomorrow's run sends it again.
  console.error('\nA reminder was not delivered — state not recorded, failing so the run is visible.');
} else {
  const sorted = Object.fromEntries(Object.keys(nextState).sort().map((k) => [k, nextState[k]]));
  // Canonical write: a run that found nothing new commits nothing.
  if (writeJsonIfChanged(STATE, sorted)) console.log(`\nWrote ${path.relative(ROOT, STATE)}`);
}

process.exit(failed ? 1 : 0);
