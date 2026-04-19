/**
 * Weekend Preview — Key storylines for the upcoming NFL weekend.
 * Runs Friday 8am PT before the weekend slate.
 *
 * Fact sheet: Each matchup with team records + projected scores for top starters.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, flipName, normalizePosition, formatDefName } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';
import { getMatchupPairings } from '../article-utils/week-resolver.mjs';

export const config = {
  id: (year, week) => `sf_${year}_weekend_preview_w${String(week).padStart(2, '0')}`,
  requiredData: ['weekly-results-raw', 'projectedScores', 'standings', 'players', 'rosters', 'league'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 4000,
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

  // Build projected scores map
  const projections = new Map();
  const projData = data.projectedScores.projectedScores?.playerScore || [];
  for (const ps of projData) {
    projections.set(ps.id, parseFloat(ps.score || 0));
  }

  // Build roster map: franchiseId → [playerId]
  const rosterMap = {};
  for (const f of data.rosters.rosters?.franchise || []) {
    const playerList = Array.isArray(f.player) ? f.player : (f.player ? [f.player] : []);
    rosterMap[f.id] = playerList
      .filter(p => p.status === 'ROSTER')
      .map(p => p.id);
  }

  // Get matchup pairings
  const pairings = getMatchupPairings(data['weekly-results-raw'], week);

  // Standings for records
  const standingsMap = {};
  for (const f of data.standings.leagueStandings?.franchise || []) {
    const wins = parseInt(f.h2hw || 0) + parseInt(f.divw || 0) + parseInt(f.nondivw || 0);
    const losses = parseInt(f.h2hl || 0) + parseInt(f.divl || 0) + parseInt(f.nondivl || 0);
    standingsMap[f.id] = { wins, losses, pf: parseFloat(f.pf || 0), streak: f.strk || '' };
  }

  const lines = [];
  lines.push(`WEEK ${week} WEEKEND PREVIEW — TheLeague (${year} Season)`);
  lines.push('');

  // Build projected lineups for each matchup
  lines.push('=== PROJECTED MATCHUPS ===');
  for (const { franchise1Id, franchise2Id } of pairings) {
    const t1 = teams.get(franchise1Id);
    const t2 = teams.get(franchise2Id);
    const s1 = standingsMap[franchise1Id] || { wins: 0, losses: 0, streak: '' };
    const s2 = standingsMap[franchise2Id] || { wins: 0, losses: 0, streak: '' };

    lines.push(`── ${t1?.name ?? franchise1Id} (${s1.wins}-${s1.losses}) vs ${t2?.name ?? franchise2Id} (${s2.wins}-${s2.losses}) ──`);

    for (const [fid, teamInfo] of [[franchise1Id, t1], [franchise2Id, t2]]) {
      const roster = rosterMap[fid] || [];
      const projected = roster
        .map(pid => {
          const info = players.get(pid);
          const proj = projections.get(pid) || 0;
          return info ? { name: info.name, position: info.position, proj } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.proj - a.proj);

      // Top 9 projected starters
      const starters = projected.slice(0, 9);
      const totalProj = starters.reduce((s, p) => s + p.proj, 0);

      lines.push(`  ${teamInfo?.name ?? fid} projected starters (total: ${totalProj.toFixed(1)}):`);
      for (const s of starters) {
        lines.push(`    ${s.position} ${s.name} — ${s.proj.toFixed(1)}`);
      }
    }
    lines.push('');
  }

  // Key storylines
  lines.push('=== KEY STORYLINES ===');
  const undefeated = Object.entries(standingsMap).filter(([, s]) => s.losses === 0 && s.wins > 0);
  if (undefeated.length > 0) {
    lines.push(`Undefeated teams: ${undefeated.map(([id]) => teams.get(id)?.name).join(', ')}`);
  }
  const onSkids = Object.entries(standingsMap).filter(([, s]) => s.streak && s.streak.startsWith('L') && parseInt(s.streak.slice(1)) >= 2);
  if (onSkids.length > 0) {
    lines.push(`Teams on losing streaks: ${onSkids.map(([id, s]) => `${teams.get(id)?.name} (${s.streak})`).join(', ')}`);
  }

  return { factSheet: lines.join('\n'), enrichment: {} };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Weekend Preview
Build anticipation for the upcoming week. Identify the matchup of the week. Call out teams that need a win. Make bold predictions. This should feel like a Friday hype piece — get the owners excited about the weekend.`);
}

export function getUserPrompt(factSheet) {
  return `Write a weekend preview article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": ["<p>Paragraph 1...</p>", "<p>Paragraph 2...</p>"]
}

INSTRUCTIONS:
- Write 4-6 content paragraphs.
- Identify the matchup of the week (most competitive or highest stakes).
- Make bold predictions for 2-3 key matchups.
- Call out teams on winning/losing streaks.
- Reference specific projected scores and player matchups from the fact sheet.
- Every name and number must come from the fact sheet.`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.content || aiOutput.content.length < 2) errors.push('Too few content paragraphs');
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
    linkLabel: 'Read full preview',
    league: 'theleague',
    authorId: 'claude',
    content: aiOutput.content,
  };
}
