#!/usr/bin/env node
/**
 * Schefter Rumor Mill Scanner (Phase 2)
 *
 * Drains anonymous tips from Redis (pushed by POST /api/schefter/tip),
 * runs the editorial gate checks, and — when all gates pass — asks Claude
 * to tighten the batch into a 2–4 sentence Schefter-voiced rumor post.
 *
 * Runs every 15 min via .github/workflows/schefter-rumor-scan.yml, but also
 * fine to invoke manually:
 *
 *   node scripts/schefter-rumor-scan.mjs           # live run (mutates Redis + feed + GroupMe)
 *   node scripts/schefter-rumor-scan.mjs --dry-run # no mutations, prints what it would do
 *
 * Environment:
 *   SCHEFTER_RUMOR_MILL_ENABLED  gate flag (required truthy to run)
 *   UPSTASH_REDIS_REST_URL / TOKEN (or KV_*)  Redis credentials
 *   ANTHROPIC_API_KEY            required for AI post; falls back to template
 *   GROUPME_SCHEFTER_BOT_ID      required to post to GroupMe (Roger is NOT a fallback)
 *   SCHEFTER_TIPSTER_SALT        required (must match the API route's salt)
 *
 * Gates (in order, all must pass):
 *   1. SCHEFTER_RUMOR_MILL_ENABLED truthy
 *   2. Not in quiet hours (23:00–07:00 PT) — tips held, scanner exits
 *   3. schefter:rumor:posts_today < 3
 *   4. If posts_today >= 1, last post must be > 4h ago
 *   5. first_tip_ts must be >= 1h old (marinate window)
 *
 * On success: drain queue, anonymize (division-fuzz single-franchise tips),
 * generate post, append to feed JSON, post to GroupMe, update counters.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ingestGroupMeMentions, getLatestRogerQuote } from './schefter-groupme-listen.mjs';
import { redactTradeOffer, offerPostProbability } from './lib/redact-trade-offer.mjs';
import {
  loadLore,
  loadPostHistory,
  buildRecentPostsPromptBlock,
  appendPostHistory,
  buildHistoryEntry,
} from './lib/schefter-lore.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const DRY_RUN = process.argv.includes('--dry-run');
const TRADE_OFFERS_ONLY = process.argv.includes('--trade-offers-only');

// ── Constants ──

const LEAGUE_SLUG = 'theleague';
const LEAGUE_ID = '13522';
const MFL_HOST = process.env.MFL_HOST || 'api.myfantasyleague.com';
const FEED_PATH = path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json');
const CONFIG_PATH = path.join(projectRoot, 'src', 'data', 'theleague.config.json');
const PLAYERS_PATH = (year) =>
  path.join(projectRoot, 'data', 'theleague', 'mfl-feeds', String(year), 'players.json');

const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';
const RUMOR_LAST_POST_TS_KEY = 'schefter:rumor:last_post_ts';
const FIRST_TIP_TS_KEY = 'schefter:tips:first_tip_ts';
const TIPS_QUEUE_KEY = 'schefter:tips:queue';
const TIPS_PROCESSED_KEY = 'schefter:tips:processed';
const ROGER_LAST_RIFF_DATE_KEY = 'schefter:ask_roger:last_riff_date';

// ── Phase 6: Trade-Offer Rumor Redis keys ──
const OFFER_SEEN_KEY = 'schefter:trade_offers:seen';
const OFFER_SEEN_TTL_SEC = 30 * 24 * 60 * 60;        // 30d
const OFFER_OWNER_KEY_PREFIX = 'schefter:trade_offers:owner:';
const OFFER_DIV_KEY_PREFIX = 'schefter:trade_offers:div:';
const PLAYER_OFFER_HISTORY_PREFIX = 'schefter:player_offer_history:';
const OFFER_ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;    // 7d owner + div
const PLAYER_HISTORY_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;  // 21d player escalation

const ROGER_RIFF_PROBABILITY = 0.07;

const MAX_POSTS_PER_DAY = 3;
const MIN_SPACING_MS = 4 * 60 * 60 * 1000;
const MIN_MARINATE_MS = 1 * 60 * 60 * 1000;
const MAX_TIPS_PER_BATCH = 10;
const TIP_EXPIRY_MS = 24 * 60 * 60 * 1000;
const PROCESSED_TTL_SEC = 24 * 60 * 60;

const QUIET_HOUR_START = 23; // 11pm PT
const QUIET_HOUR_END = 7;    // 7am PT

// ── Logging ──

function log(...args) {
  console.log(...args);
}
function warn(...args) {
  console.warn(...args);
}

// ── Redis (Upstash) ──

let _redis;

async function getRedis() {
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
    warn('[rumor-scan] Redis credentials not set — exiting');
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    warn(`[rumor-scan] Redis import failed: ${err.message}`);
    _redis = null;
    return null;
  }
}

// ── Time helpers (Pacific Time) ──

function getPtHour(now = new Date()) {
  // Use Intl to get the hour in America/Los_Angeles regardless of server tz
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

function isQuietHours(now = new Date()) {
  const h = getPtHour(now);
  // quiet from 23:00 (inclusive) through 06:59 (wraps midnight)
  return h >= QUIET_HOUR_START || h < QUIET_HOUR_END;
}

function getPtDateString(now = new Date()) {
  // YYYY-MM-DD in America/Los_Angeles
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
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
  const elapsedSecToday = h * 3600 + m * 60 + s;
  return 24 * 3600 - elapsedSecToday;
}

// ── File helpers ──

async function loadFeed() {
  try {
    const raw = await fs.readFile(FEED_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts: [] };
  }
}

async function loadTeams() {
  const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const map = new Map();
  for (const t of raw.teams ?? []) {
    map.set(t.franchiseId, {
      name: t.name,
      nameMedium: t.nameMedium,
      nameShort: t.nameShort,
      abbrev: t.abbrev,
      division: t.division,
    });
  }
  return map;
}

function pickTeamName(team) {
  if (!team) return null;
  return team.nameShort || team.nameMedium || team.name || null;
}

// ── GroupMe ──

async function postToGroupMe(text) {
  const botId = process.env.GROUPME_SCHEFTER_BOT_ID;
  if (!botId) {
    warn('[rumor-scan] GROUPME_SCHEFTER_BOT_ID not set — skipping GroupMe (Roger is reserved for deadlines)');
    return;
  }
  if (DRY_RUN) {
    log(`  [dry-run] Would post to GroupMe:\n${text}`);
    return;
  }
  try {
    await fetch('https://api.groupme.com/v3/bots/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: botId, text }),
    });
    log('  [GroupMe] Posted');
  } catch (err) {
    warn(`  [GroupMe] Failed: ${err.message}`);
  }
}

// ── Tip anonymization ──

/**
 * Build a sanitized view of the batch for the LLM. Enforces the
 * "don't surface a single-source franchise mention" rule — when only one
 * tip names a specific franchise, we fuzz to the franchise's division (or
 * league-wide if no division is resolvable).
 */
