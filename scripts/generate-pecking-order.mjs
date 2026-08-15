#!/usr/bin/env node
/**
 * The Pecking Order — Tuesday-morning weekly column generator (TheLeague).
 *
 * Reads committed MFL feeds (weekly results + standings + schedule) for the
 * target year/week and writes a structured JSON issue to
 * <dataPath>/pecking-order/<year>-<week>.json that the
 * /theleague/pecking-order pages render.
 *
 * Usage:
 *   pnpm generate:pecking-order                        # auto year/week (Labor Day season clock + last completed week)
 *   pnpm generate:pecking-order --year 2025 --week 14
 *   pnpm generate:pecking-order --year 2025 --week 14 --regenerate
 *   pnpm generate:pecking-order --dry-run --year 2025 --week 14
 *   pnpm generate:pecking-order --publish              # also post the GroupMe announcement on a fresh write
 *
 * Voice: Schefter-voiced headline/lede/blurbs via ANTHROPIC_API_KEY, with a
 * deterministic templated fallback when the key is unset or the AI output
 * fails the quality gate (per-blurb fallback — see lib/pecking-order-ai.mjs).
 *
 * Offseason: when the target year's feeds have no completed week, exits
 * cleanly so the Tuesday cron can run year-round.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES, leagueOrigin } from '../src/config/leagues-data.mjs';
import { callAnthropic } from './article-utils/ai-client.mjs';
import { getCompletedWeek } from './article-utils/week-resolver.mjs';
import { currentSeasonYear } from './lib/schefter-recurrence-ledger.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
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

// The Pecking Order is TheLeague-only for v1. An AFL edition would need its
// own voice/lore pass plus tier-aware framing (Premier/Championship), but the
// math + page component are league-agnostic already.
const LEAGUE = LEAGUES.theleague;

const COLUMN_NAME = 'The Pecking Order';

// ─── CLI ───────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { year: null, week: null, dryRun: false, regenerate: false, ai: null, publish: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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
  return opts;
}

function printUsage() {
  console.log(`Usage: node scripts/generate-pecking-order.mjs [--year YYYY] [--week N] [--dry-run] [--regenerate] [--publish] [--ai|--no-ai]`);
  console.log(`  default    year = current season (Labor Day clock), week = last completed week`);
  console.log(`  --publish  Post the GroupMe announcement when a new issue is written`);
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

async function loadTeamsConfig() {
  const cfg = await loadJSON(path.join(projectRoot, ...LEAGUE.configPath.split('/')));
  const teams = new Map();
  for (const t of cfg.teams) {
    teams.set(t.franchiseId, {
      franchiseId: t.franchiseId,
      name: t.name,
      nameMedium: t.nameMedium ?? t.name,
      nameShort: t.nameShort ?? t.name,
      abbrev: t.abbrev,
      aliases: t.aliases,
      color: t.color,
      division: t.division,
      icon: t.icon,
      banner: t.banner,
    });
  }
  return { teams, divisions: cfg.divisions };
}

function feedDir(year) {
  return path.join(projectRoot, ...LEAGUE.dataPath.split('/'), 'mfl-feeds', String(year));
}

function peckingOrderDir() {
  return path.join(projectRoot, ...LEAGUE.dataPath.split('/'), 'pecking-order');
}

function issueFilePath(year, week) {
  return path.join(peckingOrderDir(), `${year}-${String(week).padStart(2, '0')}.json`);
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Last-N record from H2H: { wins, losses, ties }. Reads schedule + weekly-results. */
function rollingRecord(schedule, weeklyResults, franchiseId, throughWeek, n = 3) {
  const ws = schedule?.schedule?.weeklySchedule || [];
  const weekScores = new Map();
  for (const w of (weeklyResults?.weeks || [])) {
    weekScores.set(int(w.week), w.scores || {});
  }
  const games = [];
  for (const w of ws) {
    const wk = int(w.week);
    if (wk > throughWeek) continue;
    const scores = weekScores.get(wk);
    if (!scores) continue;
    for (const m of (w.matchup || [])) {
      const fs = m.franchise || [];
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
  const slice = games.slice(-n);
  let wins = 0, losses = 0, ties = 0;
  for (const g of slice) {
    if (g.myScore > g.oppScore) wins++;
    else if (g.myScore < g.oppScore) losses++;
    else ties++;
  }
  return { wins, losses, ties, gamesCounted: slice.length };
}

// ─── Trend (vs. previous week) ──────────────────────────────────────

async function loadPreviousRankings(year, week) {
  for (let w = week - 1; w >= 1; w--) {
    const prior = await tryLoadJSON(issueFilePath(year, w));
    if (prior?.rankings?.length) return { week: w, rankings: prior.rankings };
  }
  return null;
}

// ─── Awards (deterministic; templated blurbs as fallback) ───────────

function findStatOfWeek({ teams, weeklyResults, week }) {
  const wk = (weeklyResults?.weeks || []).find(w => int(w.week) === week);
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
  const wk = (rawWeekly || []).find(w => int(w?.weeklyResults?.week) === week);
  if (!wk) return null;
  let worstFid = null, worstGap = -Infinity, worstActual = 0, worstOptimal = 0;
  for (const m of (wk.weeklyResults?.matchup || [])) {
    for (const f of (m.franchise || [])) {
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

function findMatchupOfWeek({ teams, schedule, rankings, week }) {
  const ws = schedule?.schedule?.weeklySchedule || [];
  const next = ws.find(w => int(w.week) === week + 1);
  if (!next) return null;
  const rankByFid = new Map(rankings.map(r => [r.franchiseId, r.rank]));
  let pick = null, pickScore = Infinity;
  for (const m of (next.matchup || [])) {
    const fs = m.franchise || [];
    if (fs.length !== 2) continue;
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

function buildStandingsSnapshot({ teams, divisions, standingsByFid }) {
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

export async function generatePeckingOrder({ year, week, useAI = false }) {
  const dir = feedDir(year);
  const teamsConfig = await loadTeamsConfig();

  const [weeklyResults, rawWeekly, standings, schedule] = await Promise.all([
    loadJSON(path.join(dir, 'weekly-results.json')),
    tryLoadJSON(path.join(dir, 'weekly-results-raw.json')),
    loadJSON(path.join(dir, 'standings.json')),
    tryLoadJSON(path.join(dir, 'schedule.json')),
  ]);

  const standingsByFid = new Map();
  for (const f of (standings?.leagueStandings?.franchise || [])) {
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
  const previous = await loadPreviousRankings(year, week);
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
    schedule,
    rankings: namedRankings,
    week,
  });

  // Templated blurbs (deterministic fallback voice). Structured facts ride
  // along so the AI fact sheet can reference them; stripped before write.
  const rankings = namedRankings.map(r => {
    const last3Record = rollingRecord(schedule, weeklyResults, r.franchiseId, week, 3);
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
    issue = await applySchefterVoice(issue, teamsConfig.teams);
  }

  // Strip transient fact-bag from output rows
  issue.rankings = issue.rankings.map(({ factsForBlurb, ...rest }) => rest);

  return { issue, teams: teamsConfig.teams };
}

async function applySchefterVoice(issue, teams) {
  const factSheet = buildFactSheet({ issue, teams });
  console.log('  Calling Claude for Schefter voice…');
  let aiOutput;
  try {
    aiOutput = await callAnthropic(getSystemPrompt(), getUserPrompt(factSheet), 4000);
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

export function buildGroupMeAnnouncement(issue, teams) {
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
  const origin = leagueOrigin(LEAGUE);
  lines.push(`Full rankings, awards, and standings ▸ ${origin}/pecking-order`);
  return lines.join('\n');
}

async function postAnnouncement(issue, teams) {
  const text = buildGroupMeAnnouncement(issue, teams);
  const { posted } = await postToGroupMe({
    botId: process.env.GROUPME_SCHEFTER_BOT_ID,
    text,
    checkStatus: true,
    onMissingBotId: () => console.log('  [groupme] GROUPME_SCHEFTER_BOT_ID not set — skipping announcement.'),
    onPosted: () => console.log('  [groupme] announcement posted.'),
    onHttpError: (status) => console.warn(`  [groupme] announcement failed: HTTP ${status}`),
    onFetchError: (err) => console.warn(`  [groupme] announcement failed: ${err.message}`),
  });
  if (!posted) console.log('  [groupme] announcement not delivered (see above).');
}

async function main() {
  const opts = parseArgs();

  const year = opts.year ?? currentSeasonYear();

  // Resolve the target week: explicit flag wins, else last completed week
  // from the feeds. No completed week (offseason / pre-Week-1) → clean exit.
  let week = opts.week;
  if (week == null) {
    const weeklyResults = await tryLoadJSON(path.join(feedDir(year), 'weekly-results.json'));
    const teamsConfig = await loadTeamsConfig();
    week = getCompletedWeek(weeklyResults ?? { weeks: [] }, teamsConfig.teams.size || 16);
    if (!week) {
      console.log(`  [skip] No completed week in ${year} feeds yet (offseason). Exiting cleanly.`);
      return;
    }
  }

  console.log(`🐔 ${COLUMN_NAME} — ${year} Week ${week}\n`);

  const outPath = issueFilePath(year, week);
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

  const { issue, teams } = await generatePeckingOrder({ year, week, useAI });

  if (opts.dryRun) {
    console.log('--- DRY RUN ---');
    console.log(JSON.stringify(issue, null, 2));
    console.log('--- GROUPME PREVIEW ---');
    console.log(buildGroupMeAnnouncement(issue, teams));
    return;
  }

  await fs.mkdir(peckingOrderDir(), { recursive: true });
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
    await postAnnouncement(issue, teams);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
