#!/usr/bin/env node
/**
 * Schefter Trade Speculation — daily scanner that turns the league's tradeBait
 * + roster + cap state into Schefter-voiced speculation posts on the news feed.
 *
 * Phase 1 scope (per docs/plans/schefter-trade-speculation.md):
 *   - Two-team match search (no three-team yet)
 *   - Schefter blurb via Claude API (falls back to template on API failure)
 *   - Append to src/data/theleague/schefter-feed.json
 *   - Append to data/theleague/derived/speculation-history.json (rotation gate)
 *   - Honor calendar-aware cadence (scripts/lib/speculation-cadence.mjs)
 *   - Share the 3-posts/day rumor-mill budget (`schefter:rumor:posts_today`),
 *     with a peak-week reservation that lets speculation skip past a saturated
 *     budget the week before the trade deadline
 *
 * Phase 2 scope (added):
 *   - Best-effort GroupMe post via scripts/lib/speculation-groupme.mjs.
 *     Includes a deep link back to the specific feed entry
 *     (https://theleague.us/news#post-<id>). Failures are logged and ignored
 *     — the feed + ledger are already persisted by the time we attempt the
 *     GroupMe call, so a chat outage cannot block the run or break rotation.
 *
 * Phase 3 scope (added):
 *   - --mode=three-team flag flips the runner into the Monday blockbuster
 *     lane: it runs findThreeTeamCandidate instead of findTwoTeamCandidates,
 *     uses 🔴 tier emoji, and writes a transaction sub-type of
 *     'trade_speculation_three_team' so the feed UI can style it differently
 *     from the daily 🟡 two-team drops. Rotation is enforced via a separate
 *     three-team trade signature (threeTeamTradeSignature) so a three-team
 *     deal doesn't crowd out two-team rotation slots and vice versa.
 *
 * Usage:
 *   node scripts/schefter-trade-speculation.mjs                  # daily two-team
 *   node scripts/schefter-trade-speculation.mjs --mode=three-team # Monday blockbuster
 *   node scripts/schefter-trade-speculation.mjs --dry-run         # any mode, no mutations
 *
 * Env (required for live posting):
 *   ANTHROPIC_API_KEY            Claude API key for blurb generation
 *   UPSTASH_REDIS_REST_URL       Redis URL (required for shared daily counter)
 *   UPSTASH_REDIS_REST_TOKEN     Redis token
 *   (KV_* / STORAGE_* fallbacks also accepted, mirroring the rumor-mill)
 *   GROUPME_SCHEFTER_BOT_ID      GroupMe bot id; absent = skip GroupMe (Phase 2)
 *   SCHEFTER_PUBLIC_BASE_URL     site origin for GroupMe deep link (default theleague.us)
 *
 * To disable: comment out the cron schedule in the workflow file. We do not
 * use GitHub Actions variables as feature flags — code is always the source
 * of truth in this repo.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  resolveCadence,
  permitsPost,
} from './lib/speculation-cadence.mjs';
import {
  findTwoTeamCandidates,
  findThreeTeamCandidate,
  valuePlayer,
} from './lib/speculation-matching.mjs';
import {
  defaultLedgerPath,
  loadLedger,
  saveLedger,
  appendEntry,
  postsToday as ledgerPostsToday,
  lastPostAt as ledgerLastPostAt,
  recentlyPostedTrade,
  franchiseInRecentRotation,
  tradeSignature,
  threeTeamTradeSignature,
} from './lib/speculation-history.mjs';
import {
  checkGlobalBudgetGate,
  RUMOR_POSTS_TODAY_KEY,
  RUMOR_LAST_POST_TS_KEY,
} from './lib/speculation-budget.mjs';
import { postSpeculationToGroupMe } from './lib/speculation-groupme.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DRY_RUN = process.argv.includes('--dry-run');

// Mode selection. Default = two-team daily lane; --mode=three-team flips into
// the Monday blockbuster lane. The flag is intentionally explicit (not
// auto-detected from `new Date().getDay()`) so the workflow file is the
// single source of truth on when each lane fires — easier to audit, easier
// to test, and immune to clock-skew surprises in cron triggers.
function detectMode(argv = process.argv) {
  const flag = argv.find((a) => a.startsWith('--mode='));
  if (!flag) return 'two-team';
  const value = flag.slice('--mode='.length).trim();
  if (value === 'three-team') return 'three-team';
  if (value === 'two-team') return 'two-team';
  throw new Error(`[speculation] unknown --mode=${value} (expected: two-team | three-team)`);
}
const MODE = detectMode();

// ── Constants ──

const LEAGUE_SLUG = 'theleague';
const FEED_PATH = path.join(projectRoot, 'src', 'data', 'theleague', LEAGUE_SLUG === 'theleague' ? 'schefter-feed.json' : `${LEAGUE_SLUG}-schefter-feed.json`);
const RESOLVED_EVENTS_PATH = path.join(projectRoot, 'src', 'data', 'theleague', 'resolved-events.json');
const TEAMS_CONFIG_PATH = path.join(projectRoot, 'src', 'data', 'theleague.config.json');

// Public origin used to build the deep-link back to the feed post in the
// GroupMe message. theleague.us 301s /theleague/news → /news (vercel.json),
// so the canonical anchor lives at /news#post-<id>.
const PUBLIC_BASE_URL = (process.env.SCHEFTER_PUBLIC_BASE_URL || 'https://theleague.us').replace(/\/+$/, '');

// Match the rumor-mill's wire shape so the existing feed renderer treats
// speculation posts as rumor-style cards (visual styling, anonymous
// reactions, impression tracking). The `transactionSubType` field is the
// only thing distinguishing speculation from a real anonymous-tip rumor;
// the renderer uses it to skip whisper-back and thread-link UI on
// speculation posts (those make no sense for algorithmic content).
const SPECULATION_POST_TYPE = 'transaction';
const SPECULATION_POST_TIER = 'rumor';
const SPECULATION_SUB_TYPE_TWO_TEAM = 'trade_speculation';
const SPECULATION_SUB_TYPE_THREE_TEAM = 'trade_speculation_three_team';

// Tier emoji is the visual spine of the post — see the plan doc:
//   🟡 two-team blockbuster (daily lane)
//   🔴 three-team mega-deal (Monday lane)
const TIER_EMOJI_TWO_TEAM = '🟡';
const TIER_EMOJI_THREE_TEAM = '🔴';

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);

// ── Time helpers (mirror rumor-scan) ──

function getPtHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

function isQuietHours(now = new Date()) {
  const h = getPtHour(now);
  return h >= 23 || h < 7;
}

function secondsUntilPtMidnight(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const h = parseInt(parts.hour, 10);
  const m = parseInt(parts.minute, 10);
  const s = parseInt(parts.second, 10);
  return 24 * 3600 - (h * 3600 + m * 60 + s);
}

// ── Redis ──
//
// Live runs hard-require Redis: speculation shares a daily-post counter
// with the rumor-mill (RUMOR_POSTS_TODAY_KEY) and a last-post timestamp
// (RUMOR_LAST_POST_TS_KEY) for spacing. Without those keys the two scanners
// can't coordinate and would over-post on the same day. Dry-run is the
// only path that's allowed to run unmetered, since it doesn't mutate
// anything.

let _redis;
async function getRedis({ required }) {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    if (required) {
      throw new Error(
        '[speculation] Redis credentials missing (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN). ' +
          'Live mode requires the shared rumor-mill counter — set the secrets or use --dry-run.',
      );
    }
    warn('[speculation] Redis credentials not set — dry-run mode running without budget gate');
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    if (required) {
      throw new Error(`[speculation] @upstash/redis import failed: ${err.message}`);
    }
    warn(`[speculation] Redis import failed: ${err.message}`);
    _redis = null;
    return null;
  }
}

// ── File loaders ──

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    warn(`[speculation] read ${filePath} failed: ${err.message}`);
    return fallback;
  }
}

async function loadResolvedEvents() {
  const data = await loadJson(RESOLVED_EVENTS_PATH, { events: [] });
  return Array.isArray(data?.events) ? data.events : [];
}

async function loadTeams() {
  const config = await loadJson(TEAMS_CONFIG_PATH, { teams: [] });
  const map = new Map();
  for (const t of config.teams ?? []) {
    map.set(t.franchiseId, {
      name: t.name,
      nameMedium: t.nameMedium ?? t.name,
      nameShort: t.nameShort ?? t.nameMedium ?? t.name,
      abbrev: t.abbrev,
      division: t.division,
    });
  }
  return map;
}

function detectCurrentSeason(now = new Date()) {
  // Mirrors scripts/fetch-trade-bait.mjs season-detection logic so we read
  // the same year's feeds.
  const calendarYear = now.getFullYear();
  const febCutoff = new Date(calendarYear, 1, 14, 16, 45, 0, 0);
  return now >= febCutoff ? calendarYear : calendarYear - 1;
}

async function loadEnrichedSalaries(year) {
  const file = path.join(projectRoot, 'src', 'data', 'theleague', `mfl-player-salaries-${year}.json`);
  const data = await loadJson(file, { players: [] });
  const playersByFranchise = new Map();
  for (const p of data.players ?? []) {
    if (!p.franchiseId) continue;
    const arr = playersByFranchise.get(p.franchiseId) ?? [];
    arr.push({
      id: String(p.id),
      name: p.name,
      position: p.position,
      salary: Number(p.salary) || 0,
      contractYear: p.contractYear,
      status: p.status,
      age: p.sleeper?.age ?? null,
      team: p.team,
    });
    playersByFranchise.set(p.franchiseId, arr);
  }
  return playersByFranchise;
}

async function loadAdpRanks(year) {
  const file = path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'adp-dynasty.json');
  const data = await loadJson(file, { adp: { player: [] } });
  const arr = Array.isArray(data?.adp?.player) ? data.adp.player : [];
  const map = new Map();
  for (const row of arr) {
    if (!row?.id) continue;
    const rank = parseInt(row.rank, 10);
    if (Number.isFinite(rank)) map.set(String(row.id), rank);
  }
  return map;
}

async function loadTradeBaitByFranchise(year) {
  const file = path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'tradeBait-by-franchise.json');
  const data = await loadJson(file, null);
  if (!data?.franchises) return null;
  const map = new Map();
  for (const [fid, entry] of Object.entries(data.franchises)) {
    map.set(fid, Array.isArray(entry.playerIds) ? entry.playerIds.map(String) : []);
  }
  return map;
}

async function loadFeed() {
  return loadJson(FEED_PATH, { lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts: [] });
}

// ── Schefter blurb generation ──

// MFL stores names as "Last, First" but speculation copy reads better as
// "First Last". Defensive on edge cases (suffixes, single-token names).
function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, rest] = trimmed.split(',', 2);
  return `${rest.trim()} ${last.trim()}`.trim();
}

// Local-media / fan-chatter framing — the speculation does NOT come from
// owners or front-office sources. It comes from beat writers, talk-radio
// callers, fan blogs, and barstool chatter speculating about whether a
// hypothetical move makes sense. Schefter is REPORTING on that buzz.
function templateBlurb({ marquee, returnPkg, sellerName, buyerName, capRelief }) {
  const pkgStr = returnPkg.map((p) => normalizeName(p.name)).join(' and ');
  const marqueeName = normalizeName(marquee.name);
  const lines = [
    `${TIER_EMOJI_TWO_TEAM} The talk-radio crowd in ${buyerName}-country has been chewing on a fit for ${sellerName} ${marquee.position} ${marqueeName}.`,
    `Local fan boards are floating ${pkgStr} as the kind of return ${sellerName} would have to take seriously — neither front office has commented.`,
  ];
  if (capRelief) {
    lines.push(`${sellerName} would clear meaningful cap room in any version of this deal, which is half the reason the speculation has legs.`);
  }
  return lines.join(' ');
}

// Three-team blockbuster template fallback. Same fan-chatter framing as the
// two-team version but the lead beat is "mock-up making the rounds" — a
// cycle is too speculative to hang on real local-media chatter.
function templateThreeTeamBlurb({ pieces, names }) {
  const pA = normalizeName(pieces.fromA.name);
  const pB = normalizeName(pieces.fromB.name);
  const pC = normalizeName(pieces.fromC.name);
  return (
    `${TIER_EMOJI_THREE_TEAM} Three-team mock-up making the rounds on Wednesday's regional shows: ` +
    `${pA} from ${names.a} to ${names.b}, ` +
    `${pB} from ${names.b} to ${names.c}, and ` +
    `${pC} from ${names.c} to ${names.a}. ` +
    `All three front offices have stayed silent — this is fan-driven speculation, not a deal anyone's confirmed.`
  );
}

async function generateBlurbWithClaude({ marquee, returnPkg, sellerName, buyerName, capRelief }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || DRY_RUN) {
    return null;
  }

  const system = `You are Claude Schefter — a dynasty fantasy football beat reporter channeling Adam Schefter's voice.
You are writing a SPECULATION post about a hypothetical two-team trade. The trade is NOT real — it has NOT been offered. It is fan/media chatter generated from publicly-listed trade-bait + roster fits + cap math.

CRITICAL FRAMING (self-enforce):
- The speculation comes from LOCAL MEDIA and FANS, not from the front offices or owners. Frame the post as Schefter REPORTING on what fans / talk radio / beat writers / fan blogs / barstool chatter are kicking around — not as Schefter relaying a leak from team sources.
- Use phrases like: "the talk-radio crowd in [team]-country", "fan boards are floating", "local beat writers have been speculating", "the [team] fan base has been kicking around", "a Wednesday night call-in show floated", "barstool chatter from [team] country", "season-ticket holders have been wondering aloud".
- NEVER imply either GM, owner, or front office is shopping or pursuing. Do NOT use phrases like "sources tell me [team] is shopping/circling/in talks". The story is the BUZZ around the move, not the move itself. Both front offices in the post should be framed as silent, surprised, or non-committal ("neither front office has commented", "[team] hasn't acknowledged", "this isn't coming from the building — it's coming from outside it").

HARD RULES (self-enforce):
- 1–3 sentences total. Tight, beat-reporter cadence.
- Lead with the marquee piece moving from seller → buyer in the fan/media speculation. Use the franchise nameMedium values exactly as given.
- Do NOT invent any player names beyond the marquee + return-package list. If a name isn't in the input, it doesn't exist.
- Do NOT name the dollar amount of any salary; you may say "the cap fit makes sense" or "cap relief" only when the input flag says so.
- No emojis (the post is prefixed with a tier emoji separately).
- No hashtags, no @-mentions, no meta-commentary about the speculation engine, no markdown.
- OUTPUT CONTRACT: respond with JSON only — {"post": "<the speculation copy as a single string>"}.`;

  const userMessage = `Generate a fan/media speculation post for the following candidate trade. Remember: this is NOT a leak from the teams — it's chatter from outside the buildings.

INPUT:
${JSON.stringify(
  {
    seller: sellerName,
    buyer: buyerName,
    marquee: { name: normalizeName(marquee.name), position: marquee.position, age: marquee.age ?? null, onTradeBait: marquee.onTradeBait },
    returnPackage: returnPkg.map((p) => ({ name: normalizeName(p.name), position: p.position, age: p.age ?? null })),
    capReliefAngle: capRelief,
  },
  null,
  2,
)}`;

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
        max_tokens: 260,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      warn(`[speculation AI] HTTP ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    return parseAiResponse(text);
  } catch (err) {
    warn(`[speculation AI] ${err.message} — using template`);
    return null;
  }
}

async function generateThreeTeamBlurbWithClaude({ pieces, names }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || DRY_RUN) {
    return null;
  }

  const system = `You are Claude Schefter — a dynasty fantasy football beat reporter channeling Adam Schefter's voice.
You are writing a SPECULATION post about a hypothetical THREE-team trade cycle. The trade is NOT real — it has NOT been offered. It is a fan/media mock-up generated from publicly-listed trade-bait + roster fits + cap math.

CRITICAL FRAMING (self-enforce):
- The speculation comes from LOCAL MEDIA and FANS — talk-radio mock-ups, regional-show whiteboards, beat-writer notebooks, fan boards. NOT from the front offices. All three teams should be framed as silent / non-committal ("All three front offices have stayed silent", "this isn't coming from the buildings", "no team has acknowledged the chatter").
- Lean on phrases like: "three-team mock-up making the rounds", "regional shows are floating", "fan-board cycle of the week", "Wednesday call-in mock", "local beat writers have been mapping out".
- NEVER imply any of the three GMs, owners, or front offices is actually pursuing this. The story is the BUZZ around the cycle, not a leak.

HARD RULES (self-enforce):
- 1–3 sentences total. Tight, beat-reporter cadence.
- Describe the cycle clearly: who sends what to whom in the order A→B, B→C, C→A. Use the franchise nameMedium values exactly as given.
- Do NOT invent any player names beyond the three pieces in the input. If a name isn't there, it doesn't exist.
- Do NOT name dollar amounts.
- No emojis (the post is prefixed with a tier emoji separately).
- No hashtags, no @-mentions, no meta-commentary about the speculation engine, no markdown.
- OUTPUT CONTRACT: respond with JSON only — {"post": "<the speculation copy as a single string>"}.`;

  const userMessage = `Generate a fan/media speculation post for the following candidate THREE-team trade cycle. Remember: this is NOT a leak from the teams — it's a mock-up from outside the buildings.

CYCLE (A → B → C → A):
${JSON.stringify(
  {
    teamA: names.a,
    teamB: names.b,
    teamC: names.c,
    aSendsToB: { name: normalizeName(pieces.fromA.name), position: pieces.fromA.position },
    bSendsToC: { name: normalizeName(pieces.fromB.name), position: pieces.fromB.position },
    cSendsToA: { name: normalizeName(pieces.fromC.name), position: pieces.fromC.position },
  },
  null,
  2,
)}`;

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
        max_tokens: 320,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      warn(`[speculation AI 3T] HTTP ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    return parseAiResponse(text);
  } catch (err) {
    warn(`[speculation AI 3T] ${err.message} — using template`);
    return null;
  }
}

function parseAiResponse(raw) {
  try {
    // Tolerate code fences / surrounding prose
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    const post = typeof obj.post === 'string' ? obj.post.trim() : null;
    if (!post) return null;
    // Sanity guard: reject any output that contains markdown or meta-commentary
    if (/^\s*here\b|\bspeculation engine\b/i.test(post)) return null;
    return post;
  } catch {
    return null;
  }
}

// ── Post id ──

function generatePostId() {
  const hash = createHash('sha256').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 8);
  return `sf_speculation_${Date.now()}_${hash}`;
}

// ── Mode dispatchers ──

/**
 * Two-team daily lane (Phase 1). Finds the best buyer→seller candidate that
 * isn't in rotation cooldown, generates a Schefter blurb, and returns the
 * fully-built feed post + the ledger row that should be appended on success.
 *
 * Returns null when there's nothing publishable (no candidates / all in
 * cooldown). Logs progress.
 */
