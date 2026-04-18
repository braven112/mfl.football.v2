#!/usr/bin/env node
/**
 * Schefter Transaction Scanner
 *
 * Scans MFL for new transactions and generates Schefter feed posts.
 * Runs hourly via GitHub Actions or manually: node scripts/schefter-scan.mjs
 *
 * For breaking-tier posts (trades, high-value auctions), calls the Anthropic API
 * to generate Schefter-voiced commentary. Standard/minor posts use templates.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY — Required for breaking-tier AI commentary
 *   MFL_HOST — MFL API host (default: api.myfantasyleague.com)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadLore,
  loadPostHistory,
  buildRecentPostsPromptBlock,
  appendPostHistory,
  buildHistoryEntry,
} from './lib/schefter-lore.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MFL_HOST = process.env.MFL_HOST || 'api.myfantasyleague.com';

// Dry-run flag: when set, scripts assemble prompts and log what WOULD happen
// but do NOT call the LLM, do NOT write to feed files, do NOT post to GroupMe,
// and do NOT append to post-history.json.
const DRY_RUN = process.argv.includes('--dry-run');

// ── League configs ──

const LEAGUES = [
  {
    slug: 'theleague',
    leagueId: '13522',
    feedPath: path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json'),
    playersPath: (year) => path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'players.json'),
    configPath: path.join(projectRoot, 'src', 'data', 'theleague.config.json'),
  },
  {
    slug: 'afl',
    leagueId: '19621',
    feedPath: path.join(projectRoot, 'data', 'afl-fantasy', 'schefter-feed.json'),
    playersPath: (year) => path.join(projectRoot, 'data', 'afl-fantasy', 'mfl-feeds', String(year), 'players.json'),
    configPath: path.join(projectRoot, 'data', 'afl-fantasy', 'afl.config.json'),
  },
];

// ── Constants ──

const SKIP_TYPES = new Set(['AUCTION_BID', 'AUCTION_INIT', 'IR', 'TAXI']);
const BREAKING_AUCTION = 3_000_000;
const STANDARD_AUCTION = 1_000_000;
const ROUND_ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };

// ── Helpers ──

function formatSalary(cents) {
  if (!Number.isFinite(cents) || cents === 0) return '$0';
  if (cents >= 1_000_000) return `$${(cents / 1_000_000).toFixed(2)}M`;
  if (cents >= 1_000) return `$${(cents / 1_000).toFixed(0)}K`;
  return `$${cents.toLocaleString()}`;
}

function generatePostId(timestamp) {
  const hash = Math.random().toString(36).slice(2, 6);
  return `sf_${timestamp}_${hash}`;
}

function parseDraftPick(pickId, teams) {
  const m = pickId.match(/^FP_(\d{4})_(\d{4})_(\d+)$/);
  if (!m) return null;
  const team = teams.get(m[1]);
  const round = parseInt(m[3]);
  const ordinal = ROUND_ORDINALS[round] ?? `${round}th`;
  return { display: `${team?.name ?? `Team ${m[1]}`}'s ${m[2]} ${ordinal}` };
}

/**
 * Format a defense name from MFL "Team, City" format.
 * "Bills, Buffalo" → "the Buffalo Bills defense"
 */
function formatDefenseName(name) {
  if (!name) return 'a team defense';
  const parts = name.split(', ');
  if (parts.length === 2) return `the ${parts[1]} ${parts[0]} defense`;
  return `the ${name} defense`;
}

/** Format a player for display — DEF-aware */
function formatPlayerDisplay(player) {
  if (!player) return 'Unknown Player';
  if (player.position === 'Def' || player.position === 'DEF') {
    return formatDefenseName(player.name);
  }
  return `${player.position ?? ''} ${player.name}`.trim();
}

function parseTradeAssets(str, players, teams) {
  if (!str) return { playerNames: [], pickNames: [] };
  const parts = str.split(',').map(s => s.trim()).filter(Boolean);
  const playerNames = [];
  const pickNames = [];
  for (const part of parts) {
    if (part.startsWith('FP_')) {
      const pick = parseDraftPick(part, teams);
      if (pick) pickNames.push(pick.display);
    } else {
      const p = players.get(part);
      playerNames.push(p ? formatPlayerDisplay(p) : `Player ${part}`);
    }
  }
  return { playerNames, pickNames };
}

/**
 * Build a stable signature for a trade so a completed TRADE transaction can
 * supersede any prior trade-pending rumor post about the same deal.
 * Uses sorted franchise pair + sorted asset IDs (player IDs + raw FP_ pick IDs)
 * so pending and completed sides hash identically regardless of who's "side 1".
 */
function buildTradeSignature(franchise1, franchise2, gaveStr1, gaveStr2) {
  const f1 = String(franchise1 || '');
  const f2 = String(franchise2 || '');
  if (!f1 || !f2) return null;
  const franchisePair = [f1, f2].sort().join(':');

  const assets = [];
  for (const str of [gaveStr1, gaveStr2]) {
    if (!str) continue;
    for (const part of str.split(',').map(s => s.trim()).filter(Boolean)) {
      assets.push(part);
    }
  }
  if (assets.length === 0) return null;
  assets.sort();
  return `${franchisePair}|${assets.join(',')}`;
}

function parseAuctionTransaction(txnStr, players) {
  const clean = txnStr.replace(/^\|/, '').replace(/\|$/, '');
  const parts = clean.split('|').filter(Boolean);
  const playerId = parts[0]?.replace(/,$/, '');
  const salary = parts[1] ? parseInt(parts[1]) : undefined;
  const player = players.get(playerId);
  const isDef = player?.position === 'Def' || player?.position === 'DEF';
  return {
    playerId,
    playerName: player ? formatPlayerDisplay(player) : `Player ${playerId}`,
    isDef,
    salary: Number.isFinite(salary) && salary > 100_000 ? salary : undefined,
  };
}

// ── Tier Classification ──

function classifyTier(raw, salary) {
  if (raw.type === 'TRADE') return 'breaking';
  if (raw.type === 'AUCTION_WON') {
    if ((salary ?? 0) >= BREAKING_AUCTION) return 'breaking';
    if ((salary ?? 0) >= STANDARD_AUCTION) return 'standard';
    return 'minor';
  }
  if (raw.by_commish === '1') return 'minor';
  if (raw.type === 'BBID_WAIVER') return 'standard';
  return 'minor';
}

// ── Post Generation ──

function generateTradePost(raw, players, teams, leagueSlug) {
  const team1 = teams.get(raw.franchise)?.name ?? `Team ${raw.franchise}`;
  const team2 = teams.get(raw.franchise2)?.name ?? `Team ${raw.franchise2}`;
  const gave1 = parseTradeAssets(raw.franchise1_gave_up, players, teams);
  const gave2 = parseTradeAssets(raw.franchise2_gave_up, players, teams);

  const team1Gets = [...gave2.playerNames, ...gave2.pickNames];
  const team2Gets = [...gave1.playerNames, ...gave1.pickNames];
  const totalAssets = team1Gets.length + team2Gets.length;

  const headline = totalAssets <= 3
    ? `${team1} trade with ${team2} for ${team1Gets[0] ?? 'assets'}`
    : `${team1} and ${team2} complete ${totalAssets}-asset trade`;

  const body = `League sources tell me ${team1} and ${team2} have agreed to a deal. ` +
    `${team1} receive ${team1Gets.join(', ') || 'assets'}. ` +
    `${team2} receive ${team2Gets.join(', ') || 'assets'}.`;

  const franchiseIds = [raw.franchise];
  if (raw.franchise2) franchiseIds.push(raw.franchise2);

  return {
    id: generatePostId(raw.timestamp),
    timestamp: new Date(parseInt(raw.timestamp) * 1000).toISOString(),
    type: 'transaction',
    transactionSubType: 'TRADE',
    tier: 'breaking',
    headline,
    body,
    franchiseIds,
    sourceTimestamp: raw.timestamp,
    tradeSignature: buildTradeSignature(raw.franchise, raw.franchise2, raw.franchise1_gave_up, raw.franchise2_gave_up),
    league: leagueSlug,
  };
}