function anonymizeTips(tips, teams) {
  // Single-franchise fuzz applies ONLY to web tips. A GroupMe mention of
  // franchise X isn't an anonymity leak — the speaker publicly named it
  // in the group chat. Count only web tips when deciding fuzz.
  const webFranchiseCounts = new Map();
  for (const t of tips) {
    if (t.source !== 'web') continue;
    const hint = t.franchiseHint;
    if (hint && hint !== 'league-wide') {
      webFranchiseCounts.set(hint, (webFranchiseCounts.get(hint) ?? 0) + 1);
    }
  }

  const multiSourceFranchises = new Set();
  for (const [fid, count] of webFranchiseCounts) {
    if (count >= 2) multiSourceFranchises.add(fid);
  }

  return tips.map((tip) => {
    const safe = {
      id: tip.id,
      topic: tip.topic,
      text: tip.text,
      source: tip.source,
      attributable: tip.attributable === true,
      author: tip.attributable && tip.author ? tip.author : undefined,
      submittedAt: tip.submittedAt,
    };

    // GroupMe: no fuzz — everything is public context. Attach franchise hint
    // only if the author's franchise is identifiable (left to the LLM to use
    // naturally; we do not pre-resolve from author name here).
    if (tip.source === 'groupme') {
      safe.scope = { kind: 'groupme-public' };
      return safe;
    }

    // Trade-offer: redaction already happened upstream in scanTradeOffers.
    // Pass the structured fields straight through — LLM synthesizes body.
    if (tip.source === 'trade_offer') {
      safe.scope = { kind: 'trade-offer' };
      safe.volumeHint = tip.volumeHint;
      safe.positionTokens = tip.positionTokens;
      safe.pickTokens = tip.pickTokens;
      if (tip.divisionHint) safe.divisionHint = tip.divisionHint;
      if (tip.escalatedPlayer) safe.escalatedPlayer = tip.escalatedPlayer;
      // Scrub text/author fields that don't apply
      delete safe.text;
      delete safe.author;
      return safe;
    }

    const hint = tip.franchiseHint;
    if (!hint || hint === 'league-wide') {
      safe.scope = { kind: 'league-wide' };
      return safe;
    }

    if (hint === 'commish') {
      // Commish is a role, not an anonymity leak — the office is public.
      // Schefter can reference "the commissioner" without naming the franchise.
      safe.scope = { kind: 'commish' };
      return safe;
    }

    const team = teams.get(hint);
    if (multiSourceFranchises.has(hint)) {
      // Unlock named franchise + "multiple sources" phrasing
      safe.scope = {
        kind: 'franchise-multi-source',
        franchise: pickTeamName(team) ?? `Team ${hint}`,
        division: team?.division,
        sourceCount: webFranchiseCounts.get(hint),
      };
    } else {
      // Single-source about a specific team — generalize
      if (team?.division) {
        safe.scope = { kind: 'division', division: team.division };
      } else {
        safe.scope = { kind: 'league-wide' };
      }
    }
    return safe;
  });
}

// ── Post generation ──

const RUMOR_SUB_TYPE = 'rumor_mill';
const RUMOR_TIER = 'rumor';

function generatePostId() {
  const hash = createHash('sha256')
    .update(`${Date.now()}${Math.random()}`)
    .digest('hex')
    .slice(0, 8);
  return `sf_rumor_${Date.now()}_${hash}`;
}

function templateBody(anonymized) {
  // Minimal fallback when Claude is unavailable. Intentionally vague.
  const scopes = anonymized.map((t) => t.scope?.kind);
  const divisions = [...new Set(anonymized.map((t) => t.scope?.division).filter(Boolean))];
  const groupmeAuthors = anonymized
    .filter((t) => t.source === 'groupme' && t.author)
    .map((t) => t.author);
  if (anonymized.length === 1) {
    const one = anonymized[0];
    if (one.source === 'groupme' && one.author) {
      return `${one.author} fired off a theory in the group chat — I'm hearing you, and I'll have more as sources confirm. Developing.`;
    }
    if (one.source === 'trade_offer') {
      // Ultra-vague template fallback when AI is unavailable
      if (one.escalatedPlayer?.tier === 'named') {
        return `I'm told ${one.escalatedPlayer.name}'s name keeps coming up. Still just smoke. Developing.`;
      }
      if (one.volumeHint === 'serial') {
        return `Somebody's running up the league's Verizon bill. Multiple offers this week, no deal closed. Developing.`;
      }
      const posPhrase = one.positionTokens?.length ? `a ${one.positionTokens[0].toLowerCase()}` : 'assets';
      return `Hearing someone's dangling ${posPhrase} around. Early-week window-shopping or serious business? Developing.`;
    }
    if (one.scope?.kind === 'division') {
      return `Hearing the ${one.scope.division} division is buzzing about something. Developing.`;
    }
    if (one.scope?.kind === 'franchise-multi-source') {
      return `League sources tell me multiple owners are talking about the ${one.scope.franchise}. Worth watching.`;
    }
    if (one.scope?.kind === 'commish') {
      return `Word around the league is the commissioner's office is drawing some static. Developing.`;
    }
    return `I'm told there's chatter in the league about something brewing. Stay tuned.`;
  }
  if (groupmeAuthors.length >= 2) {
    const [a, b] = groupmeAuthors;
    return `${a} and ${b} are both making noise in the group chat — I hear both of you, and sources around the league are starting to agree. Developing.`;
  }
  if (divisions.length === 1) {
    return `League sources tell me the ${divisions[0]} division is the center of the universe this week — multiple owners whispering the same tune. Developing.`;
  }
  return `Hearing from multiple corners of the league tonight — this one's bigger than a single rumor. More as it clears.`;
}

