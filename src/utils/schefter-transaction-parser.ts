/**
 * Schefter Transaction Parser
 *
 * Parses raw MFL transactions into structured data, classifies tiers,
 * and generates headlines/bodies for Claude Schefter's feed posts.
 */

import type {
  MFLRawTransaction,
  ParsedTransaction,
  ParsedTransactionItem,
  ParsedDraftPick,
  PostTier,
  TransactionSubType,
  SchefterPost,
} from '../types/schefter';

/** Transaction types we skip entirely (noise) */
const SKIP_TYPES = new Set(['AUCTION_BID', 'AUCTION_INIT', 'IR', 'TAXI']);

/** Transaction types we recognize and process */
const PROCESS_TYPES = new Set(['TRADE', 'AUCTION_WON', 'FREE_AGENT', 'BBID_WAIVER', 'WAIVER']);

/** Threshold for breaking-tier auction wins (in cents — $3M) */
const BREAKING_AUCTION_THRESHOLD = 3_000_000;

/** Threshold for standard-tier auction wins (in cents — $1M) */
const STANDARD_AUCTION_THRESHOLD = 1_000_000;

/** Ordinal suffixes for draft rounds */
const ROUND_ORDINALS: Record<number, string> = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
  6: '6th', 7: '7th', 8: '8th', 9: '9th', 10: '10th',
};

// ── Formatting Helpers ──

/** Format salary in cents to display string: $2.10M, $425K, $0 */
export function formatSalaryCompact(cents: number): string {
  if (!Number.isFinite(cents) || cents === 0) return '$0';
  if (cents >= 1_000_000) return `$${(cents / 1_000_000).toFixed(2)}M`;
  if (cents >= 1_000) return `$${(cents / 1_000).toFixed(0)}K`;
  return `$${cents.toLocaleString()}`;
}

/** Player info lookup map: playerId → { name, position, nflTeam } */
export interface PlayerInfo {
  name: string;
  position?: string;
  nflTeam?: string;
}

/** Team info lookup map: franchiseId → { name, abbrev } */
export interface TeamInfo {
  name: string;
  abbrev?: string;
}

// ── Transaction Parsing ──

/** Check if a transaction type should be skipped */
export function shouldSkipTransaction(raw: MFLRawTransaction): boolean {
  if (SKIP_TYPES.has(raw.type)) return true;
  if (!PROCESS_TYPES.has(raw.type)) return true;
  return false;
}

/** Check if a transaction is newer than the watermark */
export function isNewTransaction(timestamp: string, watermark: string): boolean {
  return parseInt(timestamp, 10) > parseInt(watermark, 10);
}

/**
 * Parse a pipe-delimited transaction string into player items.
 * MFL format: "|playerId,salary|" or "playerId|salary|" (varies)
 * For FREE_AGENT: "|16608," — player added
 * For AUCTION_WON: "15331|2000000|" — player at salary
 */
export function parseTransactionString(
  txnString: string,
  players: Map<string, PlayerInfo>,
): ParsedTransactionItem[] {
  if (!txnString) return [];

  const items: ParsedTransactionItem[] = [];
  // Clean and split by pipe, filter empties
  const parts = txnString.replace(/^\|/, '').replace(/\|$/, '').split('|').filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].replace(/,$/, '').trim();
    if (!part) continue;

    // Check if this is a player ID (numeric) or salary (large number after a player)
    const num = parseInt(part, 10);
    if (isNaN(num)) continue;

    // If it's a large number and the previous item exists, it's a salary
    if (num > 100_000 && items.length > 0 && items[items.length - 1].salary === undefined) {
      items[items.length - 1].salary = num;
      continue;
    }

    // It's a player ID
    const player = players.get(part);
    items.push({
      playerId: part,
      playerName: player?.name,
      position: player?.position,
      nflTeam: player?.nflTeam,
      salary: undefined,
    });
  }

  return items;
}

/**
 * Parse a trade assets string (franchise1_gave_up / franchise2_gave_up).
 * Format: "playerId,playerId,FP_XXXX_YYYY_R," (comma-delimited, trailing comma)
 * Draft picks: FP_{originalFranchiseId}_{year}_{round}
 */
