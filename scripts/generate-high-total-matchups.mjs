#!/usr/bin/env node

/**
 * Generate high-total NFL matchup blurbs.
 * Steps:
 * 1) Build the high-total game list from local data.
 * 2) Call the blurb prompt once for all games.
 * 3) Drop any hook >=100 chars.
 * 4) Save to data/theleague/high-total-matchups.json.
 *
 * Env:
 *   ANTHROPIC_API_KEY - required to call Claude
 *   MODEL_NAME        - optional override (default: claude-3-5-haiku-20241022)
 *   SCHEDULE_PATH     - optional path to nfl-cache file (default: data/theleague/nfl-cache/week15-2024.json)
 *   PLAYERS_PATH      - optional path to players.json (default: data/theleague/mfl-feeds/2025/players.json)
 *   PROJECTIONS_PATH  - optional path to projectedScores.json (default: data/theleague/mfl-feeds/2025/projectedScores.json)
 *   OUTPUT_PATH       - optional output path (default: data/theleague/high-total-matchups.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Anthropic } from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const defaults = {
  schedule: 'data/theleague/nfl-cache/week15-2024.json',
  players: 'data/theleague/mfl-feeds/2025/players.json',
  projections: 'data/theleague/mfl-feeds/2025/projectedScores.json',
  output: 'data/theleague/high-total-matchups.json'
};

const paths = {
  schedule: path.join(root, process.env.SCHEDULE_PATH || defaults.schedule),
  players: path.join(root, process.env.PLAYERS_PATH || defaults.players),
  projections: path.join(root, process.env.PROJECTIONS_PATH || defaults.projections),
  output: path.join(root, process.env.OUTPUT_PATH || defaults.output)
};

const modelName = process.env.MODEL_NAME || 'claude-3-5-haiku-20241022';

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function normalizeTeamCode(teamCode) {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  const map = {
    WAS: 'WSH',
    JAC: 'JAX',
    GBP: 'GB',
    KCC: 'KC',
    NEP: 'NE',
    NOS: 'NO',
    SFO: 'SF',
    TBB: 'TB',
    LVR: 'LV',
    HST: 'HOU',
    BLT: 'BAL',
    CLV: 'CLE',
    ARZ: 'ARI'
  };
  return map[upper] || upper;
}

function getHighTotalGames(scheduleData, playersData, projectionsData) {
  const week = scheduleData.week;
  const schedule = scheduleData.schedule || {};
  const gameDetails = scheduleData.gameDetails || {};

  const playerMap = new Map();
  const playersList = Array.isArray(playersData.players?.player)
    ? playersData.players.player
    : playersData.players?.player
      ? [playersData.players.player]
      : [];

  playersList.forEach((p) => playerMap.set(p.id, p));

  const teamPlayers = new Map();
  const teamTotals = new Map();

  const scoresList = Array.isArray(projectionsData.projectedScores?.playerScore)
    ? projectionsData.projectedScores.playerScore
    : projectionsData.projectedScores?.playerScore
      ? [projectionsData.projectedScores.playerScore]
      : [];

  scoresList.forEach((ps) => {
    const player = playerMap.get(ps.id);
    if (player) {
      const team = normalizeTeamCode(player.team);
      const score = parseFloat(ps.score) || 0;
      teamTotals.set(team, (teamTotals.get(team) || 0) + score);
      if (!teamPlayers.has(team)) teamPlayers.set(team, []);
      teamPlayers.get(team).push({ name: player.name, score });
    }
  });

  const processedGames = new Set();
  const highTotalGames = [];

  Object.entries(schedule).forEach(([teamCode, opponentCode]) => {
    const team1 = normalizeTeamCode(teamCode);
    const team2 = normalizeTeamCode(opponentCode);
    const key = [team1, team2].sort().join('-');
    if (processedGames.has(key)) return;
    processedGames.add(key);

    const team1Total = parseFloat(((teamTotals.get(team1) || 0)).toFixed(1));
    const team2Total = parseFloat(((teamTotals.get(team2) || 0)).toFixed(1));
    const combinedTotal = parseFloat((team1Total + team2Total).toFixed(1));

    if (combinedTotal >= 50 || team1Total >= 30 || team2Total >= 30) {
      const getTopPlayers = (t) =>
        (teamPlayers.get(t) || [])
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((p) => ({ player: p.name, projectedPoints: p.score, injury: null }));

      const detailKey1 = `${team1}_vs_${team2}`;
      const detailKey2 = `${team2}_vs_${team1}`;
      const details = gameDetails[detailKey1] || gameDetails[detailKey2] || {};

      highTotalGames.push({
        gameId: `${team1}@${team2}`,
        team1,
        team2,
        team1Total,
        team2Total,
        combinedTotal,
        topPlayersTeam1: getTopPlayers(team1),
        topPlayersTeam2: getTopPlayers(team2),
        day: details.day || 'Sun',
        time: details.time || '10:00 AM PST',
        channel: details.channel || '',
        weather: details.weather || ''
      });
    }
  });

  highTotalGames.sort((a, b) => b.combinedTotal - a.combinedTotal);

  return { week, highTotalGames };
}

function buildPrompt(analysis) {
  const systemPrompt =
    'You write ultra-tight betting-style blurbs. No filler. Direct, data-led, and under 100 characters per blurb.';

  const userPrompt = [
    'Given this pre-filtered high-total games JSON (from the data step):',
    JSON.stringify(analysis, null, 2),
    '',
    'Write one blurb per game. Each blurb must:',
    '- Be <100 characters; if any blurb is 100+ chars, reject and rewrite shorter.',
    '- Focus on the top 1-2 angles: high team total, pace mismatch, red-zone edge, key injury, weather if impactful.',
    '- Only include the top 1-2 angles (e.g., injury impact, defensive ranking, weather). Drop everything else.',
    '- No narratives; output a single sentence fragment. No fluff.',
    '',
    'Return JSON only (no markdown). Output contract per item:',
    '{',
    '  "matchup": "KC @ LV",',
    '  "hook": "Mahomes faces 30+ total, LV 30th vs deep ball",',
    '  "teamTotal": 31.2,',
    '  "combinedTotal": 59.0,',
    '  "keyStat": "LV 30th vs deep passes",',
    '  "chars": 74',
    '}',
    '',
    'Constraints: JSON array only. Fields per item: matchup, hook, teamTotal, combinedTotal, keyStat (optional), chars (<100). No extra text.'
  ].join('\n');

  return { systemPrompt, userPrompt };
}

async function callModel(systemPrompt, userPrompt) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set; skipping API call.');
    return null;
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: modelName,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  const text = (resp.content || [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .trim();
  return text;
}

function postProcess(raw, analysis) {
  // Strip markdown code blocks if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse model JSON:', err);
    console.error('Raw response:', raw);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('Model response is not an array; aborting.');
    return [];
  }

  const byMatchup = new Map();
  analysis.highTotalGames.forEach((g) => {
    byMatchup.set(`${g.team1} @ ${g.team2}`, g);
  });

  return parsed
    .map((item) => {
      const matchup = item.matchup || '';
      const hook = item.hook || '';
      const chars = typeof hook === 'string' ? hook.length : 0;
      const game = byMatchup.get(matchup) || null;
      if (!game) return null;
      const teamTotal =
        typeof item.teamTotal === 'number'
          ? item.teamTotal
          : Math.max(game.team1Total, game.team2Total);
      const combinedTotal =
        typeof item.combinedTotal === 'number' ? item.combinedTotal : game.combinedTotal;
      return {
        matchup,
        hook,
        teamTotal,
        combinedTotal,
        keyStat: item.keyStat || null,
        chars,
        gameId: game.gameId,
        day: game.day,
        time: game.time,
        channel: game.channel,
        weather: game.weather
      };
    })
    .filter(Boolean)
    .filter((item) => {
      if (item.chars >= 100) {
        console.warn(`Dropping long hook (${item.chars} chars) for ${item.matchup}`);
        return false;
      }
      return true;
    });
}

async function main() {
  const scheduleData = loadJson(paths.schedule);
  const playersData = loadJson(paths.players);
  const projectionsData = loadJson(paths.projections);

  const analysis = getHighTotalGames(scheduleData, playersData, projectionsData);
  console.log(`Found ${analysis.highTotalGames.length} high-total games for week ${analysis.week}.`);

  const { systemPrompt, userPrompt } = buildPrompt(analysis);
  const raw = await callModel(systemPrompt, userPrompt);
  if (!raw) {
    console.warn('No model response; nothing to write.');
    return;
  }

  const matchups = postProcess(raw, analysis);
  const output = {
    generatedAt: new Date().toISOString(),
    week: analysis.week,
    model: modelName,
    matchups
  };

  fs.mkdirSync(path.dirname(paths.output), { recursive: true });
  fs.writeFileSync(paths.output, JSON.stringify(output, null, 2));
  console.log(`Saved ${matchups.length} blurbs to ${paths.output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