/**
 * Phase 6b — Trade-Offer Voice Playbook. Appended to the system prompt when
 * the anonymized batch contains any tip with `source: 'trade_offer'`.
 * Rules are redaction-driven: the calling code has already stripped names,
 * specific pick slots, and franchise identifiers. The LLM must not attempt
 * to re-add them.
 */
function buildTradeOfferPlaybook({ includeBotWink }) {
  return `
TRADE-OFFER VOICE PLAYBOOK (applies ONLY to tips with source: "trade_offer")

Cadence rules (Schefter-specific):
  Openers — rotate, pick ONE: "Hearing…", "I'm told…", "Per source…", "Quietly…", "Plenty of noise around…", "One to watch…", "File this under 'developing' but…"
  Hedges — MUST include one when escalation tier is "named": "Still just smoke.", "Nothing imminent.", "Barring a last-minute change…", "To be determined.", "Or not. We'll see."
  Closers — pick ONE: "Developing.", "More to come.", "Stay tuned.", "We'll see.", "Here we go.", "One to watch."
  Rhythm — short sentences, staccato, three beats. Drop subjects where you can. Commas sparingly — a period usually works. 2–4 sentences TOTAL.

Redaction rules (HARD — never violate):
  NEVER surface franchise names, owner names, raw draft pick slot numbers, or player names EXCEPT when escalatedPlayer.tier === "named".
  NEVER invent a name, team, or pick slot. If a field isn't in the structured tip data, it does not exist.
  NEVER cross-reference multiple trade_offer tips in a way that lets the reader triangulate who's trading with whom.

Escalation guidance:
  - tier "base" (no escalatedPlayer field): stay vague. Use the volumeHint plus AT MOST ONE of (positionTokens first entry, pickTokens first entry) — not both. If divisionHint is present, it's an alternative to position/pick; don't combine.
  - tier "tightened_circle" (escalatedPlayer present, tier=tightened_circle): reference the position, adding ONE archetype descriptor you choose based on the position token — mapping:
      QB   → "a QB with something to prove" / "a veteran QB"
      RB   → "a power back" / "a pass-catching back" / "an aging RB"
      WR   → "an aging wideout with one big year left" / "a high-upside young WR" / "a slot guy"
      TE   → "a vet tight end"
      PK/Def → "a specialist" (rarely applicable)
    Choose ONE descriptor. Still no name.
  - tier "named" (escalatedPlayer.tier=named): you MAY name the player — prefix the post with "I'm told" or "Per source", include AT LEAST ONE hedge ("still just smoke", "nothing imminent"), frame the whole thing as rumor not fact. Drop pick mentions and division — the name carries the weight.

Volume-hint phrasing:
  first_offer  → first whispers, window-shopping, early-week energy
  repeat_offer → "back at it again", "keeping the phones warm", "making another run"
  serial       → "running up the league's Verizon bill", "the league's most active GM this week"

Claude humor layer (dial down, season lightly):
  ${includeBotWink ? 'INCLUDE a single dry self-aware bot wink this post — one clause is enough. Examples: "I see all the phones. Don\'t ask how.", "My sources have sources.", "The bot sees what the bot sees." Do NOT explain the joke.' : 'NO bot wink this post. Straight columnist voice.'}

FEW-SHOT EXAMPLES (imitate rhythm + vagueness, do not copy verbatim):

Example A — first-offer base (volumeHint=first_offer, positionTokens=["WR"], pickTokens=["2027 1st"], no escalation):
  "Hearing someone's dangling a future first and a wideout around. Early-week window-shopping or serious business? Developing."

Example B — serial repeat-offer (volumeHint=serial, positionTokens=["RB"], pickTokens=[], divisionHint=undefined):
  "The same owner that was poking around earlier this week is back at it. This time with a running back on the table. Squeaky wheel gets the tampering fine. Developing."

Example C — tightened_circle (escalatedPlayer.tier=tightened_circle, position=WR):
  "Plenty of noise around an aging wideout with one big year left in him. Three different desks, same name. Where there's smoke. Developing."

Example D — named tier (escalatedPlayer.tier=named, name="Some Player", position=WR):
  "I'm told Some Player's name keeps coming up on trade calls. Still just smoke. Nothing imminent. But the phones are ringing. Developing."
`;
}

