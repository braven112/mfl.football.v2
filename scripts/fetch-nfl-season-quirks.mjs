#!/usr/bin/env node
/**
 * Refresh src/data/nfl/season-quirks.mjs from MFL's NFL schedule, and file a
 * GitHub issue for every new Tuesday or Wednesday game.
 *
 * Runs inside the Schedule Release workflow, daily, right after the NFL
 * calendar refresh — so the quirks appear on the Schedule Release page the day
 * the NFL publishes (mid-May), well before the fantasy reveal, and any game the
 * NFL adds or moves later (a flex, a holiday shift) shows up the next morning.
 * See src/utils/nfl-season-quirks.mjs for what counts as a quirk and why
 * Tuesday and Wednesday games matter to waivers.
 *
 * HOW IT REMINDS: one GitHub issue per new Tuesday/Wednesday game, assigned to
 * the repo owner, so GitHub emails him and it stays open until he closes it.
 * Not a push: the owner ruled that out (2026-11-23) as too easy to miss. The
 * issue lists each league whose MFL calendar runs waivers midweek, read from
 * the league's own synced calendar feed (never a hardcoded list), skipping
 * leagues with no admin here. Moving the run is a hand edit on MFL.
 *
 * ONCE PER GAME: a game already in the previous generated file is not new. An
 * issue is filed only while the game is still ahead. When filing fails the
 * file keeps its previous copy of that season, so the next run retries.
 *
 * Env (set by the workflow):
 *   GITHUB_TOKEN, GITHUB_REPOSITORY   required to file; unset fails the run
 *   ISSUE_ASSIGNEE                    who the issue is assigned to
 *
 * Usage:
 *   node scripts/fetch-nfl-season-quirks.mjs              # last, this and next season
 *   node scripts/fetch-nfl-season-quirks.mjs --dry-run    # report only, never files or writes
 *   node scripts/fetch-nfl-season-quirks.mjs --year=2026
 *   node scripts/fetch-nfl-season-quirks.mjs --seed       # write the file, file no issues (marks every game known)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, isFullManagementLeague } from '../src/config/leagues-data.mjs';
import {
  findSeasonQuirks,
  newUpcomingGames,
  runsWaiversMidweek,
  usualMidweekRun,
  waiverRuns,
  waiverStatusOn,
} from '../src/utils/nfl-season-quirks.mjs';
import { adminFranchiseIds } from './lib/ops-alert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/nfl/season-quirks.mjs');
const API = 'https://api.myfantasyleague.com';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const SEED = argv.includes('--seed');
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
    headers: { 'User-Agent': 'mfl.football NFL season quirks' },
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

const readExisting = async () => {
  if (!fs.existsSync(OUT)) return {};
  const { NFL_SEASON_QUIRKS } = await import(`${OUT}?t=${Date.now()}`);
  return JSON.parse(JSON.stringify(NFL_SEASON_QUIRKS ?? {}));
};

const render = (seasons) => {
  const body = Object.keys(seasons)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => `  ${year}: ${JSON.stringify(seasons[year], null, 2).replace(/\n/g, '\n  ')},`)
    .join('\n');
  return `/**
 * NFL season quirks, per season, as published by MFL — GENERATED FILE.
 *
 * Regenerate with \`node scripts/fetch-nfl-season-quirks.mjs\`; do not hand-edit.
 * The opener, Christmas Day games and every Tuesday, Wednesday or Friday game,
 * in Pacific time; see src/utils/nfl-season-quirks.mjs. A season is absent
 * until the NFL publishes its schedule.
 *
 * A .mjs module rather than JSON so the Schedule Release island, plain node
 * scripts and Vite all import it the same way — same reasoning as
 * src/data/nfl/week-starts.mjs.
 */

/** @type {Record<number, Array<{week: number, kickoff: string, date: string, label: string, time: string, away: string, home: string, awayName: string, homeName: string, tags: string[], affectsWaivers: boolean}>>} */
export const NFL_SEASON_QUIRKS = {
${body}
};
`;
};

/**
 * A league's synced MFL calendar for `year`, plus its most recent one with a
 * recurring run as the fallback for "when does this league usually run
 * waivers" — the next season's calendar is often still empty in May.
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
  const latest = [...years].reverse().map(read).find((ev) => waiverRuns(ev).some((r) => r.recurring)) ?? [];
  return { season: years.includes(year) ? read(year) : [], latest };
}

/**
 * File one GitHub issue, assigned to the repo owner. GitHub emails the
 * assignee, and the issue stays open until it is closed.
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
      'User-Agent': 'mfl.football NFL season quirks',
    },
    body: JSON.stringify({ title, body, ...(assignee ? { assignees: [assignee] } : {}) }),
  });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${await res.text()}` };
  return { ok: true, url: (await res.json()).html_url };
}

