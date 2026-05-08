#!/usr/bin/env node
/**
 * Power Rankings Generator — Phase 1 (templated, no LLM)
 *
 * Reads weekly results + standings + schedule for the target year/week and writes
 * a structured JSON document to src/data/theleague/power-rankings/<year>-w<week>.json
 * that the /theleague/power-rankings page renders.
 *
 * Usage:
 *   pnpm generate:power-rankings --year 2025 --week 14
 *   pnpm generate:power-rankings --year 2025 --week 14 --regenerate
 *   pnpm generate:power-rankings --dry-run --year 2025 --week 14
 *
 * Phase 1 scope:
 *  - Composite ranking algorithm (rolling-3wk PF + record + all-play)
 *  - Award detection (statOfWeek, benchBlunder, heater, cooler, matchupOfWeek)
 *  - Templated blurbs — no Claude API calls
 *
 * Phase 2 will swap templated blurbs for AI-generated ones via the article-utils
 * AI client. The JSON shape is identical so the page renderer doesn't change.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callAnthropic } from './article-utils/ai-client.mjs';
import {
  buildFactSheet,
  getSystemPrompt,
  getUserPrompt,
  applyAIVoice,
} from './lib/power-rankings-ai.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ─── Algorithm weights (composite ranking score) ───────────────────
//   60% — rolling-3wk PPG (form)
//   25% — head-to-head record (results)
//   15% — all-play % (luck-adjusted strength)
// Cap-health weight from the design doc is deferred to Phase 2 (needs salary
// pipeline plumbed in). Total still sums to 1.0 by upweighting form.
const W_FORM = 0.60;
const W_RECORD = 0.25;
const W_ALL_PLAY = 0.15;

// ─── CLI ───────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { year: null, week: null, dryRun: false, regenerate: false, ai: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--year': opts.year = parseInt(args[++i], 10); break;
      case '--week': opts.week = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--regenerate': opts.regenerate = true; break;
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
  console.log(`Usage: node scripts/generate-power-rankings.mjs --year YYYY --week N [--dry-run] [--regenerate] [--ai|--no-ai]`);
  console.log(`  --ai       Force Claude voice (requires ANTHROPIC_API_KEY)`);
  console.log(`  --no-ai    Force templated voice (no API call)`);
  console.log(`  default    AI when ANTHROPIC_API_KEY is set, templated otherwise`);
}

// ─── Loaders ───────────────────────────────────────────────────────

async function loadJSON(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function loadTeamsConfig() {
  const cfg = await loadJSON(path.join(projectRoot, 'src', 'data', 'theleague.config.json'));
  const teams = new Map();
  for (const t of cfg.teams) {
    teams.set(t.franchiseId, {
      franchiseId: t.franchiseId,
      name: t.name,
      nameMedium: t.nameMedium ?? t.name,
      nameShort: t.nameShort ?? t.name,
      abbrev: t.abbrev,
      color: t.color,
      division: t.division,
      icon: t.icon,
      banner: t.banner,
    });
  }
  return { teams, divisions: cfg.divisions };
}

function feedDir(year) {
  return path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year));
}

function powerRankingsDir() {
  return path.join(projectRoot, 'src', 'data', 'theleague', 'power-rankings');
}

function rankingsFilePath(year, week) {
  return path.join(powerRankingsDir(), `${year}-w${String(week).padStart(2, '0')}.json`);
}

async function tryLoadJSON(p) {
  try { return await loadJSON(p); } catch { return null; }
}

// ─── Helpers ───────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse MFL streak string "W3" / "L4" / "" → { type: 'W'|'L'|null, length: number } */
export function parseStreak(strk) {
  if (!strk || typeof strk !== 'string') return { type: null, length: 0 };
  const m = strk.trim().match(/^([WL])(\d+)$/i);
  if (!m) return { type: null, length: 0 };
  return { type: m[1].toUpperCase(), length: parseInt(m[2], 10) };
}

/** Average team's last N completed weeks of points. Returns null if no weeks available. */
export function rollingAvgPF(weeklyResults, franchiseId, throughWeek, n = 3) {
  const weeks = (weeklyResults?.weeks || [])
    .filter(w => int(w.week) <= throughWeek && Number.isFinite(num(w.scores?.[franchiseId], NaN)))
    .sort((a, b) => int(a.week) - int(b.week));
  if (weeks.length === 0) return null;
  const slice = weeks.slice(-n);
  const sum = slice.reduce((acc, w) => acc + num(w.scores?.[franchiseId]), 0);
  return sum / slice.length;
}