export function parseTradeAssets(
  assetsStr: string,
  players: Map<string, PlayerInfo>,
  teams: Map<string, TeamInfo>,
): { players: ParsedTransactionItem[]; picks: ParsedDraftPick[] } {
  if (!assetsStr) return { players: [], picks: [] };

  const result: { players: ParsedTransactionItem[]; picks: ParsedDraftPick[] } = {
    players: [],
    picks: [],
  };

  const parts = assetsStr.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.startsWith('FP_')) {
      const pick = parseDraftPickId(part, teams);
      if (pick) result.picks.push(pick);
    } else {
      const player = players.get(part);
      result.players.push({
        playerId: part,
        playerName: player?.name,
        position: player?.position,
        nflTeam: player?.nflTeam,
      });
    }
  }

  return result;
}

/**
 * Parse a draft pick ID like FP_0009_2026_3 into structured data.
 * Returns null if the format doesn't match.
 */
export function parseDraftPickId(
  pickId: string,
  teams: Map<string, TeamInfo>,
): ParsedDraftPick | null {
  const match = pickId.match(/^FP_(\d{4})_(\d{4})_(\d+)$/);
  if (!match) return null;

  const originalFranchiseId = match[1];
  const year = parseInt(match[2], 10);
  const round = parseInt(match[3], 10);
  const team = teams.get(originalFranchiseId);
  const roundStr = ROUND_ORDINALS[round] ?? `${round}th`;
  const display = `${team?.name ?? `Team ${originalFranchiseId}`}'s ${year} ${roundStr}`;

  return { originalFranchiseId, year, round, display };
}

/** Parse a raw MFL transaction into structured data */
export function parseTransaction(
  raw: MFLRawTransaction,
  players: Map<string, PlayerInfo>,
  teams: Map<string, TeamInfo>,
): ParsedTransaction | null {
  const type = raw.type as TransactionSubType;

  // Normalize WAIVER → FREE_AGENT for our purposes
  const normalizedType: TransactionSubType = raw.type === 'WAIVER' ? 'FREE_AGENT' : type;

  if (normalizedType === 'TRADE') {
    const gave1 = parseTradeAssets(raw.franchise1_gave_up ?? '', players, teams);
    const gave2 = parseTradeAssets(raw.franchise2_gave_up ?? '', players, teams);

    return {
      type: 'TRADE',
      franchiseId: raw.franchise,
      franchiseId2: raw.franchise2,
      timestamp: raw.timestamp,
      // franchise1 acquired what franchise2 gave up
      playersAcquired: gave2.players,
      playersGivenUp: gave1.players,
      picksAcquired: gave2.picks,
      picksGivenUp: gave1.picks,
      comments: raw.comments,
      byCommish: raw.by_commish === '1',
    };
  }

  // AUCTION_WON, FREE_AGENT, BBID_WAIVER
  const items = parseTransactionString(raw.transaction, players);
  const salary = items[0]?.salary;

  return {
    type: normalizedType,
    franchiseId: raw.franchise,
    timestamp: raw.timestamp,
    playersAcquired: items,
    playersGivenUp: [],
    picksAcquired: [],
    picksGivenUp: [],
    salary,
    comments: raw.comments,
    byCommish: raw.by_commish === '1',
  };
}

// ── Tier Classification ──

/** Classify a parsed transaction into a display tier */
export function classifyTier(parsed: ParsedTransaction): PostTier {
  // All trades are breaking news
  if (parsed.type === 'TRADE') return 'breaking';

  // Auction wins tier by salary
  if (parsed.type === 'AUCTION_WON') {
    if ((parsed.salary ?? 0) >= BREAKING_AUCTION_THRESHOLD) return 'breaking';
    if ((parsed.salary ?? 0) >= STANDARD_AUCTION_THRESHOLD) return 'standard';
    return 'minor';
  }

  // Free agent pickups: commish bulk moves are minor
  if (parsed.byCommish) return 'minor';

  // BBID waivers are standard (they cost something)
  if (parsed.type === 'BBID_WAIVER') return 'standard';

  // Everything else is minor
  return 'minor';
}

// ── Headline & Body Generation ──

/** Get team display name, preferring abbrev for brevity */
function teamName(franchiseId: string, teams: Map<string, TeamInfo>): string {
  return teams.get(franchiseId)?.name ?? `Team ${franchiseId}`;
}

/** Check if a player item is a team defense */
function isDef(item: ParsedTransactionItem): boolean {
  return item.position === 'Def' || item.position === 'DEF';
}

/**
 * Format a defense name from MFL "Team, City" format.
 * "Bills, Buffalo" → "the Buffalo Bills defense"
 * "49ers, San Francisco" → "the San Francisco 49ers defense"
 *
 * Uses lowercase "the" so it reads naturally mid-sentence.
 * Templates that start with ${p} should use capitalize() on the result.
 */
