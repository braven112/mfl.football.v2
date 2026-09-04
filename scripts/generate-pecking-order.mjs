#!/usr/bin/env node
/**
 * The Pecking Order — Tuesday-morning weekly column generator.
 *
 * Reads committed MFL feeds (weekly results + standings + schedule) for the
 * target league/year/week and writes a structured JSON issue to
 * <dataPath>/pecking-order/<year>-<week>.json that the league's
 * /<league>/pecking-order pages render.
 *
 * Usage:
 *   pnpm generate:pecking-order                        # auto year/week (Labor Day season clock + last completed week)
 *   pnpm generate:pecking-order --league afl-fantasy
 *   pnpm generate:pecking-order --year 2025 --week 14
 *   pnpm generate:pecking-order --year 2025 --week 14 --regenerate
 *   pnpm generate:pecking-order --dry-run --year 2025 --week 14
 *   pnpm generate:pecking-order --publish              # also post the GroupMe announcement on a fresh write
 *
 * One league per invocation (the workflow runs them as sequential steps), so a
 * failed AFL run can never take TheLeague's issue down with it.
 *
 * Voice: Schefter-voiced headline/lede/blurbs via ANTHROPIC_API_KEY, with a
 * deterministic templated fallback when the key is unset or the AI output
 * fails the quality gate (per-blurb fallback — see lib/pecking-order-ai.mjs).
 *
 * Offseason: the column only runs while the season it would rank is actually
 * being played (see src/utils/pecking-order-season-window.mjs) AND that
 * season's feeds have a completed week, so the Tuesday cron can run
 * year-round. The earliest possible issue is therefore the Tuesday after
 * week 1.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES, leagueUrl } from '../src/config/leagues-data.mjs';
import { callAnthropic } from './article-utils/ai-client.mjs';
import { getCompletedWeek } from './article-utils/week-resolver.mjs';
import { currentSeasonYear } from './lib/schefter-recurrence-ledger.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import {
  openPoll,
  closePoll,
  readTurnout,
  describeTurnoutFailure,
  buildOpenLine,
  buildNagMessage,
  buildRevealMessage,
  normalizeFranchiseIds,
} from './lib/owners-poll-pass.mjs';
import {
  buildVoterPushes,
  sendVoterPushes,
  buildRevealFeedPost,
  buildCallback,
  upsertFeedPost,
} from './lib/owners-poll-posts.mjs';
import {
  buildFactSheet,
  getSystemPrompt,
  getUserPrompt,
  applyAIVoice,
} from './lib/pecking-order-ai.mjs';
import {
  computePeckingOrder,
  attachTrend,
  parseStreak,
  describeMethodology,
} from './lib/pecking-order-math.mjs';
import { num, int } from './lib/team-strength.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const COLUMN_NAME = 'The Pecking Order';

/** Leagues that publish the column. Best-ball drafts no games, so no rankings. */
const VALID_LEAGUES = ['theleague', 'afl-fantasy'];

/**
 * Per-league Schefter GroupMe bot. Roger's bots are never a fallback — he owns
 * deadlines, Schefter owns the column (same split as the article generator).
 */
const GROUPME_BOT_ENV = {
  theleague: 'GROUPME_SCHEFTER_BOT_ID',
  'afl-fantasy': 'GROUPME_AFL_SCHEFTER_BOT_ID',
};

// ─── CLI ───────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    league: 'theleague', year: null, week: null, dryRun: false, regenerate: false,
    ai: null, publish: false,
    // Owners' Poll passes. Each is a MODE, not a flag on the normal run: the
    // column is generated Tuesday, the ballot is nagged Wednesday morning and
    // tallied Wednesday evening, and conflating them would mean regenerating
    // the column three times a week.
    closePoll: false, nagPoll: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--league': opts.league = args[++i]; break;
      case '--year': opts.year = parseInt(args[++i], 10); break;
      case '--week': opts.week = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--regenerate': opts.regenerate = true; break;
      case '--publish': opts.publish = true; break;
      case '--close-poll': opts.closePoll = true; break;
      case '--nag-poll': opts.nagPoll = true; break;
      case '--ai': opts.ai = true; break;
      case '--no-ai': opts.ai = false; break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
    }
  }
  if (!VALID_LEAGUES.includes(opts.league)) {
    console.error(`Unknown --league ${opts.league}. Valid leagues: ${VALID_LEAGUES.join(', ')}`);
    process.exit(1);
  }
  return opts;
}

function printUsage() {
  console.log(`Usage: node scripts/generate-pecking-order.mjs [--league SLUG] [--year YYYY] [--week N] [--dry-run] [--regenerate] [--publish] [--ai|--no-ai]`);
  console.log(`  --league   ${VALID_LEAGUES.join(' | ')} (default theleague)`);
  console.log(`  default    year = current season (Labor Day clock), week = last completed week`);
  console.log(`  --publish     Post the GroupMe announcement when a new issue is written`);
  console.log(`  --close-poll  Tally the Owners' Poll into an existing issue and reveal it`);
  console.log(`  --nag-poll    Post the count-only turnout reminder while the ballot is open`);
  console.log(`  --ai       Force Schefter voice (requires ANTHROPIC_API_KEY)`);
  console.log(`  --no-ai    Force templated voice (no API call)`);
}

// ─── Loaders ───────────────────────────────────────────────────────

