/**
 * Waiver Pickups — Who got picked up this week via BBID/waiver.
 * Runs Wednesday 10pm PT after waivers process.
 *
 * Fact sheet: Per-team waiver claims with player name, position, bid amount.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, formatSalary, flipName, normalizePosition, formatDefName } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';

export const config = {
  id: (year, week) => `sf_${year}_waiver_pickups_w${String(week).padStart(2, '0')}`,
  requiredData: ['transactions', 'players', 'league'],
  postType: 'article',
  tier: 'standard',
  maxTokens: 4000,
};

export function guardSeason(week, year, now, { completedWeek }) {
  return isRegularSeasonOrPlayoffs(completedWeek);
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

  // Filter BBID_WAIVER and FREE_AGENT transactions from the past 7 days
  const now = Date.now() / 1000; // Unix seconds
  const sevenDaysAgo = now - (7 * 24 * 60 * 60);
  const txns = (data.transactions.transactions?.transaction || [])
    .filter(t =>
      (t.type === 'BBID_WAIVER' || t.type === 'FREE_AGENT') &&
      parseInt(t.timestamp, 10) >= sevenDaysAgo
    );

  // Parse transactions into structured claims
  const claimsByTeam = {};
  let totalSpent = 0;
  let highestBid = { amount: 0, player: '', team: '' };

  for (const txn of txns) {
    const fid = txn.franchise;
    const teamName = teams.get(fid)?.name ?? `Team ${fid}`;
    if (!claimsByTeam[fid]) claimsByTeam[fid] = { name: teamName, claims: [] };

    // Parse transaction string: "playerId|bidAmount|" or "playerId|bidAmount|droppedPlayerId|"
    const parts = (txn.transaction || '').split('|').filter(Boolean);
    const playerId = parts[0];
    const bidAmount = parseInt(parts[1] || '0', 10);
    const playerInfo = players.get(playerId);

    const claim = {
      player: playerInfo?.name ?? `Player ${playerId}`,
      position: playerInfo?.position ?? '??',
      bid: bidAmount,
      bidDisplay: formatSalary(bidAmount),
      type: txn.type,
    };

    claimsByTeam[fid].claims.push(claim);
    totalSpent += bidAmount;

    if (bidAmount > highestBid.amount) {
      highestBid = { amount: bidAmount, player: claim.player, team: teamName };
    }
  }

  const lines = [];
  lines.push(`WEEK ${week} WAIVER PICKUPS — TheLeague (${year} Season)`);
  lines.push(`Total claims this week: ${txns.length}`);
  lines.push(`Total spent: ${formatSalary(totalSpent)}`);
  lines.push('');

  if (txns.length === 0) {
    lines.push('No waiver claims or free agent pickups this week.');
    return { factSheet: lines.join('\n'), enrichment: {} };
  }

  lines.push('=== CLAIMS BY TEAM ===');
  const sortedTeams = Object.entries(claimsByTeam)
    .sort((a, b) => b[1].claims.reduce((s, c) => s + c.bid, 0) - a[1].claims.reduce((s, c) => s + c.bid, 0));

  for (const [fid, teamData] of sortedTeams) {
    const teamSpend = teamData.claims.reduce((s, c) => s + c.bid, 0);
    lines.push(`── ${teamData.name} (${teamData.claims.length} claims, ${formatSalary(teamSpend)} spent) ──`);
    for (const c of teamData.claims.sort((a, b) => b.bid - a.bid)) {
      const typeLabel = c.type === 'FREE_AGENT' ? ' [FA]' : '';
      lines.push(`  - ${c.position} ${c.player} (${c.bidDisplay})${typeLabel}`);
    }
    lines.push('');
  }

  lines.push('=== SPENDING SUMMARY ===');
  lines.push(`Biggest spender: ${sortedTeams[0]?.[1]?.name} (${formatSalary(sortedTeams[0]?.[1]?.claims.reduce((s, c) => s + c.bid, 0))})`);
  lines.push(`Highest single bid: ${formatSalary(highestBid.amount)} for ${highestBid.player} by ${highestBid.team}`);
  lines.push(`Most claims: ${sortedTeams[0]?.[1]?.name} (${sortedTeams[0]?.[1]?.claims.length})`);

  return { factSheet: lines.join('\n'), enrichment: {} };
}

export function getSystemPrompt() {
  return buildCachedSystem(`\n\nARTICLE TYPE: Waiver Pickups
Grade the waiver wire activity for the week. Who made the best claims? Who overpaid? Who missed out on players they needed? Talk about which pickups could be league-winners and which are desperation moves.`);
}

export function getUserPrompt(factSheet) {
  return `Write a waiver pickups recap article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": ["<p>Paragraph 1...</p>", "<p>Paragraph 2...</p>"]
}

INSTRUCTIONS:
- Write 3-5 content paragraphs.
- Lead with the biggest/most interesting waiver claim.
- Comment on spending habits — who's aggressive, who's conservative.
- Reference specific player names, positions, and bid amounts from the fact sheet.
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
    linkLabel: 'Read full article',
    league: 'theleague',
    authorId: 'claude',
    content: aiOutput.content,
  };
}