function formatDefenseName(name?: string): string {
  if (!name) return 'a team defense';
  const parts = name.split(', ');
  if (parts.length === 2) return `the ${parts[1]} ${parts[0]} defense`;
  return `the ${name} defense`;
}

/** Format a player for display: "WR Ja'Marr Chase" or "the Buffalo Bills defense" */
function playerDisplay(item: ParsedTransactionItem): string {
  if (isDef(item)) return formatDefenseName(item.playerName);
  const pos = item.position ? `${item.position} ` : '';
  return `${pos}${item.playerName ?? `Player ${item.playerId}`}`;
}

// ── Template Pools for Varied Voice ──

type TemplateFn = (team: string, player: string, salary: string) => string;

/** Capitalize first letter — used when defense name "the X defense" starts a sentence */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const BREAKING_AUCTION_HEADLINES: TemplateFn[] = [
  (tm, p, s) => `${tm} land ${p} at ${s}`,
  (tm, p, s) => `${tm} win auction for ${p} at ${s}`,
  (tm, p, s) => `Boom! ${tm} grab ${p} for ${s}`,
  (tm, p, s) => `${tm} secure ${p} at ${s}`,
  (tm, p, s) => `${tm} go big for ${p} at ${s}`,
  (tm, p, s) => `${tm} make splash for ${p}`,
  (tm, p, s) => `${tm} win ${p} in heated auction`,
  (tm, p, s) => `Wow. ${tm} land ${p} at ${s}`,
  (tm, p, s) => `${tm} pounce on ${p} for ${s}`,
  (tm, p, s) => `Breaking: ${tm} add ${p} at ${s}`,
  (tm, p, s) => `${tm} open the vault for ${p}`,
  (tm, p, s) => `Bang! ${tm} land ${p} at ${s}`,
  (tm, p, s) => `${tm} swing big for ${p}`,
  (tm, p, s) => `${tm} win ${p} at ${s}`,
  (tm, p, s) => `${tm} lock up ${p} for ${s}`,
];
const BREAKING_AUCTION_BODIES: TemplateFn[] = [
  (tm, p, s) => `I'm told ${tm} went all-in for ${p} at ${s}. A statement move.`,
  (tm, p, s) => `League sources tell me ${tm} outbid the field to land ${p} at ${s}. Bold investment.`,
  (tm, p, s) => `${tm} win the bidding war for ${p} at ${s}. That roster just got significantly better.`,
  (tm, p, s) => `Boom! ${tm} drop ${s} on ${p}. The auction room went quiet when this one hit.`,
  (tm, p, s) => `I'm told ${tm} had ${p} circled from the start. They paid ${s} and didn't flinch.`,
  (tm, p, s) => `League sources tell me ${tm} are paying ${s} for ${p}. That's a franchise-altering acquisition.`,
  (tm, p, s) => `The bidding for ${p} got intense. When the dust settled, ${tm} walked away with the prize at ${s}.`,
  (tm, p, s) => `I'm told multiple teams pushed hard for ${p}. ${tm} won the war at ${s}. Money well spent.`,
  (tm, p, s) => `${tm} weren't messing around. ${s} for ${p} is aggressive, but this is a team making a statement.`,
  (tm, p, s) => `League sources tell me ${tm} are the winners of the ${p} sweepstakes at ${s}. Major roster upgrade.`,
  (tm, p, s) => `${s} for ${p}. That's what ${tm} decided this player was worth, and I'm told they'd do it again.`,
  (tm, p, s) => `I'm told ${tm} walked into the auction room with one target: ${p}. They paid ${s} and got their guy.`,
  (tm, p, s) => `${tm} drop ${s} on ${p}. You don't spend that kind of money unless you're building something.`,
  (tm, p, s) => `I'm told the final bid for ${p} came from ${tm} at ${s}. The rest of the room tapped out.`,
  (tm, p, s) => `League sources confirm ${tm} have secured ${p} at ${s}. This one changes the math for the whole conference.`,
];
const STANDARD_AUCTION_HEADLINES: TemplateFn[] = [
  (tm, p, s) => `${tm} win ${p} at ${s}`,
  (tm, p, s) => `${tm} add ${p} (${s})`,
  (tm, p, s) => `${tm} land ${p} for ${s}`,
  (tm, p, s) => `${tm} secure ${p} at ${s}`,
  (tm, p, s) => `${tm} win bid for ${p}`,
  (tm, p, s) => `${tm} bring in ${p} (${s})`,
  (tm, p, s) => `${tm} pick up ${p} (${s})`,
  (tm, p, s) => `${tm} grab ${p} at ${s}`,
  (tm, p, s) => `${tm} claim ${p} at ${s}`,
  (tm, p, s) => `${tm} nab ${p} at ${s}`,
  (tm, p, s) => `${tm} win auction for ${p}`,
  (tm, p, s) => `${tm} pick up ${p} at ${s}`,
];
const STANDARD_AUCTION_BODIES: TemplateFn[] = [
  (tm, p, s) => `${tm} pick up ${p} at ${s}. Solid depth move.`,
  (tm, p, s) => `${tm} win the auction for ${p} at ${s}. Smart roster construction.`,
  (tm, p, s) => `I'm told ${tm} quietly secured ${p} for ${s}.`,
  (tm, p, s) => `${tm} slot ${p} onto the roster at ${s}. Nice pickup.`,
  (tm, p, s) => `${tm} add ${p} to the roster at ${s}. That's a useful piece.`,
  (tm, p, s) => `${tm} bring in ${p} at ${s}. Value play that could pay off down the road.`,
  (tm, p, s) => `${p} heads to ${tm} at ${s}. Good price for what this player can do.`,
  (tm, p, s) => `${tm} didn't overpay for ${p} at ${s}. Exactly the kind of move playoff teams make.`,
  (tm, p, s) => `${tm} take ${p} off the board at ${s}. Fills a need without breaking the bank.`,
  (tm, p, s) => `${p} to ${tm} at ${s}. Roster gets a little deeper.`,
  (tm, p, s) => `${tm} add ${p} for ${s}. Not flashy, but this team knows what it needs.`,
  (tm, p, s) => `I'm told ${tm} had been eyeing ${p} for a while. They got their price at ${s}.`,
  (tm, p, s) => `${tm} win the rights to ${p} at ${s}. Quietly building a contender.`,
  (tm, p, s) => `${p} lands with ${tm} for ${s}. A fair price for a useful player.`,
  (tm, p, s) => `${tm} snag ${p} for ${s}. This one flew under the radar but it shouldn't have.`,
  (tm, p, s) => `Another add for ${tm}: ${p} at ${s}. This front office stays busy.`,
  (tm, p, s) => `${tm} take a shot on ${p} at ${s}. Low risk, decent upside.`,
  (tm, p, s) => `${tm} round out their roster with ${p} at ${s}. Methodical addition.`,
  (tm, p, s) => `${p} goes to ${tm} at ${s}. Solid floor player at a manageable number.`,
  (tm, p, s) => `${tm} invest ${s} in ${p}. That salary won't look bad if the production is there.`,
];