async function loadJSON(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function tryLoadJSON(p) {
  try { return await loadJSON(p); } catch { return null; }
}

/**
 * Team + structure config for one league.
 *
 * Always TODAY's config, whatever `--year` says. That is exactly right for the
 * Tuesday run, which is always ranking the season in progress. It is a known
 * limitation when backfilling an old season with `--year`: names, icons and
 * division alignment come out as they are now, not as they were then. The
 * per-season overlays that fix that (`resolveConfigForYear` +
 * `applySeasonStructure`, which the AFL needs because it has re-parented
 * divisions between conferences) are page-side TypeScript; wiring them in here
 * is the work to do if this column ever backfills seasons in bulk.
 *
 * `conferenceOfDivision` is null for TheLeague (four flat divisions) and
 * resolves the AFL's division to its conference display name, so a division
 * heading can say which half of the league it belongs to.
 */
async function loadTeamsConfig(league) {
  const cfg = await loadJSON(path.join(projectRoot, ...league.configPath.split('/')));
  const teams = new Map();
  for (const t of cfg.teams) {
    teams.set(t.franchiseId, {
      franchiseId: t.franchiseId,
      name: t.name,
      nameMedium: t.nameMedium ?? t.name,
      nameShort: t.nameShort ?? t.name,
      abbrev: t.abbrev,
      aliases: t.aliases,
      color: t.color ?? t.colorPrimary,
      division: t.division,
      conference: t.conference,
      icon: t.icon,
      banner: t.banner,
    });
  }
  // AFL: divisions live under conferences ({ name, code, divisions: [...] }).
  const divisionToConference = new Map();
  for (const conf of (cfg.conferences || [])) {
    for (const div of (conf.divisions || [])) divisionToConference.set(div, conf.name);
  }
  return {
    teams,
    divisions: cfg.divisions,
    conferenceOfDivision: (name) => divisionToConference.get(name) ?? null,
  };
}

function feedDir(league, year) {
  return path.join(projectRoot, ...league.dataPath.split('/'), 'mfl-feeds', String(year));
}

function peckingOrderDir(league) {
  return path.join(projectRoot, ...league.dataPath.split('/'), 'pecking-order');
}

function issueFilePath(league, year, week) {
  return path.join(peckingOrderDir(league), `${year}-${String(week).padStart(2, '0')}.json`);
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * MFL collapses a one-element list to a bare object — a week with a single
 * matchup, a bracket with a single franchise. Every list read out of a raw feed
 * has to go through here or it throws on `.map` the first time a league-year
 * has a short week (AFL 2012 week 13 is the committed example, and it crashed
 * the generator outright before this existed).
 */
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

/**
 * Every week's H2H pairings, keyed by week: Map<week, Array<{ id, isHome }[]>>.
 *
 * Two sources, because neither covers both jobs. schedule.json is the only
 * forward-looking one — it has next week's matchup, which is what Matchup of
 * the Week previews. weekly-results-raw.json only has weeks already played,
 * but it exists for every league-year on disk, including the AFL seasons that
 * predate schedule.json being fetched for that league. Schedule wins where
 * both have a week; raw fills the rest.
 */
export function buildPairings(schedule, rawWeekly) {
  const byWeek = new Map();
  const pairingsOf = (matchup) =>
    asArray(matchup)
      .map(m => asArray(m?.franchise).map(f => ({ id: f.id, isHome: f.isHome })))
      .filter(g => g.length === 2);

  for (const entry of asArray(rawWeekly)) {
    const wk = int(entry?.weeklyResults?.week);
    if (!wk) continue;
    const games = pairingsOf(entry.weeklyResults.matchup);
    if (games.length) byWeek.set(wk, games);
  }
  for (const w of asArray(schedule?.schedule?.weeklySchedule)) {
    const wk = int(w?.week);
    if (!wk) continue;
    const games = pairingsOf(w.matchup);
    if (games.length) byWeek.set(wk, games);
  }
  return byWeek;
}

/**
 * Record over the last N weeks this franchise played: { wins, losses, ties }.
 *
 * Windowed by WEEK rather than by game, to stay in step with the form half of
 * the composite (rolling-3-week PPG). The AFL plays double-headers — two
 * opponents, one score, in weeks 1, 2 and 13 of 2025 — so a last-3-GAMES window
 * would cover barely a week and a half there while the PPG beside it covered
 * three. For a league that plays once a week the two definitions are identical,
 * which is why TheLeague's numbers don't move.
 *
 * `gamesCounted` is what the blurb quotes ("3-1 over their last 4"), so a
 * double-header week reads honestly instead of dropping a game on the floor.
 */
export function rollingRecord(pairings, weeklyResults, franchiseId, throughWeek, weeks = 3) {
  const weekScores = new Map();
  for (const w of asArray(weeklyResults?.weeks)) {
    weekScores.set(int(w.week), w.scores || {});
  }
  const games = [];
  for (const [wk, matchups] of pairings.entries()) {
    if (wk > throughWeek) continue;
    const scores = weekScores.get(wk);
    if (!scores) continue;
    for (const fs of matchups) {
      const me = fs.find(f => f.id === franchiseId);
      if (!me) continue;
      const opp = fs.find(f => f.id !== franchiseId);
      if (!opp) continue;
      const myScore = num(scores[franchiseId], NaN);
      const oppScore = num(scores[opp.id], NaN);
      if (!Number.isFinite(myScore) || !Number.isFinite(oppScore)) continue;
      games.push({ wk, myScore, oppScore });
    }
  }
  games.sort((a, b) => a.wk - b.wk);
  // Bye weeks and missing feeds are skipped, not counted: take the last N weeks
  // the team actually has a scored game in.
  const playedWeeks = [...new Set(games.map(g => g.wk))].slice(-weeks);
  const window = new Set(playedWeeks);
  const slice = games.filter(g => window.has(g.wk));
  let wins = 0, losses = 0, ties = 0;
  for (const g of slice) {
    if (g.myScore > g.oppScore) wins++;
    else if (g.myScore < g.oppScore) losses++;
    else ties++;
  }
  return { wins, losses, ties, gamesCounted: slice.length };
}

// ─── Trend (vs. previous week) ──────────────────────────────────────

async function loadPreviousRankings(league, year, week) {
  for (let w = week - 1; w >= 1; w--) {
    const prior = await tryLoadJSON(issueFilePath(league, year, w));
    if (prior?.rankings?.length) return { week: w, rankings: prior.rankings };
  }
  return null;
}

// ─── Awards (deterministic; templated blurbs as fallback) ───────────

function findStatOfWeek({ teams, weeklyResults, week }) {
  const wk = asArray(weeklyResults?.weeks).find(w => int(w?.week) === week);
  if (!wk?.scores) return null;
  let topFid = null, topScore = -Infinity;
  for (const [fid, s] of Object.entries(wk.scores)) {
    const v = num(s, NaN);
    if (Number.isFinite(v) && v > topScore) { topScore = v; topFid = fid; }
  }
  if (!topFid) return null;
  const team = teams.get(topFid);
  return {
    franchiseId: topFid,
    title: 'Stat of the Week',
    blurb: `${team?.nameMedium ?? topFid} dropped ${topScore.toFixed(2)} — the highest score in the league this week.`,
    metric: { score: topScore },
  };
}

function findBenchBlunder({ teams, rawWeekly, week }) {
  const wk = asArray(rawWeekly).find(w => int(w?.weeklyResults?.week) === week);
  if (!wk) return null;
  let worstFid = null, worstGap = -Infinity, worstActual = 0, worstOptimal = 0;
  for (const m of asArray(wk.weeklyResults?.matchup)) {
    for (const f of asArray(m?.franchise)) {
      const actual = num(f.score, NaN);
      const optimal = num(f.opt_pts, NaN);
      if (!Number.isFinite(actual) || !Number.isFinite(optimal)) continue;
      const gap = optimal - actual;
      if (gap > worstGap) {
        worstGap = gap;
        worstFid = f.id;
        worstActual = actual;
        worstOptimal = optimal;
      }
    }
  }
  if (!worstFid) return null;
  const team = teams.get(worstFid);
  return {
    franchiseId: worstFid,
    title: 'Bench Blunder of the Week',
    blurb: `${team?.nameMedium ?? worstFid} left ${worstGap.toFixed(2)} on the bench (${worstActual.toFixed(2)} actual vs ${worstOptimal.toFixed(2)} optimal).`,
    metric: { actual: worstActual, optimal: worstOptimal, gap: worstGap },
  };
}

function findHeaterAndCooler({ teams, standingsByFid }) {
  let heaterFid = null, heaterLen = 0;
  let coolerFid = null, coolerLen = 0;
  for (const [fid, s] of standingsByFid.entries()) {
    const { type, length } = parseStreak(s.strk);
    if (type === 'W' && length > heaterLen) { heaterFid = fid; heaterLen = length; }
    if (type === 'L' && length > coolerLen) { coolerFid = fid; coolerLen = length; }
  }
  const heater = heaterFid ? {
    franchiseId: heaterFid,
    title: 'Heater of the Week',
    blurb: `${teams.get(heaterFid)?.nameMedium ?? heaterFid} have won ${heaterLen} straight — longest active win streak in the league.`,
    metric: { streak: heaterLen },
  } : null;
  const cooler = coolerFid ? {
    franchiseId: coolerFid,
    title: 'Cooler of the Week',
    blurb: `${teams.get(coolerFid)?.nameMedium ?? coolerFid} have dropped ${coolerLen} in a row — the longest active losing streak in the league.`,
    metric: { streak: coolerLen },
  } : null;
  return { heater, cooler };
}

function findMatchupOfWeek({ teams, pairings, rankings, week }) {
  const next = pairings.get(week + 1);
  if (!next) return null;
  const rankByFid = new Map(rankings.map(r => [r.franchiseId, r.rank]));
  let pick = null, pickScore = Infinity;
  for (const fs of next) {
    const [a, b] = fs;
    const ra = rankByFid.get(a.id);
    const rb = rankByFid.get(b.id);
    if (ra == null || rb == null) continue;
    // Closest top-half matchup: minimize avg(rank) + |diff|
    const avg = (ra + rb) / 2;
    const diff = Math.abs(ra - rb);
    const score = avg + diff * 0.25;
    if (score < pickScore) {
      pickScore = score;
      pick = { homeId: a.isHome === '1' ? a.id : b.id, awayId: a.isHome === '1' ? b.id : a.id };
    }
  }
  if (!pick) return null;
  const home = teams.get(pick.homeId);
  const away = teams.get(pick.awayId);
  const homeRank = rankByFid.get(pick.homeId);
  const awayRank = rankByFid.get(pick.awayId);
  return {
    title: 'Matchup of the Week',
    homeId: pick.homeId,
    awayId: pick.awayId,
    blurb: `Week ${week + 1}: #${awayRank} ${away?.nameMedium ?? pick.awayId} at #${homeRank} ${home?.nameMedium ?? pick.homeId}. Highest-ranked clash on the slate.`,
    metric: { homeRank, awayRank },
  };
}

// ─── Templated blurbs (deterministic fallback voice) ────────────────

function rankingBlurb(row, standingsByFid) {
  const standing = standingsByFid.get(row.franchiseId);
  const rec = row.factsForBlurb.last3Record;
  const ppg = row.metrics.rolling3Ppg ?? row.metrics.seasonPpg;
  const ppgStr = Number.isFinite(ppg) ? `${ppg.toFixed(1)} PPG` : null;
  const recStr = rec.gamesCounted > 0 ? `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''} over their last ${rec.gamesCounted}` : null;
  const trendStr = (() => {
    if (row.previousRank == null) return null;
    const delta = row.previousRank - row.rank;
    if (delta > 0) return `up ${delta} from #${row.previousRank}`;
    if (delta < 0) return `down ${-delta} from #${row.previousRank}`;
    return 'holding steady';
  })();
  const streak = parseStreak(standing?.strk);
  const streakStr = streak.length >= 2
    ? (streak.type === 'W' ? `${streak.length}-game win streak` : `${streak.length}-game skid`)
    : null;

  const parts = [];
  if (recStr && ppgStr) parts.push(`${recStr} at ${ppgStr}.`);
  else if (ppgStr) parts.push(`Averaging ${ppgStr} over recent weeks.`);
  if (streakStr) parts.push(`Riding a ${streakStr}.`);
  if (trendStr) parts.push(`Pecking order: ${trendStr}.`);
  if (parts.length === 0) parts.push(`Reset week — limited data.`);
  return parts.join(' ');
}

// ─── Standings snapshot ─────────────────────────────────────────────

function buildStandingsSnapshot({ teams, divisions, conferenceOfDivision, standingsByFid }) {
  const byDivision = new Map();
  for (const div of divisions) byDivision.set(div, []);
  for (const [fid, t] of teams.entries()) {
    const s = standingsByFid.get(fid);
    const wins = int(s?.h2hw, 0);
    const losses = int(s?.h2hl, 0);
    const ties = int(s?.h2ht, 0);
    const pf = num(s?.pf, 0);
    const pa = num(s?.pa, 0);
    const ppg = num(s?.avgpf, 0);
    const allPlayPct = num(s?.all_play_pct, 0);
    const allPlayWLT = s?.all_play_wlt || '';
    const row = { franchiseId: fid, name: t.name, nameMedium: t.nameMedium, abbrev: t.abbrev, division: t.division, wins, losses, ties, pf, pa, ppg, allPlayPct, allPlayWLT };
    if (byDivision.has(t.division)) byDivision.get(t.division).push(row);
  }
  const divisionsOut = divisions.map(name => ({
    name,
    // Omitted entirely for a flat league, so the page renders a bare heading.
    ...(conferenceOfDivision(name) ? { conference: conferenceOfDivision(name) } : {}),
    teams: (byDivision.get(name) || []).slice().sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pf - a.pf;
    }),
  }));
  const allPlay = [...standingsByFid.entries()]
    .map(([fid, s]) => {
      const t = teams.get(fid);
      return {
        franchiseId: fid,
        name: t?.name ?? fid,
        nameMedium: t?.nameMedium ?? fid,
        abbrev: t?.abbrev ?? '',
        division: t?.division ?? '',
        allPlayPct: num(s?.all_play_pct, 0),
        allPlayWLT: s?.all_play_wlt || '',
        pf: num(s?.pf, 0),
      };
    })
    .sort((a, b) => b.allPlayPct - a.allPlayPct);
  return { divisions: divisionsOut, allPlay };
}