// Template pools for varied Schefter voice — 30+ options per tier
const BREAKING_AUCTION_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} land ${p} at ${s}`, body: `I'm told ${tm} went all-in for ${p} at ${s}. A statement move.` }),
  (tm, p, s) => ({ headline: `${tm} win auction for ${p} at ${s}`, body: `League sources tell me ${tm} outbid the field to land ${p} at ${s}. Bold investment.` }),
  (tm, p, s) => ({ headline: `Boom! ${tm} grab ${p} for ${s}`, body: `Boom! ${tm} drop ${s} on ${p}. The auction room went quiet when this one hit.` }),
  (tm, p, s) => ({ headline: `${tm} secure ${p} at ${s}`, body: `${tm} win the bidding war for ${p} at ${s}. That roster just got significantly better.` }),
  (tm, p, s) => ({ headline: `${tm} go big for ${p} at ${s}`, body: `I'm told ${tm} had ${p} circled from the start. They paid ${s} and didn't flinch.` }),
  (tm, p, s) => ({ headline: `${tm} make splash for ${p}`, body: `League sources tell me ${tm} are paying ${s} for ${p}. That's a franchise-altering acquisition.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} in heated auction`, body: `The bidding for ${p} got intense. When the dust settled, ${tm} walked away with the prize at ${s}.` }),
  (tm, p, s) => ({ headline: `Wow. ${tm} land ${p} at ${s}`, body: `I'm told multiple teams pushed hard for ${p}. ${tm} won the war at ${s}. Money well spent.` }),
  (tm, p, s) => ({ headline: `${tm} pounce on ${p} for ${s}`, body: `${tm} weren't messing around. ${s} for ${p} is aggressive, but this is a team making a statement.` }),
  (tm, p, s) => ({ headline: `Breaking: ${tm} add ${p} at ${s}`, body: `League sources tell me ${tm} are the winners of the ${p} sweepstakes at ${s}. Major roster upgrade.` }),
  (tm, p, s) => ({ headline: `${tm} open the vault for ${p}`, body: `${s} for ${p}. That's what ${tm} decided this player was worth, and I'm told they'd do it again.` }),
  (tm, p, s) => ({ headline: `Bang! ${tm} land ${p} at ${s}`, body: `I'm told ${tm} walked into the auction room with one target: ${p}. They paid ${s} and got their guy.` }),
  (tm, p, s) => ({ headline: `${tm} swing big for ${p}`, body: `${tm} drop ${s} on ${p}. You don't spend that kind of money unless you're building something. This team is building something.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} at ${s}`, body: `I'm told the final bid for ${p} came from ${tm} at ${s}. The rest of the room tapped out.` }),
  (tm, p, s) => ({ headline: `${tm} lock up ${p} for ${s}`, body: `League sources confirm ${tm} have secured ${p} at ${s}. This one changes the math for the whole conference.` }),
];
const STANDARD_AUCTION_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} win ${p} at ${s}`, body: `${tm} pick up ${p} at ${s}. Solid depth move.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} win the auction for ${p} at ${s}. Smart roster construction.` }),
  (tm, p, s) => ({ headline: `${tm} land ${p} for ${s}`, body: `I'm told ${tm} quietly secured ${p} for ${s}.` }),
  (tm, p, s) => ({ headline: `${tm} secure ${p} at ${s}`, body: `${tm} slot ${p} onto the roster at ${s}. Nice pickup.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} add ${p} to the roster at ${s}. That's a useful piece.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} for ${s}`, body: `${tm} bring in ${p} at ${s}. Value play that could pay off down the road.` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p} at ${s}`, body: `${p} heads to ${tm} at ${s}. Good price for what this player can do.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p} (${s})`, body: `${tm} didn't overpay for ${p} at ${s}. Exactly the kind of move playoff teams make.` }),
  (tm, p, s) => ({ headline: `${tm} grab ${p} at ${s}`, body: `${tm} take ${p} off the board at ${s}. Fills a need without breaking the bank.` }),
  (tm, p, s) => ({ headline: `${tm} win bid for ${p}`, body: `${p} to ${tm} at ${s}. Roster gets a little deeper.` }),
  (tm, p, s) => ({ headline: `${tm} bring in ${p} (${s})`, body: `${tm} add ${p} for ${s}. Not flashy, but this team knows what it needs.` }),
  (tm, p, s) => ({ headline: `${tm} land ${p} at ${s}`, body: `I'm told ${tm} had been eyeing ${p} for a while. They got their price at ${s}.` }),
  (tm, p, s) => ({ headline: `${tm} secure ${p} (${s})`, body: `${tm} win the rights to ${p} at ${s}. Quietly building a contender.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} at ${s}`, body: `${p} lands with ${tm} for ${s}. A fair price for a useful player.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p} at ${s}`, body: `${tm} snag ${p} for ${s}. This one flew under the radar but it shouldn't have.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} (${s})`, body: `Another add for ${tm}: ${p} at ${s}. This front office stays busy.` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p} (${s})`, body: `${tm} take a shot on ${p} at ${s}. Low risk, decent upside.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} for ${s}`, body: `${tm} round out their roster with ${p} at ${s}. Methodical addition.` }),
  (tm, p, s) => ({ headline: `${tm} nab ${p} at ${s}`, body: `${p} goes to ${tm} at ${s}. Solid floor player at a manageable number.` }),
  (tm, p, s) => ({ headline: `${tm} win auction for ${p}`, body: `${tm} invest ${s} in ${p}. That salary won't look bad if the production is there.` }),
];
const MINOR_AUCTION_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} claim ${p} (${s})`, body: `${tm} claims ${p} (${s})` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} (${s})`, body: `${tm} add ${p} at ${s}` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} pick up ${p} (${s})` }),
  (tm, p, s) => ({ headline: `${tm} grab ${p} (${s})`, body: `${p} heads to ${tm} at ${s}. Depth move.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} snag ${p} for ${s}. Lottery ticket.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} (${s})`, body: `${tm} take a flier on ${p} (${s}). Low-cost roster fill.` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p} (${s})`, body: `${p} to ${tm} at ${s}. Camp body with upside.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} at ${s}`, body: `${tm} quietly add ${p} at ${s}.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p} (${s})`, body: `${tm} roster ${p} at ${s}. Keeping options open.` }),
  (tm, p, s) => ({ headline: `${tm} grab ${p} at ${s}`, body: `${p} joins ${tm} at ${s}. End-of-bench stash.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} bring in ${p} at minimum. Worth a look.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} (${s})`, body: `${tm} add ${p} (${s}). Taxi squad candidate.` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p} at ${s}`, body: `${tm} take a swing on ${p} for ${s}.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${p} goes to ${tm} at the minimum. Cheap upside play.` }),
  (tm, p, s) => ({ headline: `${tm} roster ${p} (${s})`, body: `${tm} stash ${p} at ${s}. Speculative add.` }),
];

// DEF-specific body templates — reference the unit, not a singular player
const BREAKING_AUCTION_DEF_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} land ${p} at ${s}`, body: `I'm told ${tm} went all-in for ${p} at ${s}. Adding a premier defensive unit to this roster.` }),
  (tm, p, s) => ({ headline: `Boom! ${tm} grab ${p} for ${s}`, body: `Boom! ${tm} drop ${s} on ${p}. The points this unit put up last season made them a must-have.` }),
  (tm, p, s) => ({ headline: `${tm} secure ${p} at ${s}`, body: `League sources tell me ${tm} outbid the field for ${p} at ${s}. That special teams and defensive scoring could be the difference in a tight playoff race.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} in heated auction`, body: `${tm} pay ${s} for ${p}. Smart organizations know D/ST scoring wins weeks you have no business winning.` }),
  (tm, p, s) => ({ headline: `${tm} lock up ${p} for ${s}`, body: `I'm told ${tm} had ${p} circled from the start. That defensive front and special teams unit are worth every cent of ${s}.` }),
];
const STANDARD_AUCTION_DEF_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} pick up ${p} at ${s}. Solid defensive unit to anchor the D/ST slot.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} at ${s}`, body: `${tm} add ${p} at ${s}. That unit could be a weekly scoring advantage.` }),
  (tm, p, s) => ({ headline: `${tm} secure ${p} (${s})`, body: `${cap(p)} heads to ${tm} for ${s}. Good price for a defense with this much upside.` }),
  (tm, p, s) => ({ headline: `${tm} land ${p} for ${s}`, body: `I'm told ${tm} quietly secured ${p} for ${s}. The sack and turnover potential makes this worthwhile.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p} (${s})`, body: `${tm} invest ${s} in ${p}. Defensive scoring is the great equalizer in this league.` }),
];
const MINOR_AUCTION_DEF_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} claim ${p} (${s})`, body: `${tm} claims ${p} (${s}). Streaming option for the D/ST slot.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p} (${s})`, body: `${tm} add ${p} at ${s}. Depth piece for bye weeks.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p} (${s})`, body: `${cap(p)} to ${tm} at ${s}. Low-cost D/ST fill.` }),
  (tm, p, s) => ({ headline: `${tm} grab ${p} (${s})`, body: `${tm} grab ${p} for ${s}. Keeping their defensive options open.` }),
  (tm, p, s) => ({ headline: `${tm} win ${p} (${s})`, body: `${tm} pick up ${p} (${s}). Schedule-based streamer add.` }),
];
const FA_DEF_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} add ${p}${s}`, body: `${tm} add ${p}${s} off the wire. D/ST streaming move.` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p}${s}`, body: `${cap(p)} heads to ${tm}${s}. Adding defensive depth.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p}${s}`, body: `${tm} bring in ${p}${s}. That defensive front could produce fantasy points.` }),
  (tm, p, s) => ({ headline: `${tm} grab ${p}${s}`, body: `${tm} claim ${p}${s}. Matchup-based D/ST pickup.` }),
];

/** Capitalize first letter — for defense names at sentence start */
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Pick a template deterministically, avoiding back-to-back repeats.
 * Uses a tracker object to remember the last index per template pool.
 */
const _lastPick = new Map();
function pickTemplate(templates, timestamp) {
  const poolKey = templates; // identity reference as key
  const idx = parseInt(timestamp) % templates.length;
  const lastIdx = _lastPick.get(poolKey) ?? -1;
  const finalIdx = (idx === lastIdx && templates.length > 1) ? (idx + 1) % templates.length : idx;
  _lastPick.set(poolKey, finalIdx);
  return templates[finalIdx];
}

function generateAuctionPost(raw, players, teams, leagueSlug) {
  const team = teams.get(raw.franchise)?.name ?? `Team ${raw.franchise}`;
  const { playerName, isDef, salary } = parseAuctionTransaction(raw.transaction, players);
  const tier = classifyTier(raw, salary);
  const salaryStr = salary ? formatSalary(salary) : 'minimum salary';

  let templates;
  if (isDef) {
    templates = tier === 'breaking' ? BREAKING_AUCTION_DEF_TEMPLATES
      : tier === 'standard' ? STANDARD_AUCTION_DEF_TEMPLATES
      : MINOR_AUCTION_DEF_TEMPLATES;
  } else {
    templates = tier === 'breaking' ? BREAKING_AUCTION_TEMPLATES
      : tier === 'standard' ? STANDARD_AUCTION_TEMPLATES
      : MINOR_AUCTION_TEMPLATES;
  }
  const { headline, body } = pickTemplate(templates, raw.timestamp)(team, playerName, salaryStr);

  return {
    id: generatePostId(raw.timestamp),
    timestamp: new Date(parseInt(raw.timestamp) * 1000).toISOString(),
    type: 'transaction',
    transactionSubType: 'AUCTION_WON',
    tier,
    headline,
    body,
    franchiseIds: [raw.franchise],
    sourceTimestamp: raw.timestamp,
    league: leagueSlug,
  };
}

const FA_TEMPLATES = [
  (tm, p, s) => ({ headline: `${tm} add ${p}${s}`, body: `${tm} claims ${p}${s}` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p}${s}`, body: `${tm} add ${p} off the wire${s}` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p}${s}`, body: `${tm} scoop up ${p}${s}. Quiet move.` }),
  (tm, p, s) => ({ headline: `${tm} grab ${p}${s}`, body: `${p} heads to ${tm}${s}. Free agent pickup.` }),
  (tm, p, s) => ({ headline: `${tm} sign ${p}${s}`, body: `${tm} bring in ${p} off the open market${s}.` }),
  (tm, p, s) => ({ headline: `${tm} add ${p}${s}`, body: `${tm} roster ${p}${s}. Filling a hole.` }),
  (tm, p, s) => ({ headline: `${tm} pick up ${p}${s}`, body: `${p} to ${tm}${s}. Waiver wire add.` }),
  (tm, p, s) => ({ headline: `${tm} claim ${p}${s}`, body: `${tm} take a shot on ${p}${s}.` }),
];

function generateFreeAgentPost(raw, players, teams, leagueSlug) {
  const team = teams.get(raw.franchise)?.name ?? `Team ${raw.franchise}`;
  const { playerName, isDef, salary } = parseAuctionTransaction(raw.transaction, players);
  const tier = classifyTier(raw, salary);
  const salaryStr = salary ? ` (${formatSalary(salary)})` : '';
  const faPool = isDef ? FA_DEF_TEMPLATES : FA_TEMPLATES;
  const { headline, body } = pickTemplate(faPool, raw.timestamp)(team, playerName, salaryStr);

  return {
    id: generatePostId(raw.timestamp),
    timestamp: new Date(parseInt(raw.timestamp) * 1000).toISOString(),
    type: 'transaction',
    transactionSubType: 'FREE_AGENT',
    tier,
    headline,
    body,
    franchiseIds: [raw.franchise],
    sourceTimestamp: raw.timestamp,
    league: leagueSlug,
  };
}

// ── AI Commentary (breaking tier) ──

async function generateBreakingCommentary(post, raw) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('  [skip AI] No ANTHROPIC_API_KEY — using template body');
    return;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You are Claude Schefter, a beat reporter for a dynasty fantasy football league. Channel Adam Schefter's energy. Use phrases like "I'm told...", "League sources tell me...", "Boom!". Grade trades A+ to F. Be opinionated and confident. Never break character. Keep it to 2-3 sentences for the body and 1-2 sentences for the analysis/take.`,
        messages: [
          {
            role: 'user',
            content: `Write a breaking news post about this transaction:\n\n${post.body}\n\nProvide:\n1. A punchy body (2-3 sentences, Schefter voice)\n2. A "Schefter's Take" analysis (1-2 sentences, grade the trade if applicable)\n\nFormat as JSON: {"body": "...", "analysis": "..."}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`  [AI] API returned ${res.status} — using template`);
      return;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';

    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.body) post.body = parsed.body;
      if (parsed.analysis) post.analysis = parsed.analysis;
      console.log('  [AI] Commentary generated');
    }
  } catch (err) {
    console.warn(`  [AI] Error: ${err.message} — using template`);
  }
}

// ── GroupMe Bot ──

async function postToGroupMe(text, { botIdOverride } = {}) {
  const botId = botIdOverride || process.env.GROUPME_ROGER_BOT_ID;
  if (!botId) return;
  try {
    await fetch('https://api.groupme.com/v3/bots/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: botId, text }),
    });
    console.log('  [GroupMe] Posted');
  } catch (err) {
    console.log(`  [GroupMe] Failed: ${err.message}`);
  }
}

// ── MFL API ──

async function fetchTransactions(leagueId, year) {
  const url = `https://${MFL_HOST}/${year}/export?TYPE=transactions&L=${leagueId}&JSON=1`;
  console.log(`  Fetching: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MFL API returned ${res.status}`);
  const data = await res.json();
  const txns = data?.transactions?.transaction ?? [];
  return Array.isArray(txns) ? txns : [txns];
}

// ── Data Loading ──

async function loadPlayers(filePath) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const list = raw?.players?.player ?? [];
    const arr = Array.isArray(list) ? list : [list];
    const map = new Map();
    for (const p of arr) {
      if (p.id) {
        map.set(p.id, {
          name: p.name ?? `Player ${p.id}`,
          position: p.position,
          nflTeam: p.team,
        });
      }
    }
    return map;
  } catch {
    console.warn(`  Players file not found: ${filePath}`);
    return new Map();
  }
}