/** Last-N record from H2H: { wins, losses, ties }. Reads schedule + weekly-results. */
function rollingRecord(schedule, weeklyResults, franchiseId, throughWeek, n = 3) {
  const ws = schedule?.schedule?.weeklySchedule || [];
  const weekScores = new Map();
  for (const w of (weeklyResults?.weeks || [])) {
    weekScores.set(int(w.week), w.scores || {});
  }
  // Walk completed weeks descending, record per-game outcomes for this franchise
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

/** Normalize array of values to 0-100 by min-max. */
function minMax01(values) {
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length === 0) return values.map(() => 50);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return values.map(() => 50);
  return values.map(v => Number.isFinite(v) ? ((v - min) / (max - min)) * 100 : 50);
}

// ─── Composite ranking ─────────────────────────────────────────────

export function computeRankings({ teams, standingsByFid, weeklyResults, schedule, week }) {
  const franchiseIds = [...teams.keys()];

  // Compute per-team rolling averages
  const rolling = franchiseIds.map(fid => ({
    fid,
    ppg: rollingAvgPF(weeklyResults, fid, week, 3),
    seasonPpg: num(standingsByFid.get(fid)?.avgpf, 0),
  }));

  const ppgRaw = rolling.map(r => r.ppg ?? r.seasonPpg);
  const ppgScores = minMax01(ppgRaw);

  // Record: H2H pct from standings (.000 to 1.000) → 0-100
  const recordScores = franchiseIds.map(fid => {
    const s = standingsByFid.get(fid);
    return num(s?.h2hpct, 0.5) * 100;
  });

  // All-play %: from standings → 0-100
  const allPlayScores = franchiseIds.map(fid => {
    const s = standingsByFid.get(fid);
    return num(s?.all_play_pct, 0.5) * 100;
  });

  const composite = franchiseIds.map((fid, i) =>
    W_FORM * ppgScores[i] + W_RECORD * recordScores[i] + W_ALL_PLAY * allPlayScores[i]
  );

  // Rank by composite descending
  const indexed = franchiseIds.map((fid, i) => ({
    fid,
    composite: composite[i],
    ppgScore: ppgScores[i],
    recordScore: recordScores[i],
    allPlayScore: allPlayScores[i],
    rolling3Ppg: rolling[i].ppg,
    seasonPpg: rolling[i].seasonPpg,
  }));
  indexed.sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    return b.seasonPpg - a.seasonPpg; // tiebreak
  });

  return indexed.map((row, idx) => ({ rank: idx + 1, ...row }));
}

// ─── Trend (vs. previous week) ──────────────────────────────────────

async function loadPreviousRankings(year, week) {
  // First try same-year previous week, then previous week's playoffs etc.
  for (let w = week - 1; w >= 1; w--) {
    const prior = await tryLoadJSON(rankingsFilePath(year, w));
    if (prior?.rankings?.length) return { week: w, rankings: prior.rankings };
  }
  return null;
}

export function attachTrend(rankings, previous) {
  if (!previous) {
    return rankings.map(r => ({ ...r, previousRank: null, trend: 'flat' }));
  }
  const priorMap = new Map(previous.rankings.map(r => [r.franchiseId, r.rank]));
  return rankings.map(r => {
    const prev = priorMap.get(r.fid) ?? null;
    let trend = 'flat';
    if (prev != null) {
      if (prev > r.rank) trend = 'up';
      else if (prev < r.rank) trend = 'down';
    }
    return { ...r, previousRank: prev, trend };
  });
}

// ─── Awards (deterministic; templated blurbs in Phase 1) ────────────

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
  const wk = rawWeekly.find(w => int(w?.weeklyResults?.week) === week);
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
      pick = { homeId: a.isHome === '1' ? a.id : b.id, awayId: a.isHome === '1' ? b.id : a.id, ra, rb };
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

// ─── Templated blurbs for individual rankings (Phase 1) ─────────────

function rankingBlurb(row, teams, standingsByFid, schedule, weeklyResults, week) {
  const team = teams.get(row.franchiseId);
  const standing = standingsByFid.get(row.franchiseId);
  const rec = rollingRecord(schedule, weeklyResults, row.franchiseId, week, 3);
  const ppg = row.rolling3Ppg ?? row.seasonPpg;
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
  if (trendStr) parts.push(`Rankings: ${trendStr}.`);
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

// ─── Lede headline (Phase 1 templated) ──────────────────────────────

function buildHeadlineAndLede({ teams, rankings, awards, week, year }) {
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
      return `${team?.nameShort ?? moverUp.franchiseId} surges to #${moverUp.rank}`;
    }
    return `${topTeam?.nameShort ?? top.franchiseId} hold #1 entering Week ${week + 1}`;
  })();

  const ledeParts = [`Through Week ${week}, ${topTeam?.name ?? top.franchiseId} sit atop the rankings.`];
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