// ─── Headline + lede (deterministic fallback voice) ─────────────────

function buildHeadlineAndLede({ teams, rankings, awards, week }) {
  const top = rankings[0];
  const topTeam = teams.get(top.franchiseId);
  const moverUp = rankings
    .filter(r => r.previousRank != null)
    .sort((a, b) => (b.previousRank - b.rank) - (a.previousRank - a.rank))[0];
  const moverDown = rankings
    .filter(r => r.previousRank != null)
    .sort((a, b) => (a.previousRank - a.rank) - (b.previousRank - b.rank))[0];

  const headline = (() => {
    if (moverUp && (moverUp.previousRank - moverUp.rank) >= 3) {
      const team = teams.get(moverUp.franchiseId);
      return `${team?.nameShort ?? moverUp.franchiseId} climb the pecking order to #${moverUp.rank}`;
    }
    return `${topTeam?.nameShort ?? top.franchiseId} rule the roost after Week ${week}`;
  })();

  const ledeParts = [`Through Week ${week}, ${topTeam?.name ?? top.franchiseId} sit atop the pecking order.`];
  if (awards.statOfWeek) ledeParts.push(awards.statOfWeek.blurb);
  if (moverUp && (moverUp.previousRank - moverUp.rank) >= 2) {
    const team = teams.get(moverUp.franchiseId);
    ledeParts.push(`${team?.nameMedium ?? moverUp.franchiseId} jump ${moverUp.previousRank - moverUp.rank} spots to #${moverUp.rank}.`);
  }
  if (moverDown && (moverDown.rank - moverDown.previousRank) >= 2) {
    const team = teams.get(moverDown.franchiseId);
    ledeParts.push(`${team?.nameMedium ?? moverDown.franchiseId} slide ${moverDown.rank - moverDown.previousRank} to #${moverDown.rank}.`);
  }

  return { headline, lede: ledeParts.join(' ') };
}

