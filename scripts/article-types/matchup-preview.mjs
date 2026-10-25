/**
 * Matchup Preview — Fantasy matchup analysis + NFL broadcast guide.
 * Runs Saturday 9am PT before the weekend games.
 *
 * Fact sheet: Matchup analysis + which NFL games feature rostered players + broadcast channels.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, loadJSON, flipName, normalizePosition, formatDefName, resolveMainRepo } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';
import { getMatchupPairings } from '../article-utils/week-resolver.mjs';
import path from 'node:path';
import { primaryLink, articleLink, featureLink, linkList } from '../article-utils/article-links.mjs';
import {
  franchiseRecord,
  summarizeWeekFormat,
  doubleheaderBriefing,
} from '../article-utils/franchise-record.mjs';
import { LEAGUES, DEFAULT_LEAGUE_SLUG } from '../../src/config/leagues-data.mjs';
import { buildMatchupVisuals } from '../../src/utils/matchup-preview-visuals.mjs';
import { loadHometowns, hometownFact } from '../article-utils/hometowns.mjs';

/**
 * The column is short because the visuals carry the numbers (owner's call,
 * Oct 2026): a Game of the Week rivalry panel leads the article and every
 * matchup gets a tale-of-the-tape card under the copy. Hard cap, applied in
 * buildPost — validate() only rejects too FEW paragraphs.
 */
const MAX_PARAGRAPHS = 4;

export const config = {
  id: (year, week) => `sf_${year}_matchup_preview_w${String(week).padStart(2, '0')}`,
  requiredData: ['weekly-results-raw', 'projectedScores', 'standings', 'players', 'rosters', 'league'],
  // Previews the games still to be played: the runner targets completedWeek + 1.
  previewsUpcomingWeek: true,
  postType: 'article',
  // NOT 'breaking'. The homepage's breaking-story hero takes the freshest
  // tier:'breaking' post under 48h old at P0 (src/utils/offseason-hero-data.ts
  // selectBreakingStory → hero-resolver.ts), which is built for a trade or
  // auction bomb. A COLUMN THAT RUNS ON A CRON IS NOT BREAKING NEWS: at
  // 'breaking' the three weekly columns held the homepage ~4 of every 7 days
  // in-season (recap Tue→Thu, preview Fri→Sun, matchup preview Sat→Mon),
  // preempting the regular-season daily rotation that was built for those
  // days. Tier drives the hero claim, the feed card's red treatment and the OG
  // badge — nothing else. Chat and push are gated on whether the module exports
  // buildGroupMePromo (only cut-watch, schedule-release and schedule-strength
  // do), so this column has no chat or push path to lose either way.
  // Pinned by tests/weekly-column-hero-claim.test.ts.
  tier: 'standard',
  maxTokens: 5000,
};

export function guardSeason(week, year, now, { currentWeek }) {
  return isRegularSeasonOrPlayoffs(currentWeek);
}