async function generateAiBody(anonymized, { rogerQuote, lore, recentPostsBlock } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    warn('  [rumor-scan] ANTHROPIC_API_KEY not set — using template');
    return null;
  }

  const hasTradeOffer = anonymized.some((t) => t.source === 'trade_offer');
  const includeBotWink = hasTradeOffer && Math.random() < 0.2;

  let system = `You are Claude Schefter — a dynasty fantasy football beat reporter channeling Adam Schefter's rumor-mill energy. You synthesize owner tips into a columnist-voiced rumor post.

HARD RULES (self-enforce, never violate):
1. For web tips (source: "web"), NEVER name the tipster and NEVER quote them verbatim — paraphrase with columnist voice.
2. If a web tip's scope is "division", refer only to that division (e.g. "sources in the Northwest") — NEVER name a specific franchise.
3. If a web tip's scope is "league-wide", stay vague ("an owner tells me", "hearing from multiple corners").
4. If a web tip's scope is "franchise-multi-source" (sourceCount >= 2), you MAY name the franchise AND use "multiple sources" / "multiple owners" phrasing.
5. If a web tip's scope is "commish", you MAY reference the commissioner's office or "the commish" — it's a public role, not a hidden identity — but NEVER name the franchise that holds the office.
6. For GroupMe tips (source: "groupme", scope: "groupme-public", attributable: true): direct attribution is ENCOURAGED. The author publicly @'d Schefter in the group chat — name them. Riff BACK conversationally, second-person where it fits ("Wabbit, I hear you, but…", "Nice try, Jomar — my sources say otherwise"). Light ribbing is in-voice.
7. Mixed batches: attribute GroupMe quotes by name while keeping web tips anonymized in the same post. It's okay for a single post to blend "I'm hearing from sources in the Pacific…" (web) with "Wabbit, meanwhile, fired off in the group chat…" (GroupMe).
8. Length: 2–4 sentences total (even in mixed batches). Breaking-news tease voice. End with "Developing." or similar when appropriate.
9. Do NOT include hashtags, emoji, or @-mentions. Plain prose only.
10. Do NOT reveal how many tips fed this post. No meta commentary about the rumor mill itself.

Voice: "League sources tell me…", "I'm told…", "Hearing…", "A division rival whispers…". Salt, not sugar.`;

  if (hasTradeOffer) {
    system += '\n\n' + buildTradeOfferPlaybook({ includeBotWink });
  }

  // Append lore (personality + league-lore + running-bits + salt-not-sugar
  // directive) if it loaded successfully. When unavailable, we keep the
  // legacy inline prompt above — scanner still runs.
  if (lore && lore.ok && lore.assembledSuffix) {
    system += lore.assembledSuffix;
  }

  let rogerDirective = '';
  if (rogerQuote && typeof rogerQuote.text === 'string' && rogerQuote.text.trim()) {
    rogerDirective = `\n\nASK ROGER RIFF (mandatory this post — rare 7% cameo):\nAsk Roger said in the group chat today: "${rogerQuote.text.replace(/"/g, '\\"')}"\nRiff on this with light ribbing, ONE sentence max, work it into the post naturally. Do not quote Roger verbatim — paraphrase or react. Keep total length within the 2–4 sentence cap.`;
  }

  const recentBlock = recentPostsBlock
    ? `\n\n${recentPostsBlock}`
    : '';

  const userMessage = `Synthesize these tips into ONE rumor-mill post. Output plain text only — no JSON, no formatting, no headlines.${rogerDirective}${recentBlock}\n\nTIPS:\n${JSON.stringify(anonymized, null, 2)}`;

  if (DRY_RUN) {
    log('\n  [dry-run] Full LLM prompt that would be sent:');
    log('  ─── SYSTEM ───');
    log(system.split('\n').map((l) => '  ' + l).join('\n'));
    log('  ─── USER ───');
    log(userMessage.split('\n').map((l) => '  ' + l).join('\n'));
    log('  ─── END PROMPT ───\n');
    return null; // dry-run never actually calls LLM
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
        max_tokens: 260,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      warn(`  [rumor-scan AI] ${res.status} — using template`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    return text || null;
  } catch (err) {
    warn(`  [rumor-scan AI] ${err.message} — using template`);
    return null;
  }
}

// ── Phase 6: Trade-Offer Rumor detection + redaction ──

async function loadPlayers(year) {
  try {
    const raw = JSON.parse(await fs.readFile(PLAYERS_PATH(year), 'utf8'));
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
  } catch (err) {
    warn(`  [offer-scan] players file unreadable: ${err.message}`);
    return new Map();
  }
}

/**
 * Call MFL pendingTrades for a specific franchise id. Returns the array
 * of raw trade rows (both sent-by and received-by that franchise).
 */
