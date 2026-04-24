/**
 * Draft Grades — Grade each team's rookie draft haul.
 * Manual dispatch only. Requires draft picks to have player selections.
 *
 * Uses the grade card format (like auction-recap) with intro[] + grades[].
 * AI output: { headline, excerpt, intro: string[], grades: [{franchiseId, grade, headline, body}] }
 */

import { loadTeams, flipName, normalizePosition, formatDefName } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isDraftComplete } from '../article-utils/season-guards.mjs';

const VALID_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

export const config = {
  id: (year) => `sf_${year}_draft_grades`,
  requiredData: ['draftResults', 'players', 'projectedScores', 'league'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 6000,
};

export function guardSeason(week, year, now, extra) {
  // Draft completion is checked in buildFactSheet with actual data.
  // Guard here is a no-op — the script self-guards via --week override or manual dispatch.
  return true;
}

export async function buildFactSheet(data, week, year, projectRoot) {
  if (!isDraftComplete(data.draftResults)) {
    throw new Error('Draft not complete — no picks with player selections found.');
  }

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

  // Build projections map
  const projections = new Map();
  for (const ps of data.projectedScores.projectedScores?.playerScore || []) {
    projections.set(ps.id, parseFloat(ps.score || 0));
  }

  // Parse draft results
  const picks = data.draftResults.draftResults?.draftUnit?.draftPick || [];
  const completedPicks = picks.filter(p => p.player && p.player.trim() !== '');

  // Group by franchise
  const draftByFranchise = {};
  for (const pick of completedPicks) {
    const fid = pick.franchise;
    if (!draftByFranchise[fid]) draftByFranchise[fid] = [];
    const playerInfo = players.get(pick.player);
    draftByFranchise[fid].push({
      round: parseInt(pick.round, 10),
      pick: parseInt(pick.pick, 10),
      playerId: pick.player,
      name: playerInfo?.name ?? `Player ${pick.player}`,
      position: playerInfo?.position ?? '??',
      nflTeam: playerInfo?.team ?? '??',
      projectedScore: projections.get(pick.player) || 0,
    });
  }

  const lines = [];
  lines.push(`${year} ROOKIE DRAFT GRADES — TheLeague`);
  lines.push(`Total picks made: ${completedPicks.length}`);
  lines.push('');

  lines.push('=== FRANCHISE-BY-FRANCHISE DRAFT DATA ===');
  lines.push('(Grade each team. Use ONLY this data. Do not invent facts.)');
  lines.push('');

  const franchiseIds = [];
  for (const [fid, draftPicks] of Object.entries(draftByFranchise).sort((a, b) => a[0].localeCompare(b[0]))) {
    const teamInfo = teams.get(fid);
    franchiseIds.push(fid);

    const avgProj = draftPicks.reduce((s, p) => s + p.projectedScore, 0) / draftPicks.length;
    const positions = {};
    for (const p of draftPicks) positions[p.position] = (positions[p.position] || 0) + 1;

    lines.push(`── ${teamInfo?.name ?? fid} [franchiseId="${fid}"] ──`);
    lines.push(`  Total picks: ${draftPicks.length}`);
    lines.push(`  Avg projected score: ${avgProj.toFixed(1)}/week`);
    lines.push(`  Position distribution: ${Object.entries(positions).map(([p, c]) => `${c} ${p}`).join(', ')}`);
    lines.push(`  Picks:`);
    for (const p of draftPicks.sort((a, b) => a.round - b.round || a.pick - b.pick)) {
      lines.push(`    Round ${p.round}, Pick ${p.pick}: ${p.position} ${p.name} (${p.nflTeam}) — proj ${p.projectedScore.toFixed(1)}/week`);
    }
    lines.push('');
  }

  // League-wide stats
  lines.push('=== LEAGUE-WIDE DRAFT STATS ===');
  const allPicks = Object.values(draftByFranchise).flat();
  const posBreakdown = {};
  for (const p of allPicks) posBreakdown[p.position] = (posBreakdown[p.position] || 0) + 1;
  lines.push(`Position breakdown: ${Object.entries(posBreakdown).map(([p, c]) => `${c} ${p}`).join(', ')}`);

  const bestPick = allPicks.sort((a, b) => b.projectedScore - a.projectedScore)[0];
  if (bestPick) {
    const pickerTeam = teams.get(Object.entries(draftByFranchise).find(([, picks]) => picks.includes(bestPick))?.[0] ?? '');
    lines.push(`Highest projected pick: ${bestPick.position} ${bestPick.name} (${bestPick.projectedScore.toFixed(1)}/week) by ${pickerTeam?.name ?? 'unknown'}`);
  }

  lines.push('');
  lines.push('GRADING CRITERIA:');
  lines.push('  1. VALUE: Did they get projected production relative to their draft position?');
  lines.push('  2. ROSTER FIT: Do these picks fill needs or create redundancy?');
  lines.push('  3. DYNASTY UPSIDE: Young players with high ceilings are more valuable than safe floors.');
  lines.push('  4. DRAFT CAPITAL: Teams with more picks had more chances — grade accordingly.');

  return {
    factSheet: lines.join('\n'),
    enrichment: { draftByFranchise, teams, franchiseIds },
  };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Draft Grades
Grade each team's rookie draft class. Be harsh with reaches (players picked too early relative to projections), praise value picks. Dynasty drafts are about upside — young players with high ceilings are more valuable. Consider roster fit and how many picks each team had to work with.`);
}

export function getUserPrompt(factSheet) {
  return `Write rookie draft grades using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "intro": ["<p>Opening paragraph — set the scene for the draft.</p>"],
  "grades": [
    {
      "franchiseId": "0001",  // MUST be the 4-digit ID from [franchiseId="XXXX"] in the fact sheet
      "grade": "A",
      "headline": "Punchy 5-8 word summary",
      "body": "<p>2-3 sentences explaining the grade. Reference specific picks. Use <strong> for player names.</p>"
    }
  ]
}

INSTRUCTIONS:
- Write 1-2 intro paragraphs.
- Grade every franchise that made picks. Sort grades best to worst.
- Grade scale: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F
- Be bold. Spread grades out — not everyone gets a B.
- Every player name must come from the fact sheet.`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.intro || aiOutput.intro.length < 1) errors.push('Missing intro paragraphs');
  if (!aiOutput.grades || aiOutput.grades.length < 3) errors.push('Too few grades');
  for (const g of (aiOutput.grades || [])) {
    if (!VALID_GRADES.includes(g.grade)) errors.push(`Invalid grade "${g.grade}" for ${g.franchiseId}`);
  }
  return errors;
}

