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
import { ALL_LEAGUES, LEAGUES, leagueUrl } from '../src/config/leagues-data.mjs';
import { callAnthropic } from './article-utils/ai-client.mjs';
import { getCompletedWeek } from './article-utils/week-resolver.mjs';
import { currentSeasonYear } from './lib/schefter-recurrence-ledger.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { capSentences, LEDE_MAX_SENTENCES } from '../src/utils/pecking-order-lede.mjs';
import { spellOutShorthand } from '../src/utils/pecking-order-wording.mjs';
import { normalizeFranchiseId } from '../src/utils/franchise-id.mjs';
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
  enrichStandingsFromResults,
  buildPairings,
} from './lib/pecking-order-math.mjs';
import { loadLeaguePersona } from './lib/persona-store.mjs';
import { num, int } from './lib/team-strength.mjs';
// Announcements are QUEUED here and sent by scripts/schefter-announce-pending.mjs
// after the commit, once the issue is live. See scripts/lib/await-published.mjs.
import { enqueueAnnounce } from './lib/announce-queue.mjs';
import { leaguesFor } from './lib/league-jobs.mjs';
import { addResult, emptyRecord, scoreResult } from '../src/utils/game-results.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const COLUMN_NAME = 'The Pecking Order';

/**
 * Leagues that publish the column: the Power rankings box, by registry
 * (scripts/lib/league-jobs.mjs `pecking-order`). Best ball never qualifies —
 * it drafts no games, so there is nothing to rank.
 */
const VALID_LEAGUES = leaguesFor('pecking-order').map((l) => l.slug);

/**
 * Per-league Schefter GroupMe bot, from the registry's `chat` block. Roger's
 * bots are never a fallback — he owns deadlines, Schefter owns the column
 * (same split as the article generator). A Slack league has no entry on
 * purpose: the queued announcement's `botEnv` is then undefined, and the
 * drainer (schefter-announce-pending.mjs) routes it through chatConfigFor →
 * Slack.
 */
const GROUPME_BOT_ENV = Object.fromEntries(
  ALL_LEAGUES.filter((l) => l.chat?.provider === 'groupme' && l.chat.botEnv).map((l) => [l.slug, l.chat.botEnv]),
);

// ─── CLI ───────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    league: 'theleague', year: null, week: null, dryRun: false, regenerate: false,
    ai: null, publish: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--league': opts.league = args[++i]; break;
      case '--year': opts.year = parseInt(args[++i], 10); break;
      case '--week': opts.week = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--regenerate': opts.regenerate = true; break;
      case '--publish': opts.publish = true; break;
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
    // TheLeague/AFL list division NAMES; a package league lists
    // { id, name } objects (its teams carry the name in `division`).
    divisions: (cfg.divisions || []).map((d) => (typeof d === 'string' ? d : d?.name)).filter(Boolean),
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

// buildPairings moved to lib/pecking-order-math.mjs so the standings page can
// share it; re-exported here for existing importers.
export { buildPairings };

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
      const result = scoreResult(scores[franchiseId], scores[opp.id]);
      if (!result) continue;
      games.push({ wk, result });
    }
  }
  games.sort((a, b) => a.wk - b.wk);
  // Bye weeks and missing feeds are skipped, not counted: take the last N weeks
  // the team actually has a scored game in.
  const playedWeeks = [...new Set(games.map(g => g.wk))].slice(-weeks);
  const window = new Set(playedWeeks);
  const slice = games.filter(g => window.has(g.wk));
  const rec = emptyRecord();
  for (const g of slice) addResult(rec, g.result);
  return { wins: rec.wins, losses: rec.losses, ties: rec.ties, gamesCounted: slice.length };
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
    ? `${streak.length}-game ${streak.type === 'W' ? 'winning' : 'losing'} streak`
    : null;

  const parts = [];
  if (recStr && ppgStr) parts.push(`${recStr} at ${ppgStr}.`);
  else if (ppgStr) parts.push(`Averaging ${ppgStr} over recent weeks.`);
  if (streakStr) parts.push(`Riding a ${streakStr}.`);
  if (trendStr) parts.push(`Pecking order: ${trendStr}.`);
  if (parts.length === 0) parts.push(`Reset week — limited data.`);
  return spellOutShorthand(parts.join(' '));
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

  return { headline, lede: capSentences(ledeParts.join(' '), LEDE_MAX_SENTENCES) };
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

  let standingsByFid = new Map();
  for (const f of asArray(standings?.leagueStandings?.franchise)) {
    standingsByFid.set(f.id, f);
  }
  // Fill all-play / streak / PA where the league's export lacks them (archies);
  // a no-op for a league whose MFL standings already carry them.
  standingsByFid = enrichStandingsFromResults(standingsByFid, weeklyResults, pairings, week);

  // A big league writes up only its top N (registry `peckingOrder.topN`); the
  // rest are still ranked, and shown in their division lists.
  const topN = league.peckingOrder?.topN ?? null;

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
    ...(topN ? { topN } : {}),
  };

  if (useAI) {
    issue = await applySchefterVoice(issue, teamsConfig.teams, league, topN);
  }

  // Strip transient fact-bag from output rows; below a top-N cut a row keeps
  // its rank and metrics but carries no blurb (nothing renders one).
  issue.rankings = issue.rankings.map(({ factsForBlurb, ...rest }) => {
    if (topN && rest.rank > topN) {
      const { blurb, ...noBlurb } = rest;
      return noBlurb;
    }
    return rest;
  });

  return { issue, teams: teamsConfig.teams };
}

