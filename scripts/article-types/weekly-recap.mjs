/**
 * Weekly Recap — Week N recap article.
 * Runs Tuesday 6am PT after the previous week's games are complete.
 *
 * Fact sheet: All 8 matchups with scores + top scorers, standings, storylines.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadPlayers, loadTeams, formatSalary } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';

export const config = {
  id: (year, week) => `sf_${year}_weekly_recap_w${String(week).padStart(2, '0')}`,
  requiredData: ['weekly-results-raw', 'weekly-results', 'standings', 'players', 'league'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 4000,
};

export function guardSeason(week, year, now, { completedWeek }) {
  return isRegularSeasonOrPlayoffs(completedWeek);
}

export async function buildFactSheet(data, week, year, projectRoot) {
  const players = new Map();
  for (const p of data.players.players.player) {
    if (p.id) players.set(p.id, { name: p.name, position: p.position, team: p.team });
  }

  const teams = await loadTeams(projectRoot);

  // Find the target week in raw results
  const weekData = data['weekly-results-raw'].find(w =>
    String(w?.weeklyResults?.week) === String(week)
  );

  const lines = [];
  lines.push(`WEEK ${week} RECAP — TheLeague (${year} Season)`);
  lines.push('');

  // Matchup results
  lines.push('=== MATCHUP RESULTS ===');
  const matchups = weekData?.weeklyResults?.matchup || [];
  const teamScores = {};

  for (const matchup of matchups) {
    const [f1, f2] = matchup.franchise || [];
    if (!f1 || !f2) continue;

    const t1 = teams.get(f1.id);
    const t2 = teams.get(f2.id);
    const s1 = parseFloat(f1.score ?? f1.spread ?? 0);
    const s2 = parseFloat(f2.score ?? f2.spread ?? 0);

    teamScores[f1.id] = s1;
    teamScores[f2.id] = s2;

    const winner = s1 > s2 ? t1?.name : s2 > s1 ? t2?.name : 'TIE';
    lines.push(`${t1?.name ?? f1.id} ${s1.toFixed(2)} vs ${t2?.name ?? f2.id} ${s2.toFixed(2)} — Winner: ${winner}`);

    // Top scorers per team from starter data
    for (const f of [f1, f2]) {
      const teamName = teams.get(f.id)?.name ?? f.id;
      const starters = (f.player || [])
        .filter(p => p.status === 'starter' && p.score)
        .map(p => {
          const info = players.get(p.id);
          const name = info ? (info.name.includes(',') ? `${info.name.split(', ')[1]} ${info.name.split(', ')[0]}` : info.name) : `Player ${p.id}`;
          return { name, position: info?.position ?? '??', score: parseFloat(p.score) };
        })
        .sort((a, b) => b.score - a.score);

      if (starters.length > 0) {
        const top3 = starters.slice(0, 3).map(s => `${s.position} ${s.name} (${s.score.toFixed(2)})`).join(', ');
        lines.push(`  ${teamName} top scorers: ${top3}`);
      }
    }
    lines.push('');
  }

  // Standings
  lines.push('=== STANDINGS (After Week ' + week + ') ===');
  const standings = data.standings.leagueStandings?.franchise || [];
  const sorted = [...standings].sort((a, b) => {
    const wa = parseInt(a.h2hw || 0) + parseInt(a.divw || 0) + parseInt(a.nondivw || 0);
    const wb = parseInt(b.h2hw || 0) + parseInt(b.divw || 0) + parseInt(b.nondivw || 0);
    if (wb !== wa) return wb - wa;
    return parseFloat(b.pf || 0) - parseFloat(a.pf || 0);
  });

  for (const [i, f] of sorted.entries()) {
    const t = teams.get(f.id);
    const wins = parseInt(f.h2hw || 0) + parseInt(f.divw || 0) + parseInt(f.nondivw || 0);
    const losses = parseInt(f.h2hl || 0) + parseInt(f.divl || 0) + parseInt(f.nondivl || 0);
    const pf = parseFloat(f.pf || 0).toFixed(2);
    const pa = parseFloat(f.pa || 0).toFixed(2);
    const streak = f.strk || '';
    lines.push(`  ${i + 1}. ${t?.name ?? f.id} (${wins}-${losses}) PF: ${pf} PA: ${pa} ${streak ? `Streak: ${streak}` : ''}`);
  }
  lines.push('');

  // Storylines
  lines.push('=== KEY STORYLINES ===');
  const scores = Object.entries(teamScores);
  if (scores.length > 0) {
    const highest = scores.sort((a, b) => b[1] - a[1])[0];
    const lowest = scores.sort((a, b) => a[1] - b[1])[0];
    lines.push(`Highest scorer: ${teams.get(highest[0])?.name} at ${highest[1].toFixed(2)}`);
    lines.push(`Lowest scorer: ${teams.get(lowest[0])?.name} at ${lowest[1].toFixed(2)}`);

    // Biggest blowout and closest game
    let biggestMargin = 0, biggestMatchup = '';
    let closestMargin = Infinity, closestMatchup = '';
    for (const matchup of matchups) {
      const [f1, f2] = matchup.franchise || [];
      if (!f1 || !f2) continue;
      const s1 = parseFloat(f1.score ?? f1.spread ?? 0);
      const s2 = parseFloat(f2.score ?? f2.spread ?? 0);
      const margin = Math.abs(s1 - s2);
      if (margin > biggestMargin) {
        biggestMargin = margin;
        biggestMatchup = `${teams.get(f1.id)?.name} vs ${teams.get(f2.id)?.name} (${margin.toFixed(2)} pt margin)`;
      }
      if (margin < closestMargin) {
        closestMargin = margin;
        closestMatchup = `${teams.get(f1.id)?.name} vs ${teams.get(f2.id)?.name} (${margin.toFixed(2)} pt margin)`;
      }
    }
    if (biggestMatchup) lines.push(`Biggest blowout: ${biggestMatchup}`);
    if (closestMatchup) lines.push(`Closest game: ${closestMatchup}`);
  }

  return { factSheet: lines.join('\n'), enrichment: {} };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Weekly Recap
Write like a Monday morning ESPN column. Lead with the biggest story of the week — the biggest upset, the highest score, or the most dramatic finish. Weave in standings implications. End with a look-ahead to next week.`);
}

export function getUserPrompt(factSheet) {
  return `Write a Week N recap article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card. Hook the reader.",
  "content": ["<p>First paragraph — lead with the biggest story.</p>", "<p>Second paragraph — matchup highlights.</p>", "<p>More analysis paragraphs...</p>", "<p>Closing — standings implications and look-ahead.</p>"]
}

INSTRUCTIONS:
- Write 4-6 content paragraphs covering the week's action.
- Lead with the biggest story (upset, blowout, high scorer).
- Reference specific players and scores from the fact sheet.
- Include standings implications.
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
    linkLabel: 'Read full recap',
    league: 'theleague',
    authorId: 'claude',
    content: aiOutput.content,
  };
}
