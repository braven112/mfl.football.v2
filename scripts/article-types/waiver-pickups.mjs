/**
 * Waiver Pickups — the week's waiver run plus the first-come-first-served
 * pickups around it, in one recap.
 * Runs Thursday morning PT, after Wednesday night's waiver run and the FCFS
 * scramble that follows it (src/utils/sync-cadence.ts). The window is the
 * seven days before the run, so each recap starts where the last one ended
 * and every pickup lands in exactly one.
 *
 * Fact sheet: Per-team pickups with player name, position, price, and whether
 * each was a waiver claim, an FCFS add after the run, or an FCFS add earlier.
 * AI output: { headline, excerpt, content: string[] }
 */

import { loadTeams, formatSalary, flipName, normalizePosition, formatDefName } from '../article-utils/data-loaders.mjs';
import { buildCachedSystem } from '../article-utils/ai-client.mjs';
import { articlePrompt } from '../article-utils/article-prompts.mjs';
import { isRegularSeasonOrPlayoffs } from '../article-utils/season-guards.mjs';
import { pickHeroPlayer } from '../article-utils/hero-player.mjs';
import { parseRosterMove, rosterMoveString } from '../lib/roster-move-parse.mjs';
import { primaryLink, articleLink, featureLink, linkList } from '../article-utils/article-links.mjs';
import { LEAGUES, DEFAULT_LEAGUE_SLUG } from '../../src/config/leagues-data.mjs';

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

/**
 * "1 claim" / "2 claims". The fact sheet is the model's ONLY source of truth
 * and it reads it as prose, so "1 claims" is a sentence the column can echo.
 */
