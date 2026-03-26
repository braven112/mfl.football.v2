#!/usr/bin/env node
/**
 * Scheftner Transaction Scanner
 *
 * Scans MFL for new transactions and generates Scheftner feed posts.
 * Runs hourly via GitHub Actions or manually: node scripts/scheftner-scan.mjs
 *
 * For breaking-tier posts (trades, high-value auctions), calls the Anthropic API
 * to generate Scheftner-voiced commentary. Standard/minor posts use templates.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY — Required for breaking-tier AI commentary
 *   MFL_HOST — MFL API host (default: api.myfantasyleague.com)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MFL_HOST = process.env.MFL_HOST || 'api.myfantasyleague.com';

// ── League configs ──

const LEAGUES = [
  {
    slug: 'theleague',
    leagueId: '13522',
    feedPath: path.join(projectRoot, 'src', 'data', 'theleague', 'scheftner-feed.json'),
    playersPath: (year) => path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'players.json'),
    configPath: path.join(projectRoot, 'src', 'data', 'theleague.config.json'),
  },
  {
    slug: 'afl',
    leagueId: '19621',
    feedPath: path.join(projectRoot, 'data', 'afl-fantasy', 'scheftner-feed.json'),
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
    league: leagueSlug,
  };
}

// Template pools for varied Scheftner voice — 30+ options per tier
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
            content: `Write a breaking news post about this transaction:\n\n${post.body}\n\nProvide:\n1. A punchy body (2-3 sentences, Scheftner voice)\n2. A "Scheftner's Take" analysis (1-2 sentences, grade the trade if applicable)\n\nFormat as JSON: {"body": "...", "analysis": "..."}`,
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

// Run
console.log('🎙️ Scheftner Scanner starting...');
let totalPosts = 0;

for (const league of LEAGUES) {
  try {
    totalPosts += await scanLeague(league);
  } catch (err) {
    console.error(`  Error scanning ${league.slug}:`, err.message);
  }
}

console.log(`\n✅ Done. Generated ${totalPosts} new posts.`);
process.exit(totalPosts > 0 ? 0 : 0);
