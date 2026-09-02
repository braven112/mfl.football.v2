/**
 * Weekly Recap — Week N recap article.
 * Runs Tuesday 6am PT after the previous week's games are complete.
 *
 * Fact sheet: every matchup with scores + top scorers, standings, storylines.
 * NOT always 8 games: TheLeague plays doubleheaders in Weeks 1, 2, 3 and 12,
 * where all 16 franchises play TWICE. See article-utils/franchise-record.mjs.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadPlayers, loadTeams, formatSalary } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';
import { primaryLink, articleLink, featureLink, linkList } from '../article-utils/article-links.mjs';
import {
  franchiseRecord,
  summarizeWeekFormat,
  doubleheaderBriefing,
  resultsByFranchise,
  weekSummaryLine,
} from '../article-utils/franchise-record.mjs';

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

  const matchups = weekData?.weeklyResults?.matchup || [];

  // A doubleheader week lists every franchise twice. Say so up front, or the
  // model reads a team that both won and lost as a contradiction and writes
  // around it.
  const format = summarizeWeekFormat(
    matchups.map((m) => ({ franchise1Id: m?.franchise?.[0]?.id, franchise2Id: m?.franchise?.[1]?.id }))
  );
  const perFranchise = resultsByFranchise(matchups);

  const lines = [];
  lines.push(`WEEK ${week} RECAP — TheLeague (${year} Season)`);
  lines.push(`FORMAT: ${format.label}`);
  lines.push('');
  const briefing = doubleheaderBriefing(format);
  if (briefing) {
    lines.push(briefing);
    lines.push('');
  }

  // Matchup results
  lines.push('=== MATCHUP RESULTS ===');

  for (const [gameIndex, matchup] of matchups.entries()) {
    const [f1, f2] = matchup.franchise || [];
    if (!f1 || !f2) continue;

    const t1 = teams.get(f1.id);
    const t2 = teams.get(f2.id);
    const s1 = parseFloat(f1.score ?? f1.spread ?? 0);
    const s2 = parseFloat(f2.score ?? f2.spread ?? 0);

    const winner = s1 > s2 ? t1?.name : s2 > s1 ? t2?.name : 'TIE';
    const gameLabel = format.isDoubleheader ? `GAME ${gameIndex + 1}: ` : '';
    lines.push(`${gameLabel}${t1?.name ?? f1.id} ${s1.toFixed(2)} vs ${t2?.name ?? f2.id} ${s2.toFixed(2)} — Winner: ${winner}`);

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

  // On a doubleheader week the combined result is the story, and it is not
  // derivable from the game rows without the reader doing the bookkeeping.
  if (format.isDoubleheader) {
    lines.push(`=== EACH TEAM'S WEEK (combined across ${format.gamesPerFranchise} games) ===`);
    const summaries = [...perFranchise.entries()]
      .map(([fid, games]) => ({ fid, games, total: games.reduce((a, g) => a + g.score, 0) }))
      .sort((a, b) => b.total - a.total);
    for (const { fid, games } of summaries) {
      lines.push(`  ${teams.get(fid)?.name ?? fid}: ${weekSummaryLine(games)}`);
    }
    lines.push('');
  }

  // Standings
  lines.push('=== STANDINGS (After Week ' + week + ') ===');
  const standings = data.standings.leagueStandings?.franchise || [];
  const sorted = [...standings].sort((a, b) => {
    const wa = franchiseRecord(a).wins;
    const wb = franchiseRecord(b).wins;
    if (wb !== wa) return wb - wa;
    return parseFloat(b.pf || 0) - parseFloat(a.pf || 0);
  });

  for (const [i, f] of sorted.entries()) {
    const t = teams.get(f.id);
    const { wins, losses } = franchiseRecord(f);
    const pf = parseFloat(f.pf || 0).toFixed(2);
    const pa = parseFloat(f.pa || 0).toFixed(2);
    const streak = f.strk || '';
    lines.push(`  ${i + 1}. ${t?.name ?? f.id} (${wins}-${losses}) PF: ${pf} PA: ${pa} ${streak ? `Streak: ${streak}` : ''}`);
  }
  lines.push('');

  // Storylines
  lines.push('=== KEY STORYLINES ===');
  // EVERY game, not one per franchise — a franchise-keyed map kept only the
  // second game of a doubleheader and hid the other from these superlatives.
  const allGames = [...perFranchise.entries()].flatMap(([fid, games]) =>
    games.map((g) => ({ fid, ...g }))
  );
  if (allGames.length > 0) {
    const byScore = [...allGames].sort((a, b) => b.score - a.score);
    const highest = byScore[0];
    const lowest = byScore[byScore.length - 1];
    const suffix = format.isDoubleheader ? ' (single game)' : '';
    lines.push(`Highest score${suffix}: ${teams.get(highest.fid)?.name} at ${highest.score.toFixed(2)}`);
    lines.push(`Lowest score${suffix}: ${teams.get(lowest.fid)?.name} at ${lowest.score.toFixed(2)}`);
    if (format.isDoubleheader) {
      const byTotal = [...perFranchise.entries()]
        .map(([fid, games]) => ({ fid, total: games.reduce((a, g) => a + g.score, 0) }))
        .sort((a, b) => b.total - a.total);
      lines.push(`Most points across both games: ${teams.get(byTotal[0].fid)?.name} at ${byTotal[0].total.toFixed(2)}`);
      const sweeps = [...perFranchise.entries()].filter(([, g]) => g.every((x) => x.result === 'W'));
      const winless = [...perFranchise.entries()].filter(([, g]) => g.every((x) => x.result === 'L'));
      if (sweeps.length) lines.push(`Swept the doubleheader: ${sweeps.map(([f]) => teams.get(f)?.name).join(', ')}`);
      if (winless.length) lines.push(`Lost both: ${winless.map(([f]) => teams.get(f)?.name).join(', ')}`);
    }

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
Write like a Monday morning ESPN column. Lead with the biggest story of the week — the biggest upset, the highest score, or the most dramatic finish. Weave in standings implications. End with a look-ahead to next week.\nIf the fact sheet's FORMAT line says DOUBLEHEADER, every team played more than once: describe a team's week by its combined result (swept, split, dropped both), never as a single win or loss, and treat the two games as separate events when you cite scores.`);
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

/**
 * Where this article points, and which parts of the site it plugs.
 *
 * A recap is an argument about who is good; the standings are the scoreboard
 * that argument gets settled on. The plugs are the pages a reader reaches for
 * once they disagree with the recap.
 *
 * The pipeline calls this on every run. `applyArticleLinks` injects the
 * PRIMARY link if the model drops it and strips any href the model invented;
 * the `featureLink` plugs are never injected, only offered — see
 * article-links.mjs for why a forced plug is worse than no plug. Plugs for
 * pages a league does not have resolve to null and `linkList` drops them, so
 * this one list serves every league.
 */
export function relatedLinks(_enrichment, { league = 'theleague' } = {}) {
  return linkList(
    primaryLink(league, 'standings', {
      label: 'the standings',
      cta: 'The full standings, with every tiebreaker applied, are here.',
    }),
    articleLink(league, 'pecking-order', { label: "this week's pecking order" }),
    featureLink(league, 'mvp'),
    featureLink(league, 'trade-builder'),
    featureLink(league, 'schedule-strength'),
    featureLink(league, 'records'),
  );
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