async function loadTeams(configPath) {
  try {
    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const teams = raw.teams ?? [];
    const map = new Map();
    for (const t of teams) {
      map.set(t.franchiseId, { name: t.name, abbrev: t.abbrev });
    }
    return map;
  } catch {
    console.warn(`  Config file not found: ${configPath}`);
    return new Map();
  }
}

async function loadFeed(feedPath) {
  try {
    return JSON.parse(await fs.readFile(feedPath, 'utf8'));
  } catch {
    return { lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts: [] };
  }
}

// ── Main ──

async function scanLeague(league) {
  console.log(`\n=== Scanning ${league.slug} (${league.leagueId}) ===`);

  const feed = await loadFeed(league.feedPath);
  const watermark = feed.lastProcessedMflTimestamp || '0';
  console.log(`  Watermark: ${watermark}`);

  // Determine current year from feed or system
  const now = new Date();
  const year = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;

  const [transactions, players, teams] = await Promise.all([
    fetchTransactions(league.leagueId, year),
    loadPlayers(league.playersPath(year)),
    loadTeams(league.configPath),
  ]);

  console.log(`  Total transactions: ${transactions.length}`);
  console.log(`  Players loaded: ${players.size}`);
  console.log(`  Teams loaded: ${teams.size}`);

  // Filter new transactions
  const newTxns = transactions.filter(txn => {
    if (SKIP_TYPES.has(txn.type)) return false;
    return parseInt(txn.timestamp) > parseInt(watermark);
  });

  console.log(`  New transactions: ${newTxns.length}`);
  if (newTxns.length === 0) {
    feed.lastScanTimestamp = now.toISOString();
    await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
    return 0;
  }

  // Sort oldest first so we process chronologically
  newTxns.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

  const leagueSlug = league.slug === 'afl' ? 'afl' : 'theleague';
  const newPosts = [];

  for (const txn of newTxns) {
    let post;
    if (txn.type === 'TRADE') {
      post = generateTradePost(txn, players, teams, leagueSlug);
    } else if (txn.type === 'AUCTION_WON') {
      post = generateAuctionPost(txn, players, teams, leagueSlug);
    } else if (txn.type === 'FREE_AGENT' || txn.type === 'WAIVER' || txn.type === 'BBID_WAIVER') {
      post = generateFreeAgentPost(txn, players, teams, leagueSlug);
    } else {
      continue;
    }

    // Check for dedup
    if (feed.posts.some(p => p.sourceTimestamp === txn.timestamp && p.transactionSubType === post.transactionSubType)) {
      continue;
    }

    // One post per topic: a completed TRADE supersedes any prior trade-pending
    // rumor about the same deal. Match by sorted franchise pair + sorted assets.
    if (post.transactionSubType === 'TRADE' && post.tradeSignature) {
      const before = feed.posts.length;
      feed.posts = feed.posts.filter(p => {
        if (p.transactionSubType !== TRADE_PENDING_SUB_TYPE) return true;
        return p.tradeSignature !== post.tradeSignature;
      });
      const removed = before - feed.posts.length;
      if (removed > 0) {
        console.log(`  [dedup] Removed ${removed} pending-trade rumor post(s) superseded by completed TRADE`);
      }
    }

    // Generate AI commentary for breaking-tier posts
    if (post.tier === 'breaking') {
      await generateBreakingCommentary(post, txn);
    }

    newPosts.push(post);
    console.log(`  [${post.tier}] ${post.headline}`);
  }

  // Prepend new posts (newest first) and update watermark
  feed.posts = [...newPosts.reverse(), ...feed.posts];
  feed.lastScanTimestamp = now.toISOString();
  feed.lastProcessedMflTimestamp = Math.max(
    ...newTxns.map(t => parseInt(t.timestamp))
  ).toString();

  await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
  console.log(`  Wrote ${newPosts.length} new posts. Feed total: ${feed.posts.length}`);
  return newPosts.length;
}

// ── Schefter Rumor Mill: Trade-Pending Posts (Phase 1) ──
// When a trade enters pending commish approval, post a breaking-news rumor
// to the feed + GroupMe. Doubles as a nag reminder for the commish.
// Gated by SCHEFTER_RUMOR_MILL_ENABLED. Bypasses rumor-mill rate limits.
// Watermark: feed.pendingTradeWatermark = [offerId, ...] of already-posted trades.

const TRADE_PENDING_SUB_TYPE = 'trade_pending_rumor';

/** Pick the best short-ish team display name from the league config entry */
function pickTeamDisplayName(team) {
  if (!team) return null;
  return team.nameShort || team.nameMedium || team.name || null;
}