/** Each league's waiver line for one game, or [] when no league is affected. */
function leagueLines(year, g) {
  const lines = [];
  for (const league of ALL_LEAGUES.filter(isFullManagementLeague)) {
    const { season, latest } = leagueCalendars(league, year);
    if (!runsWaiversMidweek(season) && !runsWaiversMidweek(latest)) continue;
    const status = waiverStatusOn(season, g.date);
    if (status.status === 'moved') {
      console.log(`  ${league.slug}: no waiver run that week after ${g.date} — already moved`);
      continue;
    }
    // Leagues with no admin here are someone else's to run (Archie's).
    if (!adminFranchiseIds(league).length) {
      console.log(`  ${league.slug}: runs midweek waivers but has no admin here — not ours to move`);
      continue;
    }
    const usual = usualMidweekRun(latest);
    const day = status.day ?? usual?.day;
    const time = status.time ?? usual?.time;
    const when = status.status === 'conflict'
      ? `waivers run ${day} at ${time} PT, after kickoff`
      : `waivers usually run ${day ?? 'midweek'}${time ? ` at ${time} PT` : ''} (that week isn't on MFL's calendar yet)`;
    lines.push(`- **${league.name}**: ${when}. [MFL league home](https://${league.mflHost}/${year}/home/${league.id})`);
  }
  return lines;
}

const previous = await readExisting();
const next = { ...previous };
const summary = [];
let failed = false;

for (const year of SEASONS) {
  let weeks;
  try {
    weeks = await fetchSchedule(year);
  } catch (err) {
    // Not fatal: tomorrow's run asks again, and the previous copy stays.
    console.error(`  ${year}: ${err.message} — keeping previous data`);
    continue;
  }
  if (!weeks) {
    console.log(`  ${year}: NFL schedule not published yet`);
    continue;
  }
  const quirks = findSeasonQuirks(weeks, brandTeams);
  console.log(`  ${year}: ${quirks.length} quirk(s)`);
  for (const q of quirks) {
    console.log(`      [${q.tags.join(', ')}] Week ${q.week}: ${q.awayName} at ${q.homeName}, ${q.label}, ${q.time} PT`);
  }

  const fresh = SEED ? [] : newUpcomingGames(
    (previous[year] ?? []).filter((q) => q.affectsWaivers),
    quirks.filter((q) => q.affectsWaivers),
  );
  let seasonOk = true;
  for (const g of fresh) {
    const lines = leagueLines(year, g);
    if (!lines.length) continue;
    const day = g.label.slice(0, 3) === 'Tue' ? 'Tuesday' : 'Wednesday';
    const matchup = `${g.awayName} at ${g.homeName}`;
    const title = `Move waivers: NFL game on ${day} ${g.label.slice(4)} (Week ${g.week}, ${matchup})`;
    const body = [
      `The NFL schedule has a **${day}** game: **${matchup}**, ${g.label}, ${g.time} PT (Week ${g.week}).`,
      '',
      ...lines,
      '',
      "Move that week's waiver run on MFL so it processes before kickoff, then close this issue.",
      '',
      '_Filed by the Schedule Release job (`scripts/fetch-nfl-season-quirks.mjs`)._',
    ].join('\n');
    console.log(`\n${title}\n${body}`);
    summary.push(`### ${title}`, '', ...lines, '');
    if (DRY_RUN) {
      console.log('  [dry-run] issue not filed.');
      continue;
    }
    const result = await fileIssue(title, body);
    if (result.ok) {
      console.log(`  filed ${result.url}`);
    } else {
      console.error(`  issue NOT filed (${result.reason})`);
      seasonOk = false;
      failed = true;
    }
  }
  // A season whose issue failed keeps its old copy, so the game stays "new"
  // and tomorrow's run files it again.
  if (seasonOk) next[year] = quirks;
}

if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Tuesday and Wednesday NFL games\n\n${summary.join('\n')}\n`);
}

if (DRY_RUN) {
  console.log('\n[dry-run] quirks file not written.');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(next));
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
}

if (failed) console.error('\nA reminder issue was not filed — it will be retried tomorrow.');
process.exit(failed ? 1 : 0);