export async function buildFactSheet(data, week, year, projectRoot, { league = DEFAULT_LEAGUE_SLUG } = {}) {
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

  // Franchise names must come from the league being written. Defaulting
  // this to TheLeague built AFL prose from TheLeague's team names —
  // invisible, because both leagues have a franchise 0001 (#1086 F4).
  const teams = await loadTeams(projectRoot, league);

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
    const { wins, losses } = franchiseRecord(f);
    standingsMap[f.id] = { wins, losses };
  }

  const pairings = getMatchupPairings(data['weekly-results-raw'], week);
  // A preview of a week with no matchups is not an article — it is the "Week 0:
  // TheLeague Waits for Kickoff" post, whose whole body was "there are no
  // matchups scheduled". That happens because the runner targets completedWeek
  // (schefter-weekly-articles.mjs) while this forward-looking column guards on
  // currentWeek, so before the season's first week completes the target is 0.
  // Declining here is the pipeline's documented clean skip (step 7: a null
  // fact sheet exits 0 without spending an Anthropic call), and it is what
  // keeps an empty preview out of the feed and out of ArticleHero's Friday
  // slot, which matches on a headline regex and would front it.
  if (pairings.length === 0) {
    console.log(`  [skip] No matchups scheduled for week ${week} — nothing to preview.`);
    return null;
  }
  // Weeks 1, 2, 3 and 12 are doubleheaders — every franchise appears in the
  // pairings TWICE. Unlabelled, that reads as a duplicate rather than the format.
  const weekFormat = summarizeWeekFormat(pairings);

  // The visuals snapshot (Game of the Week panel + one card per matchup) rides
  // on the post; the fact sheet reads the SAME snapshot so the copy can never
  // state a series record or streak the cards beside it contradict.
  let franchises;
  try {
    const historyFile = path.join(resolveMainRepo(projectRoot), LEAGUES[league].dataPath, 'derived', 'franchise-history.json');
    const history = await loadJSON(historyFile);
    franchises = history.franchises ?? history;
  } catch {
    // No ingested head-to-head: the cards still show this season's form.
    franchises = undefined;
  }
  const visuals = buildMatchupVisuals({
    pairings,
    weeklyResultsRaw: data['weekly-results-raw'],
    franchises,
    year,
    week,
  });
  const nameOf = (id) => teams.get(id)?.name ?? id;
  // Owner Map hometowns (Redis): the same cities and miles the cards' mini
  // maps print, so the copy and the map beside it agree.
  const hometowns = await loadHometowns(league);

  const lines = [];
  lines.push(`WEEK ${week} MATCHUP PREVIEW + BROADCAST GUIDE — ${LEAGUES[league].name} (${year} Season)`);
  lines.push(`FORMAT: ${weekFormat.label}`);
  lines.push('');
  const dhBriefing = doubleheaderBriefing(weekFormat);
  if (dhBriefing) { lines.push(dhBriefing); lines.push(''); }

  if (visuals.gameOfWeek != null) {
    const g = visuals.matchups[visuals.gameOfWeek];
    lines.push(`GAME OF THE WEEK: ${nameOf(g.a.franchiseId)} vs ${nameOf(g.b.franchiseId)} (MATCHUP ${visuals.gameOfWeek + 1}) — the rivalry panel at the top of the article features it.`);
    for (const fact of seriesFacts(g, nameOf, { full: true })) lines.push(`  ${fact}`);
    lines.push('');
  }

  // Track NFL teams with rostered players for broadcast guide
  const nflTeamPlayers = {}; // nflTeam → [{player, position, franchiseName}]

  // Matchup analysis
  for (const [idx, { franchise1Id, franchise2Id }] of pairings.entries()) {
    const t1 = teams.get(franchise1Id);
    const t2 = teams.get(franchise2Id);
    const s1 = standingsMap[franchise1Id] || { wins: 0, losses: 0 };
    const s2 = standingsMap[franchise2Id] || { wins: 0, losses: 0 };

    lines.push(`=== MATCHUP ${idx + 1}: ${t1?.name ?? franchise1Id} (${s1.wins}-${s1.losses}) vs ${t2?.name ?? franchise2Id} (${s2.wins}-${s2.losses}) ===`);
    for (const fact of [...formFacts(visuals.matchups[idx], nameOf), ...seriesFacts(visuals.matchups[idx], nameOf)]) {
      lines.push(`  ${fact}`);
    }
    const hometown = hometownFact(franchise1Id, franchise2Id, hometowns, nameOf);
    if (hometown) lines.push(`  ${hometown}`);

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
  lines.push(`Key NFL games featuring ${LEAGUES[league].name} rostered starters:`);

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

  return { factSheet: lines.join('\n'), enrichment: { visuals } };
}

/** This season's streak and luck for both sides, as fact-sheet lines. */
function formFacts(m, nameOf) {
  const out = [];
  for (const side of [m.a, m.b]) {
    const bits = [];
    if (side.streak) bits.push(`current streak ${side.streak}`);
    if (side.luck != null && Math.abs(side.luck) >= 1.5) {
      bits.push(`${Math.abs(side.luck)} wins ${side.luck > 0 ? 'MORE' : 'FEWER'} than their weekly scores would earn against an average schedule`);
    }
    if (bits.length) out.push(`${nameOf(side.franchiseId)}: ${bits.join('; ')}`);
  }
  return out;
}

/**
 * The all-time series as fact-sheet lines, always naming the side that leads
 * (a bare "12-4" with no owner is how a record gets printed backwards).
 * A disputed series states nothing — see matchup-preview-visuals.mjs.
 */
function seriesFacts(m, nameOf, { full = false } = {}) {
  const s = m.series;
  if (!s) return ['All-time series: first meeting under the current owners'];
  if (s.disputed) return [];
  const a = nameOf(m.a.franchiseId);
  const b = nameOf(m.b.franchiseId);
  const tie = s.ties ? `-${s.ties}` : '';
  const record = s.aWins === s.bWins
    ? `dead even at ${s.aWins}-${s.bWins}${tie}`
    : s.aWins > s.bWins ? `${a} lead ${s.aWins}-${s.bWins}${tie}` : `${b} lead ${s.bWins}-${s.aWins}${tie}`;
  const out = [`All-time series (${s.games} meetings since ${s.since}): ${record}`];
  if (s.streak && s.streak.count >= 2) out.push(`Series streak: ${nameOf(s.streak.franchiseId)} have won the last ${s.streak.count} meetings`);
  if (full) {
    if (s.playoffGames) out.push(`Playoff meetings: ${s.playoffGames} (${a} ${s.playoffWins}-${s.playoffLosses})`);
    if (s.biggest) out.push(`Biggest blowout: ${nameOf(s.biggest.winnerId)} ${s.biggest.score}-${s.biggest.opp} (${s.biggest.year})`);
    if (s.closest) out.push(`Closest game: ${nameOf(s.closest.winnerId)} ${s.closest.score}-${s.closest.opp} (${s.closest.year})`);
  }
  return out;
}

