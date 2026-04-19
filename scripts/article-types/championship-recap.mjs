/**
 * Championship Recap — Season champion crowned.
 * Manual dispatch only. Validates week 17 scores are in.
 *
 * Fact sheet: Championship matchup score, starters + individual scores, season records.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, flipName, normalizePosition, formatDefName } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isChampionshipComplete } from '../article-utils/season-guards.mjs';

const CHAMPIONSHIP_WEEK = 17;

export const config = {
  id: (year) => `sf_${year}_championship_recap`,
  requiredData: ['weekly-results-raw', 'standings', 'players', 'league'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 4000,
};

export function guardSeason(week, year, now, { completedWeek }) {
  return isChampionshipComplete(completedWeek);
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

  // Find championship week data
  const weekData = data['weekly-results-raw'].find(w =>
    String(w?.weeklyResults?.week) === String(CHAMPIONSHIP_WEEK)
  );

  const lines = [];
  lines.push(`${year} CHAMPIONSHIP RECAP — TheLeague`);
  lines.push('');

  if (!weekData?.weeklyResults?.matchup) {
    lines.push('Championship data not yet available.');
    return { factSheet: lines.join('\n'), enrichment: {} };
  }

  // Find the championship matchup (typically the first matchup in week 17)
  const matchups = weekData.weeklyResults.matchup;

  lines.push('=== CHAMPIONSHIP GAME (Week 17) ===');
  for (const matchup of matchups) {
    const [f1, f2] = matchup.franchise || [];
    if (!f1 || !f2) continue;

    const t1 = teams.get(f1.id);
    const t2 = teams.get(f2.id);
    const s1 = parseFloat(f1.score ?? f1.spread ?? 0);
    const s2 = parseFloat(f2.score ?? f2.spread ?? 0);

    const isChampionshipMatchup = matchup.playoffGame || matchup.playoffRound;
    // In playoff weeks, all matchups matter — include all of them
    const winner = s1 > s2 ? t1 : t2;
    const loser = s1 > s2 ? t2 : t1;
    const winScore = Math.max(s1, s2);
    const loseScore = Math.min(s1, s2);

    lines.push(`${t1?.name ?? f1.id} ${s1.toFixed(2)} vs ${t2?.name ?? f2.id} ${s2.toFixed(2)}`);
    lines.push(`Winner: ${winner?.name} | Margin: ${(winScore - loseScore).toFixed(2)} points`);

    // Starters with individual scores
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

      lines.push(`  ${teamName} starters:`);
      for (const s of starters) {
        lines.push(`    ${s.position} ${s.name} — ${s.score.toFixed(2)}`);
      }
    }
    lines.push('');
  }

  // Season context from standings
  lines.push('=== SEASON CONTEXT ===');
  for (const f of data.standings.leagueStandings?.franchise || []) {
    const t = teams.get(f.id);
    const wins = parseInt(f.h2hw || 0) + parseInt(f.divw || 0) + parseInt(f.nondivw || 0);
    const losses = parseInt(f.h2hl || 0) + parseInt(f.divl || 0) + parseInt(f.nondivl || 0);
    const pf = parseFloat(f.pf || 0).toFixed(2);
    lines.push(`  ${t?.name ?? f.id}: ${wins}-${losses}, PF: ${pf}`);
  }

  return { factSheet: lines.join('\n'), enrichment: {} };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Championship Recap
This is the biggest article of the year. Crown the champion with all the fanfare they deserve. Celebrate greatness — the MVP performances, the dynasty implications. This team just won the whole damn thing. Make it feel like a coronation. But also give the runner-up credit for getting there.`);
}

export function getUserPrompt(factSheet) {
  return `Write a championship recap article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars, crown the champion)",
  "excerpt": "2-3 sentence teaser — the championship result and why it matters.",
  "content": ["<p>Opening — the champion is crowned.</p>", "<p>The championship game breakdown.</p>", "<p>MVP performances.</p>", "<p>Season in review / dynasty implications.</p>"]
}

INSTRUCTIONS:
- Write 4-6 content paragraphs.
- Lead with the champion — name them, celebrate them.
- Break down the championship game score and key performers.
- Give credit to the runner-up.
- Put the season in context — was this a dynasty? An upset? A coronation?
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
    linkLabel: 'Read championship recap',
    league: 'theleague',
    authorId: 'claude',
    content: aiOutput.content,
  };
}
