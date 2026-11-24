#!/usr/bin/env node
/**
 * Remind the league admins about every NFL game played on a Wednesday.
 *
 * Runs inside the Schedule Release workflow, right after the NFL calendar is
 * refreshed, so a reminder lands the day the NFL publishes its schedule (mid-May)
 * — and again for any Wednesday game the NFL adds or moves later (a flex, a
 * holiday shift). See src/utils/nfl-wednesday-games.mjs for why it matters.
 *
 * HOW IT REMINDS: one GitHub issue per Wednesday game, assigned to the repo
 * owner, so GitHub emails him and it stays open until he closes it. Not a push:
 * the owner ruled that out (2026-11-23) as too easy to miss. The issue lists
 * each league whose MFL calendar runs waivers that Wednesday, read from the
 * league's own synced calendar feed (never a hardcoded list), skipping leagues
 * with no admin here. Moving the run is a hand edit on MFL.
 *
 * ONCE PER GAME: data/nfl/wednesday-games.json records every Wednesday game
 * seen per season. An issue is filed only the first time a game appears, and
 * only while it is still ahead. The file is written only after the issue was
 * filed, so a failure is retried by the next daily run instead of being lost.
 *
 * Env (set by the workflow):
 *   GITHUB_TOKEN, GITHUB_REPOSITORY   required to file; unset fails the run
 *   ISSUE_ASSIGNEE                    who the issue is assigned to
 *
 * Usage:
 *   node scripts/check-nfl-wednesday-games.mjs              # last, this and next season
 *   node scripts/check-nfl-wednesday-games.mjs --dry-run    # report only, never files or writes
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
import { adminFranchiseIds } from './lib/ops-alert.mjs';

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

// Game by game: which leagues run waivers that Wednesday, and when.
const issues = [];
for (const [year, games] of newBySeason) {
  for (const g of games) {
    const leagues = [];
    for (const league of ALL_LEAGUES.filter(isFullManagementLeague)) {
      const { season, latest } = leagueCalendars(league, year);
      if (!runsWaiversOnWednesday(season) && !runsWaiversOnWednesday(latest)) continue;
      const { status, time } = waiverStatusOn(season, g.date);
      if (status === 'moved') {
        console.log(`  ${league.slug}: ${g.date} already has no waiver run — skipping`);
        continue;
      }
      // Leagues with no admin are someone else's to run (Archie's): skip them.
      if (!adminFranchiseIds(league).length) {
        console.log(`  ${league.slug}: runs Wednesday waivers but has no admin here — not ours to move`);
        continue;
      }
      const runTime = time ?? usualWednesdayRunTime(latest);
      const when = status === 'conflict'
        ? `waivers run at ${runTime} PT that day`
        : `waivers usually run Wednesday${runTime ? ` at ${runTime} PT` : ''} (that week isn't on MFL's calendar yet)`;
      leagues.push(`- **${league.name}**: ${when}. [MFL league home](https://${league.mflHost}/${year}/home/${league.id})`);
    }
    if (leagues.length) issues.push({ year, game: g, leagues });
  }
}

/**
 * File one GitHub issue per game, assigned to the repo owner. GitHub emails
 * the assignee, and the issue stays open until the waiver run is moved and
 * the issue is closed, which a push notification could not do (owner's call,
 * 2026-11-23: "I'll for sure miss" a push).
 */
async function fileIssue(title, body) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const assignee = process.env.ISSUE_ASSIGNEE;
  if (!repo || !token) return { ok: false, reason: 'no GITHUB_REPOSITORY / GITHUB_TOKEN' };
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mfl.football NFL Wednesday games',
    },
    body: JSON.stringify({ title, body, ...(assignee ? { assignees: [assignee] } : {}) }),
  });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${await res.text()}` };
  const json = await res.json();
  return { ok: true, url: json.html_url };
}

const summary = [];
let failed = false;
for (const { game: g, leagues } of issues) {
  const matchup = `${teamNickname(g.away, brandTeams)} at ${teamNickname(g.home, brandTeams)}`;
  const title = `Move waivers: NFL game on Wednesday ${g.label.slice(4)} (Week ${g.week}, ${matchup})`;
  const body = [
    `The NFL schedule has a **Wednesday** game: **${matchup}**, ${g.label}, ${g.time} PT (Week ${g.week}).`,
    '',
    'Waivers in these leagues would process after kickoff:',
    '',
    ...leagues,
    '',
    "Move that week's waiver run on MFL so it processes before kickoff, then close this issue.",
    '',
    '_Filed by the Schedule Release job (`scripts/check-nfl-wednesday-games.mjs`)._',
  ].join('\n');
  console.log(`\n${title}\n${body}`);
  summary.push(`### ${title}`, '', ...leagues, '');
  if (DRY_RUN) {
    console.log('  [dry-run] issue not filed.');
    continue;
  }
  const result = await fileIssue(title, body);
  if (result.ok) {
    console.log(`  filed ${result.url}`);
  } else {
    console.error(`  issue NOT filed (${result.reason})`);
    failed = true;
  }
}

if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Wednesday NFL games\n\n${summary.join('\n')}\n`);
}

if (DRY_RUN) {
  console.log('\n[dry-run] state file not written.');
} else if (failed) {
  // Leave the state alone so tomorrow's run files it again.
  console.error('\nA reminder issue was not filed — state not recorded, failing so the run is visible.');
} else {
  const sorted = Object.fromEntries(Object.keys(nextState).sort().map((k) => [k, nextState[k]]));
  // Canonical write: a run that found nothing new commits nothing.
  if (writeJsonIfChanged(STATE, sorted)) console.log(`\nWrote ${path.relative(ROOT, STATE)}`);
}

process.exit(failed ? 1 : 0);