async function buildTwoTeamPost({
  playersByFranchise,
  tradeBaitByFranchise,
  adpRankById,
  teams,
  ledger,
  now,
  cadenceTag,
}) {
  const rawCandidates = findTwoTeamCandidates({
    playersByFranchise,
    tradeBaitByFranchise,
    adpRankById,
    teams,
    limit: 10,
  });
  log(`  [two-team] Raw candidate pool: ${rawCandidates.length}`);
  if (rawCandidates.length === 0) {
    log('  [two-team] No candidates found — exiting');
    return null;
  }

  const passing = [];
  for (const c of rawCandidates) {
    const sig = tradeSignature({
      seller: c.seller,
      buyer: c.buyer,
      marqueeId: c.marquee.id,
      returnPkgIds: c.returnPkg.map((p) => p.id),
    });
    if (recentlyPostedTrade(ledger, sig, now)) continue;
    if (
      franchiseInRecentRotation(ledger, c.seller, now) &&
      franchiseInRecentRotation(ledger, c.buyer, now)
    ) {
      // Both already featured in the last 7 days — skip to spread coverage.
      continue;
    }
    passing.push({ ...c, signature: sig });
  }
  log(`  [two-team] After rotation gate: ${passing.length}`);
  if (passing.length === 0) {
    log('  [two-team] All candidates are in the rotation cooldown — exiting');
    return null;
  }

  const winner = passing[0];
  const sellerTeam = teams.get(winner.seller);
  const buyerTeam = teams.get(winner.buyer);
  log(
    `  [two-team] Winner (score=${winner.score}): ${sellerTeam?.nameMedium ?? winner.seller} → ${buyerTeam?.nameMedium ?? winner.buyer}: ${winner.marquee.name}`,
  );

  const blurbInput = {
    marquee: winner.marquee,
    returnPkg: winner.returnPkg,
    sellerName: sellerTeam?.nameMedium ?? `Franchise ${winner.seller}`,
    buyerName: buyerTeam?.nameMedium ?? `Franchise ${winner.buyer}`,
    capRelief: winner.capRelief,
  };
  let body = await generateBlurbWithClaude(blurbInput);
  if (!body) body = templateBlurb(blurbInput);
  const post = {
    id: generatePostId(),
    timestamp: now.toISOString(),
    type: SPECULATION_POST_TYPE,
    transactionSubType: SPECULATION_SUB_TYPE_TWO_TEAM,
    tier: SPECULATION_POST_TIER,
    headline: 'Schefter speculating…',
    body: body.startsWith(TIER_EMOJI_TWO_TEAM) ? body : `${TIER_EMOJI_TWO_TEAM} ${body}`,
    authorId: 'claude',
    franchiseIds: [winner.seller, winner.buyer],
    league: LEAGUE_SLUG,
    speculation: {
      mode: 'two-team',
      seller: winner.seller,
      buyer: winner.buyer,
      marquee: { id: winner.marquee.id, name: winner.marquee.name, position: winner.marquee.position },
      returnPkg: winner.returnPkg.map((p) => ({ id: p.id, name: p.name, position: p.position })),
      score: winner.score,
      capRelief: winner.capRelief,
    },
  };
  return {
    post,
    ledgerEntry: {
      postedAt: now.getTime(),
      postId: post.id,
      signature: winner.signature,
      franchiseIds: [winner.seller, winner.buyer],
      cadenceTag,
      mode: 'two-team',
    },
  };
}