// ─── Main ──────────────────────────────────────────────────────────

export async function generatePeckingOrder({ league, year, week, useAI = false }) {
  const dir = feedDir(league, year);
  const teamsConfig = await loadTeamsConfig(league);

  const [weeklyResults, rawWeekly, standings, schedule] = await Promise.all([
    loadJSON(path.join(dir, 'weekly-results.json')),
    tryLoadJSON(path.join(dir, 'weekly-results-raw.json')),
    loadJSON(path.join(dir, 'standings.json')),
    tryLoadJSON(path.join(dir, 'schedule.json')),
  ]);

  const pairings = buildPairings(schedule, rawWeekly);

  const standingsByFid = new Map();
  for (const f of asArray(standings?.leagueStandings?.franchise)) {
    standingsByFid.set(f.id, f);
  }

  // Composite rankings (pure math — lib/pecking-order-math.mjs)
  const rawRankings = computePeckingOrder({
    franchiseIds: [...teamsConfig.teams.keys()],
    standingsByFid,
    weeklyResults,
    week,
  });

  // Trend vs previous published issue
  const previous = await loadPreviousRankings(league, year, week);
  const ranked = attachTrend(rawRankings, previous);

  // Awards
  const statOfWeek = findStatOfWeek({ teams: teamsConfig.teams, weeklyResults, week });
  const benchBlunder = findBenchBlunder({ teams: teamsConfig.teams, rawWeekly, week });
  const { heater, cooler } = findHeaterAndCooler({ teams: teamsConfig.teams, standingsByFid });

  const namedRankings = ranked.map(r => ({
    rank: r.rank,
    franchiseId: r.fid,
    previousRank: r.previousRank,
    trend: r.trend,
    metrics: {
      composite: round2(r.composite),
      allPlayPct: r.allPlayPct == null ? null : r.allPlayPct,
      rolling3Ppg: r.rolling3Ppg == null ? null : round2(r.rolling3Ppg),
      seasonPpg: round2(r.seasonPpg),
      avgMargin: r.avgMargin == null ? null : round2(r.avgMargin),
      allPlayScore: round2(r.allPlayScore),
      formScore: round2(r.formScore),
    },
  }));

  const matchupOfWeek = findMatchupOfWeek({
    teams: teamsConfig.teams,
    pairings,
    rankings: namedRankings,
    week,
  });

  // Templated blurbs (deterministic fallback voice). Structured facts ride
  // along so the AI fact sheet can reference them; stripped before write.
  const rankings = namedRankings.map(r => {
    const last3Record = rollingRecord(pairings, weeklyResults, r.franchiseId, week, 3);
    const factsForBlurb = { last3Record, streak: parseStreak(standingsByFid.get(r.franchiseId)?.strk) };
    const withFacts = { ...r, factsForBlurb };
    return { ...withFacts, blurb: rankingBlurb(withFacts, standingsByFid) };
  });

  const awards = {
    statOfWeek,
    benchBlunder,
    tradeOfWeek: null,    // deferred: needs transactions parsing + dynasty value model
    cutOfShame: null,     // deferred: needs salary delta on the cut player
    heaterOfWeek: heater,
    coolerOfWeek: cooler,
    matchupOfWeek,
  };

  const standingsSnapshot = buildStandingsSnapshot({
    teams: teamsConfig.teams,
    divisions: teamsConfig.divisions,
    conferenceOfDivision: teamsConfig.conferenceOfDivision,
    standingsByFid,
  });

  const { headline, lede } = buildHeadlineAndLede({
    teams: teamsConfig.teams,
    rankings,
    awards,
    week,
  });

  const generatedAt = new Date().toISOString();

  let issue = {
    league: league.slug,
    year,
    week,
    publishedAt: generatedAt,
    generatedAt,
    voiceMode: 'templated',
    methodology: describeMethodology(),
    headline,
    lede,
    rankings,
    awards,
    standings: standingsSnapshot,
  };

  if (useAI) {
    issue = await applySchefterVoice(issue, teamsConfig.teams, league);
  }

  // Strip transient fact-bag from output rows
  issue.rankings = issue.rankings.map(({ factsForBlurb, ...rest }) => rest);

  return { issue, teams: teamsConfig.teams };
}