export async function generatePowerRankings({ year, week, useAI = false }) {
  const dir = feedDir(year);
  const teamsConfig = await loadTeamsConfig();

  const [weeklyResults, rawWeekly, standings, schedule] = await Promise.all([
    loadJSON(path.join(dir, 'weekly-results.json')),
    loadJSON(path.join(dir, 'weekly-results-raw.json')),
    loadJSON(path.join(dir, 'standings.json')),
    loadJSON(path.join(dir, 'schedule.json')),
  ]);

  const standingsByFid = new Map();
  for (const f of (standings?.leagueStandings?.franchise || [])) {
    standingsByFid.set(f.id, f);
  }

  // Composite rankings
  const rawRankings = computeRankings({
    teams: teamsConfig.teams,
    standingsByFid,
    weeklyResults,
    schedule,
    week,
  });

  // Trend vs previous week
  const previous = await loadPreviousRankings(year, week);
  const ranked = attachTrend(rawRankings, previous);

  // Awards
  const statOfWeek = findStatOfWeek({ teams: teamsConfig.teams, weeklyResults, week });
  const benchBlunder = findBenchBlunder({ teams: teamsConfig.teams, rawWeekly, week });
  const { heater, cooler } = findHeaterAndCooler({ teams: teamsConfig.teams, standingsByFid });

  // We need a temporary rankings shape with franchiseId set for matchup lookup
  const namedRankings = ranked.map(r => ({
    rank: r.rank,
    franchiseId: r.fid,
    previousRank: r.previousRank,
    trend: r.trend,
    metrics: {
      composite: round2(r.composite),
      rolling3Ppg: r.rolling3Ppg == null ? null : round2(r.rolling3Ppg),
      seasonPpg: round2(r.seasonPpg),
      ppgScore: round2(r.ppgScore),
      recordScore: round2(r.recordScore),
      allPlayScore: round2(r.allPlayScore),
    },
  }));

  const matchupOfWeek = findMatchupOfWeek({
    teams: teamsConfig.teams,
    schedule,
    rankings: namedRankings,
    week,
  });

  // Build blurbs (templated baseline). We also stash the structured facts
  // (last3 record, streak) on each row so the AI fact sheet can reference them.
  const rankings = namedRankings.map(r => {
    const last3Record = rollingRecord(schedule, weeklyResults, r.franchiseId, week, 3);
    const streak = parseStreak(standingsByFid.get(r.franchiseId)?.strk);
    const factsForBlurb = { last3Record, streak };
    return {
      ...r,
      blurb: rankingBlurb(
        { ...r, rolling3Ppg: r.metrics.rolling3Ppg, seasonPpg: r.metrics.seasonPpg },
        teamsConfig.teams,
        standingsByFid,
        schedule,
        weeklyResults,
        week
      ),
      factsForBlurb,
    };
  });

  const awards = {
    statOfWeek,
    benchBlunder,
    tradeOfWeek: null,    // Phase 1: deferred (needs transactions parsing + dynasty model)
    cutOfShame: null,     // Phase 1: deferred (needs salary delta on cut player)
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
    year,
  });

  const generatedAt = new Date().toISOString();

  let issue = {
    year,
    week,
    publishedAt: generatedAt,
    generatedAt,
    voiceMode: 'templated',
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

  return issue;
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

async function main() {
  const opts = parseArgs();
  if (opts.year == null || opts.week == null) {
    printUsage();
    process.exit(1);
  }

  console.log(`📊 Power Rankings — ${opts.year} Week ${opts.week}\n`);

  const outPath = rankingsFilePath(opts.year, opts.week);
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

  const issue = await generatePowerRankings({ year: opts.year, week: opts.week, useAI });

  if (opts.dryRun) {
    console.log('--- DRY RUN ---');
    console.log(JSON.stringify(issue, null, 2));
    return;
  }

  await fs.mkdir(powerRankingsDir(), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(issue, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Wrote ${path.relative(projectRoot, outPath)}`);
  console.log(`  Headline: ${issue.headline}`);
  console.log(`  Top 3:`);
  for (const r of issue.rankings.slice(0, 3)) {
    console.log(`    #${r.rank} ${r.franchiseId} — ${r.blurb}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