async function applySchefterVoice(issue, teams, league, topN = null) {
  // The league's own writer (commissioner-editable); the default persona
  // leaves every prompt byte-identical to before.
  const persona = await loadLeaguePersona(league.slug);
  const leagueKind = league.features?.contracts || league.features?.keepers ? 'dynasty' : 'redraft';
  const factSheet = buildFactSheet({ issue, teams, leagueName: league.name, leagueKind, voiceName: persona.name, topN });
  const voicedRows = topN ? issue.rankings.filter((r) => r.rank <= topN) : issue.rankings;
  console.log(`  Calling Claude for ${persona.name}'s voice…`);
  let aiOutput;
  try {
    aiOutput = await callAnthropic(
      getSystemPrompt(league.name, { persona, topN }),
      getUserPrompt(factSheet, voicedRows.length),
      4000,
    );
  } catch (err) {
    console.warn(`  [warn] AI call failed (${err.message}). Keeping templated voice.`);
    return issue;
  }

  // Voice only the rows the sheet carried; the rest ride through untouched.
  const { issue: voicedTop, report } = applyAIVoice({ ...issue, rankings: voicedRows }, aiOutput, teams);
  const voiced = topN
    ? { ...voicedTop, rankings: [...voicedTop.rankings, ...issue.rankings.filter((r) => r.rank > topN)] }
    : voicedTop;

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

/**
 * One sentence and a link. The column does the talking; the chat post only
 * says who is on top and where to read the rest (owner's call, Oct 2026 — the
 * old multi-line post with the #1 blurb and both awards was the column
 * re-told in the chat).
 */
export function buildGroupMeAnnouncement(issue, teams, league) {
  const top = issue.rankings[0];
  const name = teams.get(top.franchiseId)?.nameMedium ?? top.franchiseId;
  const hook = top.previousRank == null || top.previousRank === top.rank
    ? `${name} holds #1`
    : `${name} climbs to #1`;
  // leagueUrl is total in both directions: it strips the prefix on a league's
  // own apex host and adds one on the shared host, so the link never burns a
  // redirect hop or 404s. The URL ends the message — GroupMe autolinks a
  // trailing period into the href.
  return `🐔 Week ${issue.week} Pecking Order: ${hook} ▸ ${leagueUrl(league, '/pecking-order')}`;
}

/**
 * The Tuesday column waits for its own issue permalink before announcing.
 *
 * The landing page `/pecking-order` cannot be the probe: it answers 200 in
 * every week of the season, and while the deploy is in flight it is the page
 * that shows LAST week's column. That is exactly what owners saw on
 * 2026-10-20, when this lane announced with no wait at all: the Week 6 post
 * went out at 11:29, the deploy carrying Week 6 had only just started
 * building, and GroupMe's unfurl (and every owner who tapped within those
 * minutes) got Week 5.
 *
 * `/<league>/pecking-order/<year>/<week>` is honest: it is server-rendered off
 * the deployed bundle's own glob of issue files and answers 404 for a week it
 * does not have, so it turns 200 in the same deploy that updates the landing
 * page. It used to be prerendered, which made it 500 on every apex host and
 * forced this lane to skip the wait — see
 * docs/claude/followups/2026-09-17-pecking-order-permalink-500.md.
 *
 * League-PREFIXED, like every verifyPath: `awaitPublished` runs it through
 * `leagueUrl`, which strips the prefix on the league's apex host.
 */
export function issuePermalink(league, year, week) {
  return `/${league.slug}/pecking-order/${year}/${week}`;
}

/**
 * Queue Tuesday's announcement. It is SENT by
 * scripts/schefter-announce-pending.mjs, after the workflow's commit step and
 * once the issue is actually live — see scripts/lib/await-published.mjs for
 * the bug that split these apart.
 */
async function queueAnnouncement(issue, teams, league, { year, week, push, dryRun }) {
  const { file, size } = await enqueueAnnounce(projectRoot, {
    league: league.slug,
    kind: 'pecking-order',
    postId: `pecking-order-${year}-${week}`,
    verifyPath: issuePermalink(league, year, week),
    // A post that beats the deploy sends owners to last week's column, so on
    // a timeout say nothing rather than say the wrong thing.
    skipIfNotLive: true,
    groupMeText: buildGroupMeAnnouncement(issue, teams, league),
    botEnv: GROUPME_BOT_ENV[league.slug],
    push,
    pushCategory: 'column',
    dryRun,
  });
  console.log(`  [announce] Queued for after the deploy (${size} pending → ${file}).`);
  console.log('  [announce] Send with: node scripts/schefter-announce-pending.mjs');
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

/** Normalize a franchise list once, for the push recipients. */
function normalizeFranchiseIds(ids) {
  return Array.from(new Set(Array.from(ids ?? [], (id) => normalizeFranchiseId(id)))).filter(Boolean);
}

async function main() {
  const opts = parseArgs();
  const league = LEAGUES[opts.league];

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
  //
  // QUEUED, not sent: the issue above is a file in the Actions runner, and the
  // commit + Vercel build are still ahead of us. Announcing here told owners
  // to go read a week the site could not serve yet — the column permalink
  // 404s until it deploys, and /pecking-order still showed LAST week. The
  // three channels are handed over together so they cannot drift apart.
  if (opts.publish) {
    await queueAnnouncement(issue, teams, league, {
      year,
      week,
      // The column itself, to owners who asked for it.
      push: {
        franchiseIds: normalizeFranchiseIds(teams.keys()),
        title: `The Pecking Order — Week ${week}`,
        body: issue.headline,
        url: '/pecking-order',
        tag: `pecking-order-${year}-${week}`,
      },
      dryRun: opts.dryRun,
    });
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
