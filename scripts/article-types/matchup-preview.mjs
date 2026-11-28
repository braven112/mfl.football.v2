/**
 * Matchup Preview — Fantasy matchup analysis + NFL broadcast guide.
 * Runs Saturday 9am PT before the weekend games.
 *
 * Fact sheet: Matchup analysis + which NFL games feature rostered players + broadcast channels.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, loadJSON, flipName, normalizePosition, formatDefName, resolveMainRepo } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { articlePrompt } from '../article-utils/article-prompts.mjs';
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
import { buildMatchupVisuals, addPreviewExtras } from '../../src/utils/matchup-preview-visuals.mjs';
import { tryLoadJSON } from '../article-utils/data-loaders.mjs';
import { leagueUrl } from '../../src/config/leagues-data.mjs';
import { recordBook } from '../../src/utils/league-history/records.mjs';
import { loadHometowns, hometownFact } from '../article-utils/hometowns.mjs';
import { bubbleSeasons, bubbleFacts, currentOwners } from '../../src/utils/league-history/playoff-bubble.mjs';
import { plainText } from '../../src/utils/article-paragraphs.mjs';
import { selectWeekMatchups, nflWeekGames, keyNflGame } from '../../src/utils/nfl-week-games.mjs';
import { parseStartingLineups } from '../lib/lineup-warnings.mjs';
import { ALIASES as NFL_CODE_ALIASES } from '../lib/nfl-logo-sources.mjs';
import { weekSoFar, unplayedGames, liveCardSnapshot } from '../../src/utils/matchup-preview-live.mjs';

/**
 * MFL's NFL team codes (NOS, KCC, GBP…) in the standard form the cards print
 * (NO, KC, GB). The model copies whatever the fact sheet says, so a raw MFL
 * code put "CAR at NOS" in the copy above a card reading "CAR at NO".
 */
const nflCode = (code) => (code ? NFL_CODE_ALIASES[String(code).toUpperCase()] ?? code : code);
import { resolveDataDir } from '../article-utils/data-loaders.mjs';

/**
 * The column is short because the visuals carry the numbers (owner's call,
 * Oct 2026): a Game of the Week rivalry panel leads the article and every
 * matchup gets a tale-of-the-tape card under the copy. Hard cap, applied in
 * buildPost — validate() only rejects too FEW paragraphs.
 */
const MAX_PARAGRAPHS = 3;