/** Load teams WITH short names for rumor posts (the default loadTeams drops those) */
async function loadTeamsWithShortNames(configPath) {
  try {
    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const teams = raw.teams ?? [];
    const map = new Map();
    for (const t of teams) {
      map.set(t.franchiseId, {
        name: t.name,
        nameMedium: t.nameMedium,
        nameShort: t.nameShort,
        abbrev: t.abbrev,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Fetch trades pending commish approval. Requires MFL_USER_ID env (commish cookie)
 * because FRANCHISE_ID=0000 is commissioner-scoped.
 *
 * NOTE: This is the ONE non-contract write context that uses the commish cookie
 * for a READ — justified because only the commish can see the "pending approval"
 * queue for the whole league. For all other user-specific write endpoints, use
 * the owner's cookie via getAuthUser() per repo auth rules.
 */
async function fetchPendingCommishTrades(leagueId, year) {
  const mflCookie = process.env.MFL_USER_ID;
  if (!mflCookie) {
    console.log('  [rumor-mill] MFL_USER_ID not set — cannot fetch pending commish trades');
    return { trades: null, error: 'MFL_USER_ID env missing' };
  }
  const url = `https://${MFL_HOST}/${year}/export?TYPE=pendingTrades&L=${leagueId}&FRANCHISE_ID=0000&JSON=1`;
  try {
    const res = await fetch(url, {
      headers: {
        Cookie: `MFL_USER_ID=${mflCookie}`,
        'User-Agent': 'schefter-scan/1.0',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { trades: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    if (text.trim().startsWith('<')) return { trades: null, error: 'Got HTML — auth likely failed' };
    let data;
    try { data = JSON.parse(text); } catch { return { trades: null, error: 'Invalid JSON' }; }
    if (data?.error) return { trades: null, error: `MFL error: ${JSON.stringify(data.error)}` };
    const pending = data?.pendingTrades;
    if (!pending || pending === '') return { trades: [] };
    const raw = pending?.pendingTrade ?? pending?.trade;
    if (!raw) return { trades: [] };
    return { trades: Array.isArray(raw) ? raw : [raw] };
  } catch (err) {
    return { trades: null, error: err.message };
  }
}

/** Build the natural-language asset phrase for a side of the trade */
function describeSide(assetStr, players, teams) {
  const { playerNames, pickNames } = parseTradeAssets(assetStr, players, teams);
  const all = [...playerNames, ...pickNames];
  if (all.length === 0) return 'assets';
  if (all.length === 1) return all[0];
  if (all.length === 2) return `${all[0]} and ${all[1]}`;
  return `${all.slice(0, 2).join(', ')} and ${all.length - 2} more`;
}

/** Schefter-voiced template fallback when Claude rewrite is unavailable */
function generatePendingTradeTemplate(trade, players, teams) {
  const t1 = teams.get(trade.franchise);
  const t2 = teams.get(trade.franchise2);
  const team1 = pickTeamDisplayName(t1) ?? `Team ${trade.franchise}`;
  const team2 = pickTeamDisplayName(t2) ?? `Team ${trade.franchise2}`;
  const side1 = describeSide(trade.franchise1_gave_up, players, teams);
  const side2 = describeSide(trade.franchise2_gave_up, players, teams);

  return `Hearing a deal is on the commish's desk between the ${team1} and the ${team2} — ${side1} going one way, ${side2} coming back. The league awaits. Developing.`;
}

/**
 * Call Claude (if key present) to tighten the rumor into Schefter voice.
 * Mirrors generateBreakingCommentary() pattern but with rumor-mill directives.
 */
async function generatePendingTradeAiBody(templateBody, trade, players, teams, { lore, recentPostsBlock } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const t1 = teams.get(trade.franchise);
  const t2 = teams.get(trade.franchise2);
  const team1 = pickTeamDisplayName(t1) ?? `Team ${trade.franchise}`;
  const team2 = pickTeamDisplayName(t2) ?? `Team ${trade.franchise2}`;
  const { playerNames: gave1Players, pickNames: gave1Picks } = parseTradeAssets(trade.franchise1_gave_up, players, teams);
  const { playerNames: gave2Players, pickNames: gave2Picks } = parseTradeAssets(trade.franchise2_gave_up, players, teams);

  let system = `You are Claude Schefter — a dynasty fantasy football beat reporter channeling Adam Schefter's rumor-mill energy. You've just heard a trade has landed on the commissioner's desk awaiting approval. Voice: breaking-news tease, "I'm told...", "League sources tell me...", "hearing...". 2-3 sentences. End with "Developing." or a similar tease. Reference both franchises by name and loosely name the key assets. Do NOT include a @Brandon tag — that will be appended separately. Never break character.`;

  // Append personality + lore + bits when available. Falls back silently.
  if (lore && lore.ok && lore.assembledSuffix) {
    system += lore.assembledSuffix;
  }

  const recentBlock = recentPostsBlock ? `\n\n${recentPostsBlock}` : '';
  const userContent =
    `Trade pending commish approval:\n\n` +
    `${team1} sends: ${[...gave1Players, ...gave1Picks].join(', ') || 'assets'}\n` +
    `${team2} sends: ${[...gave2Players, ...gave2Picks].join(', ') || 'assets'}${recentBlock}\n\n` +
    `Write a 2-3 sentence Schefter-voiced rumor-mill post teasing this pending deal. Plain text only, no JSON, no formatting.`;

  if (DRY_RUN) {
    console.log('  [dry-run] Would call LLM with pending-trade prompt:');
    console.log('  ─── SYSTEM (first 400 chars) ───');
    console.log('  ' + system.slice(0, 400).replace(/\n/g, '\n  '));
    console.log(`  … (${system.length} chars total)`);
    console.log('  ─── USER ───');
    console.log(userContent.split('\n').map((l) => '  ' + l).join('\n'));
    return null;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) {
      console.log(`  [rumor-mill AI] ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    return text || null;
  } catch (err) {
    console.log(`  [rumor-mill AI] error: ${err.message} — using template`);
    return null;
  }
}

async function scanPendingTrades(league) {
  if (!process.env.SCHEFTER_RUMOR_MILL_ENABLED ||
      process.env.SCHEFTER_RUMOR_MILL_ENABLED === '0' ||
      process.env.SCHEFTER_RUMOR_MILL_ENABLED.toLowerCase() === 'false') {
    return 0;
  }

  // Phase 1 is theleague-only (AFL has its own commish and cadence)
  if (league.slug !== 'theleague') return 0;

  console.log(`\n=== Scanning Pending Trades (Rumor Mill) for ${league.slug} ===`);

  const feed = await loadFeed(league.feedPath);
  const prevWatermark = Array.isArray(feed.pendingTradeWatermark) ? feed.pendingTradeWatermark : [];

  const now = new Date();
  const year = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;

  const [result, players, teams] = await Promise.all([
    fetchPendingCommishTrades(league.leagueId, year),
    loadPlayers(league.playersPath(year)),
    loadTeamsWithShortNames(league.configPath),
  ]);

  if (result.error) {
    console.log(`  [rumor-mill] Could not fetch pending trades: ${result.error}`);
    // Still write watermark cleanup below — but we only know what's currently pending if the call succeeded
    return 0;
  }

  const pending = result.trades ?? [];
  const currentOfferIds = pending
    .map(t => String(t.id || t.trade_id || ''))
    .filter(Boolean);
  console.log(`  Pending commish-review trades: ${pending.length}`);

  // New trades = currently pending but not yet posted about
  const newPending = pending.filter(t => {
    const id = String(t.id || t.trade_id || '');
    return id && !prevWatermark.includes(id);
  });

  console.log(`  Already posted: ${prevWatermark.length}, new: ${newPending.length}`);

  const newPosts = [];
  const leagueSlug = 'theleague';

  // Load personality + lore + bits + rolling post-memory ONCE per scan cycle.
  // If anything is missing the lore loader falls back and logs a warning;
  // recentPostsBlock is an empty string when history is empty.
  const lore = await loadLore({ log: console.log, warn: console.warn });
  const history = await loadPostHistory({ log: console.log, warn: console.warn });
  const recentPostsBlock = buildRecentPostsPromptBlock(history.posts);
  console.log(`  [memory] last ${Math.min(history.posts.length, 5)} posts passed to LLM`);

  for (const trade of newPending) {
    const offerId = String(trade.id || trade.trade_id || '');
    if (!offerId) continue;

    const templateBody = generatePendingTradeTemplate(trade, players, teams);
    const aiBody = await generatePendingTradeAiBody(templateBody, trade, players, teams, {
      lore,
      recentPostsBlock,
    });
    const body = aiBody || templateBody;

    const t1 = teams.get(trade.franchise);
    const t2 = teams.get(trade.franchise2);
    const team1 = pickTeamDisplayName(t1) ?? `Team ${trade.franchise}`;
    const team2 = pickTeamDisplayName(t2) ?? `Team ${trade.franchise2}`;

    const tradeTs = parseInt(trade.timestamp || `${Math.floor(Date.now() / 1000)}`, 10);
    const post = {
      id: `sf_pending_${offerId}`,
      timestamp: new Date().toISOString(),
      type: 'transaction',
      transactionSubType: TRADE_PENDING_SUB_TYPE,
      tier: 'breaking',
      headline: `Trade on the commish's desk: ${team1} and ${team2}`,
      body,
      authorId: 'claude',
      franchiseIds: [trade.franchise, trade.franchise2].filter(Boolean),
      sourceTimestamp: String(tradeTs),
      offerId,
      tradeSignature: buildTradeSignature(trade.franchise, trade.franchise2, trade.franchise1_gave_up, trade.franchise2_gave_up),
      league: leagueSlug,
    };

    // Dedup guard in case watermark got out of sync with feed
    if (feed.posts.some(p => p.id === post.id)) {
      console.log(`  [rumor-mill] Skip ${offerId} — already in feed`);
      continue;
    }

    // One post per topic: don't post a pending rumor if the completed TRADE
    // already landed on the feed (e.g., approved between scan cycles).
    if (post.tradeSignature && feed.posts.some(p =>
      p.transactionSubType === 'TRADE' && p.tradeSignature === post.tradeSignature
    )) {
      console.log(`  [rumor-mill] Skip ${offerId} — completed TRADE already in feed`);
      continue;
    }

    newPosts.push(post);
    console.log(`  [breaking] ${post.headline}`);

    // GroupMe: Schefter is the voice of the league — require his bot, never fall back to Roger
    const schefterBotId = process.env.GROUPME_SCHEFTER_BOT_ID;
    if (!schefterBotId) {
      console.warn('  [GroupMe] GROUPME_SCHEFTER_BOT_ID not set — skipping GroupMe post (Roger bot is reserved for deadlines)');
    } else if (DRY_RUN) {
      console.log(`  [dry-run] Would post to GroupMe:\n${post.headline}\n\n${post.body}\n\n@Brandon the league awaits.`);
    } else {
      const groupMeText = `${post.headline}\n\n${post.body}\n\n@Brandon the league awaits.`;
      await postToGroupMe(groupMeText, { botIdOverride: schefterBotId });
    }

    // Append to rolling post history (skipped in dry-run). Best-effort.
    if (!DRY_RUN) {
      await appendPostHistory(
        buildHistoryEntry({
          id: post.id,
          timestamp: post.timestamp,
          body: post.body,
          subject: `trade-pending (${team1} ↔ ${team2})`,
          tipSources: ['trade_pending'],
        }),
        { log: console.log, warn: console.warn },
      );
    }
  }

  // Rebuild watermark: only keep offerIds still pending. Add any new ones we posted.
  const newWatermarkSet = new Set(currentOfferIds);
  // (Trades that disappeared from pending drop off automatically.)
  feed.pendingTradeWatermark = Array.from(newWatermarkSet);

  if (newPosts.length > 0) {
    feed.posts = [...newPosts.reverse(), ...feed.posts];
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] Would write ${newPosts.length} pending-trade post(s) to feed`);
  } else {
    await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
  }

  const dropped = prevWatermark.filter(id => !newWatermarkSet.has(id));
  if (dropped.length) console.log(`  [rumor-mill] Dropped ${dropped.length} resolved trade(s) from watermark`);
  console.log(`  Wrote ${newPosts.length} pending-trade rumor post(s). Watermark size: ${feed.pendingTradeWatermark.length}`);
  return newPosts.length;
}

// ── ESPN Integration ──
// NOTE: Parsing logic mirrors src/utils/espn-feed.ts but duplicated here because
// this .mjs script runs directly via Node without a TypeScript build step.
// If the ESPN API structure changes, update BOTH files.

// All ESPN contributors to poll
const ESPN_CONTRIBUTORS = [
  { slug: 'adam-schefter', authorId: 'adam-schefter' },
  { slug: 'mel-kiper-jr', authorId: 'mel-kiper' },
  { slug: 'field-yates', authorId: 'field-yates' },
  { slug: 'jeremy-fowler', authorId: 'jeremy-fowler' },
  { slug: 'dan-graziano', authorId: 'dan-graziano' },
  { slug: 'ben-solak', authorId: 'ben-solak' },
  { slug: 'matt-miller', authorId: 'matt-miller' },
  { slug: 'jordan-reid', authorId: 'jordan-reid' },
  { slug: 'kalyn-kahler', authorId: 'kalyn-kahler' },
  { slug: 'lindsey-thiry', authorId: 'lindsey-thiry' },
];

async function fetchEspnPosts(contributorSlug = 'adam-schefter') {
  const url = `https://site.web.api.espn.com/apis/v2/flex?contributor=${contributorSlug}&limit=10&pubkey=contributor-page`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  ESPN API returned ${res.status} — skipping`);
      return [];
    }
    const data = await res.json();
    const articles = [];

    // Navigate: columns[middlecolumn].items[contributor-page].feed.{0,1,2,...}
    const middle = (data.columns || []).find(c => c.name === 'middlecolumn');
    const contribItem = (middle?.items || []).find(i => i.type === 'contributor-page');
    const feed = contribItem?.feed || {};

    for (const key of Object.keys(feed)) {
      if (!/^\d+$/.test(key)) continue;
      const item = feed[key];
      const id = item.id;
      const headline = item.descriptions?.headline || item.descriptions?.title;
      const body = item.payload || headline || '';
      const published = item.dates?.created;
      const webLink = (item.links || []).find(l => l.rels?.includes('web'));

      if (id && headline && published) {
        articles.push({
          id,
          headline,
          body,
          published,
          link: webLink?.href || `https://www.espn.com/contributor/${contributorSlug}/${id}`,
        });
      }
    }

    return articles;
  } catch (err) {
    console.log(`  ESPN fetch error: ${err.message}`);
    return [];
  }
}

function truncateAtSentence(text, maxLen) {
  if (text.length <= maxLen) return text;
  const chunk = text.slice(0, maxLen);
  const lastPeriod = Math.max(chunk.lastIndexOf('. '), chunk.lastIndexOf('! '), chunk.lastIndexOf('? '));
  if (lastPeriod > maxLen * 0.4) return chunk.slice(0, lastPeriod + 1);
  const lastSpace = chunk.lastIndexOf(' ');
  return chunk.slice(0, lastSpace > 0 ? lastSpace : maxLen) + '...';
}

function espnToPost(article, leagueSlug, authorId = 'adam-schefter') {
  return {
    id: `espn_${article.id}`,
    timestamp: article.published,
    type: 'external',
    tier: 'standard',
    headline: article.headline,
    body: truncateAtSentence(article.body, 200),
    link: article.link,
    linkLabel: 'Read on ESPN →',
    authorId,
    franchiseIds: [],
    league: leagueSlug,
  };
}

async function scanEspn(league) {
  console.log(`\n=== Scanning ESPN for ${league.slug} ===`);

  const feed = await loadFeed(league.feedPath);
  const watermark = feed.lastEspnTimestamp || '1970-01-01T00:00:00Z';
  console.log(`  ESPN watermark: ${watermark}`);

  const watermarkDate = new Date(watermark);
  const leagueSlug = league.slug === 'afl' ? 'afl' : 'theleague';
  let allNewArticles = [];

  // Poll all ESPN contributors
  for (const contributor of ESPN_CONTRIBUTORS) {
    const articles = await fetchEspnPosts(contributor.slug);
    const newOnes = articles.filter(a => {
      const pubDate = new Date(a.published);
      return pubDate > watermarkDate && !feed.posts.some(p => p.id === `espn_${a.id}`);
    });
    if (newOnes.length > 0) {
      console.log(`  ${contributor.slug}: ${newOnes.length} new`);
      allNewArticles.push(...newOnes.map(a => ({ ...a, authorId: contributor.authorId })));
    }
  }

  console.log(`  Total new ESPN articles: ${allNewArticles.length}`);
  if (allNewArticles.length === 0) return 0;

  // Sort oldest first
  allNewArticles.sort((a, b) => new Date(a.published).getTime() - new Date(b.published).getTime());

  const newPosts = allNewArticles.map(a => espnToPost(a, leagueSlug, a.authorId));

  // Prepend new posts (newest first) and update watermark
  feed.posts = [...newPosts.reverse(), ...feed.posts];
  feed.lastEspnTimestamp = new Date(
    Math.max(...allNewArticles.map(a => new Date(a.published).getTime()))
  ).toISOString();

  await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
  console.log(`  Wrote ${newPosts.length} ESPN posts. Feed total: ${feed.posts.length}`);
  return newPosts.length;
}

// ── Ask Roger: Event Reminders ──
// Ask Roger posts reminders at: 14 days, 7 days, 2 days, day-of.
// Event tiers determine which touches fire: major=all 4, standard=7d+dayof, minor=dayof only.

const REMINDER_TOUCHES = [
  { id: '14d', daysOut: 14, minTier: 'major', postTier: 'standard' },
  { id: '7d', daysOut: 7, minTier: 'standard', postTier: 'standard' },
  { id: '2d', daysOut: 2, minTier: 'major', postTier: 'breaking' },
  { id: 'dayof', daysOut: 0, minTier: 'minor', postTier: 'breaking' },
];

const TIER_RANK = { major: 3, standard: 2, minor: 1 };

// ── Roger Template Pools ──

const ROGER_14D = [
  { h: '{event} — {days} days out', b: 'Mark your calendars. {name} is {days} days away. I shouldn\'t have to tell you this, but here we are.' },
  { h: '{event} in {days} days', b: 'This is your {days}-day heads up for {name}. Start planning now or don\'t — I\'ll remind you again either way.' },
  { h: '{days} days until {event}', b: 'Just a friendly reminder that {name} is coming up. "Friendly" is doing a lot of heavy lifting in that sentence.' },
  { h: '{event} is {days} days away', b: 'Consider this your save-the-date for {name}. I know half of you won\'t read this until the day before.' },
  { h: 'Heads up: {event} approaching', b: '{name} hits in {days} days. You\'ve been warned. No extensions, no exceptions, no excuses.' },
  { h: 'The {event} countdown begins', b: 'We\'re officially {days} days from {name}. If you\'re not thinking about this yet, you\'re already behind.' },
];

const ROGER_7D = [
  { h: 'One week until {event}', b: 'This is your one-week warning for {name}. If you haven\'t started preparing, I admire your confidence.' },
  { h: '{event} — {days} days', b: '{name} is next week. Get your house in order. I will not be fielding "I didn\'t know" messages after the fact.' },
  { h: '{event} is one week away', b: '{days} days until {name}. This is the part where smart owners make their moves and everyone else panics later.' },
  { h: 'Week out: {event}', b: 'We\'re a week from {name}. I\'ve done my part. The rest is on you. Literally.' },
  { h: '{event} next week', b: '{name} lands next week. Some of you are prepared. The rest of you know who you are.' },
  { h: 'T-minus {days} days: {event}', b: 'One week to {name}. I\'ll send one more reminder. After that, you\'re on your own.' },
];

const ROGER_2D = [
  { h: '{event} — 2 days away', b: 'This is your second-to-last reminder about {name}. There will be exactly one more, and then I wash my hands of it.' },
  { h: '{event} is in 48 hours', b: '{name} hits in two days. Whatever you need to do, do it now. Not tomorrow. Now.' },
  { h: 'Final countdown: {event}', b: 'Two days until {name}. If you miss this, that\'s between you and your roster.' },
  { h: '{event} — almost here', b: '{name} is practically knocking on the door. Last chance to get ready before it walks in uninvited.' },
  { h: 'Two days: {event}', b: 'I\'m telling you now so you can\'t tell me later that nobody told you. {name}. Two days.' },
  { h: '{event}: crunch time', b: '48 hours until {name}. Some of you will be ready. The rest will be in my DMs asking for an extension. The answer is no.' },
];

const ROGER_DAYOF = [
  { h: 'TODAY: {event}', b: 'It\'s here. {name} is today. No more reminders. No more warnings. Handle your business.' },
  { h: '{event} — it\'s go time', b: '{name} is happening right now. If you\'re reading this and haven\'t acted yet, close this and go.' },
  { h: '{event} is LIVE', b: '{name} kicks off today. You\'ve had weeks of notice. Make it count.' },
  { h: 'Game day: {event}', b: '{name} is officially underway. Good luck to those who prepared. Thoughts and prayers to those who didn\'t.' },
  { h: '{event} has arrived', b: 'The day is here. {name}. Everything you\'ve been putting off? That bill comes due today.' },
  { h: 'Right now: {event}', b: '{name} is live. I\'ve reminded you four times. My conscience is clear.' },
];

const ROGER_TEMPLATES = {
  '14d': ROGER_14D,
  '7d': ROGER_7D,
  '2d': ROGER_2D,
  'dayof': ROGER_DAYOF,
};

function pickRogerTemplate(touchId, eventId) {
  const pool = ROGER_TEMPLATES[touchId];
  // Deterministic selection based on event ID hash
  const hash = eventId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return pool[hash % pool.length];
}

async function scanEventReminders(league) {
  console.log(`\n=== Scanning event reminders for ${league.slug} ===`);

  // Only TheLeague gets Ask Roger posts (AFL has different calendar)
  if (league.slug !== 'theleague') {
    console.log('  Skipping — Ask Roger is TheLeague only');
    return 0;
  }

  // Read resolved events
  const eventsPath = path.join(projectRoot, 'src', 'data', 'theleague', 'resolved-events.json');
  let eventsData;
  try {
    eventsData = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  } catch {
    console.log('  No resolved-events.json found. Run: node scripts/compute-league-events.mjs');
    return 0;
  }

  const feed = await loadFeed(league.feedPath);
  const now = new Date();
  const newPosts = [];

  for (const event of eventsData.events) {
    if (event.isPast) continue;

    for (const touch of REMINDER_TOUCHES) {
      // Check if this event tier qualifies for this touch
      if ((TIER_RANK[event.tier] || 0) < (TIER_RANK[touch.minTier] || 0)) continue;

      // Check if we're in the right window (within 1 day of the target)
      const targetDays = touch.daysOut;
      if (event.daysUntil > targetDays + 1 || event.daysUntil < targetDays - 1) continue;

      // Day-of: only fire when daysUntil is 0 or -1 (still same day)
      if (touch.id === 'dayof' && event.daysUntil > 1) continue;

      const postId = `roger_${event.id}_${touch.id}`;

      // Dedup: skip if already posted
      if (feed.posts.some(p => p.id === postId)) continue;

      const template = pickRogerTemplate(touch.id, event.id);
      const days = String(event.daysUntil);
      const headline = template.h.replace(/\{event\}/g, event.name).replace(/\{name\}/g, event.name).replace(/\{days\}/g, days);
      const body = template.b.replace(/\{event\}/g, event.name).replace(/\{name\}/g, event.name).replace(/\{days\}/g, days);

      newPosts.push({
        id: postId,
        timestamp: now.toISOString(),
        type: 'ask-roger',
        tier: touch.postTier,
        headline,
        body,
        link: '/theleague/calendar',
        linkLabel: 'View calendar',
        authorId: 'roger',
        franchiseIds: [],
        league: 'theleague',
      });

      console.log(`  [${touch.id}] ${headline}`);
    }
  }

  if (newPosts.length === 0) {
    console.log('  No reminders due');
    return 0;
  }

  feed.posts = [...newPosts.reverse(), ...feed.posts];
  await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
  console.log(`  Wrote ${newPosts.length} reminder posts. Feed total: ${feed.posts.length}`);

  // Send Ask Roger reminders to GroupMe
  for (const post of newPosts) {
    const text = `${post.headline}\n\n${post.body}\n\nhttps://www.theleague.us/calendar`;
    await postToGroupMe(text);
  }
  return newPosts.length;
}

// ── NFL Wire: General NFL News ──
// Fetches from ESPN's public NFL news API. Produces content year-round
// (free agency, draft, OTAs, etc.). External posts link to ESPN.
// Uses relevance scoring to filter out low-value beat writer articles.

// Route articles to existing ESPN author personas when byline matches
const BYLINE_TO_AUTHOR = {
  'Mel Kiper Jr.': 'mel-kiper',
  'Jordan Reid': 'jordan-reid',
  'Matt Miller': 'matt-miller',
  'Kalyn Kahler': 'kalyn-kahler',
  'Field Yates': 'field-yates',
  'Dan Graziano': 'dan-graziano',
  'Ben Solak': 'ben-solak',
  'Lindsey Thiry': 'lindsey-thiry',
  'Adam Schefter': 'adam-schefter',
  'Jeremy Fowler': 'jeremy-fowler',
};

// High-value ESPN category topics (always include)
const HIGH_VALUE_CATEGORIES = new Set([
  'NFL Draft', 'NFL draft', 'NFL Free Agency', 'NFL free agency',
  'NFL Trades', 'NFL trades', 'NFL Combine', 'NFL combine',
]);

// Tier A: Completed actions — worth +2, pass threshold alone
const KEYWORDS_HIGH = [
  /\btraded\b/i,                              // completed trade
  /\breleased?\b/i, /\bcuts?\b/i,             // roster moves
  /\bsuspend(?:s|ed)\b/i,                     // discipline
  /\brule change/i, /\bnew rule/i,            // league policy
  /\barrested?\b/i, /\bcharged?\b/i,          // legal
  /\bfined?\b/i, /\bbanned?\b/i,              // discipline
];

// Tier B: Process/discussion words — worth +1, need a second signal to pass
const KEYWORDS_LOW = [
  /\btrade\b/i, /\btrading\b/i,               // discussions/rumors, not completed
  /\binjur(?:y|ed|ies)\b/i, /\btorn\b/i,      // injury news
  /\bACL\b/, /\bPUP\b/,
  /\bfree agent/i,
  /\bexercis(?:e[ds]?|ing) .{0,20}option/i,
  /\bretir(?:e[ds]?|ement)\b/i,               // retirement — needs second signal (rostered name) to pass
];

// Hard-block: off-field celebrity/charity content — irrelevant regardless of player name matches
const NOISE_PATTERNS = [
  /\bawareness day\b/i,   // charity/awareness TV segments
  /\bswag bag\b/i,        // celebrity gifting
];

/** Build a set of player names from rosters for headline matching */
async function loadRosteredPlayerNames(league) {
  try {
    const now = new Date();
    const year = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
    const players = await loadPlayers(league.playersPath(year));

    const rostersPath = league.slug === 'afl'
      ? path.join(projectRoot, 'data', 'afl-fantasy', 'mfl-feeds', String(year), 'rosters.json')
      : path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'rosters.json');
    const rostersRaw = JSON.parse(await fs.readFile(rostersPath, 'utf8'));
    const franchises = rostersRaw?.rosters?.franchise ?? [];
    const rosteredIds = new Set();
    for (const f of franchises) {
      const pList = f.player ?? [];
      const arr = Array.isArray(pList) ? pList : [pList];
      for (const p of arr) rosteredIds.add(p.id);
    }
    // Common last names and words that cause false positives in headlines
    const LAST_NAME_BLOCKLIST = new Set([
      'Brown', 'Moore', 'Smith', 'Allen', 'Wilson', 'Adams', 'Johnson', 'Davis',
      'Jones', 'Thomas', 'White', 'Harris', 'Martin', 'Lewis', 'Young', 'Walker',
      'Hall', 'King', 'Green', 'Baker', 'Carter', 'Evans', 'Turner', 'Parker',
      'Collins', 'Edwards', 'Howard', 'Cooper', 'Reed', 'Bailey', 'Ward', 'Gray',
      'Hunter', 'Henry', 'Ross', 'Graham', 'Long', 'Price', 'Gordon',
      // 5-char common names
      'Grant', 'Scott', 'Bruce', 'Craig', 'Cross', 'Floyd', 'Lloyd', 'Perry',
      'Dixon', 'Burke', 'Stone', 'Chase', 'Brady', 'Woods', 'Mills', 'Byrd',
    ]);

    // Build name set: full names + distinctive last names for matching
    const names = { full: new Set(), last: new Set() };
    for (const id of rosteredIds) {
      const p = players.get(id);
      if (!p?.name) continue;
      // Skip DEF positions — their "names" are team names (Browns, 49ers, etc.)
      if (p.position === 'Def' || p.position === 'DEF') continue;
      // MFL names are "Last, First" format
      const commaIdx = p.name.indexOf(',');
      const fullName = commaIdx > 0
        ? `${p.name.slice(commaIdx + 1).trim()} ${p.name.slice(0, commaIdx).trim()}`
        : p.name;
      const lastName = commaIdx > 0 ? p.name.slice(0, commaIdx).trim() : p.name.split(' ').pop();
      names.full.add(fullName);
      // Only use last name if 5+ chars and not a common name that causes false positives
      if (lastName.length >= 5 && !LAST_NAME_BLOCKLIST.has(lastName)) {
        names.last.add(lastName);
      }
    }
    return names;
  } catch (err) {
    console.log(`  Could not load rostered names: ${err.message}`);
    return { full: new Set(), last: new Set() };
  }
}

/** Score an article for relevance. Higher = more relevant. Threshold: 2+ to publish. */
function scoreArticle(article, rosteredNames) {
  let score = 0;
  const reasons = [];
  const headline = article.headline ?? article.title ?? '';

  // Hard-block noise regardless of player name matches
  if (NOISE_PATTERNS.some(re => re.test(headline))) {
    return { score: 0, reasons: ['noise-blocked'] };
  }
  const desc = article.description ?? '';
  const text = `${headline} ${desc}`;
  const categories = (article.categories ?? []).map(c => c.description);

  // +3: Draft content (always valuable)
  if (categories.some(c => c === 'NFL Draft' || c === 'NFL draft') ||
      /\bdraft\b/i.test(headline)) {
    score += 3;
    reasons.push('draft');
  }

  // +3: Rostered player full name in headline
  for (const name of rosteredNames.full) {
    if (headline.includes(name)) {
      score += 3;
      reasons.push(`rostered:${name}`);
      break;
    }
  }

  // Last-name matching intentionally removed — too many collisions between
  // rostered players and coaches/executives with the same last name.

  // +2: High-value ESPN category
  if (categories.some(c => HIGH_VALUE_CATEGORIES.has(c))) {
    score += 2;
    reasons.push('category');
  }

  // +2: Tier A keyword — completed transaction/event (passes alone)
  if (KEYWORDS_HIGH.some(re => re.test(headline))) {
    score += 2;
    reasons.push('keyword-high');
  }
  // +1: Tier B keyword — discussion/process word (needs another signal)
  else if (KEYWORDS_LOW.some(re => re.test(headline))) {
    score += 1;
    reasons.push('keyword-low');
  }

  // +2: Known reporter byline — always meets threshold on its own
  if (BYLINE_TO_AUTHOR[article.byline]) {
    score += 2;
    reasons.push(`reporter:${article.byline}`);
  }

  return { score, reasons };
}

async function scanNflWire(league) {
  console.log(`\n=== Scanning NFL Wire for ${league.slug} ===`);

  const feed = await loadFeed(league.feedPath);
  const watermark = feed.lastNflWireTimestamp || '1970-01-01T00:00:00Z';
  console.log(`  NFL Wire watermark: ${watermark}`);

  const watermarkDate = new Date(watermark);
  const leagueSlug = league.slug === 'afl' ? 'afl' : 'theleague';

  try {
    // Load rostered player names for relevance scoring
    const rosteredNames = await loadRosteredPlayerNames(league);
    console.log(`  Rostered player names loaded: ${rosteredNames.full.size} full, ${rosteredNames.last.size} last`);

    const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=25';
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  NFL Wire API returned ${res.status} — skipping`);
      return 0;
    }

    const data = await res.json();
    const articles = data.articles ?? [];
    console.log(`  ESPN returned ${articles.length} articles`);

    const newArticles = articles.filter(a => {
      const pubDate = new Date(a.published);
      const articleId = `wire_${a.id ?? ''}`;
      return pubDate > watermarkDate && !feed.posts.some(p => p.id === articleId);
    });

    console.log(`  New articles: ${newArticles.length}`);
    if (newArticles.length === 0) return 0;

    // Score and filter articles — threshold of 2+ to publish
    const RELEVANCE_THRESHOLD = 2;
    const scored = newArticles.map(a => ({
      article: a,
      ...scoreArticle(a, rosteredNames),
    }));

    const relevant = scored.filter(s => s.score >= RELEVANCE_THRESHOLD);
    const skipped = scored.filter(s => s.score < RELEVANCE_THRESHOLD);

    console.log(`  Relevance scoring: ${relevant.length} pass (≥${RELEVANCE_THRESHOLD}), ${skipped.length} filtered out`);
    for (const s of scored) {
      const mark = s.score >= RELEVANCE_THRESHOLD ? '✓' : '✗';
      console.log(`    ${mark} [${s.score}] ${s.reasons.join(', ') || 'no signals'} — ${(s.article.headline ?? '').substring(0, 60)}`);
    }

    if (relevant.length === 0) {
      // Still advance watermark so we don't re-evaluate these articles
      feed.lastNflWireTimestamp = new Date(
        Math.max(...newArticles.map(a => new Date(a.published).getTime()))
      ).toISOString();
      await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
      console.log(`  No relevant articles — watermark advanced.`);
      return 0;
    }

    // Sort oldest first so newest end up at top after prepend
    relevant.sort((a, b) => new Date(a.article.published).getTime() - new Date(b.article.published).getTime());

    const newPosts = relevant.map(({ article: a }) => {
      const headline = a.headline ?? a.title ?? 'NFL News';
      const body = truncateAtSentence(a.description ?? headline, 200);
      const link = a.links?.web?.href ?? a.links?.api?.news?.href ?? '';

      const isDraft = (a.categories ?? []).some(
        c => c.description === 'NFL Draft' || c.description === 'NFL draft'
      ) || /\bdraft\b/i.test(a.headline ?? '');

      // Draft content → nfl-draft persona; known byline → their persona; else nfl-wire
      const authorId = isDraft
        ? (BYLINE_TO_AUTHOR[a.byline] ?? 'nfl-draft')
        : (BYLINE_TO_AUTHOR[a.byline] ?? 'nfl-wire');

      return {
        id: `wire_${a.id}`,
        timestamp: a.published,
        type: 'external',
        tier: 'standard',
        headline,
        body,
        link,
        linkLabel: isDraft ? 'Read draft analysis →' : 'Read on ESPN →',
        authorId,
        franchiseIds: [],
        league: leagueSlug,
      };
    });

    feed.posts = [...newPosts.reverse(), ...feed.posts];
    feed.lastNflWireTimestamp = new Date(
      Math.max(...newArticles.map(a => new Date(a.published).getTime()))
    ).toISOString();

    await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
    console.log(`  Wrote ${newPosts.length} NFL Wire posts. Feed total: ${feed.posts.length}`);
    return newPosts.length;
  } catch (err) {
    console.log(`  NFL Wire fetch error: ${err.message}`);
    return 0;
  }
}

// ── Doc Rivers: Injury Reporter ──
// Fetches injury data from ESPN's per-team injuries API.
// Only generates posts when a player's status CHANGES (snapshot diffing).
// Rostered fantasy players get higher tiers.

// ESPN team IDs for all 32 NFL teams
const ESPN_TEAM_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34,
];

// Doc Rivers template pools — direct, no-nonsense medical correspondent
const INJURY_TEMPLATES_BREAKING = [
  (p) => `Major update: ${p.name} (${p.nflTeam}) is now listed as ${p.status}. ${p.detail ? `Dealing with ${p.detail.toLowerCase()}.` : ''} If he's on your roster, it's time for Plan B.`,
  (p) => `This is a big one. ${p.name} has been moved to ${p.status}${p.detail ? ` with ${p.detail.toLowerCase()}` : ''}. Fantasy managers, adjust accordingly.`,
  (p) => `Confirmed: ${p.name} (${p.position}, ${p.nflTeam}) → ${p.status}.${p.detail ? ` ${p.detail}.` : ''} This changes lineup calculations across the league.`,
  (p) => `${p.name} officially ${p.status}.${p.detail ? ` ${p.detail}.` : ''} If you were counting on him this week, you need a new plan. Now.`,
  (p) => `Breaking from the medical tent: ${p.name} (${p.nflTeam}) is ${p.status}.${p.detail ? ` Diagnosis: ${p.detail.toLowerCase()}.` : ''} Fantasy impact is significant.`,
];

const INJURY_TEMPLATES_STANDARD = [
  (p) => `${p.name} (${p.position}, ${p.nflTeam}) now listed as ${p.status}.${p.detail ? ` ${p.detail}.` : ''} Monitor through the week.`,
  (p) => `Injury update: ${p.name} (${p.nflTeam}) — ${p.status}.${p.detail ? ` Dealing with ${p.detail.toLowerCase()}.` : ''} Keep an eye on practice reports.`,
  (p) => `${p.name} has been moved to ${p.status}.${p.detail ? ` ${p.detail}.` : ''} Not ideal, but not panic time yet.`,
  (p) => `Status change for ${p.name} (${p.nflTeam}): now ${p.status}.${p.detail ? ` ${p.detail}.` : ''} Watch the injury report closely.`,
  (p) => `${p.name} (${p.position}, ${p.nflTeam}) → ${p.status}.${p.detail ? ` ${p.detail}.` : ''} Could go either way by game day.`,
];

const INJURY_TEMPLATES_MINOR = [
  (p) => `${p.name} (${p.nflTeam}) — ${p.status}${p.detail ? ` (${p.detail.toLowerCase()})` : ''}.`,
  (p) => `${p.name} listed as ${p.status}${p.detail ? ` with ${p.detail.toLowerCase()}` : ''}.`,
];

async function fetchEspnInjuries() {
  const allInjuries = new Map(); // espnId → { name, position, nflTeam, status, detail }

  // Fetch all 32 teams in parallel
  const results = await Promise.allSettled(
    ESPN_TEAM_IDS.map(async (teamId) => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?team=${teamId}`;
      const res = await fetch(url);
      if (!res.ok) return [];

      const data = await res.json();
      const teamData = data.team;
      const teamAbbrev = teamData?.abbreviation ?? '';
      const injuries = [];

      for (const group of (data.injuries ?? [])) {
        for (const entry of (group.entries ?? [])) {
          const athlete = entry.athlete;
          if (!athlete?.id) continue;
          injuries.push({
            espnId: String(athlete.id),
            name: athlete.displayName ?? athlete.fullName ?? 'Unknown',
            position: athlete.position?.abbreviation ?? '',
            nflTeam: teamAbbrev,
            status: entry.status ?? entry.type ?? 'Unknown',
            detail: entry.details?.detail ?? entry.details?.type ?? '',
          });
        }
      }
      return injuries;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const inj of result.value) {
        allInjuries.set(inj.espnId, inj);
      }
    }
  }

  return allInjuries;
}

/** Load all rostered player IDs for a league to determine fantasy relevance */
async function loadRosteredPlayerIds(league) {
  const year = new Date().getFullYear();
  const rostersPath = league.slug === 'afl'
    ? path.join(projectRoot, 'data', 'afl-fantasy', 'mfl-feeds', String(year), 'rosters.json')
    : path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'rosters.json');

  try {
    const raw = JSON.parse(await fs.readFile(rostersPath, 'utf8'));
    const franchises = raw?.rosters?.franchise ?? [];
    const playerToFranchise = new Map(); // playerId → franchiseId
    for (const f of (Array.isArray(franchises) ? franchises : [franchises])) {
      const players = f.player ?? [];
      for (const p of (Array.isArray(players) ? players : [players])) {
        if (p.id) playerToFranchise.set(p.id, f.id);
      }
    }
    return playerToFranchise;
  } catch {
    console.log('  Could not load rosters for injury cross-reference');
    return new Map();
  }
}

/** Load MFL players to map ESPN names → MFL player IDs */
async function loadPlayerNameIndex(league) {
  const year = new Date().getFullYear();
  const players = await loadPlayers(league.playersPath(year));
  const nameIndex = new Map();
  for (const [id, p] of players) {
    // MFL names are "LastName, FirstName" — normalize to "FirstName LastName"
    const parts = p.name.split(', ');
    const normalized = parts.length === 2 ? `${parts[1]} ${parts[0]}` : p.name;
    nameIndex.set(normalized.toLowerCase(), { id, ...p });
  }
  return nameIndex;
}

async function scanInjuries(league) {
  console.log(`\n=== Scanning Injuries (Doc Rivers) for ${league.slug} ===`);

  // Season guard: check if there are upcoming NFL games
  try {
    const sbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    if (sbRes.ok) {
      const sbData = await sbRes.json();
      if (!sbData.events || sbData.events.length === 0) {
        console.log('  No upcoming NFL games — skipping injury scan (offseason)');
        return 0;
      }
    }
  } catch {
    // If scoreboard check fails, proceed with scan anyway
  }

  const feed = await loadFeed(league.feedPath);
  const previousSnapshot = feed.lastInjurySnapshot ?? {};
  const leagueSlug = league.slug === 'afl' ? 'afl' : 'theleague';

  // Fetch current injury data from ESPN
  const currentInjuries = await fetchEspnInjuries();
  console.log(`  ESPN injuries: ${currentInjuries.size} players`);

  if (currentInjuries.size === 0) {
    console.log('  No injury data returned — skipping');
    return 0;
  }

  // Load roster data for fantasy relevance
  const rosteredPlayers = await loadRosteredPlayerIds(league);
  const nameIndex = await loadPlayerNameIndex(league);

  // Diff against previous snapshot
  const statusChanges = [];
  for (const [espnId, inj] of currentInjuries) {
    const prevStatus = previousSnapshot[espnId];
    if (prevStatus !== inj.status) {
      // Find MFL player by name match
      const mflPlayer = nameIndex.get(inj.name.toLowerCase());
      const franchiseId = mflPlayer ? rosteredPlayers.get(mflPlayer.id) : null;

      statusChanges.push({
        ...inj,
        mflId: mflPlayer?.id,
        franchiseId,
        isRostered: !!franchiseId,
        prevStatus: prevStatus ?? null,
      });
    }
  }

  console.log(`  Status changes detected: ${statusChanges.length}`);
  if (statusChanges.length === 0) {
    // Update snapshot even with no changes (capture new players)
    const newSnapshot = {};
    for (const [espnId, inj] of currentInjuries) {
      newSnapshot[espnId] = inj.status;
    }
    feed.lastInjurySnapshot = newSnapshot;
    await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
    return 0;
  }

  // Classify tiers and generate posts
  const HIGH_VALUE_STATUSES = new Set(['Out', 'Injured Reserve', 'IR', 'Suspended']);
  const MEDIUM_STATUSES = new Set(['Questionable', 'Doubtful']);
  const newPosts = [];

  for (const change of statusChanges) {
    let tier = 'minor';
    let templates = INJURY_TEMPLATES_MINOR;

    if (change.isRostered && HIGH_VALUE_STATUSES.has(change.status)) {
      tier = 'breaking';
      templates = INJURY_TEMPLATES_BREAKING;
    } else if (change.isRostered && MEDIUM_STATUSES.has(change.status)) {
      tier = 'standard';
      templates = INJURY_TEMPLATES_STANDARD;
    } else if (HIGH_VALUE_STATUSES.has(change.status)) {
      tier = 'standard';
      templates = INJURY_TEMPLATES_STANDARD;
    }

    // Skip minor non-rostered injuries to avoid feed spam
    if (tier === 'minor' && !change.isRostered) continue;

    const template = pickTemplate(templates, change.espnId);
    const body = template(change);
    const headline = `${change.name} (${change.nflTeam}) → ${change.status}`;

    const post = {
      id: `inj_${change.espnId}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'injury',
      tier,
      headline,
      body,
      authorId: 'doc-rivers',
      franchiseIds: change.franchiseId ? [change.franchiseId] : [],
      playerIds: change.mflId ? [change.mflId] : [],
      league: leagueSlug,
    };

    newPosts.push(post);
    console.log(`  [${tier}] ${headline}`);
  }

  if (newPosts.length > 0) {
    feed.posts = [...newPosts.reverse(), ...feed.posts];
  }

  // Update snapshot
  const newSnapshot = {};
  for (const [espnId, inj] of currentInjuries) {
    newSnapshot[espnId] = inj.status;
  }
  feed.lastInjurySnapshot = newSnapshot;

  await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
  console.log(`  Wrote ${newPosts.length} injury posts. Feed total: ${feed.posts.length}`);
  return newPosts.length;
}

// ── Vegas Vic: Odds & Lines ──
// Fetches weekly opening lines from ESPN Scoreboard API.
// Posts once per NFL week when lines first appear. Season-only.

// Vegas Vic template pools — confident, numbers-focused, slightly cocky
const ODDS_TEMPLATES = [
  (g) => `${g.away} at ${g.home}: ${g.spread}, O/U ${g.overUnder}. The book is talking.`,
  (g) => `Opening number: ${g.home} ${g.spread} vs ${g.away}. Over/under sits at ${g.overUnder}.`,
  (g) => `${g.away} at ${g.home} — line opens at ${g.spread}, total ${g.overUnder}. Market will move. Get in early.`,
  (g) => `${g.home} ${g.spread} hosting ${g.away}. O/U: ${g.overUnder}. Sharp money hasn't spoken yet.`,
];

function getCurrentNFLWeekForOdds() {
  const now = new Date();
  const seasonYear = now.getFullYear();
  const seasonConfigs = {
    2024: new Date('2024-09-05T20:20:00-04:00'),
    2025: new Date('2025-09-04T20:20:00-04:00'),
    2026: new Date('2026-09-10T20:20:00-04:00'),
  };

  let week1Start = seasonConfigs[seasonYear];
  if (!week1Start) {
    const sept1 = new Date(seasonYear, 8, 1);
    const dayOfWeek = sept1.getDay();
    const daysUntilThursday = dayOfWeek <= 4 ? 4 - dayOfWeek : 11 - dayOfWeek;
    week1Start = new Date(seasonYear, 8, 1 + daysUntilThursday, 20, 20);
  }

  if (now < week1Start) return 0; // Offseason
  const msSinceStart = now.getTime() - week1Start.getTime();
  const weeksSinceStart = Math.floor(msSinceStart / (7 * 24 * 60 * 60 * 1000));
  return Math.min(weeksSinceStart + 1, 22);
}

async function scanOdds(league) {
  console.log(`\n=== Scanning Odds (Vegas Vic) for ${league.slug} ===`);

  const currentWeek = getCurrentNFLWeekForOdds();
  if (currentWeek === 0) {
    console.log('  Offseason — no NFL games. Skipping odds scan.');
    return 0;
  }

  const feed = await loadFeed(league.feedPath);
  const lastWeek = feed.lastOddsWeek ?? 0;
  const leagueSlug = league.slug === 'afl' ? 'afl' : 'theleague';

  if (lastWeek >= currentWeek) {
    console.log(`  Already posted Week ${currentWeek} odds. Skipping.`);
    return 0;
  }

  // Fetch scoreboard for current week
  const seasonType = currentWeek <= 18 ? 2 : 3;
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${currentWeek}&seasontype=${seasonType}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  ESPN scoreboard returned ${res.status} — skipping`);
      return 0;
    }

    const data = await res.json();
    const events = data.events ?? [];

    if (events.length === 0) {
      console.log('  No games found for this week — skipping');
      return 0;
    }

    console.log(`  Found ${events.length} games for Week ${currentWeek}`);

    const newPosts = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
      const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
      if (!homeTeam || !awayTeam) continue;

      const odds = comp.odds?.[0];
      if (!odds) continue; // No odds available for this game

      const spread = odds.details || 'N/A';
      const overUnder = odds.overUnder ? `${odds.overUnder}` : 'N/A';

      if (spread === 'N/A' && overUnder === 'N/A') continue;

      const home = homeTeam.team?.abbreviation ?? 'HOME';
      const away = awayTeam.team?.abbreviation ?? 'AWAY';
      const homeFull = homeTeam.team?.shortDisplayName ?? home;
      const awayFull = awayTeam.team?.shortDisplayName ?? away;

      const template = pickTemplate(ODDS_TEMPLATES, event.id);
      const body = template({ home: homeFull, away: awayFull, spread, overUnder });

      newPosts.push({
        id: `odds_wk${currentWeek}_${event.id}`,
        timestamp: new Date().toISOString(),
        type: 'odds',
        tier: 'standard',
        headline: `Week ${currentWeek}: ${away} at ${home} — ${spread}`,
        body,
        authorId: 'vegas-vic',
        franchiseIds: [],
        league: leagueSlug,
      });
    }

    if (newPosts.length === 0) {
      console.log('  No games with odds data — skipping');
      return 0;
    }

    feed.posts = [...newPosts.reverse(), ...feed.posts];
    feed.lastOddsWeek = currentWeek;
    await fs.writeFile(league.feedPath, JSON.stringify(feed, null, 2) + '\n');
    console.log(`  Wrote ${newPosts.length} odds posts for Week ${currentWeek}. Feed total: ${feed.posts.length}`);
    return newPosts.length;
  } catch (err) {
    console.log(`  Odds fetch error: ${err.message}`);
    return 0;
  }
}

// Run
console.log('🎙️ Schefter Scanner starting...');
let totalPosts = 0;

for (const league of LEAGUES) {
  try {
    // Scan MFL transactions
    totalPosts += await scanLeague(league);
    // Scan pending trades (Schefter Rumor Mill — Phase 1)
    totalPosts += await scanPendingTrades(league);
    // Scan ESPN contributors
    totalPosts += await scanEspn(league);
    // Scan event reminders (Ask Roger)
    totalPosts += await scanEventReminders(league);
    // Scan NFL Wire (general NFL news)
    totalPosts += await scanNflWire(league);
    // Scan injuries (Doc Rivers)
    totalPosts += await scanInjuries(league);
    // Scan odds (Vegas Vic)
    totalPosts += await scanOdds(league);
  } catch (err) {
    console.error(`  Error scanning ${league.slug}:`, err.message);
  }
}

console.log(`\n✅ Done. Generated ${totalPosts} new posts.`);
process.exit(0);
