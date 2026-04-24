/**
 * Team Grades — Pre-season roster grades, cap health, championship window assessment.
 * Manual dispatch only (~3 weeks before NFL kickoff).
 *
 * Uses the grade card format with intro[] + grades[].
 * AI output: { headline, excerpt, intro: string[], grades: [{franchiseId, grade, headline, body}] }
 */

import { loadTeams, flipName, normalizePosition, formatDefName, formatSalary } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';

const SALARY_CAP = 45_000_000;
const VALID_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

export const config = {
  id: (year) => `sf_${year}_team_grades`,
  requiredData: ['rosters', 'players', 'projectedScores', 'standings', 'league'],
  postType: 'article',
  tier: 'breaking',
  maxTokens: 6000,
};

export function guardSeason() {
  // Manual dispatch only — always allow
  return true;
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

  // Prior year standings for context
  const priorStandings = {};
  for (const f of data.standings.leagueStandings?.franchise || []) {
    const wins = parseInt(f.h2hw || 0) + parseInt(f.divw || 0) + parseInt(f.nondivw || 0);
    const losses = parseInt(f.h2hl || 0) + parseInt(f.divl || 0) + parseInt(f.nondivl || 0);
    priorStandings[f.id] = { wins, losses, pf: parseFloat(f.pf || 0) };
  }

  const lines = [];
  lines.push(`${year} PRE-SEASON TEAM GRADES — TheLeague`);
  lines.push(`Salary cap: ${formatSalary(SALARY_CAP)}`);
  lines.push('');

  lines.push('=== FRANCHISE-BY-FRANCHISE ROSTER DATA ===');
  lines.push('(Grade each team. Use ONLY this data. Do not invent facts.)');
  lines.push('');

  const franchiseData = {};

  for (const f of data.rosters.rosters?.franchise || []) {
    const fid = f.id;
    const teamInfo = teams.get(fid);
    const playerList = Array.isArray(f.player) ? f.player : (f.player ? [f.player] : []);

    const active = playerList.filter(p => p.status === 'ROSTER');
    const taxi = playerList.filter(p => p.status === 'TAXI_SQUAD');
    const ir = playerList.filter(p => p.status === 'INJURED_RESERVE');

    // Resolve players with projections
    const rosterPlayers = active.map(p => {
      const info = players.get(p.id);
      return {
        name: info?.name ?? `Player ${p.id}`,
        position: info?.position ?? '??',
        salary: parseInt(parseFloat(p.salary || 0), 10),
        contractYear: parseInt(p.contractYear || 1, 10),
        projected: projections.get(p.id) || 0,
      };
    }).sort((a, b) => b.projected - a.projected);

    const totalSalary = rosterPlayers.reduce((s, p) => s + p.salary, 0);
    const capSpace = SALARY_CAP - totalSalary;

    // Position depth
    const positionCounts = {};
    for (const p of rosterPlayers) {
      positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
    }

    // Projected starters (top 9)
    const starters = rosterPlayers.slice(0, 9);
    const totalProj = starters.reduce((s, p) => s + p.projected, 0);

    // Contract distribution
    const contractDist = {};
    for (const p of rosterPlayers) {
      const bucket = p.contractYear >= 4 ? '4+' : String(p.contractYear);
      contractDist[bucket] = (contractDist[bucket] || 0) + 1;
    }

    const prior = priorStandings[fid];

    franchiseData[fid] = { teamInfo, totalSalary, capSpace, totalProj, starters };

    lines.push(`── ${teamInfo?.name ?? fid} [franchiseId="${fid}"] ──`);
    if (prior) {
      lines.push(`  Prior season: ${prior.wins}-${prior.losses}, PF: ${prior.pf.toFixed(2)}`);
    }
    lines.push(`  Roster: ${active.length} active, ${taxi.length} taxi, ${ir.length} IR`);
    lines.push(`  Salary committed: ${formatSalary(totalSalary)} / ${formatSalary(SALARY_CAP)}`);
    lines.push(`  Cap space: ${formatSalary(capSpace)}`);
    lines.push(`  Position depth: ${Object.entries(positionCounts).map(([p, c]) => `${c} ${p}`).join(', ')}`);
    lines.push(`  Contract years: ${Object.entries(contractDist).map(([y, c]) => `${c} @ ${y}yr`).join(', ')}`);
    lines.push(`  Projected starters (total: ${totalProj.toFixed(1)}/week):`);
    for (const s of starters) {
      lines.push(`    ${s.position} ${s.name} — proj ${s.projected.toFixed(1)}, ${formatSalary(s.salary)}, ${s.contractYear}yr`);
    }
    lines.push(`  Bench depth: ${rosterPlayers.length - 9} players`);
    lines.push('');
  }

  lines.push('GRADING CRITERIA:');
  lines.push('  1. PROJECTED STARTER QUALITY: How good is the top-9 lineup? Star power + production.');
  lines.push('  2. ROSTER DEPTH: Can this team survive injuries? Bench quality matters.');
  lines.push('  3. CAP HEALTH: Teams with cap space have flexibility. Teams at the cap are locked in.');
  lines.push('  4. CONTRACT STRUCTURE: Long-term deals on young studs = dynasty gold. Expiring deals = risk.');
  lines.push('  5. CHAMPIONSHIP WINDOW: Is this team competing NOW or rebuilding?');

  return {
    factSheet: lines.join('\n'),
    enrichment: { franchiseData, teams },
  };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Pre-Season Team Grades
Grade every roster top to bottom. Who's a contender? Who's rebuilding? Who's stuck in the middle with no plan? Factor in cap health, contract structure, projected starters, and bench depth. This is the definitive pre-season power ranking in grade form.`);
}

