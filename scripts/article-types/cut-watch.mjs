/**
 * Cut Watch — Teams over the 22-man active roster limit.
 * Runs daily 8am PT during the cut window (Jul 15 – Aug 16).
 *
 * Fact sheet: Teams over limit with player-level cut candidates.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, flipName, normalizePosition, formatDefName, formatSalary } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isCutWindow } from '../article-utils/season-guards.mjs';

const ACTIVE_ROSTER_LIMIT = 22;

export const config = {
  id: (year, week) => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `sf_${year}_cut_watch_${mm}${dd}`;
  },
  requiredData: ['rosters', 'players', 'league'],
  postType: 'article',
  tier: 'standard',
  maxTokens: 4000,
};

export function guardSeason(week, year, now) {
  return isCutWindow(now);
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

  const lines = [];
  const now = new Date();
  lines.push(`CUT WATCH — TheLeague (${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})`);
  lines.push(`Active roster limit: ${ACTIVE_ROSTER_LIMIT} players`);
  lines.push('');

  const overLimit = [];
  const atLimit = [];
  const underLimit = [];

  for (const f of data.rosters.rosters?.franchise || []) {
    const fid = f.id;
    const teamInfo = teams.get(fid);
    const playerList = Array.isArray(f.player) ? f.player : (f.player ? [f.player] : []);

    // Count active roster players (status: ROSTER)
    const activeRoster = playerList.filter(p => p.status === 'ROSTER');
    const count = activeRoster.length;
    const over = count - ACTIVE_ROSTER_LIMIT;

    // Position breakdown
    const positionCounts = {};
    const rosterDetails = activeRoster.map(p => {
      const info = players.get(p.id);
      const pos = info?.position ?? '??';
      positionCounts[pos] = (positionCounts[pos] || 0) + 1;
      return {
        name: info?.name ?? `Player ${p.id}`,
        position: pos,
        salary: parseInt(parseFloat(p.salary || 0), 10),
        contractYear: parseInt(p.contractYear || 1, 10),
      };
    });

    const entry = {
      fid,
      name: teamInfo?.name ?? `Team ${fid}`,
      count,
      over,
      positionCounts,
      // Cut candidates: lowest salary, shortest contract
      cutCandidates: rosterDetails
        .sort((a, b) => a.salary - b.salary || a.contractYear - b.contractYear)
        .slice(0, Math.max(over + 2, 3)),
    };

    if (over > 0) overLimit.push(entry);
    else if (over === 0) atLimit.push(entry);
    else underLimit.push(entry);
  }

  if (overLimit.length > 0) {
    lines.push('=== TEAMS OVER THE LIMIT ===');
    for (const e of overLimit.sort((a, b) => b.over - a.over)) {
      lines.push(`── ${e.name}: ${e.count} active players (${e.over} over limit) ──`);
      const posParts = Object.entries(e.positionCounts).map(([p, c]) => `${c} ${p}`).join(', ');
      lines.push(`  Positions: ${posParts}`);
      lines.push(`  Likely cut candidates (lowest salary):`);
      for (const c of e.cutCandidates) {
        lines.push(`    - ${c.position} ${c.name} (${formatSalary(c.salary)}, ${c.contractYear}yr)`);
      }
      lines.push('');
    }
  } else {
    lines.push('=== ALL TEAMS AT OR UNDER THE LIMIT ===');
    lines.push('No teams are currently over the active roster limit.');
    lines.push('');
  }

  if (atLimit.length > 0) {
    lines.push('=== TEAMS AT THE LIMIT ===');
    for (const e of atLimit) {
      lines.push(`  ${e.name}: ${e.count} active (exactly at limit)`);
    }
    lines.push('');
  }

  if (underLimit.length > 0) {
    lines.push('=== TEAMS UNDER THE LIMIT ===');
    for (const e of underLimit.sort((a, b) => a.over - b.over)) {
      lines.push(`  ${e.name}: ${e.count} active (${Math.abs(e.over)} under)`);
    }
    lines.push('');
  }

  return { factSheet: lines.join('\n'), enrichment: {} };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Cut Watch
Channel the urgency of NFL roster cut day. Name names — who's on the chopping block? Which teams are in the toughest spots? Who has easy decisions vs. gut-wrenching ones? Talk about salary implications of keeping vs. cutting players.`);
}

export function getUserPrompt(factSheet) {
  return `Write a cut watch article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": ["<p>Paragraph 1...</p>", "<p>Paragraph 2...</p>"]
}

INSTRUCTIONS:
- Write 3-5 content paragraphs.
- Focus on teams that are over the roster limit.
- Name specific players who could be cut and why.
- Discuss which cuts are easy (low salary, redundant) vs. painful.
- If no teams are over the limit, write about who's cutting it close.
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
    linkLabel: 'Read cut watch',
    league: 'theleague',
    authorId: 'claude',
    content: aiOutput.content,
  };
}