async function applySchefterVoice(issue, teams, league) {
  const factSheet = buildFactSheet({ issue, teams, leagueName: league.name });
  console.log('  Calling Claude for Schefter voice…');
  let aiOutput;
  try {
    aiOutput = await callAnthropic(
      getSystemPrompt(league.name),
      getUserPrompt(factSheet, issue.rankings.length),
      4000,
    );
  } catch (err) {
    console.warn(`  [warn] AI call failed (${err.message}). Keeping templated voice.`);
    return issue;
  }

  const { issue: voiced, report } = applyAIVoice(issue, aiOutput, teams);

  const blurbsApplied = report.blurbs.applied;
  const blurbsTotal = blurbsApplied + report.blurbs.fallback;
  const awardsApplied = report.awardBlurbs.applied;
  const awardsTotal = awardsApplied + report.awardBlurbs.fallback;
  console.log(`  Voice: headline=${report.headline}, lede=${report.lede}, blurbs=${blurbsApplied}/${blurbsTotal}, awardBlurbs=${awardsApplied}/${awardsTotal}`);
  if (report.blurbs.fails.length > 0) {
    for (const f of report.blurbs.fails) {
      console.warn(`    [fallback] ${f.franchiseId}: ${f.errors.join('; ')}`);
    }
  }

  voiced.voiceMode = blurbsApplied > 0 ? 'schefter' : 'templated';
  return voiced;
}