export function getUserPrompt(factSheet) {
  return `Write pre-season team grades using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "intro": ["<p>Opening paragraph — set the scene for the upcoming season.</p>"],
  "grades": [
    {
      "franchiseId": "0001",  // MUST be the 4-digit ID from [franchiseId="XXXX"] in the fact sheet
      "grade": "A",
      "headline": "Punchy 5-8 word summary",
      "body": "<p>2-3 sentences explaining the grade. Reference specific players, cap numbers, projected scores. Use <strong> for player names.</p>"
    }
  ]
}

INSTRUCTIONS:
- Write 1-2 intro paragraphs setting the stage for the season.
- Grade all 16 franchises. Sort grades best to worst.
- Grade scale: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F
- Be bold. Identify the title contenders and the rebuilders.
- Reference specific projected scores, salary numbers, and cap space from the fact sheet.
- Every name and number must come from the fact sheet.`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.intro || aiOutput.intro.length < 1) errors.push('Missing intro paragraphs');
  if (!aiOutput.grades || aiOutput.grades.length < 8) errors.push('Too few grades (expected most/all 16 teams)');
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

  const grades = (aiOutput.grades || []).map(g => {
    // Resolve franchiseId: try direct match, then abbrev/name fallback
    let fid = g.franchiseId;
    if (!enrichment.teams?.has(fid)) {
      const resolved = abbrevToId.get(fid?.toUpperCase());
      if (resolved) {
        fid = resolved;
        g.franchiseId = fid;
      }
    }
    const teamInfo = enrichment.teams?.get(fid);
    const fd = enrichment.franchiseData?.[g.franchiseId];
    return {
      ...g,
      teamName: teamInfo?.name,
      abbrev: teamInfo?.abbrev,
      color: teamInfo?.color,
      ...(fd ? {
        postCapSpace: fd.capSpace,
        postCapSpaceDisplay: formatSalary(fd.capSpace),
        auctionSpend: fd.totalSalary,
        auctionSpendDisplay: formatSalary(fd.totalSalary),
      } : {}),
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
    linkLabel: 'Read team grades',
    league: 'theleague',
    authorId: 'claude',
    intro: aiOutput.intro,
    grades,
  };
}