export const config = {
  id: (year, week) => `sf_${year}_matchup_preview_w${String(week).padStart(2, '0')}`,
  requiredData: ['weekly-results-raw', 'projectedScores', 'standings', 'players', 'rosters', 'league'],
  // Previews the games still to be played: the runner targets completedWeek + 1.
  previewsUpcomingWeek: true,
  // Read MFL's live scoring at write time: by Saturday the week's Thursday
  // (and some weeks Wednesday, Thanksgiving or Friday) games are already
  // final, and the preview starts from their points (owner's call, Nov 2026).
  liveScoring: true,
  postType: 'article',
  // NOT 'breaking'. The homepage's breaking-story hero takes the freshest
  // tier:'breaking' post under 48h old at P0 (src/utils/offseason-hero-data.ts
  // selectBreakingStory → hero-resolver.ts), which is built for a trade or
  // auction bomb. A COLUMN THAT RUNS ON A CRON IS NOT BREAKING NEWS: at
  // 'breaking' the three weekly columns held the homepage ~4 of every 7 days
  // in-season (recap Tue→Thu, preview Fri→Sun, matchup preview Sat→Mon),
  // preempting the regular-season daily rotation that was built for those
  // days. Tier drives the hero claim, the feed card's red treatment and the OG
  // badge — nothing else. Chat and push come from buildGroupMePromo (below),
  // which this column exports since Nov 2026 — not from the tier.
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
  // The series is the League History dataset's head-to-head, the record each
  // rivalry page shows (league-history/rivalry.mjs).
  let history;
  let historyDataset = null;
  try {
    const historyFile = path.join(resolveMainRepo(projectRoot), LEAGUES[league].dataPath, 'derived', 'league-history.json');
    historyDataset = await loadJSON(historyFile);
    history = recordBook(historyDataset).ix;
  } catch {
    // No League History dataset: the cards still show this season's form.
    history = undefined;
  }
  // Playoff-bubble storylines (commissioner, Nov 2026): who missed the
  // playoffs by one spot, and who took it. Seeded per conference where the
  // league has them, from this season's own league feed.
  const conferenceName = {};
  for (const c of [data.league?.league?.conferences?.conference ?? []].flat()) conferenceName[c.id] = c.name;
  const conferenceOfDivision = {};
  for (const d of [data.league?.league?.divisions?.division ?? []].flat()) {
    if (d?.conference != null) conferenceOfDivision[d.name] = conferenceName[d.conference] ?? d.conference;
  }
  const bubble = historyDataset
    ? { seasons: bubbleSeasons(historyDataset, conferenceOfDivision), owners: currentOwners(historyDataset) }
    : null;
  const visuals = buildMatchupVisuals({
    pairings,
    weeklyResultsRaw: data['weekly-results-raw'],
    history,
    year,
    week,
  });
  const nameOf = (id) => teams.get(id)?.name ?? id;

  // The chart-led half (Nov 2026): playoff odds and The Gauntlet, both from
  // their weekly derived files for THIS week (compute-playoff-odds.mjs runs in
  // the same job just before this). Either missing just drops its charts.
  const derived = (name) => tryLoadJSON(path.join(
    resolveMainRepo(projectRoot), LEAGUES[league].dataPath, 'derived',
    `${name}-${year}-w${String(week).padStart(2, '0')}.json`,
  ));
  const [odds, gauntlet] = await Promise.all([derived('playoff-odds'), derived('schedule-strength')]);
  // The snapshot the page renders: race board, cards in stakes order. The fact
  // sheet below keeps reading `visuals` (pairing order) so its MATCHUP numbers
  // line up with `pairings`.
  const rendered = addPreviewExtras(visuals, { weeklyResultsRaw: data['weekly-results-raw'], history, odds, gauntlet });
  const stakesByPair = new Map(rendered.matchups.map((m) => [[m.a.franchiseId, m.b.franchiseId].sort().join('-'), m.stakes]));
  // Owner Map hometowns (Redis): the same cities and miles the cards' mini
  // maps print, so the copy and the map beside it agree.
  const hometowns = await loadHometowns(league);

  // Each game's key NFL game (owner's call, Nov 2026): the NFL game carrying
  // the most projected points across both teams' starters. Same schedule feed
  // and the same projected-points question the Sunday Ticket board asks.
  const nflGames = await loadNflWeekGames(projectRoot, year, league, week);
  const now = data.now ?? Date.now();
  // The games already played this week (null before the first kickoff).
  const soFar = weekSoFar(data.liveScoring, {
    nflGames, players, projections, now, zone: LEAGUES[league].officialClock?.zone,
  });
  for (const m of rendered.matchups) {
    const live = liveCardSnapshot(soFar, m.a.franchiseId, m.b.franchiseId);
    if (live) m.live = live;
  }
  // A game that has kicked off cannot be the one to watch: the key NFL game
  // is chosen from the games still to come.
  const gamesAhead = unplayedGames(nflGames, now);
  const teamsAhead = new Set(gamesAhead.flatMap((g) => [g.away, g.home]));
  const teamsPlayed = new Set(nflGames.flatMap((g) => [g.away, g.home]).filter((t) => !teamsAhead.has(t)));
  const isPlayed = (team) => teamsPlayed.has(String(team ?? '').toUpperCase());
  const startersOf = startersResolver(data['weekly-results-raw'], week, rosterMap, projections, players);
  const keyGameByPair = new Map();
  if (gamesAhead.length) {
    for (const { franchise1Id, franchise2Id } of pairings) {
      const k = pairKey(franchise1Id, franchise2Id);
      if (keyGameByPair.has(k)) continue;
      const game = keyNflGame(gamesAhead, [
        { franchiseId: franchise1Id, players: startersOf(franchise1Id) },
        { franchiseId: franchise2Id, players: startersOf(franchise2Id) },
      ]);
      if (game) keyGameByPair.set(k, game);
    }
    for (const m of rendered.matchups) {
      const game = keyGameByPair.get(pairKey(m.a.franchiseId, m.b.franchiseId));
      if (game) m.keyGame = { ...game, players: game.players.slice(0, 4) };
    }
  }

  const lines = [];
  lines.push(`WEEK ${week} MATCHUP PREVIEW + BROADCAST GUIDE — ${LEAGUES[league].name} (${year} Season)`);
  lines.push(`FORMAT: ${weekFormat.label}`);
  lines.push('');
  const dhBriefing = doubleheaderBriefing(weekFormat);
  if (dhBriefing) { lines.push(dhBriefing); lines.push(''); }
  for (const line of weekSoFarFacts(soFar)) lines.push(line);

  if (rendered.race) {
    const r = rendered.race;
    lines.push(`PLAYOFF RACE (simulated odds, ${r.spots} playoff spots, regular season ends week ${r.lastWeek}):`);
    for (const t of r.teams.slice(0, 20)) {
      lines.push(`  ${nameOf(t.franchiseId)} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}): ${pct(t.playoff)} chance to make the playoffs${r.hasByes ? `, ${pct(t.bye)} chance at a first-round bye` : ''}`);
    }
    if (r.lockedIds.length) lines.push(`  ${r.lockedIds.length} teams are already all but in.`);
    lines.push('');
  }

  // The featured game is the first card on the page: the Game of the Week
  // when there is one, else the game with the most on the line.
  const pairKeys = pairings.map(({ franchise1Id, franchise2Id }) => pairKey(franchise1Id, franchise2Id));
  const first = rendered.matchups[0];
  const featuredNumber = first ? pairKeys.indexOf(pairKey(first.a.franchiseId, first.b.franchiseId)) + 1 : 0;
  if (featuredNumber > 0) {
    lines.push(`FEATURED GAME: MATCHUP ${featuredNumber} — the first card on the page. It gets the long write-up.`);
    lines.push('');
  }

  if (visuals.gameOfWeek != null) {
    const g = visuals.matchups[visuals.gameOfWeek];
    lines.push(`GAME OF THE WEEK: ${nameOf(g.a.franchiseId)} vs ${nameOf(g.b.franchiseId)} (MATCHUP ${visuals.gameOfWeek + 1}) — the rivalry panel at the top of the article features it.`);
    for (const fact of seriesFacts(g, nameOf, { full: true })) lines.push(`  ${fact}`);
    lines.push('');
  }

  // Track NFL teams with rostered players for broadcast guide
  const nflTeamPlayers = {}; // nflTeam → [{player, position, franchiseName}]

  // Matchup analysis
  // A large league's sheet covers only the games its cards show.
  const carded = new Set(rendered.matchups.map((m) => [m.a.franchiseId, m.b.franchiseId].sort().join('-')));
  for (const [idx, { franchise1Id, franchise2Id }] of pairings.entries()) {
    if (rendered.moreGames > 0 && !carded.has([franchise1Id, franchise2Id].sort().join('-'))) continue;
    const t1 = teams.get(franchise1Id);
    const t2 = teams.get(franchise2Id);
    const s1 = standingsMap[franchise1Id] || { wins: 0, losses: 0 };
    const s2 = standingsMap[franchise2Id] || { wins: 0, losses: 0 };

    lines.push(`=== MATCHUP ${idx + 1}: ${t1?.name ?? franchise1Id} (${s1.wins}-${s1.losses}) vs ${t2?.name ?? franchise2Id} (${s2.wins}-${s2.losses}) ===`);
    for (const fact of [...formFacts(visuals.matchups[idx], nameOf), ...seriesFacts(visuals.matchups[idx], nameOf)]) {
      lines.push(`  ${fact}`);
    }
    const stakes = stakesByPair.get([franchise1Id, franchise2Id].sort().join('-'));
    for (const fact of stakesFacts(stakes, nameOf)) lines.push(`  ${fact}`);
    const keyGame = keyGameByPair.get(pairKey(franchise1Id, franchise2Id));
    for (const fact of matchupSoFarFacts(soFar, franchise1Id, franchise2Id, nameOf)) lines.push(`  ${fact}`);
    if (keyGame) lines.push(`  ${keyGameFact(keyGame, nameOf)}`);
    const hometown = hometownFact(franchise1Id, franchise2Id, hometowns, nameOf);
    if (hometown) lines.push(`  ${hometown}`);
    if (bubble) {
      for (const fact of bubbleFacts(bubble.seasons, bubble.owners, franchise1Id, franchise2Id, nameOf)) {
        lines.push(`  ${fact}`);
      }
    }

    for (const [fid, teamInfo] of [[franchise1Id, t1], [franchise2Id, t2]]) {
      // Once games have been played, the team's line is its projected FINAL:
      // points already banked plus the starters still to play.
      const live = soFar?.teams.get(fid);
      if (live?.projFinal != null) {
        lines.push(`  ${teamInfo?.name ?? fid} (projected final ${live.projFinal.toFixed(1)} = ${live.score.toFixed(1)} already scored + starters still to play):`);
        for (const s of live.left.slice(0, 5)) {
          const team = nflCode(s.nflTeam);
          lines.push(`    ${s.position} ${s.name} (${team}) — still to play, proj ${s.proj.toFixed(1)}`);
          if (team && team !== '??') {
            if (!nflTeamPlayers[team]) nflTeamPlayers[team] = [];
            nflTeamPlayers[team].push({ player: s.name, position: s.position, franchise: teamInfo?.name ?? fid });
          }
        }
        if (!live.left.length && !live.live.length) lines.push('    Every starter has already played.');
        continue;
      }
      const roster = rosterMap[fid] || [];
      const projected = roster
        // A player whose game is already over is not "projected" any more.
        .filter((pid) => !soFar || !isPlayed(players.get(pid)?.team))
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
        const team = nflCode(s.nflTeam);
        lines.push(`    ${s.position} ${s.name} (${team}) — proj ${s.proj.toFixed(1)}`);

        // Track for broadcast guide
        if (team && team !== '??') {
          if (!nflTeamPlayers[team]) nflTeamPlayers[team] = [];
          nflTeamPlayers[team].push({
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
  lines.push(`NFL games STILL TO BE PLAYED featuring ${LEAGUES[league].name} rostered starters${soFar ? ' (games already played are left out)' : ''}:`);

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

  // Team names ride along for the chat promo (never on the post: the page
  // reads names from the league config, so a renamed team stays current).
  const names = Object.fromEntries([...teams.entries()].map(([id, t]) => [id, t.nameMedium ?? t.name ?? id]));
  return { factSheet: lines.join('\n'), enrichment: { visuals: rendered, names, pairKeys } };
}

/**
 * Odds as a percentage. Never rounds to a flat 100% or 0%: 99.6% printed as
 * "100%" read as a clinched spot, and the copy then said "at 100%".
 */
export const pct = (x) => (x >= 0.995 && x < 1 ? 'over 99%' : x > 0 && x < 0.005 ? 'under 1%' : `${Math.round(x * 100)}%`);

/** The week-so-far header: which games are already in the books. */
export function weekSoFarFacts(soFar) {
  if (!soFar) return [];
  const out = [];
  if (soFar.finals.length) {
    const list = soFar.finals.map((g) => `${nflCode(g.away)} at ${nflCode(g.home)}`).join(', ');
    out.push(`THE WEEK SO FAR: this preview is written AFTER ${soFar.finals.length} NFL game${soFar.finals.length === 1 ? '' : 's'} of the week ${soFar.finals.length === 1 ? 'was' : 'were'} already played (through ${soFar.through}): ${list}. Those points are already on the board in every matchup below. Never preview those games; treat them as done.`);
  } else {
    out.push('THE WEEK SO FAR: the week has kicked off and a game is in progress; scores below are live.');
  }
  const inProgress = soFar.started.filter((g) => !soFar.finals.includes(g));
  if (inProgress.length) {
    out.push(`IN PROGRESS as this is written: ${inProgress.map((g) => `${nflCode(g.away)} at ${nflCode(g.home)}`).join(', ')}. Its points so far are in the scores below; it is not over, so do not treat it as done or preview it as if it has not started.`);
  }
  out.push('');
  return out;
}

/** One matchup's start: the score so far, who is done, how many are left. */
export function matchupSoFarFacts(soFar, aId, bId, nameOf) {
  const a = soFar?.teams.get(aId);
  const b = soFar?.teams.get(bId);
  if (!a || !b) return [];
  const left = (t) => t.left.length + t.live.length;
  const side = (id, t) => `${nameOf(id)} ${t.score.toFixed(1)} (${left(t)} starter${left(t) === 1 ? '' : 's'} still to play${t.projFinal != null ? `, projected final ${t.projFinal.toFixed(1)}` : ''})`;
  const out = [`SCORE SO FAR: ${side(aId, a)} vs ${side(bId, b)}.`];
  const done = [
    ...a.done.map((p) => ({ ...p, fid: aId })),
    ...b.done.map((p) => ({ ...p, fid: bId })),
  ].sort((x, y) => y.score - x.score).slice(0, 4);
  // A Saturday game (a few late-season weeks) can be under way when the
  // column is written at 11 AM PT: its players are mid-game, not done.
  const playing = [
    ...a.live.map((p) => ({ ...p, fid: aId })),
    ...b.live.map((p) => ({ ...p, fid: bId })),
  ].sort((x, y) => y.score - x.score).slice(0, 4);
  if (playing.length) {
    out.push(`PLAYING RIGHT NOW (game in progress as this is written, points so far): ${playing.map((p) => `${p.position === 'Def' ? '' : `${p.position} `}${p.name} (${nameOf(p.fid)}, ${nflCode(p.nflTeam)}) ${p.score.toFixed(1)}`).join('; ')}.`);
  }
  if (done.length) {
    out.push(`ALREADY PLAYED (final, do not preview): ${done.map((p) => `${p.position === 'Def' ? '' : `${p.position} `}${p.name} (${nameOf(p.fid)}) scored ${p.score.toFixed(1)}`).join('; ')}.`);
  } else {
    out.push('Neither team had a starter in the games already played: this one starts at 0-0.');
  }
  return out;
}

/** This week's NFL games, from the same `nflSchedule.json` the Sunday Ticket board reads (the full archive as a fallback). */
async function loadNflWeekGames(projectRoot, year, league, week) {
  const dir = resolveDataDir(projectRoot, year, league);
  for (const file of ['nflSchedule.json', 'nflSchedule-full.json']) {
    const games = nflWeekGames(selectWeekMatchups(await tryLoadJSON(path.join(dir, file)), week));
    if (games.length) return games;
  }
  return [];
}

/**
 * A franchise's starters for the week: the lineup it has submitted when MFL
 * has one, else its nine best projected players (what the sheet has always
 * listed).
 */
export function startersResolver(weeklyResultsRaw, week, rosterMap, projections, players) {
  const entry = (Array.isArray(weeklyResultsRaw) ? weeklyResultsRaw : [])
    .find((w) => String(w?.weeklyResults?.week) === String(week));
  const submitted = new Map(parseStartingLineups(entry).map((l) => [l.franchiseId, l.starters]));
  const toPlayer = (pid) => {
    const info = players.get(pid);
    return info ? { name: info.name, position: info.position, nflTeam: info.team, proj: projections.get(pid) || 0 } : null;
  };
  return (fid) => {
    const lineup = submitted.get(fid);
    if (lineup?.length) return lineup.map(toPlayer).filter(Boolean);
    return (rosterMap[fid] || []).map(toPlayer).filter(Boolean).sort((a, b) => b.proj - a.proj).slice(0, 9);
  };
}

/** The key NFL game as one fact-sheet line. */
export function keyGameFact(game, nameOf) {
  const who = game.players.slice(0, 4)
    .map((p) => `${p.position === 'Def' ? '' : `${p.position} `}${p.name} (${nameOf(p.franchiseId)}, ${p.proj.toFixed(1)})`)
    .join(', ');
  return `KEY NFL GAME: ${nflCode(game.away)} at ${nflCode(game.home)}, ${game.projTotal.toFixed(1)} projected points from these two teams' starters — ${who}.`;
}

/** One key per pairing, order-free, so a fact-sheet MATCHUP number finds its card. */
const pairKey = (a, b) => [a, b].sort().join('-');

/**
 * Attach the model's per-game write-ups to the cards they describe (owner's
 * call, Nov 2026: the copy lives on each game's card, not in a block above
 * them). `games` is keyed by fact-sheet MATCHUP number; the cards are in
 * stakes order, so the number goes through the pairing's key. The text is
 * plain: the card renders it escaped, so a write-up can never carry markup.
 * A number with no card is dropped; a doubleheader's repeat pairing fills the
 * first card still without a story.
 */
export function attachGameStories(visuals, games, pairKeys, { closing } = {}) {
  if (!visuals?.matchups?.length) return visuals;
  const matchups = visuals.matchups.map((m) => ({ ...m }));
  for (const g of Array.isArray(games) ? games : []) {
    const key = pairKeys?.[Number(g?.matchup) - 1];
    const paragraphs = (Array.isArray(g?.paragraphs) ? g.paragraphs : [])
      .map(plainText)
      .filter(Boolean);
    if (!key || !paragraphs.length) continue;
    const card = matchups.find((m) => !m.story && pairKey(m.a.franchiseId, m.b.franchiseId) === key);
    if (card) card.story = paragraphs;
  }
  const closingText = (Array.isArray(closing) ? closing : []).map(plainText).filter(Boolean);
  return { ...visuals, matchups, ...(closingText.length ? { closing: closingText } : {}) };
}

/** What a game is worth, as fact-sheet lines: each side's odds now, with a win, with a loss. */
function stakesFacts(stakes, nameOf) {
  if (!stakes || stakes.swing < 0.02) return [];
  const key = stakes.kind === 'bye' ? 'bye' : 'playoff';
  // Every number is named for what it is: "at 16%" with no noun is how the
  // copy left readers guessing (owner's note, 2026-11-28).
  const what = key === 'bye' ? 'chance at a first-round bye' : 'chance to make the playoffs';
  const out = [`STAKES (simulated ${what}; this game swings it by up to ${pct(stakes.swing)}):`];
  for (const s of [stakes.a, stakes.b]) {
    if (!s) continue;
    out.push(`  ${nameOf(s.franchiseId)}: ${pct(s.now[key])} ${what} now, ${pct(s.win[key])} with a win, ${pct(s.loss[key])} with a loss`);
  }
  return out;
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

// The column's own text lives in the private pack (article-prompts.mjs).
export function getSystemPrompt({ league = DEFAULT_LEAGUE_SLUG, persona } = {}) {
  return buildCachedSystem(articlePrompt('matchup-preview', 'system'), { league, persona });
}

export function getUserPrompt(factSheet) {
  return articlePrompt('matchup-preview', 'user', { FACT_SHEET: factSheet });
}

/**
 * A pick that carries a predicted final score, "My pick: X, 124-117" (whole or
 * decimal points, any dash). The score must FOLLOW the word "pick": a write-up
 * also quotes series records ("leads the series 21-16"), which are not a score.
 */
const PICK_WITH_SCORE = /\bpick\b[^]*?\b\d{2,3}(?:\.\d+)?\s*[-–—]\s*\d{2,3}(?:\.\d+)?\b/i;

/**
 * The MATCHUP numbers whose write-up names no predicted score. Owner's call
 * (Nov 2026): every game in every league gets a score with its pick — the
 * Week 10 AFL preview picked twelve winners and scored none of them.
 */
export function gamesMissingScore(aiOutput) {
  return (Array.isArray(aiOutput?.games) ? aiOutput.games : [])
    .filter((g) => !(g?.paragraphs ?? []).some((p) => PICK_WITH_SCORE.test(String(p))))
    .map((g) => g?.matchup);
}

/** The runner's one rewrite (schefter-weekly-articles.mjs): a pick without a score. */
export function correctionFor(aiOutput) {
  const missing = gamesMissingScore(aiOutput);
  if (!missing.length) return null;
  return `the pick for MATCHUP ${missing.join(', ')} has no predicted score. Every game's pick must end with a final score, winner's first, like "My pick: Team Name, 124-117."`;
}

export function validate(aiOutput) {
  const errors = [];
  if (!aiOutput.headline || aiOutput.headline.length > 100) errors.push('Headline missing or too long');
  if (!aiOutput.excerpt || aiOutput.excerpt.length > 500) errors.push('Excerpt missing or too long');
  if (!aiOutput.content || aiOutput.content.length < 1) errors.push('Missing opening paragraph');
  if (!Array.isArray(aiOutput.games) || aiOutput.games.length === 0) errors.push('Missing per-game write-ups');
  else if (gamesMissingScore(aiOutput).length) errors.push(`No predicted score for matchup ${gamesMissingScore(aiOutput).join(', ')}`);
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
    // Each card's write-up and the closing broadcast guide ride on the same
    // snapshot, so they render with the cards (MatchupPreviewSection).
    matchupVisuals: enrichment?.visuals
      ? attachGameStories(enrichment.visuals, aiOutput.games, enrichment.pairKeys, { closing: aiOutput.closing })
      : undefined,
  };
}

/**
 * The Saturday chat post (owner's call, Nov 2026): one line and the link,
 * after the lineup roll call (scripts/lib/lineup-broadcast.mjs) has gone out.
 * Queued by the runner and sent only once the permalink answers on the live
 * site; Saturday's one chat slot is this column's (groupme-day-plan.mjs).
 *
 * Leads with the game that has the most on the line; falls back to the Game of
 * the Week, then to a plain line. The URL goes last with nothing glued to it
 * (GroupMe autolinks trailing punctuation into a 404).
 */
export function buildGroupMePromo(post, enrichment, { league = DEFAULT_LEAGUE_SLUG, teamNames } = {}) {
  const visuals = enrichment?.visuals;
  if (!visuals?.matchups?.length) return null;
  const url = leagueUrl(LEAGUES[league], post.link);
  const nameOf = (id) => teamNames?.get?.(id) ?? enrichment?.names?.[id] ?? id;
  const top = [...visuals.matchups].filter((m) => m.stakes).sort((x, y) => y.stakes.swing - x.stakes.swing)[0];
  if (top && top.stakes.swing >= 0.05) {
    const key = top.stakes.kind === 'bye' ? 'bye' : 'playoff';
    const gap = (s) => (s ? Math.abs(s.win[key] - s.loss[key]) : -1);
    // Name the team whose odds this game moves most, and who stands in the way.
    const [mover, other] = gap(top.stakes.a) >= gap(top.stakes.b) ? [top.a, top.b] : [top.b, top.a];
    // No possessive: "Gridiron Geeks's" is how a team name breaks one.
    const what = key === 'bye' ? 'A first-round bye' : 'A playoff spot';
    return `🔭 Week ${visuals.week} Matchup Preview: ${what} is on the line for ${nameOf(mover.franchiseId)} against ${nameOf(other.franchiseId)}. Odds, rivalries and every game ▸ ${url}`;
  }
  const gotw = visuals.gameOfWeek != null ? visuals.matchups[visuals.gameOfWeek] : null;
  if (gotw) {
    return `🔭 Week ${visuals.week} Matchup Preview: ${nameOf(gotw.a.franchiseId)} vs ${nameOf(gotw.b.franchiseId)} headlines the slate. Odds, rivalries and every game ▸ ${url}`;
  }
  return `🔭 Week ${visuals.week} Matchup Preview: playoff odds, rivalries and every game ▸ ${url}`;
}