function round2(x) {
  if (x == null || !Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

// ─── GroupMe announcement ──────────────────────────────────────────

export function buildGroupMeAnnouncement(issue, teams, league) {
  const top = issue.rankings[0];
  const topTeam = teams.get(top.franchiseId);
  const arrow = top.previousRank == null || top.previousRank === top.rank
    ? ''
    : top.previousRank > top.rank
      ? ` (↑${top.previousRank - top.rank})`
      : ` (↓${top.rank - top.previousRank})`;
  const lines = [
    `🐔 THE PECKING ORDER — Week ${issue.week}`,
    `#1 ${topTeam?.nameMedium ?? top.franchiseId}${arrow} — "${top.blurb}"`,
  ];
  if (issue.awards?.statOfWeek) lines.push(`🏆 ${issue.awards.statOfWeek.blurb}`);
  if (issue.awards?.benchBlunder) lines.push(`🪑 ${issue.awards.benchBlunder.blurb}`);
  // leagueUrl is total in both directions: it strips the prefix on a league's
  // own apex host and adds one on the shared host, so the link never burns a
  // redirect hop or 404s.
  lines.push(`Full rankings, awards, and standings ▸ ${leagueUrl(league, '/pecking-order')}`);

  // The ballot invite rides along with the column rather than as its own post:
  // one Tuesday message, not two. buildOpenLine returns null when no ballot
  // opened, so the announcement is unchanged for a league without the poll.
  const openLine = buildOpenLine(issue, teams, league);
  if (openLine) lines.push('', openLine);

  return lines.join('\n');
}

async function postAnnouncement(issue, teams, league) {
  const text = buildGroupMeAnnouncement(issue, teams, league);
  const botEnv = GROUPME_BOT_ENV[league.slug];
  const { posted } = await postToGroupMe({
    botId: process.env[botEnv],
    text,
    checkStatus: true,
    onMissingBotId: () => console.log(`  [groupme] ${botEnv} not set — skipping announcement.`),
    onPosted: () => console.log('  [groupme] announcement posted.'),
    onHttpError: (status) => console.warn(`  [groupme] announcement failed: HTTP ${status}`),
    onFetchError: (err) => console.warn(`  [groupme] announcement failed: ${err.message}`),
  });
  if (!posted) console.log('  [groupme] announcement not delivered (see above).');
}

/**
 * Decide which season this run is for, and whether it may run at all.
 *
 * Auto-resolved year (the cron path, including a workflow_dispatch --week
 * override) is gated on the season actually being in progress. An EXPLICIT
 * --year is a deliberate backfill of a named season, so it bypasses the
 * window — the operator already said which season they mean, and that path
 * only reaches GroupMe if they also pass --publish by hand.
 */
export function resolveSeasonGate({ optsYear, now = new Date() }) {
  if (optsYear != null) return { skip: false, year: optsYear };
  const year = currentSeasonYear(now);
  if (!isSeasonWindowOpen(year, now)) {
    return {
      skip: true,
      year,
      reason: `the ${year} season is not in progress (preseason/offseason).`,
    };
  }
  return { skip: false, year };
}

/**
 * Wednesday evening: tally the ballot into Tuesday's issue and reveal it.
 *
 * Amends the EXISTING issue file in place rather than regenerating: the
 * headline, lede and blurbs owners read on Tuesday must not change under them,
 * and the AI is not called at all on this path.
 */
async function runClosePoll(opts, league) {
  if (!league.ownersPoll?.enabled) {
    console.log(`  [skip] ${league.name} does not run the Owners' Poll.`);
    return;
  }

  const redisWindowYear = opts.year ?? currentSeasonYear();
  const week = opts.week ?? (await resolveLatestIssueWeek(league, redisWindowYear));
  if (!week) {
    console.log(`  [skip] No ${league.name} issue found for ${redisWindowYear}.`);
    return;
  }

  const outPath = issueFilePath(league, redisWindowYear, week);
  const issue = await tryLoadJSON(outPath);
  if (!issue) {
    console.log(`  [skip] ${path.relative(projectRoot, outPath)} does not exist.`);
    return;
  }
  if (issue.ownersPoll?.status === 'closed') {
    console.log(`  [skip] Week ${week}'s poll is already closed.`);
    return;
  }

  // The composite is the tiebreaker AND the ordering of the unranked block, so
  // it comes from the issue itself — the same numbers owners saw, not a fresh
  // computation that could have drifted.
  const compositeRankByFid = Object.fromEntries(
    (issue.rankings ?? []).map((r) => [r.franchiseId, r.rank]),
  );

  const result = await closePoll({ league, issue, compositeRankByFid });
  if (!result) return;

  issue.ownersPoll = result.block;

  if (opts.dryRun) {
    console.log('--- DRY RUN ---');
    console.log(JSON.stringify(issue.ownersPoll, null, 2));
    return;
  }

  await fs.writeFile(outPath, JSON.stringify(issue, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Amended ${path.relative(projectRoot, outPath)}`);

  const teamsConfig = await loadTeamsConfig(league);

  // Earlier weeks of this season, for the callback — the line that resurfaces
  // what the room got wrong. Read once and shared by the feed post and the
  // chat post so they cannot disagree about which week they are quoting.
  const priorIssues = await loadSeasonIssues(league, redisWindowYear, week);

  // The feed post is written even without --publish: it is a durable record on
  // the site, not an announcement, and a dry operator run that skips chat
  // still wants the archive correct. Replace-by-id, so a re-run cannot leave
  // two Owners' Poll posts for the same week.
  await writeRevealFeedPost({ league, issue, teams: teamsConfig.teams, priorIssues });

  if (opts.publish) {
    const callback = buildCallback({ issue, priorIssues, teams: teamsConfig.teams });
    const text = buildRevealMessage({ league, issue, teams: teamsConfig.teams, callback });
    if (text) await postPollMessage(text, league, 'reveal');

    // Personal, per voter, and only to voters. The chat post is a broadcast;
    // this is the payoff that makes voting worth doing. Never fatal — the
    // issue is already committed and the reveal already went out, so a push
    // outage must not turn a successful week into a failed job.
    const previousIssue = await tryLoadJSON(
      issueFilePath(league, redisWindowYear, week - 1),
    );
    const notifications = buildVoterPushes({
      league,
      issue,
      teams: teamsConfig.teams,
      previousIssue,
    });
    await sendVoterPushes({ league, notifications });
  }
}

/** Write (or replace) the Owners' Poll reveal post in the league's feed. */
async function writeRevealFeedPost({ league, issue, teams, priorIssues = [] }) {
  const post = buildRevealFeedPost({ league, issue, teams, priorIssues });
  if (!post) return;

  const feedPath = path.join(projectRoot, league.schefterFeedPath);
  const feed = await tryLoadJSON(feedPath);
  if (!feed) {
    console.warn(`  [poll] No feed at ${league.schefterFeedPath} — skipping the reveal post.`);
    return;
  }
  await fs.writeFile(feedPath, JSON.stringify(upsertFeedPost(feed, post), null, 2) + '\n', 'utf8');
  console.log(`  ✓ Feed post ${post.id}`);
}

/**
 * Wednesday morning: the count-only turnout reminder.
 *
 * Silent at full turnout, and silent when no ballot is open — a cron that
 * posts "0 of 16" in the offseason is worse than no cron.
 */
async function runNagPoll(opts, league) {
  if (!league.ownersPoll?.enabled) {
    console.log(`  [skip] ${league.name} does not run the Owners' Poll.`);
    return;
  }

  const turnout = await readTurnout({ league });
  if (!turnout.ok) {
    const why = describeTurnoutFailure(turnout.reason, turnout.error);
    // A credential or read failure is NOT a clean skip: exiting 0 on it would
    // let a broken deployment look like a quiet week for the whole season.
    if (turnout.reason === 'no-credentials' || turnout.reason === 'read-failed') {
      throw new Error(why);
    }
    console.log(`  [skip] ${why}`);
    return;
  }

  const text = buildNagMessage({ league, ...turnout });
  if (!text) {
    console.log(`  [skip] All ${turnout.eligibleVoters} ballots are already in.`);
    return;
  }

  if (opts.dryRun || !opts.publish) {
    console.log('--- NAG PREVIEW ---');
    console.log(text);
    return;
  }
  await postPollMessage(text, league, 'nag');
}

/**
 * First kickoff of the week AFTER the one just ranked, or null.
 *
 * MFL's nflSchedule feed carries ONE week and `fetch-mfl-feeds` re-syncs it to
 * the current NFL week daily, so the week it holds is not guaranteed to be the
 * one we want. The week number is therefore CHECKED, not assumed: a feed
 * describing any other week returns null and the window falls back to its
 * scheduled hour. Trusting a mismatched feed could close the ballot before it
 * opened.
 */
async function resolveUpcomingKickoff(league, year, completedWeek) {
  const feed = await tryLoadJSON(path.join(feedDir(league, year), 'nflSchedule.json'));
  const schedule = feed?.nflSchedule;
  if (!schedule) return null;

  if (Number(schedule.week) !== completedWeek + 1) {
    console.log(
      `  [poll] nflSchedule holds week ${schedule.week}, not ${completedWeek + 1} — using the scheduled close.`,
    );
    return null;
  }

  const matchups = Array.isArray(schedule.matchup) ? schedule.matchup : [schedule.matchup];
  const kickoffs = matchups
    .map((m) => Number(m?.kickoff) * 1000)
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  if (kickoffs.length === 0) return null;

  return new Date(Math.min(...kickoffs));
}

/** Every earlier issue of this season, oldest first. */
async function loadSeasonIssues(league, year, beforeWeek) {
  let entries;
  try {
    entries = await fs.readdir(peckingOrderDir(league));
  } catch {
    return [];
  }
  const weeks = entries
    .map((f) => f.match(new RegExp(`^${year}-(\\d{1,2})\\.json$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((w) => w < beforeWeek)
    .sort((a, b) => a - b);

  const issues = [];
  for (const w of weeks) {
    const data = await tryLoadJSON(issueFilePath(league, year, w));
    if (data) issues.push(data);
  }
  return issues;
}

/** Newest issue week on disk for a season, so the poll passes need no --week. */
async function resolveLatestIssueWeek(league, year) {
  let entries;
  try {
    entries = await fs.readdir(peckingOrderDir(league));
  } catch {
    return null;
  }
  const weeks = entries
    .map((f) => f.match(new RegExp(`^${year}-(\\d{1,2})\\.json$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return weeks.length ? Math.max(...weeks) : null;
}

async function postPollMessage(text, league, label) {
  const botEnv = GROUPME_BOT_ENV[league.slug];
  const { posted } = await postToGroupMe({
    botId: process.env[botEnv],
    text,
    checkStatus: true,
    onMissingBotId: () => console.log(`  [groupme] ${botEnv} not set — skipping ${label}.`),
    onPosted: () => console.log(`  [groupme] ${label} posted.`),
    onHttpError: (status) => console.warn(`  [groupme] ${label} failed: HTTP ${status}`),
    onFetchError: (err) => console.warn(`  [groupme] ${label} failed: ${err.message}`),
  });
  if (!posted) console.log(`  [groupme] ${label} not delivered (see above).`);
}

async function main() {
  const opts = parseArgs();
  const league = LEAGUES[opts.league];

  // The poll passes operate on an issue that ALREADY EXISTS. They never
  // generate or re-voice one — re-running the AI on Wednesday would rewrite
  // Tuesday's published prose underneath the owners who already read it.
  if (opts.closePoll) return runClosePoll(opts, league);
  if (opts.nagPoll) return runNagPoll(opts, league);

  const gate = resolveSeasonGate({ optsYear: opts.year });
  if (gate.skip) {
    console.log(`  [skip] ${league.name}: ${gate.reason} Exiting cleanly.`);
    return;
  }
  const year = gate.year;

  // Resolve the target week: explicit flag wins, else last completed week
  // from the feeds. No completed week (pre-Week-1) → clean exit.
  let week = opts.week;
  if (week == null) {
    const weeklyResults = await tryLoadJSON(path.join(feedDir(league, year), 'weekly-results.json'));
    const teamsConfig = await loadTeamsConfig(league);
    week = getCompletedWeek(weeklyResults ?? { weeks: [] }, teamsConfig.teams.size || 16);
    if (!week) {
      console.log(`  [skip] No completed week in ${league.name} ${year} feeds yet (offseason). Exiting cleanly.`);
      return;
    }
  }

  console.log(`🐔 ${COLUMN_NAME} — ${league.name} ${year} Week ${week}\n`);

  const outPath = issueFilePath(league, year, week);
  if (!opts.regenerate && !opts.dryRun) {
    const existing = await tryLoadJSON(outPath);
    if (existing) {
      console.log(`  ${path.relative(projectRoot, outPath)} already exists. Pass --regenerate to overwrite.`);
      return;
    }
  }

  // Resolve voice mode: explicit flag wins, otherwise auto on API key.
  const useAI = opts.ai === true
    ? true
    : opts.ai === false
      ? false
      : Boolean(process.env.ANTHROPIC_API_KEY);
  console.log(`  Voice: ${useAI ? 'schefter (AI)' : 'templated'}`);

  const { issue, teams } = await generatePeckingOrder({ league, year, week, useAI });

  if (opts.dryRun) {
    console.log('--- DRY RUN ---');
    console.log(JSON.stringify(issue, null, 2));
    console.log('--- GROUPME PREVIEW ---');
    console.log(buildGroupMeAnnouncement(issue, teams, league));
    return;
  }

  // The ballot must not still be open once games have started, so the close is
  // clamped to the real first kickoff of the UPCOMING week when the schedule
  // feed can supply it. Returns null when it can't, and the window then falls
  // back to the scheduled hour — which is right on a normal week and only
  // matters on the odd one (Thanksgiving) where kickoff is much earlier.
  const firstKickoff = await resolveUpcomingKickoff(league, year, week);

  // Open the ballot BEFORE writing, so the issue carries the window it
  // advertises. A poll that fails to open returns null and the column simply
  // publishes without the section — additive, never fatal.
  const pollBlock = await openPoll({
    league,
    year,
    week,
    eligibleFranchiseIds: normalizeFranchiseIds(teams.keys()),
    firstKickoff,
  });
  if (pollBlock) issue.ownersPoll = pollBlock;

  await fs.mkdir(peckingOrderDir(league), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(issue, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Wrote ${path.relative(projectRoot, outPath)}`);
  console.log(`  Headline: ${issue.headline}`);
  console.log(`  Top 3:`);
  for (const r of issue.rankings.slice(0, 3)) {
    console.log(`    #${r.rank} ${r.franchiseId} — ${r.blurb}`);
  }

  // Announce only on a fresh write (dedup above guarantees this) so a re-run
  // can never re-buzz the chat. Missing bot id skips silently by design.
  if (opts.publish) {
    await postAnnouncement(issue, teams, league);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