// ── DEF-Specific Body Templates ──
// When a defense is acquired, we reference the unit, not a singular player.

const BREAKING_AUCTION_DEF_BODIES: TemplateFn[] = [
  (tm, p, s) => `I'm told ${tm} went all-in for ${p} at ${s}. Adding a premier defensive unit to this roster.`,
  (tm, p, s) => `League sources tell me ${tm} outbid the field to land ${p} at ${s}. That special teams and defensive scoring could be the difference in a tight playoff race.`,
  (tm, p, s) => `Boom! ${tm} drop ${s} on ${p}. The points this unit put up last season made them a must-have.`,
  (tm, p, s) => `${tm} aren't messing around. ${s} for ${p} signals a team loading up on every scoring advantage they can find.`,
  (tm, p, s) => `I'm told ${tm} had ${p} circled from the start. That defensive line and special teams unit are worth every cent of ${s}.`,
  (tm, p, s) => `League sources confirm ${tm} have locked up ${p} at ${s}. Elite defensive units don't come cheap — and this one won't disappoint.`,
  (tm, p, s) => `${tm} pay ${s} for ${p}. Smart organizations know that D/ST scoring wins weeks you have no business winning.`,
  (tm, p, s) => `I'm told multiple teams wanted ${p}. ${tm} won the bidding war at ${s}. This unit brings sacks, turnovers, and special teams points.`,
];

