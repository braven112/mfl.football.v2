/**
 * Matchup Preview — Fantasy matchup analysis + NFL broadcast guide.
 * Runs Saturday 9am PT before the weekend games.
 *
 * Fact sheet: Matchup analysis + which NFL games feature rostered players + broadcast channels.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, loadJSON, flipName, normalizePosition, formatDefName } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';
import { getMatchupPairings } from '../article-utils/week-resolver.mjs';
import path from 'node:path';

export const config = {
  id: (year, week) => `sf_${year}_matchup_preview_w${String(week).padStart(2, '0')}`,
  requiredData: ['weekly-results-raw', 'projectedScores', 'standings', 'players', 'rosters', 'league'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 5000,
};

export function guardSeason(week, year, now, { currentWeek }) {
  return isRegularSeasonOrPlayoffs(currentWeek);
}

export async function buildFactSheet(data, week, year, projectRoot) {
  const players = new Map();
  for (const p of data.players.players.player) {
    if (p.id) {
      const pos = normalizePosition(p.position);
      const isDef = pos === 'Def';
      players.set(p.id, {
        name: isDef ? formatDefName(p.name) : flipName(p.name),
        position: pos,
        team: p.team,
      });
    }
  }

  const teams = await loadTeams(projectRoot);

  // Projections
  const projections = new Map();
  for (const ps of data.projectedScores.projectedScores?.playerScore || []) {
    projections.set(ps.id, parseFloat(ps.score || 0));
  }

  // Rosters
  const rosterMap = {};
  for (const f of data.rosters.rosters?.franchise || []) {
    const playerList = Array.isArray(f.player) ? f.player : (f.player ? [f.player] : []);
    rosterMap[f.id] = playerList.filter(p => p.status === 'ROSTER').map(p => p.id);
  }

  // Standings
  const standingsMap = {};
  for (const f of data.standings.leagueStandings?.franchise || []) {
    const wins = parseInt(f.h2hw || 0) + parseInt(f.divw || 0) + parseInt(f.nondivw || 0);
    const losses = parseInt(f.h2hl || 0) + parseInt(f.divl || 0) + parseInt(f.nondivl || 0);
    standingsMap[f.id] = { wins, losses };
  }

  const pairings = getMatchupPairings(data['weekly-results-raw'], week);

  const lines = [];
  lines.push(`WEEK ${week} MATCHUP PREVIEW + BROADCAST GUIDE — TheLeague (${year} Season)`);
  lines.push('');

  // Track NFL teams with rostered players for broadcast guide
  const nflTeamPlayers = {}; // nflTeam → [{player, position, franchiseName}]

  // Matchup analysis
  for (const [idx, { franchise1Id, franchise2Id }] of pairings.entries()) {
    const t1 = teams.get(franchise1Id);
    const t2 = teams.get(franchise2Id);
    const s1 = standingsMap[franchise1Id] || { wins: 0, losses: 0 };
    const s2 = standingsMap[franchise2Id] || { wins: 0, losses: 0 };

    lines.push(`=== MATCHUP ${idx + 1}: ${t1?.name ?? franchise1Id} (${s1.wins}-${s1.losses}) vs ${t2?.name ?? franchise2Id} (${s2.wins}-${s2.losses}) ===`);

    for (const [fid, teamInfo] of [[franchise1Id, t1], [franchise2Id, t2]]) {
      const roster = rosterMap[fid] || [];
      const projected = roster
        .map(pid => {
          const info = players.get(pid);
          const proj = projections.get(pid) || 0;
          return info ? { name: info.name, position: info.position, proj, nflTeam: info.team } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.proj - a.proj);

      const starters = projected.slice(0, 9);
      const totalProj = starters.reduce((s, p) => s + p.proj, 0);

      lines.push(`  ${teamInfo?.name ?? fid} (projected ${totalProj.toFixed(1)}):`);
      for (const s of starters.slice(0, 5)) {
        lines.push(`    ${s.position} ${s.name} (${s.nflTeam}) — proj ${s.proj.toFixed(1)}`);

        // Track for broadcast guide
        if (s.nflTeam && s.nflTeam !== '??') {
          if (!nflTeamPlayers[s.nflTeam]) nflTeamPlayers[s.nflTeam] = [];
          nflTeamPlayers[s.nflTeam].push({
            player: s.name,
            position: s.position,
            franchise: teamInfo?.name ?? fid,
          });
        }
      }
    }
    lines.push('');
  }

  // NFL Broadcast Guide
  lines.push('=== NFL BROADCAST GUIDE ===');
  lines.push('Key NFL games featuring TheLeague rostered starters:');

  // Load broadcast mappings
  const mainRepo = projectRoot.includes('.claude/worktrees/')
    ? projectRoot.replace(/\.claude\/worktrees\/[^/]+$/, '')
    : projectRoot;
  let broadcastData;
  try {
    broadcastData = await loadJSON(path.join(mainRepo, 'data', 'theleague', 'broadcast-mappings.json'));
  } catch {
    broadcastData = null;
  }

  const nflTeams = Object.keys(nflTeamPlayers).sort();
  for (const nflTeam of nflTeams) {
    const rostered = nflTeamPlayers[nflTeam];
    const playerList = rostered.map(r => `${r.position} ${r.player} (${r.franchise})`).join(', ');
    lines.push(`  ${nflTeam}: ${playerList}`);
  }

  if (broadcastData?.countries?.US?.channels) {
    lines.push('');
    lines.push('US Broadcast channels: ' + Object.keys(broadcastData.countries.US.channels).join(', '));
  }

  return { factSheet: lines.join('\n'), enrichment: {} };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Matchup Preview + Broadcast Guide
Break down each fantasy matchup in TheLeague for the week. Pick winners for each matchup — be bold, be wrong sometimes, that's what makes it fun. Include a section about which NFL games to watch based on rostered players. This is the Saturday morning "what to watch" guide.`);
}

export function getUserPrompt(factSheet) {
  return `Write a matchup preview + broadcast guide article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": ["<p>Opening paragraph...</p>", "<p>Matchup breakdowns...</p>", "<p>Broadcast guide section...</p>"]
}

INSTRUCTIONS:
- Write 5-8 content paragraphs.
- Cover at least the top 3-4 most interesting matchups.
- Pick winners for each matchup — be bold.
- Include a broadcast guide section (which NFL games to watch for fantasy implications).
- Reference specific projected scores and player names from the fact sheet.
- Every name and number must come from the fact sheet.`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.content || aiOutput.content.length < 3) errors.push('Too few content paragraphs');
  return errors;
}

export function buildPost(aiOutput, enrichment, articleId) {
  return {
    id: articleId,
    timestamp: new Date().toISOString(),
    type: 'article',
    category: 'articles',
    tier: config.tier,
    headline: aiOutput.headline,
    body: aiOutput.excerpt,
    franchiseIds: [],
    link: `/theleague/news/${articleId}`,
    linkLabel: 'Read matchup preview',
    league: 'theleague',
    authorId: 'claude',
    content: aiOutput.content,
  };
}