export function getSystemPrompt({ league = DEFAULT_LEAGUE_SLUG, persona } = {}) {
  return buildCachedSystem(`\n\nARTICLE TYPE: Matchup Preview + Broadcast Guide
Preview the week's fantasy matchups and pick winners — be bold, be wrong sometimes, that's what makes it fun. This is the Saturday morning "what to watch" guide.
The article page already SHOWS the numbers: a Game of the Week rivalry panel sits above your copy (series record, streak, playoff meetings, biggest and closest games, a chart of every meeting) and every matchup gets a tale-of-the-tape card below it (record, streak, recent results, weekly scores, luck). Your copy is SHORT and tells the story those visuals cannot: who wins and why. Do not recite records or streaks the cards already show.\nHOMETOWNS: some matchups carry a "Hometowns" line — the city each TEAM represents, picked by its owner (usually where they grew up, often not where they live now). Each card shows a map of the two cities with the miles apart. Use it as seasoning, at most twice in the whole article, best on the Game of the Week or a long-distance or same-city game: the miles between them, or a playful nod to what the city is famous for (its food, a landmark, its pro teams). When the city is small or you know little about it, use the state instead. Stick to well-known, friendly references; never invent local specifics (a restaurant, a street, a local event), and never say an owner lives there.\nIf the fact sheet's FORMAT line says DOUBLEHEADER, every team plays twice: pick a winner for each GAME separately and name the team facing the toughest two-game slate.`, { league, persona });
}

export function getUserPrompt(factSheet) {
  return `Write a matchup preview + broadcast guide article using ONLY the verified data in this fact sheet.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Short punchy headline (~60 chars)",
  "excerpt": "2-3 sentence teaser for the feed card.",
  "content": ["<p>Game of the Week...</p>", "<p>Other matchups...</p>", "<p>Broadcast guide...</p>"]
}

INSTRUCTIONS:
- Write exactly 3 or 4 SHORT paragraphs, each under 350 characters.
- Paragraph 1: the GAME OF THE WEEK (if the fact sheet names one) — the rivalry angle and your pick.
- Then 1-2 paragraphs on the next 2-3 most interesting matchups, with picks. Do not run through every game.
- Last paragraph: the broadcast guide — the one or two NFL games to watch and which rostered players make them matter.
- Use the all-time series and streak facts only as the fact sheet states them, naming the team that leads.
- Hometown references are optional flavor, at most twice; mileage only as the fact sheet states it.
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

/**
 * Where this article points, and which parts of the site it plugs.
 *
 * The broadcast guide is a plan for Sunday; the scoreboard is where Sunday
 * actually happens. The plugs are the pages that settle the arguments a
 * matchup preview starts.
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
    primaryLink(league, 'live-scoring', {
      label: 'the live scoreboard',
      cta: 'Follow every matchup live on the scoreboard.',
    }),
    articleLink(league, 'lineup', { label: 'your lineup' }),
    // The broadcast guide's natural landing: the four games to put on the
    // multiview each window, built from the reader's own rosters.
    featureLink(league, 'sunday-ticket', { label: 'the Sunday Ticket board' }),
    featureLink(league, 'rivalries'),
    featureLink(league, 'standings'),
    featureLink(league, 'notifications'),
  );
}

export function buildPost(aiOutput, enrichment, articleId, { league = DEFAULT_LEAGUE_SLUG } = {}) {
  // The runner invokes this type for --league afl-fantasy too, so the
  // permalink and the feed tag must both come from the league actually
  // being written. Hardcoding them landed AFL posts in the AFL feed
  // carrying a TheLeague link and a theleague tag (issue #1086 F4).
  const slug = LEAGUES[league].slug;
  return {
    id: articleId,
    timestamp: new Date().toISOString(),
    type: 'article',
    category: 'articles',
    tier: config.tier,
    headline: aiOutput.headline,
    body: aiOutput.excerpt,
    franchiseIds: [],
    link: `/${slug}/news/${articleId}`,
    linkLabel: 'Read matchup preview',
    league: slug,
    authorId: 'claude',
    content: (aiOutput.content ?? []).slice(0, MAX_PARAGRAPHS),
    // The Game of the Week panel and the tale-of-the-tape cards render from
    // this snapshot (src/components/shared/matchup-preview/), taken when the
    // column was written so an old preview keeps that week's numbers.
    matchupVisuals: enrichment?.visuals ?? undefined,
  };
}