const STANDARD_AUCTION_DEF_BODIES: TemplateFn[] = [
  (tm, p, s) => `${tm} pick up ${p} at ${s}. Solid defensive unit to anchor the D/ST slot.`,
  (tm, p, s) => `${tm} add ${p} at ${s}. That unit could be a weekly scoring advantage.`,
  (tm, p, s) => `${cap(p)} heads to ${tm} for ${s}. Good price for a defense with this much upside.`,
  (tm, p, s) => `${tm} slot ${p} onto the roster at ${s}. Smart D/ST investment.`,
  (tm, p, s) => `I'm told ${tm} quietly secured ${p} for ${s}. The sack and turnover potential alone makes this worthwhile.`,
  (tm, p, s) => `${tm} bring in ${p} at ${s}. This defensive unit should provide a consistent scoring floor.`,
  (tm, p, s) => `${tm} invest ${s} in ${p}. Defensive scoring is the great equalizer in this league.`,
  (tm, p, s) => `${cap(p)} goes to ${tm} at ${s}. A defense with that schedule ahead? This could be a steal.`,
];

const MINOR_AUCTION_DEF_BODIES: TemplateFn[] = [
  (tm, p, s) => `${tm} claims ${p} (${s}). Streaming option for the D/ST slot.`,
  (tm, p, s) => `${tm} add ${p} at ${s}. Depth piece for bye weeks.`,
  (tm, p, s) => `${cap(p)} to ${tm} at ${s}. Low-cost D/ST fill.`,
  (tm, p, s) => `${tm} grab ${p} for ${s}. Keeping their defensive options open.`,
  (tm, p, s) => `${tm} pick up ${p} (${s}). Schedule-based streamer add.`,
];

const FA_DEF_BODIES: TemplateFn[] = [
  (tm, p, s) => `${tm} add ${p}${s} off the wire. D/ST streaming move.`,
  (tm, p, s) => `${cap(p)} heads to ${tm}${s}. Adding defensive depth.`,
  (tm, p, s) => `${tm} bring in ${p}${s}. That defensive front could produce fantasy points.`,
  (tm, p, s) => `${tm} claim ${p}${s}. Matchup-based D/ST pickup.`,
];

/** Pick a template deterministically based on timestamp */
function pickTemplate<T>(templates: T[], timestamp: string): T {
  const idx = parseInt(timestamp, 10) % templates.length;
  return templates[idx];
}

/** Generate a headline for a transaction post (~60 chars target) */
export function generateHeadline(
  parsed: ParsedTransaction,
  teams: Map<string, TeamInfo>,
): string {
  const team1 = teamName(parsed.franchiseId, teams);

  if (parsed.type === 'TRADE') {
    const team2 = teamName(parsed.franchiseId2 ?? '', teams);
    const totalAssets = parsed.playersAcquired.length + parsed.playersGivenUp.length +
      parsed.picksAcquired.length + parsed.picksGivenUp.length;
    if (totalAssets <= 2) {
      const got = parsed.playersAcquired[0] ?? parsed.picksAcquired[0];
      const gave = parsed.playersGivenUp[0] ?? parsed.picksGivenUp[0];
      const gotStr = got ? ('playerName' in got ? playerDisplay(got as ParsedTransactionItem) : (got as ParsedDraftPick).display) : 'assets';
      const gaveStr = gave ? ('playerName' in gave ? playerDisplay(gave as ParsedTransactionItem) : (gave as ParsedDraftPick).display) : 'assets';
      return `${team1} trade ${gaveStr} to ${team2} for ${gotStr}`;
    }
    return `${team1} and ${team2} complete ${totalAssets}-asset trade`;
  }

  if (parsed.type === 'AUCTION_WON') {
    const player = parsed.playersAcquired[0];
    const salary = parsed.salary ? formatSalaryCompact(parsed.salary) : 'minimum salary';
    const tier = classifyTier(parsed);
    if (tier === 'breaking') {
      return pickTemplate(BREAKING_AUCTION_HEADLINES, parsed.timestamp)(team1, playerDisplay(player), salary);
    }
    if (tier === 'standard') {
      return pickTemplate(STANDARD_AUCTION_HEADLINES, parsed.timestamp)(team1, playerDisplay(player), salary);
    }
    return `${team1} win ${playerDisplay(player)} (${salary})`;
  }

  // FREE_AGENT / BBID_WAIVER
  const player = parsed.playersAcquired[0];
  const salary = parsed.salary ? ` (${formatSalaryCompact(parsed.salary)})` : '';
  return `${team1} add ${playerDisplay(player)}${salary}`;
}