export function buildPost(aiOutput, enrichment, articleId) {
  // Build abbrev→ID lookup for fallback resolution (AI sometimes uses abbrevs)
  const abbrevToId = new Map();
  if (enrichment.teams) {
    for (const [id, info] of enrichment.teams) {
      abbrevToId.set(info.abbrev?.toUpperCase(), id);
      abbrevToId.set(info.name?.toUpperCase(), id);
    }
  }

  // Enrich grades with deterministic team data
  const grades = (aiOutput.grades || []).map(g => {
    let fid = g.franchiseId;
    if (!enrichment.teams?.has(fid)) {
      const resolved = abbrevToId.get(fid?.toUpperCase());
      if (resolved) {
        fid = resolved;
        g.franchiseId = fid;
      }
    }
    const teamInfo = enrichment.teams?.get(fid);
    const picks = enrichment.draftByFranchise?.[fid] || [];
    return {
      ...g,
      teamName: teamInfo?.name,
      abbrev: teamInfo?.abbrev,
      color: teamInfo?.color,
      pickups: picks.map(p => ({
        name: p.name,
        position: p.position,
        salary: `Round ${p.round}, Pick ${p.pick}`,
      })),
    };
  });

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
    linkLabel: 'Read draft grades',
    league: 'theleague',
    authorId: 'claude',
    intro: aiOutput.intro,
    grades,
  };
}