/**
 * Three-team Monday blockbuster lane (Phase 3). Finds the single best A→B→C→A
 * cycle in the league that isn't in rotation cooldown. Two cooldowns apply:
 *   - Same exact cycle (canonical signature) within the last 30 days → skip.
 *   - All three franchises featured in the last 7 days → skip (spread coverage).
 *
 * Note: the franchise rotation gate is more permissive than the two-team gate,
 * which requires only TWO of the franchises to be in cooldown to skip. Three
 * franchises all being in rotation is rarer, so we hold the bar at "all three"
 * to keep the Monday lane from going dark for weeks at a time.
 */
async function buildThreeTeamPost({
  playersByFranchise,
  tradeBaitByFranchise,
  adpRankById,
  teams,
  ledger,
  now,
  cadenceTag,
}) {
  const cycle = findThreeTeamCandidate({
    playersByFranchise,
    tradeBaitByFranchise,
    adpRankById,
    teams,
  });
  if (!cycle) {
    log('  [three-team] No 3-cycle found — exiting');
    return null;
  }

  const signature = threeTeamTradeSignature({
    a: cycle.a,
    b: cycle.b,
    c: cycle.c,
    fromAIds: [cycle.pieces.fromA.id],
    fromBIds: [cycle.pieces.fromB.id],
    fromCIds: [cycle.pieces.fromC.id],
  });
  if (recentlyPostedTrade(ledger, signature, now)) {
    log('  [three-team] Same cycle posted in the last 30 days — exiting');
    return null;
  }
  const allInRotation =
    franchiseInRecentRotation(ledger, cycle.a, now) &&
    franchiseInRecentRotation(ledger, cycle.b, now) &&
    franchiseInRecentRotation(ledger, cycle.c, now);
  if (allInRotation) {
    log('  [three-team] All three franchises in 7d rotation cooldown — exiting');
    return null;
  }

  const teamA = teams.get(cycle.a);
  const teamB = teams.get(cycle.b);
  const teamC = teams.get(cycle.c);
  const names = {
    a: teamA?.nameMedium ?? `Franchise ${cycle.a}`,
    b: teamB?.nameMedium ?? `Franchise ${cycle.b}`,
    c: teamC?.nameMedium ?? `Franchise ${cycle.c}`,
  };
  log(
    `  [three-team] Cycle (score=${cycle.score}): ${names.a} → ${names.b} → ${names.c} → ${names.a}`,
  );

  const blurbInput = { pieces: cycle.pieces, names };
  let body = await generateThreeTeamBlurbWithClaude(blurbInput);
  if (!body) body = templateThreeTeamBlurb(blurbInput);
  const post = {
    id: generatePostId(),
    timestamp: now.toISOString(),
    type: SPECULATION_POST_TYPE,
    transactionSubType: SPECULATION_SUB_TYPE_THREE_TEAM,
    tier: SPECULATION_POST_TIER,
    headline: 'Schefter speculating…',
    body: body.startsWith(TIER_EMOJI_THREE_TEAM) ? body : `${TIER_EMOJI_THREE_TEAM} ${body}`,
    authorId: 'claude',
    franchiseIds: [cycle.a, cycle.b, cycle.c],
    league: LEAGUE_SLUG,
    speculation: {
      mode: 'three-team',
      cycle: { a: cycle.a, b: cycle.b, c: cycle.c },
      pieces: {
        fromA: { id: cycle.pieces.fromA.id, name: cycle.pieces.fromA.name, position: cycle.pieces.fromA.position },
        fromB: { id: cycle.pieces.fromB.id, name: cycle.pieces.fromB.name, position: cycle.pieces.fromB.position },
        fromC: { id: cycle.pieces.fromC.id, name: cycle.pieces.fromC.name, position: cycle.pieces.fromC.position },
      },
      score: cycle.score,
    },
  };
  return {
    post,
    ledgerEntry: {
      postedAt: now.getTime(),
      postId: post.id,
      signature,
      franchiseIds: [cycle.a, cycle.b, cycle.c],
      cadenceTag,
      mode: 'three-team',
    },
  };
}