/** Generate a body for standard/minor tier posts (template-based, no AI) */
export function generateBody(
  parsed: ParsedTransaction,
  teams: Map<string, TeamInfo>,
): string {
  const team1 = teamName(parsed.franchiseId, teams);

  if (parsed.type === 'TRADE') {
    const team2 = teamName(parsed.franchiseId2 ?? '', teams);
    const gave1Items = [
      ...parsed.playersGivenUp.map(playerDisplay),
      ...parsed.picksGivenUp.map(p => p.display ?? 'draft pick'),
    ];
    const gave2Items = [
      ...parsed.playersAcquired.map(playerDisplay),
      ...parsed.picksAcquired.map(p => p.display ?? 'draft pick'),
    ];
    return `${team1} send ${gave1Items.join(', ')} to ${team2} in exchange for ${gave2Items.join(', ')}.`;
  }

  if (parsed.type === 'AUCTION_WON') {
    const player = parsed.playersAcquired[0];
    const salary = parsed.salary ? formatSalaryCompact(parsed.salary) : 'minimum salary';
    const tier = classifyTier(parsed);
    const defPlayer = isDef(player);
    if (tier === 'breaking') {
      const pool = defPlayer ? BREAKING_AUCTION_DEF_BODIES : BREAKING_AUCTION_BODIES;
      return pickTemplate(pool, parsed.timestamp)(team1, playerDisplay(player), salary);
    }
    if (tier === 'standard') {
      const pool = defPlayer ? STANDARD_AUCTION_DEF_BODIES : STANDARD_AUCTION_BODIES;
      return pickTemplate(pool, parsed.timestamp)(team1, playerDisplay(player), salary);
    }
    if (defPlayer) {
      return pickTemplate(MINOR_AUCTION_DEF_BODIES, parsed.timestamp)(team1, playerDisplay(player), salary);
    }
    return `${team1} claims ${playerDisplay(player)} (${salary})`;
  }

  // FREE_AGENT / BBID_WAIVER
  const player = parsed.playersAcquired[0];
  const salary = parsed.salary ? ` for ${formatSalaryCompact(parsed.salary)}` : '';
  if (isDef(player)) {
    return pickTemplate(FA_DEF_BODIES, parsed.timestamp)(team1, playerDisplay(player), salary);
  }
  return `${team1} add ${playerDisplay(player)}${salary} off the free agent wire.`;
}

/** Generate a one-liner for minor tier posts */
export function generateMinorLine(
  parsed: ParsedTransaction,
  teams: Map<string, TeamInfo>,
): string {
  const team1 = teamName(parsed.franchiseId, teams);
  const player = parsed.playersAcquired[0];
  if (!player) return `${team1} makes a roster move.`;
  const salary = parsed.salary ? ` (${formatSalaryCompact(parsed.salary)})` : '';
  return `${team1} claims ${player.playerName ?? `Player ${player.playerId}`}${salary}`;
}

// ── Post Generation ──

/** Generate a unique post ID */
export function generatePostId(timestamp: string): string {
  const hash = Math.random().toString(36).slice(2, 6);
  return `sf_${timestamp}_${hash}`;
}

/**
 * Convert a parsed transaction into a SchefterPost.
 * For breaking-tier posts, body/analysis will be placeholder —
 * the scanner script fills these in via Anthropic API.
 */
export function transactionToPost(
  parsed: ParsedTransaction,
  teams: Map<string, TeamInfo>,
  league: 'theleague' | 'afl',
): SchefterPost {
  const tier = classifyTier(parsed);
  const headline = generateHeadline(parsed, teams);
  const body = tier === 'minor'
    ? generateMinorLine(parsed, teams)
    : generateBody(parsed, teams);

  const franchiseIds = [parsed.franchiseId];
  if (parsed.franchiseId2) franchiseIds.push(parsed.franchiseId2);

  const playerIds = [
    ...parsed.playersAcquired.map(p => p.playerId),
    ...parsed.playersGivenUp.map(p => p.playerId),
  ];

  const post: SchefterPost = {
    id: generatePostId(parsed.timestamp),
    timestamp: new Date(parseInt(parsed.timestamp, 10) * 1000).toISOString(),
    type: 'transaction',
    transactionSubType: parsed.type,
    tier,
    headline,
    body,
    franchiseIds,
    playerIds: playerIds.length > 0 ? playerIds : undefined,
    sourceTimestamp: parsed.timestamp,
    league,
  };

  return post;
}