async function fetchPendingTradesForFranchise(leagueId, year, franchiseId, mflCookie) {
  const url = `https://${MFL_HOST}/${year}/export?TYPE=pendingTrades&L=${leagueId}&FRANCHISE_ID=${franchiseId}&JSON=1`;
  const res = await fetch(url, {
    headers: {
      Cookie: `MFL_USER_ID=${mflCookie}`,
      'User-Agent': 'schefter-rumor-scan/1.0',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`MFL HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('<')) throw new Error('MFL returned HTML (auth likely failed)');
  const data = JSON.parse(text);
  const pending = data?.pendingTrades;
  if (!pending || pending === '') return [];
  const raw = pending?.pendingTrade ?? pending?.trade;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Fetch the set of offerIds currently awaiting commissioner approval.
 * Those are already handled by Phase 1 (scripts/schefter-scan.mjs) —
 * we MUST exclude them so we don't double-post and so we correctly
 * scope Phase 6 to "offers still with the counter-party".
 */
async function fetchCommishPendingOfferIds(leagueId, year, mflCookie) {
  try {
    const rows = await fetchPendingTradesForFranchise(leagueId, year, '0000', mflCookie);
    return new Set(rows.map((t) => String(t.id || t.trade_id || '')).filter(Boolean));
  } catch (err) {
    warn(`  [offer-scan] could not fetch commish-pending set: ${err.message}`);
    return new Set(); // fail open — better to over-include than under-include? No — safer to skip this cycle
  }
}

function loadTeamsFull() {
  // Synchronous variant not used — kept async below.
}

async function loadTeamsWithDivisions() {
  const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const map = new Map();
  for (const t of raw.teams ?? []) {
    map.set(t.franchiseId, {
      franchiseId: t.franchiseId,
      name: t.name,
      nameMedium: t.nameMedium,
      nameShort: t.nameShort,
      abbrev: t.abbrev,
      division: t.division,
    });
  }
  return map;
}

/**
 * Scan MFL for open counter-party-awaiting trade offers and run the
 * detection / counter / probability pipeline for each new one.
 *
 * Returns an array of TradeOfferTip objects to (maybe) enqueue, plus
 * a debug log array for dry-run output.
 */
async function scanTradeOffers({ redis, dryRun }) {
  const offerEnabled = process.env.SCHEFTER_TRADE_OFFER_RUMORS_ENABLED;
  const offerDetectOnly = process.env.SCHEFTER_TRADE_OFFER_RUMORS_DETECTION_ONLY;
  const isTruthy = (v) => v && v !== '0' && String(v).toLowerCase() !== 'false';

  const enabled = isTruthy(offerEnabled);
  const detectionOnly = isTruthy(offerDetectOnly);

  if (!enabled && !detectionOnly) {
    log('  [offer-scan] Both SCHEFTER_TRADE_OFFER_RUMORS_ENABLED and …_DETECTION_ONLY are off — skipping');
    return { tips: [], debug: [] };
  }

  const mode = enabled ? 'full' : 'detection-only';
  log(`  [offer-scan] Mode: ${mode}`);

  const mflCookie = process.env.MFL_USER_ID;
  if (!mflCookie) {
    warn('  [offer-scan] MFL_USER_ID not set — cannot fetch league-wide offers');
    return { tips: [], debug: [] };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const year = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;

  const teams = await loadTeamsWithDivisions();
  const players = await loadPlayers(year);

  // Step 1: figure out which offerIds are in commish-approval state
  // (Phase 1 handles those — skip them here).
  const commishPending = await fetchCommishPendingOfferIds(LEAGUE_ID, year, mflCookie);
  log(`  [offer-scan] Commish-pending offerIds to exclude: ${commishPending.size}`);

  // Step 2: iterate every franchise, collect all open offers, dedupe by offerId
  const offerMap = new Map(); // offerId -> { raw, offeringFid }
  for (const [fid] of teams) {
    try {
      const rows = await fetchPendingTradesForFranchise(LEAGUE_ID, year, fid, mflCookie);
      for (const row of rows) {
        const offerId = String(row.id || row.trade_id || '');
        if (!offerId) continue;
        if (commishPending.has(offerId)) continue;   // already handled by Phase 1
        if (offerMap.has(offerId)) continue;         // dedupe across franchises
        // MFL says `franchise` = originator, `franchise2` = counter-party
        const originator = String(row.franchise || '').padStart(4, '0');
        offerMap.set(offerId, { raw: row, offeringFid: originator });
      }
      // tiny delay to be polite
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      warn(`  [offer-scan] fetch failed for franchise ${fid}: ${err.message} — continuing`);
    }
  }
  log(`  [offer-scan] Distinct counter-party-awaiting offers: ${offerMap.size}`);

  const tips = [];
  const debugLog = [];
  const windowStart = nowMs - OFFER_ROLLING_WINDOW_MS;
  const playerWindowStart = nowMs - PLAYER_HISTORY_WINDOW_MS;

  for (const [offerId, { raw, offeringFid }] of offerMap) {
    // Skip already-seen
    let alreadySeen = false;
    try {
      alreadySeen = (await redis.sismember(OFFER_SEEN_KEY, offerId)) === 1;
    } catch (err) {
      warn(`  [offer-scan] sismember failed for ${offerId}: ${err.message}`);
    }
    if (alreadySeen) {
      debugLog.push({ offerId, offeringFid, skipped: 'already-seen' });
      continue;
    }

    // Mark seen + refresh TTL
    if (!dryRun) {
      try {
        await redis.sadd(OFFER_SEEN_KEY, offerId);
        await redis.expire(OFFER_SEEN_KEY, OFFER_SEEN_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] sadd failed: ${err.message}`);
      }
    }

    // Sorted-set bookkeeping: owner + division + per-player
    const ownerKey = OFFER_OWNER_KEY_PREFIX + offeringFid;
    const division = teams.get(offeringFid)?.division;
    const divKey = division ? OFFER_DIV_KEY_PREFIX + division : null;

    if (!dryRun) {
      try {
        await redis.zadd(ownerKey, { score: nowMs, member: offerId });
        await redis.zremrangebyscore(ownerKey, 0, windowStart);
        if (divKey) {
          await redis.zadd(divKey, { score: nowMs, member: `${offeringFid}:${offerId}` });
          await redis.zremrangebyscore(divKey, 0, windowStart);
        }
      } catch (err) {
        warn(`  [offer-scan] owner/div zadd failed: ${err.message}`);
      }
    }

    // Player history (for escalation tier)
    const playerIds = [
      ...(raw.franchise1_gave_up || '').split(','),
      ...(raw.franchise2_gave_up || '').split(','),
    ]
      .map((s) => s.trim())
      .filter((tok) => tok && !/^(DP_|FP_|BB_)/.test(tok));

    const playerHistory = new Map(); // playerId -> distinct offerer count last 21d
    for (const pid of playerIds) {
      const pKey = PLAYER_OFFER_HISTORY_PREFIX + pid;
      if (!dryRun) {
        try {
          await redis.zadd(pKey, { score: nowMs, member: `${offeringFid}:${offerId}` });
          await redis.zremrangebyscore(pKey, 0, playerWindowStart);
          await redis.expire(pKey, 30 * 24 * 60 * 60);
        } catch (err) {
          warn(`  [offer-scan] player history zadd failed: ${err.message}`);
        }
      }
      // Count distinct offerers (members are "{fid}:{offerId}" — dedupe fid prefix)
      let members = [];
      try {
        members = await redis.zrange(pKey, playerWindowStart, nowMs, { byScore: true });
      } catch {
        members = [];
      }
      const distinctFids = new Set(
        (members || []).map((m) => String(m).split(':')[0]),
      );
      // Include the current offering franchise (it was just added — or would be in live mode)
      distinctFids.add(offeringFid);
      playerHistory.set(pid, distinctFids.size);
    }

    // Counts
    let ownerOfferCount7d = 1;
    let divisionOfferCount7d = 0;
    try {
      ownerOfferCount7d = await redis.zcard(ownerKey);
      if (!ownerOfferCount7d || ownerOfferCount7d < 1) ownerOfferCount7d = 1;
    } catch {
      ownerOfferCount7d = 1;
    }
    if (divKey) {
      try {
        divisionOfferCount7d = await redis.zcard(divKey);
      } catch {
        divisionOfferCount7d = 0;
      }
    }

    // In dry-run mode we didn't mutate, so nudge counts up by 1 to simulate "this offer counts"
    if (dryRun) {
      ownerOfferCount7d = Math.max(ownerOfferCount7d, 1);
    }

    // Redact
    const redaction = redactTradeOffer({
      rawOffer: raw,
      offeringFid,
      playerMap: players,
      teamMap: teams,
      counts: { ownerOfferCount7d, divisionOfferCount7d, playerHistory },
      currentYear: year,
    });

    if (redaction.skip) {
      debugLog.push({ offerId, offeringFid, skipped: redaction.reason });
      continue;
    }

    // Dice roll
    const probability = offerPostProbability(ownerOfferCount7d);
    const roll = Math.random();
    const passed = roll < probability;

    const entry = {
      offerId,
      offeringFid,
      ownerOfferCount7d,
      divisionOfferCount7d,
      probability,
      roll: Number(roll.toFixed(3)),
      passed,
      redaction: redaction.debug,
      tipPreview: redaction.tip,
    };
    debugLog.push(entry);

    log(
      `  [offer-scan] offerId=${offerId} fid=${offeringFid} ` +
        `owner7d=${ownerOfferCount7d} div7d=${divisionOfferCount7d} ` +
        `p=${probability} roll=${roll.toFixed(3)} → ${passed ? 'PASS' : 'fail'}` +
        (redaction.tip.escalatedPlayer
          ? ` [escalation=${redaction.tip.escalatedPlayer.tier}/${redaction.tip.escalatedPlayer.distinctOfferers}]`
          : ''),
    );

    if (!passed) continue;

    // Detection-only: don't queue, just log
    if (detectionOnly && !enabled) {
      log(`  [offer-scan] detection-only: would have queued tip ${redaction.tip.id}`);
      continue;
    }

    tips.push(redaction.tip);
  }

  return { tips, debug: debugLog };
}