// ── Main ──

async function main() {
  log(`\n=== Schefter Trade Speculation [${MODE}] ${DRY_RUN ? '[DRY RUN]' : ''} ===`);
  const now = new Date();
  log(`  Timestamp: ${now.toISOString()}`);

  if (isQuietHours(now)) {
    log(`  Quiet hours (PT ${getPtHour(now)}:00) — exiting`);
    return 0;
  }

  // 1. Resolve calendar cadence.
  const events = await loadResolvedEvents();
  const cadence = resolveCadence({ events, now });
  log(`  Cadence: ${cadence.tag} (maxPerDay=${cadence.maxPerDay}, reservesGlobalSlot=${cadence.reservesGlobalSlot})`);
  if (cadence.maxPerDay === 0) {
    log('  Cadence quota = 0 — exiting');
    return 0;
  }

  // 2. Lane permission check (against the local rotation ledger).
  const ledgerPath = defaultLedgerPath(projectRoot);
  const ledger = await loadLedger(ledgerPath);
  const laneToday = ledgerPostsToday(ledger, now);
  const laneLast = ledgerLastPostAt(ledger);
  const lanePermit = permitsPost({ cadence, postsTodayInLane: laneToday, lastPostAt: laneLast, now });
  if (!lanePermit.allowed) {
    log(`  Lane gate blocked: ${lanePermit.reason} — exiting`);
    return 0;
  }

  // 3. Global daily-budget gate — share the rumor-mill's `posts_today`
  // counter and last-post timestamp so all Schefter-voiced posts honor
  // a single 3-per-day cap and a 4-hour spacing rule. Redis is required
  // in live mode (getRedis throws if creds are missing); dry-run runs
  // unmetered.
  const redis = await getRedis({ required: !DRY_RUN });
  let globalPostsToday = 0;
  let lastPostTs = null;
  if (redis) {
    const rawCount = await redis.get(RUMOR_POSTS_TODAY_KEY);
    globalPostsToday = typeof rawCount === 'number' ? rawCount : parseInt(rawCount ?? '0', 10) || 0;
    const rawLast = await redis.get(RUMOR_LAST_POST_TS_KEY);
    lastPostTs = typeof rawLast === 'number' ? rawLast : parseInt(rawLast ?? '0', 10) || null;
  }
  const budgetGate = checkGlobalBudgetGate({ cadence, globalPostsToday, lastPostTs, now });
  if (!budgetGate.allowed) {
    log(`  Global budget gate blocked: ${budgetGate.reason} — exiting`);
    return 0;
  }
  log(`  Global budget OK (posts_today=${globalPostsToday}, ceiling=${budgetGate.ceiling})`);

  // 4. Load league state.
  const season = detectCurrentSeason(now);
  const teams = await loadTeams();
  const playersByFranchise = await loadEnrichedSalaries(season);
  const adpRankById = await loadAdpRanks(season);
  const tradeBaitByFranchise = await loadTradeBaitByFranchise(season);

  if (!tradeBaitByFranchise || tradeBaitByFranchise.size === 0) {
    log('  No tradeBait-by-franchise.json (run scripts/fetch-trade-bait.mjs first) — exiting');
    return 0;
  }
  if (playersByFranchise.size === 0) {
    log('  Enriched salary feed empty — exiting');
    return 0;
  }

  // 5/6/7. Mode-specific candidate selection + post construction.
  // Each branch returns { post, ledgerEntry } or null when nothing publishable
  // came out of its lane. Steps 8/9/10 (persist + counter + GroupMe) are
  // shared.
  const built =
    MODE === 'three-team'
      ? await buildThreeTeamPost({
          playersByFranchise,
          tradeBaitByFranchise,
          adpRankById,
          teams,
          ledger,
          now,
          cadenceTag: cadence.tag,
        })
      : await buildTwoTeamPost({
          playersByFranchise,
          tradeBaitByFranchise,
          adpRankById,
          teams,
          ledger,
          now,
          cadenceTag: cadence.tag,
        });
  if (!built) return 0;
  const { post, ledgerEntry } = built;

  if (DRY_RUN) {
    log('\n  [dry-run] Would append to feed:');
    log(JSON.stringify(post, null, 2));
    log('\n  [dry-run] Would append to speculation history:', ledgerEntry.signature);
    await postSpeculationToGroupMe({
      post,
      publicBaseUrl: PUBLIC_BASE_URL,
      dryRun: true,
      log,
      warn,
    });
    return 0;
  }

  // 8. Persist feed + ledger.
  const feed = await loadFeed();
  feed.posts = [post, ...(feed.posts ?? [])];
  feed.lastScanTimestamp = now.toISOString();
  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
  log('  Appended to schefter-feed.json');

  const updatedLedger = appendEntry(ledger, ledgerEntry);
  await saveLedger(ledgerPath, updatedLedger, { now });
  log('  Appended to speculation-history.json');

  // 9. Increment shared global counter (so rumor-mill respects this slot).
  if (redis) {
    try {
      const newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
      if (newCount === 1) {
        await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
      }
      await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());
      await redis.expire(RUMOR_LAST_POST_TS_KEY, secondsUntilPtMidnight(now));
      log(`  posts_today incremented → ${newCount}`);
    } catch (err) {
      warn(`  [speculation] Redis counter update failed: ${err.message}`);
    }
  }

  // 10. GroupMe — Phase 2. Best-effort: feed + ledger + counter are already
  // persisted, so a GroupMe failure must not throw. The helper swallows all
  // errors and returns a status object we can log.
  await postSpeculationToGroupMe({
    post,
    publicBaseUrl: PUBLIC_BASE_URL,
    log,
    warn,
  });

  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