function countOf(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Rows that are a claim decided BY the waiver run (a bid, or rolling priority). */
const WAIVER_CLAIM_TYPES = new Set(['BBID_WAIVER', 'WAIVER']);
/** The row MFL writes once per waiver run, claims or not. */
const WAIVER_RUN_TYPES = new Set(['BBID_AUTO_PROCESS_WAIVERS', 'AUTO_PROCESS_WAIVERS']);
/** Fact-sheet order within a team: the run first, then what followed it. */
const KIND_ORDER = { waiver: 0, fcfsAfter: 1, fcfsBefore: 2 };

/** "Wed Nov 25, 7:00 PM" on the league's Pacific clock. */
function formatPacific(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** How a pickup arrived, in words the model can repeat. */
function kindLabel(c, minimumSalary) {
  if (c.type === 'BBID_WAIVER') return 'waiver claim, blind bid';
  if (c.type === 'WAIVER') return 'waiver claim, rolling priority';
  const when = c.kind === 'fcfsAfter' ? 'right after the waiver run' : 'earlier in the week, before the run';
  return minimumSalary > 0
    ? `first-come-first-served add ${when} — signs at the league-minimum salary, NOT free`
    : `first-come-first-served add ${when}`;
}

export async function buildFactSheet(data, week, year, projectRoot, options = {}) {
  const { league = DEFAULT_LEAGUE_SLUG } = options;
  const players = new Map();
  // Raw feed records (position + espn_id) for hero-player selection.
  const playerMeta = new Map();
  for (const p of data.players.players.player) {
    if (p.id) {
      const pos = normalizePosition(p.position);
      const isDef = pos === 'Def';
      players.set(p.id, {
        name: isDef ? formatDefName(p.name) : flipName(p.name),
        position: pos,
        team: p.team,
      });
      playerMeta.set(p.id, p);
    }
  }

  // Franchise names must come from the league being written. Defaulting
  // this to TheLeague built AFL prose from TheLeague's team names —
  // invisible, because both leagues have a franchise 0001 (#1086 F4).
  const teams = await loadTeams(projectRoot, league);

  // A first-come-first-served add is not free in a salary league: the player
  // still signs at the league minimum. MFL writes no price on a FREE_AGENT row,
  // so pricing it from the row alone told the column two FCFS adds were "free
  // assets for zero dollars". Absent for a league without salaries.
  const minimumSalary = LEAGUES[league].minimumSalary ?? 0;

  // The window is the seven days before the run, so consecutive weekly
  // recaps tile the calendar with no gap and no overlap.
  const now = (options.now ?? Date.now()) / 1000; // Unix seconds
  const windowStart = now - (7 * 24 * 60 * 60);
  const inWindow = (t) => {
    const ts = parseInt(t.timestamp, 10);
    return ts >= windowStart && ts <= now;
  };
  const allRows = (data.transactions.transactions?.transaction || []);

  // The waiver run itself. MFL logs one AUTO_PROCESS row per run, claims or
  // not (BBID_ for a blind-bid league, plain for the AFL's rolling priority),
  // stamped with the same second as the claims it processed. It is how the
  // recap tells an FCFS add AFTER the run from one before it — and its absence
  // means the data does not reach this week's run at all. That was the
  // 2026-11-25 failure: a stale copy whose newest row predated the run, read
  // as "zero claims, zero dollars". A missing run is a skip, never a zero.
  const runTimestamps = allRows
    .filter((t) => WAIVER_RUN_TYPES.has(t.type) && inWindow(t))
    .map((t) => parseInt(t.timestamp, 10));
  const claimRows = allRows.filter((t) => WAIVER_CLAIM_TYPES.has(t.type) && inWindow(t));
  if (runTimestamps.length === 0 && claimRows.length === 0) {
    console.warn(
      `  [waiver-pickups] no waiver run in the last 7 days of ${data.transactionsSource ?? 'the'} transactions — ` +
      'not writing a recap that would call the week empty.'
    );
    return null;
  }
  const waiverRunAt = Math.max(...runTimestamps, ...claimRows.map((t) => parseInt(t.timestamp, 10)));

  const txns = allRows.filter((t) =>
    (WAIVER_CLAIM_TYPES.has(t.type) || t.type === 'FREE_AGENT') && inWindow(t)
  );

  // Parse transactions into structured claims
  const claimsByTeam = {};
  let totalSpent = 0;
  let highestBid = { amount: 0, player: '', team: '' };
  // Scored candidates for the composite hero — the biggest bid gets the face.
  const heroCandidates = [];
  const counts = { waiver: 0, fcfsAfter: 0, fcfsBefore: 0 };

  // Parse each move with the SHARED positional parser, never an ad-hoc split.
  // MFL writes the add side with a TRAILING COMMA ("16171,|775000|16752,"), so
  // `split('|')[0]` is "16171," — a key no player map holds, which is how a
  // whole column shipped calling Kendre Miller "Player 16171". And a pure drop
  // is encoded as an EMPTY add segment ("|15749,"), so a `.filter(Boolean)`
  // before indexing promotes the dropped player to a phantom pickup — the same
  // bug the scanner already shipped once (see scripts/lib/roster-move-parse.mjs).
  // The AFL's plain WAIVER rows carry `added`/`dropped` and NO `transaction`,
  // so the move string comes from rosterMoveString — reading `txn.transaction`
  // alone dropped every AFL waiver claim from this column.
  let claimCount = 0;
  for (const txn of txns) {
    const { addedIds, bbidAmount } = parseRosterMove(rosterMoveString(txn));

    // A BBID row the parser could not read is UNPARSED, not a drop and not a
    // free pickup — so both of its failure modes warn, and neither is decided
    // by which check happens to run first. The bid check used to sit BELOW the
    // drop-skip, which meant a BBID string mangled badly enough to yield no add
    // at all was silently classified as a drop and vanished, while the very
    // same string with a readable add warned loudly three lines later. The
    // quiet half is the dangerous one: a claim that never reaches the fact
    // sheet cannot be noticed in the published prose either (#1158 F3).
    const unreadableBid = txn.type === 'BBID_WAIVER' && !Number.isFinite(bbidAmount);
    if (unreadableBid || addedIds.length === 0) {
      if (unreadableBid) {
        console.warn(
          `  [waiver-pickups] unreadable BBID bid, skipping claim: ${JSON.stringify(txn.transaction)}`
        );
      }
      // Nothing added and nothing wrong with it — a plain drop, not a claim.
      continue;
    }

    const fid = txn.franchise;
    const teamName = teams.get(fid)?.name ?? `Team ${fid}`;
    if (!claimsByTeam[fid]) claimsByTeam[fid] = { name: teamName, claims: [] };

    const ts = parseInt(txn.timestamp, 10);
    const kind = txn.type !== 'FREE_AGENT'
      ? 'waiver'
      : ts >= waiverRunAt ? 'fcfsAfter' : 'fcfsBefore';

    for (const playerId of addedIds) {
      // A BBID bid buys the one player on the add side; any other pickup
      // (a free-agent add, a rolling-priority waiver claim) signs at the
      // league minimum (0 where the league has no salaries).
      const bidAmount = txn.type === 'BBID_WAIVER'
        ? addedIds.length === 1 && Number.isFinite(bbidAmount) ? bbidAmount : 0
        : minimumSalary;
      const playerInfo = players.get(playerId);

      const claim = {
        player: playerInfo?.name ?? `Player ${playerId}`,
        position: playerInfo?.position ?? '??',
        bid: bidAmount,
        bidDisplay: formatSalary(bidAmount),
        type: txn.type,
        kind,
      };

      claimsByTeam[fid].claims.push(claim);
      claimCount += 1;
      counts[kind] += 1;
      totalSpent += bidAmount;
      heroCandidates.push({ id: playerId, score: bidAmount });

      if (txn.type === 'BBID_WAIVER' && bidAmount > highestBid.amount) {
        highestBid = { amount: bidAmount, player: claim.player, team: teamName };
      }
    }
  }

  const lines = [];
  lines.push(`WEEK ${week} WAIVER PICKUPS — ${LEAGUES[league].name} (${year} Season)`);
  lines.push(`Waiver run: ${formatPacific(waiverRunAt)} PT`);
  lines.push(`Total pickups this week: ${claimCount}`);
  lines.push(`  - Waiver claims in the run: ${counts.waiver}`);
  lines.push(`  - First-come-first-served adds right after the run: ${counts.fcfsAfter}`);
  lines.push(`  - First-come-first-served adds earlier in the week, before the run: ${counts.fcfsBefore}`);
  // A league without salaries or bids (the AFL) has nothing to spend; "$0
  // spent" lines there only invite the model to call pickups free.
  const priced = totalSpent > 0;
  if (priced) lines.push(`Total spent: ${formatSalary(totalSpent)}`);
  if (minimumSalary > 0) {
    lines.push(`League rule: every pickup, waiver bid or first-come-first-served, costs at least the ${formatSalary(minimumSalary)} league-minimum salary. No pickup is free.`);
  }
  lines.push('');

  // Counts CLAIMS, not rows: a week of nothing but drops has txns but no pickups.
  // Reaching here means the run WAS in the data, so this is a real empty week.
  if (claimCount === 0) {
    lines.push('No waiver claims or free agent pickups this week.');
    return { factSheet: lines.join('\n'), enrichment: {} };
  }

  lines.push('=== PICKUPS BY TEAM ===');
  const sortedTeams = Object.entries(claimsByTeam)
    .sort((a, b) => b[1].claims.reduce((s, c) => s + c.bid, 0) - a[1].claims.reduce((s, c) => s + c.bid, 0));

  for (const [fid, teamData] of sortedTeams) {
    const teamSpend = teamData.claims.reduce((s, c) => s + c.bid, 0);
    lines.push(priced
      ? `── ${teamData.name} (${countOf(teamData.claims.length, 'pickup')}, ${formatSalary(teamSpend)} spent) ──`
      : `── ${teamData.name} (${countOf(teamData.claims.length, 'pickup')}) ──`);
    for (const c of teamData.claims.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.bid - a.bid)) {
      const price = priced ? ` (${c.bidDisplay})` : '';
      lines.push(`  - ${c.position} ${c.player}${price} [${kindLabel(c, minimumSalary)}]`);
    }
    lines.push('');
  }

  lines.push('=== SPENDING SUMMARY ===');
  if (priced) lines.push(`Biggest spender: ${sortedTeams[0]?.[1]?.name} (${formatSalary(sortedTeams[0]?.[1]?.claims.reduce((s, c) => s + c.bid, 0))})`);
  // A week of nothing but free-agent adds has no priced claim, so highestBid is
  // still its {0, '', ''} seed — printing it emits "Highest single bid: $0 for
  // by " into the model's only source of truth. The AFL has never had a BBID
  // row at all, so that is every AFL week. Omit the line instead.
  if (highestBid.amount > 0) {
    lines.push(`Highest single bid: ${formatSalary(highestBid.amount)} for ${highestBid.player} by ${highestBid.team}`);
  } else if (priced) {
    lines.push('Highest single bid: none — no claim this week carried a bid.');
  }
  // sortedTeams is ordered by SPEND, so [0] is the biggest spender — asking it
  // for "most claims" reported the top spender's single bid as the week's
  // busiest team while another team had twice the moves. Max by COUNT.
  const busiest = sortedTeams.reduce(
    (a, b) => (b[1].claims.length > a[1].claims.length ? b : a),
    sortedTeams[0]
  );
  lines.push(`Most pickups: ${busiest?.[1]?.name} (${busiest?.[1]?.claims.length})`);

  const heroPlayerId = pickHeroPlayer(heroCandidates, playerMeta);
  return { factSheet: lines.join('\n'), enrichment: { heroPlayerId } };
}

// The column's own text lives in the private pack (article-prompts.mjs).
export function getSystemPrompt({ league = DEFAULT_LEAGUE_SLUG, persona } = {}) {
  return buildCachedSystem(articlePrompt('waiver-pickups', 'system'), { league, persona });
}

export function getUserPrompt(factSheet) {
  return articlePrompt('waiver-pickups', 'user', { FACT_SHEET: factSheet });
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
 * Every waiver column ends with a reader wondering who is still out there —
 * which is a page, not a paragraph. The plugs are the tools that turn that
 * wondering into a claim.
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
    primaryLink(league, 'players', {
      label: 'the free agent board',
      cta: 'See who is still out there on the free agent board.',
    }),
    articleLink(league, 'rosters', { label: 'the rosters' }),
    featureLink(league, 'notifications'),
    featureLink(league, 'salary'),
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
    linkLabel: 'Read full article',
    league: slug,
    authorId: 'claude',
    content: aiOutput.content,
    ...(enrichment.heroPlayerId
      ? { heroPlayerId: enrichment.heroPlayerId, playerIds: [enrichment.heroPlayerId] }
      : {}),
  };
}