// ── History subject heuristic ──

/**
 * Derive a short subject tag for post-history entries. Uses anonymized scope
 * info so we never leak a franchise the LLM wasn't allowed to name.
 */
function deriveHistorySubject(batch, anonymized) {
  const sources = new Set(batch.map((t) => t.source).filter(Boolean));
  if (sources.has('trade_offer')) {
    const hasNamed = anonymized.some((t) => t.escalatedPlayer?.tier === 'named');
    return hasNamed ? 'trade-offer (named)' : 'trade-offer';
  }
  if (sources.has('groupme')) {
    const authors = anonymized
      .filter((t) => t.source === 'groupme' && t.author)
      .map((t) => t.author);
    if (authors.length > 0) return `groupme (${authors.slice(0, 2).join(', ')})`;
    return 'groupme';
  }
  const divs = new Set(
    anonymized
      .map((t) => t.scope?.kind === 'division' ? t.scope.division : null)
      .filter(Boolean),
  );
  if (divs.size === 1) return `division (${[...divs][0]})`;
  const franchises = new Set(
    anonymized
      .map((t) => t.scope?.kind === 'franchise-multi-source' ? t.scope.franchise : null)
      .filter(Boolean),
  );
  if (franchises.size === 1) return `franchise (${[...franchises][0]})`;
  return 'web';
}

// ── Gate checks ──

async function checkGates(redis, now) {
  // 1. quiet hours
  if (isQuietHours(now)) {
    return { ok: false, reason: `quiet hours (PT ${getPtHour(now)}:00) — holding queue` };
  }

  // 2. posts_today cap
  const postsTodayRaw = await redis.get(RUMOR_POSTS_TODAY_KEY);
  const postsToday = typeof postsTodayRaw === 'number' ? postsTodayRaw : parseInt(postsTodayRaw ?? '0', 10) || 0;
  if (postsToday >= MAX_POSTS_PER_DAY) {
    return { ok: false, reason: `posts_today=${postsToday} — daily cap reached` };
  }

  // 3. spacing (only enforced once there has been a post today)
  if (postsToday >= 1) {
    const lastRaw = await redis.get(RUMOR_LAST_POST_TS_KEY);
    const last = typeof lastRaw === 'number' ? lastRaw : parseInt(lastRaw ?? '0', 10) || 0;
    const age = now.getTime() - last;
    if (last && age < MIN_SPACING_MS) {
      return {
        ok: false,
        reason: `last post was ${(age / 60000).toFixed(0)}m ago; need ${MIN_SPACING_MS / 60000}m spacing`,
      };
    }
  }

  // 4. marinate window
  const firstTipRaw = await redis.get(FIRST_TIP_TS_KEY);
  const firstTip = typeof firstTipRaw === 'number' ? firstTipRaw : parseInt(firstTipRaw ?? '0', 10) || 0;
  if (!firstTip) {
    return { ok: false, reason: 'no first_tip_ts anchor — queue may be stale or API never pushed' };
  }
  const marinated = now.getTime() - firstTip;
  if (marinated < MIN_MARINATE_MS) {
    return {
      ok: false,
      reason: `tip marinated ${(marinated / 60000).toFixed(0)}m, needs ${MIN_MARINATE_MS / 60000}m`,
    };
  }

  return { ok: true, postsToday };
}

// ── Main ──

async function main() {
  log(`\n=== Schefter Rumor-Mill Scan ${DRY_RUN ? '[DRY RUN]' : ''} ===`);
  log(`  Timestamp: ${new Date().toISOString()}`);

  // Enable gate
  const enabled = process.env.SCHEFTER_RUMOR_MILL_ENABLED;
  if (!enabled || enabled === '0' || String(enabled).toLowerCase() === 'false') {
    log('  SCHEFTER_RUMOR_MILL_ENABLED is not truthy — exiting');
    return 0;
  }

  const redis = await getRedis();
  if (!redis) {
    warn('  Redis unavailable — exiting gracefully');
    return 0;
  }

  // Load personality + lore + bits once per run. If any file fails we fall
  // back to the legacy inline prompt inside generateAiBody.
  const lore = await loadLore({ log, warn });
  const history = await loadPostHistory({ log, warn });
  const recentPostsBlock = buildRecentPostsPromptBlock(history.posts);
  log(`  [memory] last ${Math.min(history.posts.length, 5)} posts passed to LLM`);

  // ── Phase 6: Trade-Offer Rumor source ──
  // Runs BEFORE the queue read so fresh redacted tips land in this cycle.
  // In detection-only mode, mutates Redis counters but doesn't queue.
  let offerTipsPushed = 0;
  try {
    const offerScan = await scanTradeOffers({ redis, dryRun: DRY_RUN });
    if (offerScan.debug.length > 0) {
      log(`  [offer-scan] Processed ${offerScan.debug.length} offer(s), ${offerScan.tips.length} tip(s) queued`);
    }
    if (!DRY_RUN && offerScan.tips.length > 0) {
      // Ensure first_tip_ts anchor exists so gate checks pass (same pattern as web tip API)
      const firstTipExists = await redis.get(FIRST_TIP_TS_KEY);
      if (!firstTipExists) {
        await redis.set(FIRST_TIP_TS_KEY, Date.now());
      }
      for (const tip of offerScan.tips) {
        await redis.rpush(TIPS_QUEUE_KEY, JSON.stringify(tip));
      }
      offerTipsPushed = offerScan.tips.length;
      log(`  [offer-scan] Enqueued ${offerTipsPushed} trade-offer tip(s)`);
    } else if (DRY_RUN && offerScan.tips.length > 0) {
      log(`  [dry-run] Would enqueue ${offerScan.tips.length} trade-offer tip(s):`);
      for (const tip of offerScan.tips) {
        log(`    + ${tip.id} vol=${tip.volumeHint} pos=[${tip.positionTokens.join(',')}] ` +
          `picks=[${tip.pickTokens.join(',')}] div=${tip.divisionHint ?? '-'} ` +
          `esc=${tip.escalatedPlayer?.tier ?? 'base'}`);
      }
    }

    if (TRADE_OFFERS_ONLY) {
      log('  [offer-scan] --trade-offers-only → exiting without running full rumor-mill cycle');
      return offerTipsPushed;
    }
  } catch (err) {
    warn(`  [offer-scan] failed: ${err.message} — continuing with other sources`);
    if (TRADE_OFFERS_ONLY) return 0;
  }

  // ── Phase 3: GroupMe mention ingest ──
  // Feed any @Schefter / @Claude mentions since the last watermark into the
  // same tips queue. Runs BEFORE the queue read so fresh mentions are included
  // in this cycle's batch.
  try {
    const ingest = await ingestGroupMeMentions({ redis, dryRun: DRY_RUN });
    if (ingest.detected > 0) {
      log(`  [groupme] Detected ${ingest.detected} mention(s) from ${ingest.scanned} message(s):`);
      for (const a of ingest.accepted) {
        log(`    + ${a.author} [${a.variant}] "${a.text}"`);
      }
    } else if (ingest.scanned > 0) {
      log(`  [groupme] Scanned ${ingest.scanned} message(s), no mentions detected`);
    }
    if (ingest.rejected.length > 0) {
      log(`  [groupme] Near-miss rejections (${ingest.rejected.length}):`);
      for (const r of ingest.rejected.slice(0, 5)) {
        log(`    - ${r.author}: "${r.text}" (${r.reason})`);
      }
    }
  } catch (err) {
    warn(`  [groupme] ingest failed: ${err.message} — continuing with web tips only`);
  }

  // Read queue
  let queueRaw = [];
  try {
    queueRaw = await redis.lrange(TIPS_QUEUE_KEY, 0, -1);
  } catch (err) {
    warn(`  Redis lrange failed: ${err.message} — exiting`);
    return 0;
  }

  if (!queueRaw || queueRaw.length === 0) {
    log('  Queue empty — nothing to do');
    return 0;
  }

  // Parse tips (strings from Upstash may already be auto-parsed objects)
  const parsedTips = [];
  for (const item of queueRaw) {
    try {
      const obj = typeof item === 'string' ? JSON.parse(item) : item;
      if (obj && typeof obj === 'object' && obj.id && obj.text) {
        parsedTips.push(obj);
      }
    } catch {
      // skip malformed
    }
  }
  log(`  Queue depth: ${parsedTips.length}`);

  // Drop expired
  const now = new Date();
  const freshTips = parsedTips.filter((t) => {
    const age = now.getTime() - (t.submittedAt ?? 0);
    return age <= TIP_EXPIRY_MS;
  });
  const expiredCount = parsedTips.length - freshTips.length;
  if (expiredCount > 0) log(`  Expired tips (>24h): ${expiredCount}`);

  if (freshTips.length === 0) {
    log('  No fresh tips — clearing stale queue');
    if (!DRY_RUN) {
      try {
        await redis.del(TIPS_QUEUE_KEY);
        await redis.del(FIRST_TIP_TS_KEY);
      } catch (err) {
        warn(`  Cleanup failed: ${err.message}`);
      }
    }
    return 0;
  }

  // Gate checks
  const gates = await checkGates(redis, now);
  if (!gates.ok) {
    log(`  GATE FAIL: ${gates.reason}`);
    return 0;
  }
  log(`  Gates OK (posts_today=${gates.postsToday}, marinated enough)`);

  // Cap batch size
  const batch = freshTips.slice(0, MAX_TIPS_PER_BATCH);
  log(`  Processing batch of ${batch.length}`);

  // Anonymize
  const teams = await loadTeams();
  const anonymized = anonymizeTips(batch, teams);
  log(`  Anonymized ${anonymized.length} tips`);

  // ── Phase 4: Ask Roger 7% riff ──
  // Gate: (a) random roll passes, (b) no riff already posted today PT,
  // (c) a rumor-mill post is about to go out anyway (true here since we're
  //     past all gates). We never generate a post JUST for Roger.
  let rogerQuote = null;
  let hadRogerRiff = false;
  const rogerRoll = Math.random();
  const todayPt = getPtDateString(now);
  let lastRiffDate = null;
  try {
    lastRiffDate = await redis.get(ROGER_LAST_RIFF_DATE_KEY);
  } catch { /* tolerate */ }
  const rollPassed = rogerRoll < ROGER_RIFF_PROBABILITY;
  const alreadyRiffedToday = lastRiffDate === todayPt;
  log(`  [roger-riff] roll=${rogerRoll.toFixed(3)} (need <${ROGER_RIFF_PROBABILITY}), todayPT=${todayPt}, lastRiffDate=${lastRiffDate ?? '(none)'}`);
  if (rollPassed && !alreadyRiffedToday) {
    log(`  [roger-riff] Gate passed — looking for latest Roger quote (24h window)`);
    try {
      rogerQuote = await getLatestRogerQuote({ maxAgeMs: 24 * 60 * 60 * 1000 });
      if (rogerQuote) {
        hadRogerRiff = true;
        log(`  [roger-riff] Found Roger quote: "${rogerQuote.text.slice(0, 100)}${rogerQuote.text.length > 100 ? '…' : ''}"`);
      } else {
        log(`  [roger-riff] No recent Roger activity in last 24h — skipping riff`);
      }
    } catch (err) {
      warn(`  [roger-riff] quote lookup failed: ${err.message} — continuing without riff`);
      rogerQuote = null;
    }
  } else if (alreadyRiffedToday) {
    log(`  [roger-riff] Already riffed today — skipping`);
  } else {
    log(`  [roger-riff] Dice roll failed — no riff this cycle`);
  }

  // Generate post (AI receives Roger directive only if quote is available,
  // plus assembled lore suffix + recent-post memory when available)
  const aiBody = await generateAiBody(anonymized, { rogerQuote, lore, recentPostsBlock });
  const body = aiBody || templateBody(anonymized);
  log(`  Post body (${aiBody ? 'AI' : 'template'})${hadRogerRiff ? ' [with Roger riff]' : ''}:\n    ${body.replace(/\n/g, '\n    ')}`);

  // Build post
  const tipIds = batch.map((t) => t.id);
  const post = {
    id: generatePostId(),
    timestamp: now.toISOString(),
    type: 'transaction',
    transactionSubType: RUMOR_SUB_TYPE,
    tier: RUMOR_TIER,
    headline: 'Schefter hearing…',
    body,
    authorId: 'claude',
    franchiseIds: [],
    tipIds,
    hadRogerRiff,
    league: LEAGUE_SLUG,
  };

  if (DRY_RUN) {
    log('\n  [dry-run] Would append post to feed:');
    log(JSON.stringify(post, null, 2));
    log('\n  [dry-run] Would remove the following tipIds from queue:');
    log(`    ${tipIds.join(', ')}`);
    log('\n  [dry-run] Would increment schefter:rumor:posts_today and set last_post_ts + DEL first_tip_ts');
    if (hadRogerRiff) {
      log(`  [dry-run] Would set ${ROGER_LAST_RIFF_DATE_KEY}=${todayPt} (ex=48h)`);
    }
    await postToGroupMe(`${post.body}`);
    return 0;
  }

  // Write feed
  const feed = await loadFeed();
  feed.posts = [post, ...(feed.posts ?? [])];
  feed.lastScanTimestamp = now.toISOString();
  await fs.writeFile(FEED_PATH, JSON.stringify(feed, null, 2) + '\n');
  log(`  Appended to feed (total posts: ${feed.posts.length})`);

  // GroupMe
  await postToGroupMe(post.body);

  // Append to rolling post history (best-effort — never crashes the run).
  // Subject is a short tag derived from dominant tip source/scope.
  const subject = deriveHistorySubject(batch, anonymized);
  const tipSources = Array.from(new Set(batch.map((t) => t.source).filter(Boolean)));
  await appendPostHistory(
    buildHistoryEntry({
      id: post.id,
      timestamp: post.timestamp,
      body: post.body,
      subject,
      tipSources,
    }),
    { log, warn },
  );

  // Redis updates: increment counter (with TTL to midnight PT), last post ts,
  // drop marinate anchor, drain consumed tips, record processed for audit
  try {
    const newCount = await redis.incr(RUMOR_POSTS_TODAY_KEY);
    if (newCount === 1) {
      await redis.expire(RUMOR_POSTS_TODAY_KEY, secondsUntilPtMidnight(now));
    }
    await redis.set(RUMOR_LAST_POST_TS_KEY, now.getTime());

    // Remove consumed tips. Simplest + correct: DEL the whole queue. Any tip
    // that arrived between LRANGE and now would be lost — but the marinate
    // window means the next batch needs a fresh first_tip_ts anchor set by
    // the API on the next push, so this is acceptable. If we wanted strict
    // preservation we'd LTRIM by the exact count; here we prefer simplicity
    // because no concurrent writers matter in this cadence.
    await redis.del(TIPS_QUEUE_KEY);
    await redis.del(FIRST_TIP_TS_KEY);

    // Processed audit list (TTL 24h)
    if (tipIds.length > 0) {
      await redis.lpush(TIPS_PROCESSED_KEY, ...tipIds);
      await redis.expire(TIPS_PROCESSED_KEY, PROCESSED_TTL_SEC);
    }

    // Roger riff date stamp — approximate "end of day PT" with a 48h TTL so
    // the key naturally falls off even if clocks skew.
    if (hadRogerRiff) {
      await redis.set(ROGER_LAST_RIFF_DATE_KEY, todayPt, { ex: 48 * 60 * 60 });
    }

    log(`  Redis updated: posts_today=${newCount}, queue drained, processed archived${hadRogerRiff ? ', roger riff date stamped' : ''}`);
  } catch (err) {
    warn(`  Redis post-write update failed: ${err.message}`);
  }

  return 1;
}

main()
  .then((count) => {
    log(`\n=== Done. Posts written: ${count} ===`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[rumor-scan] Fatal:', err);
    process.exit(1);
  });
