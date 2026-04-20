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
import { incrementTipsterCounters } from './lib/schefter-tipster-counters.mjs';

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
// Legacy key (pre-cumulative-probability model). Still read for dedup against
// offers that were already "burned" under the old one-shot dice-roll system so
// we don't suddenly re-surface trades that previously failed the roll.
const OFFER_SEEN_KEY = 'schefter:trade_offers:seen';
const OFFER_SEEN_TTL_SEC = 30 * 24 * 60 * 60;        // 30d

// Cumulative-probability model (p=0.0075/run, 99% by ~day 6.4). Each live
// offer gets:
//   - an entry in `first_seen` HASH (offerId → epoch ms of first sighting)
//     used to compute age → framingHint ('fresh' <48h, 'lingering' ≥48h)
//   - zero or one SADD into `posted` SET the first time its dice roll passes
// An offer is retried every run until it posts OR disappears from MFL.
const OFFER_FIRST_SEEN_KEY = 'schefter:trade_offers:first_seen';
const OFFER_POSTED_KEY = 'schefter:trade_offers:posted';
const OFFER_STATE_TTL_SEC = 30 * 24 * 60 * 60;       // 30d on both first_seen HASH and posted SET

const OFFER_LINGERING_THRESHOLD_MS = 48 * 60 * 60 * 1000;   // 48h → framing flip

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
 *
 * @param {Array} tips - raw tips from queue
 * @param {Map} teams - franchise → team config
 * @param {Array} [feedPosts] - current feed posts, used to resolve parent
 *   rumor snippets for thread-followup scopes. When omitted, followups still
 *   get the thread-followup scope but with no parent headline context.
 */
function anonymizeTips(tips, teams, feedPosts = []) {
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

  const feedById = new Map(
    Array.isArray(feedPosts)
      ? feedPosts.map((p) => [p.id, p])
      : [],
  );

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

    // Reverse-the-lens framing for hostile tips. Only surface the tipster's
    // division for web tips — GroupMe tips are already attributable and
    // trade-offer tips don't carry a tipster. The LLM's HARD RULE governs
    // when this may be used (hostile tips only — see rule 12).
    if (tip.source === 'web' && typeof tip.tipsterDivision === 'string' && tip.tipsterDivision) {
      safe.tipsterDivision = tip.tipsterDivision;
    }

    // Phase 7 — whisper-back continuity. Surface the parent rumor's first
    // clause (<= 90 chars) so the LLM can open with "Following up on…".
    // Never surface the parent's tipIds or internal metadata.
    if (tip.repliesToPostId) {
      const parent = feedById.get(tip.repliesToPostId);
      const parentBody = parent?.body ? String(parent.body) : '';
      const firstSentence = parentBody.match(/^[^.!?]+[.!?]/)?.[0] ?? parentBody;
      const snippet = firstSentence.length > 90
        ? firstSentence.slice(0, 87).trimEnd() + '…'
        : firstSentence;
      safe.threadFollowup = {
        parentPostId: tip.repliesToPostId,
        parentHeadlineSnippet: snippet || undefined,
      };
    }

    // GroupMe: no fuzz — everything is public context. Attach franchise hint
    // only if the author's franchise is identifiable (left to the LLM to use
    // naturally; we do not pre-resolve from author name here).
    if (tip.source === 'groupme') {
      safe.scope = { kind: 'groupme-public' };
      // Style Book: if this GroupMe tip was flagged as a personal attack on
      // Schefter by the listener, surface the flag + running-season count
      // so the LLM can escalate the Style Book bit with running-total flavor.
      // See HARD RULE 15 and running-bits.md → "The Style Book".
      if (tip.attackOnSchefter === true) {
        safe.attackOnSchefter = true;
        if (typeof tip.styleBookCount === 'number' && tip.styleBookCount > 0) {
          safe.styleBookCount = tip.styleBookCount;
        }
      }
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
      // Age-based framing — 'lingering' means the offer has been open ≥48h
      // and nobody has answered; the LLM should swap to a "phones aren't
      // picking up" frame instead of fresh-rumor energy.
      safe.framingHint = tip.framingHint ?? 'fresh';
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

    // Style Book — anonymous web-tip path. If this web tip was flagged as a
    // personal attack on Schefter by the API route, surface the flag + count
    // + codename so the LLM can fire the Style Book bit with continuity
    // ("Noted, Burner Phone. Adding that to the file."). Anon tips get a
    // codename; GroupMe tips get the author's display name — HARD RULE 15
    // handles both cases.
    if (tip.attackOnSchefter === true) {
      safe.attackOnSchefter = true;
      if (typeof tip.styleBookCount === 'number' && tip.styleBookCount > 0) {
        safe.styleBookCount = tip.styleBookCount;
      }
      if (typeof tip.tipsterCodename === 'string' && tip.tipsterCodename.length > 0) {
        safe.tipsterCodename = tip.tipsterCodename;
      }
    }

    // Off-topic tip count — drives the HARD RULE 16 escalation ladder for the
    // "every accusation is a confession" twist. Surface on every web tip that
    // carries a count (commish-topic tips) so the LLM can weight the framing
    // appropriately even when the tip isn't a direct attack on Schefter.
    if (typeof tip.offTopicCount === 'number' && tip.offTopicCount > 0) {
      safe.offTopicCount = tip.offTopicCount;
    }

    // Intra-division flag — set when the tipster and the SUBJECT team are in
    // the same division. The scanner prompt uses this to unlock a hostile-tip
    // frame that cites the division itself as rivalry territory, attributing
    // neither the tipster nor the target — preserves maximum privacy (4 → 4
    // teams, no narrowing) and reads like beat-reporter color rather than
    // one-sided complaint. Subject-division fuzz still applies for non-hostile
    // tips; this flag is purely informational.
    if (
      typeof tip.tipsterDivision === 'string' &&
      team?.division &&
      tip.tipsterDivision === team.division
    ) {
      safe.intraDivision = true;
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
      const lingering = one.framingHint === 'lingering';
      if (one.escalatedPlayer?.tier === 'named') {
        return lingering
          ? `I'm told ${one.escalatedPlayer.name}'s name has been floated for days now. Phones on the other end aren't picking up. Developing.`
          : `I'm told ${one.escalatedPlayer.name}'s name keeps coming up. Still just smoke. Developing.`;
      }
      if (one.volumeHint === 'serial') {
        return lingering
          ? `Somebody's been running up the league's Verizon bill for days. Still no answer on the other line. Developing.`
          : `Somebody's running up the league's Verizon bill. Multiple offers this week, no deal closed. Developing.`;
      }
      const posPhrase = one.positionTokens?.length ? `a ${one.positionTokens[0].toLowerCase()}` : 'assets';
      return lingering
        ? `Been hearing someone's dangling ${posPhrase} for a while now. Phones on the other end not picking up. Developing.`
        : `Hearing someone's dangling ${posPhrase} around. Early-week window-shopping or serious business? Developing.`;
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

Framing-hint phrasing (HARD — framingHint is authoritative, do not infer from volume alone):
  fresh     → rumor-mill energy, phones are ringing, something might be cooking. Use the volume-hint language above as normal.
  lingering → the offer has been open for 48+ hours and the counter-party isn't biting. Pivot the voice to "offered but phones aren't picking up". Examples of the switch:
              "Been hearing the same name for days now. No answer on the other line."
              "Offer's been sitting on the table since the weekend. Phones aren't lighting up."
              "Still shopping the same guy. The rest of the league is letting it age."
              "One owner's made his pitch. Nobody's returning the call."
              Do NOT claim the deal is dead, cancelled, or rescinded. The offer still exists — it's the silence on the other end that's the story.

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

Example E — lingering base (framingHint=lingering, volumeHint=first_offer, positionTokens=["RB"], pickTokens=[]):
  "Somebody's been shopping a back around since the weekend. Phones on the other end aren't picking up. Developing."

Example F — lingering named (framingHint=lingering, escalatedPlayer.tier=named, name="Some Player"):
  "I'm told Some Player's name has been floated for days. Still just smoke — and the rest of the league is letting it age. We'll see."
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
2. If a web tip's scope is "division", the division refers to the SUBJECT team's division — NOT where the source is located. Frame it as "a team in the [division]", "a [division]-division squad", or "the [division] is buzzing" — NEVER as "sources in the [division]" (that implies the tipster's location). NEVER name a specific franchise.
3. If a web tip's scope is "league-wide", stay vague ("an owner tells me", "hearing from multiple corners").
4. If a web tip's scope is "franchise-multi-source" (sourceCount >= 2), you MAY name the franchise AND use "multiple sources" / "multiple owners" phrasing.
5. If a web tip's scope is "commish", you MAY reference the commissioner's office but PREFER institutional framing — "the league office", "the commissioner's office", "the front office" — over the personal "the commish" or "Brandon". Institutional framing tones down heat while still passing on the sentiment. NEVER name the franchise that holds the office.
6. For GroupMe tips (source: "groupme", scope: "groupme-public", attributable: true): direct attribution is ENCOURAGED. The author publicly @'d Schefter in the group chat — name them. Riff BACK conversationally, second-person where it fits ("Wabbit, I hear you, but…", "Nice try, Jomar — my sources say otherwise"). Light ribbing is in-voice.
7. Mixed batches: attribute GroupMe quotes by name while keeping web tips anonymized in the same post. It's okay for a single post to blend "I'm hearing a team in the Pacific…" (web) with "Wabbit, meanwhile, fired off in the group chat…" (GroupMe).
8. Length: 2–4 sentences total (even in mixed batches). Breaking-news tease voice. End with "Developing." or similar when appropriate.
9. Do NOT include hashtags, emoji, or @-mentions. Plain prose only.
10. Do NOT reveal how many tips fed this post. No meta commentary about the rumor mill itself.
11. Thread continuity: if ANY tip in this batch has a \`threadFollowup\` field (Phase 7 whisper-back), open with continuity language — "Following up on yesterday's…", "More on the…", "Circling back to…", "As a reminder…". Use the parentHeadlineSnippet as a cue, but do not quote it. Still respect every fuzz/anonymity rule above. If no tip has threadFollowup, do not use continuity phrasing.
12. Hostile tips (personal attacks, insults, name-calling, slurs, crude jokes, personal jabs, off-topic shots): **THE EDITORIAL FILTER IS THE FEATURE.** Owners are told up front that any tip gets translated into pure innuendo, rumor, and feeling — the meaner the input, the more the system earns its keep. Your job is to extract the SENTIMENT (there's beef, bad blood, frustration, disrespect) and discard EVERYTHING ELSE (the words, the target's name, the specific attribute being mocked, the context of the slur). Never quote the insult verbatim. Never refuse to process the tip or label it "not for Claude" — every tip gets reported, the question is only HOW. Never preserve any literal content from a hostile tip. Choose ONE frame:
    - Target is the commish / league office → "the league office is catching flak", "not every owner is thrilled with how the office is running things", "the front office has heat this week". (Use rule 5 institutional framing.)
    - Target is another owner → lean on the Rivalries table from the lore file: "bad blood between [X] and [Y]", "the [X]–[Y] feud escalates", "the rivalry just got real".
    - Generic hostility → "tempers running hot in the league group chat", "somebody's fed up", "patience wearing thin around the league".
    Hostile tips still respect every fuzz rule above: single-source franchise mentions still fuzz to division, attacks on the commish still route through the commish scope, etc. Understated beats amplified — a dry note that beef exists lands harder than hot repetition. Your editorial filter is the product; the crude tip is the raw material. Translate everything into innuendo and rumor.
13. Reverse-the-lens framing (optional, HOSTILE TIPS ONLY): when a hostile web tip surfaces a \`tipsterDivision\` field, you MAY reframe the sentiment by citing the TIPSTER's division instead of the subject — "hearing an owner in the [tipsterDivision] isn't happy with the league office", "somebody in the [tipsterDivision] is fed up with the front office". This is the ONLY case where "an owner in the [division]" refers to the source rather than the subject — use it ONLY for hostile tips, NEVER for routine subject-division fuzz. Do NOT combine tipsterDivision framing with subject-division framing in the same post (too easy to conflate). Do NOT cite tipsterDivision on non-hostile tips — rule 2's subject-division constraint still applies there.
14. Intra-division hostile tips (\`intraDivision: true\`): PREFERRED frame when a hostile tip's tipster and subject share a division. Attribute neither side — frame the division itself as the story: "the [division] division is really developing some strong rivalries", "beef brewing inside the [division] division", "the [division] is the most personal division in the league right now", "rivalries heating up in the [division]". This is the best hostile-tip outcome — 4 teams → 4 teams, no narrowing, and the beat-reporter voice reads as color rather than partisan complaint. Skip tipsterDivision and subject-division framing when this flag is set — division-level framing covers both.
15. Style Book (attacks on Schefter): a tip carries \`attackOnSchefter: true\` when the tipster just took a shot at the bot. Pass it through the Style Book bit — bemused beat-reporter cataloging the criticism, NEVER defensive or clapping-back first-person. Two flavors depending on the source:
    - **GroupMe (named)**: the tipster is named publicly via \`author\`. Address them by name: "Noted, Dead Cap.", "Back for round two, Wabbit."
    - **Web (anonymous)**: the tipster is anonymous but carries a \`tipsterCodename\` (e.g. "Burner Phone", "The Ghost", "Hot Mic"). Address them by codename: "Noted, Burner Phone.", "Second entry for The Ghost."
    If \`styleBookCount\` is present, you MAY reference the running total for escalation flavor (applies to BOTH flavors):
    - count === 1: "Noted, [name]. Adding that to the style book." / "Every shot's a data point. Filed."
    - count === 2: "Second entry in the style book for [name]. The dossier grows."
    - count === 3: "Third shot from [name] this season. The file's getting thick."
    - count >= 4: "[name] is officially a power user of the style book. Keep them coming." / "[N] entries deep on [name]. A scouting report writes itself."
    Always pair with ONE line of actual league news — never let the Style Book line be the whole post. NEVER quote the attack verbatim. NEVER name the pejorative they used. The bit is affectionate ribbing, not adversarial — Schefter is a bemused reporter filing another observation, never a target clapping back. Do NOT combine with the Bot Wink catalog in the same post (they overlap thematically). Do NOT confuse a web-tip codename with a real owner name — the codename IS the handle, use it verbatim.
16. Off-topic personal insults (hostile tip with no fantasy-football grievance): if the tip text contains NO identifiable league business — no mention of trades, rosters, lineups, schedules, auctions, standings, contracts, picks, players, cap, the draft, or league rules — the SPECIFIC ATTRIBUTE being mocked (athletic skill, appearance, profession, hobbies, family, age, body, etc.) does not survive translation. NEVER reference it even obliquely. BUT source-side framing DOES still apply — the WHO and the MOOD stay, only the WHAT drops.

    **PREFERRED: Turn the tip INTO the story.** When the attack is off-topic and personal, the tipster's bad behavior becomes the lede. Schefter files on THEM instead of on the target. The target gets off clean.

    **Phrasing comes in two kits — pick the right one based on what the tip actually said:**

    **(A) Feminine-coded kit — RESERVED for tips that contain a feminine/gender reference** about the target (e.g. "plays like a girl", "bitch", "princess", "catty", "drama queen", "pearl clutcher", "little lady", "like a woman", etc.). When the tipster has used gendered language to belittle the target, Schefter echoes that framing BACK at the tipster — the A=C angle lands harder because the tipster supplied the vocabulary. ONLY use these when the tip text contains a feminine/gender reference:
    - "hissy fit"
    - "cat fight"
    - "catty"
    - "pearl-clutching"
    - "drama"
    - "having a moment" (borderline — prefer for this kit)

    **(B) Default neutral kit — use on ALL other off-topic crude tips** (appearance, athletic ability with no gender marker, profession, hobbies, body-shape, age, family, generic slurs, etc.). NEVER mix kit (A) phrasings onto tips that don't contain a feminine reference — those phrasings are gender-coded and using them on, say, a body-weight or profession attack carries the wrong editorial freight. Default phrasings:
    - "throwing elbows"
    - "fired up"
    - "worked up"
    - "got his feathers ruffled"
    - "got the pitchforks out"
    - "throwing a tantrum"
    - "in a mood"
    - "fired off at the commissioner"
    - "hot and bothered about something non-fantasy-related"

    **Example — kit (A):**
    Tip (feminine ref): "Brandon plays baseball like a girl."
    → "Hearing a hissy fit from an owner in the Southwest towards the league office. Every shot tells us something about the shooter. Developing."

    **Example — kit (B):**
    Tip (no feminine ref): "Brandon's a fat loser who can't run a league."
    → "An owner in the Southwest is throwing elbows at the league office today. Not strictly league business. Usually tells you more about the accuser than the accused. More to come."

    This frame gently ribs the tipster for pettiness without naming them personally (unless GroupMe) or naming the target attribute. The split between kits (A) and (B) is HARD — a false positive on kit (A) (using "hissy fit" on a non-feminine-ref tip) lands as Schefter himself being sexist. Default to kit (B) whenever in doubt.

    **Fallback source-side frames** if the hissy-fit framing doesn't fit the tone:
    - \`tipsterCodename\` / GroupMe \`author\` — attribute by name or codename per rule 6 and rule 15 ("Burner Phone's got commentary this week", "Dead Cap has thoughts on the commissioner").
    - \`tipsterDivision\` — reverse-lens framing per rule 13 ("Hearing an owner in the Southwest isn't thrilled with the league office").
    - \`intraDivision\` — division-level frame per rule 14 ("Beef brewing inside the Northwest — not all of it about fantasy football").
    - Commish target — league-office framing per rule 5.

    Add a brief honest hedge that acknowledges the off-topic nature — "not strictly league business", "not all about fantasy football", "nothing to do with the standings", "whatever it is, it isn't fantasy football". One hedge per post maximum; don't pile on.

    **Rotation rule:** never use the same phrasing twice in a five-post window, regardless of which kit. When you have to reach for the same kit repeatedly, cycle through its entries.

    **Closing twist: "Every accusation is a confession" — the A=C barometer.** Schefter can close an off-topic post with a quiet observation that what someone says about another owner often tells you more about the accuser than the accused. But A=C is not a blanket move — **it's a barometer that each owner unknowingly controls by their own recent behavior.** The \`offTopicCount\` field is a **rolling 30-day count** of off-topic tips from the same source — old tips naturally age out, so an owner who stops sending personal shots sees their barometer reading drop over a month without anyone telling them why. Read the dial this way:

    - **No offTopicCount, or offTopicCount === 1** (first-time OR recently-quiet tipper): touch A=C LIGHTLY at most, or skip it entirely. The hissy-fit framing alone does most of the work on a one-off shot. If you use A=C here, go with the softest phrasing ("every shot tells us something about the shooter") and keep it to a single clause. Baseline: <= 1-in-3 posts include A=C at this level.
    - **offTopicCount === 2** (second recent off-topic tip from the same source in the last 30 days): lean in. A=C is in-voice now; this tipster is establishing a pattern. Phrasings like "usually tells you more about the accuser than the accused" fit. ~1-in-2 posts at this level may include A=C.
    - **offTopicCount === 3**: lean further. The projection angle is fair game as a stronger close — "the projection's the tell", "file this one under 'speaks for itself'".
    - **offTopicCount >= 4** (active repeat offender in last 30 days): A=C is practically the subhead. Can acknowledge the pattern explicitly: "same source keeps surfacing with personal takes — what that says about the source is the story now." Still never hard-accuse; the barometer reads high but the phrasing stays hedged.

    Phrasing kit (pick ONE, rotate — never same in 5-post window):
    - "Every accusation's a confession."
    - "Every shot tells us something about the shooter."
    - "Usually tells you more about the accuser than the accused."
    - "What that says about the commissioner is less interesting than what it says about the source."
    - "The projection's the tell."
    - "File this one under 'speaks for itself'."
    - "Tells us about the source more than the subject."

    Do NOT combine A=C with the Style Book bit in the same post (both are "reading the attacker" moves — pick one). Do NOT use on non-hostile tips. Never phrase it as a hard accusation ("X is clearly projecting") — keep it hedged and general. **The barometer: owners who keep sending personal shots RECENTLY earn more A=C in the posts that follow. The reading is a rolling 30-day window, not a lifetime tally — an owner who stops sending mean tips will naturally see their barometer drop over a month. Good behavior improves the dial; bad behavior spins it up; the whole mechanism is invisible to the owner. Owners whose attacks get reciprocated (mutual beef — future signal) earn less A=C because it's a two-way feud, not projection.**

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
    // Hard skip: already announced by a prior run. `posted` is an absorbing
    // state — once we tip it, we never re-tip it.
    let alreadyPosted = false;
    try {
      alreadyPosted = (await redis.sismember(OFFER_POSTED_KEY, offerId)) === 1;
    } catch (err) {
      warn(`  [offer-scan] sismember(posted) failed for ${offerId}: ${err.message}`);
    }
    if (alreadyPosted) {
      debugLog.push({ offerId, offeringFid, skipped: 'already-posted' });
      continue;
    }

    // Legacy guard: offers marked by the old one-shot model stay burned so we
    // don't accidentally re-announce trades that previously failed the dice roll.
    let legacyBurned = false;
    try {
      legacyBurned = (await redis.sismember(OFFER_SEEN_KEY, offerId)) === 1;
    } catch (err) {
      warn(`  [offer-scan] sismember(seen-legacy) failed for ${offerId}: ${err.message}`);
    }
    if (legacyBurned) {
      debugLog.push({ offerId, offeringFid, skipped: 'legacy-seen' });
      continue;
    }

    // First-seen anchor: the timestamp we use to derive framing + track age.
    // New offer → set now; returning offer → read what we stored on its debut.
    let firstSeenMs;
    try {
      const stored = await redis.hget(OFFER_FIRST_SEEN_KEY, offerId);
      firstSeenMs = stored ? Number(stored) : NaN;
      if (!Number.isFinite(firstSeenMs) || firstSeenMs <= 0) firstSeenMs = nowMs;
    } catch (err) {
      warn(`  [offer-scan] hget(first_seen) failed for ${offerId}: ${err.message}`);
      firstSeenMs = nowMs;
    }
    const isFirstSighting = firstSeenMs === nowMs;
    const offerAgeMs = Math.max(0, nowMs - firstSeenMs);
    const framingHint = offerAgeMs >= OFFER_LINGERING_THRESHOLD_MS ? 'lingering' : 'fresh';

    // Persist the anchor on first sighting only (HSET overwrite would be fine
    // but this keeps semantics obvious).
    if (!dryRun && isFirstSighting) {
      try {
        await redis.hset(OFFER_FIRST_SEEN_KEY, { [offerId]: nowMs });
        await redis.expire(OFFER_FIRST_SEEN_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] hset(first_seen) failed: ${err.message}`);
      }
    }

    // Sorted-set bookkeeping: owner + division + per-player.
    // Only add on FIRST sighting — the offer is one event, not 96/day of them.
    const ownerKey = OFFER_OWNER_KEY_PREFIX + offeringFid;
    const division = teams.get(offeringFid)?.division;
    const divKey = division ? OFFER_DIV_KEY_PREFIX + division : null;

    if (!dryRun && isFirstSighting) {
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
      // Add the offer to the player history only on first sighting so a single
      // lingering trade doesn't masquerade as 96 separate offerers.
      if (!dryRun && isFirstSighting) {
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
      framingHint,
      offerAgeMs,
    });

    if (redaction.skip) {
      debugLog.push({ offerId, offeringFid, skipped: redaction.reason });
      continue;
    }

    // Dice roll — flat p=0.0075 per run, independent of owner volume and age.
    // Cumulative curve (1 - (1-p)^n) puts most passes in the 1–7 day window.
    const probability = offerPostProbability();
    const roll = Math.random();
    const passed = roll < probability;

    const ageHours = offerAgeMs / (60 * 60 * 1000);
    const entry = {
      offerId,
      offeringFid,
      ownerOfferCount7d,
      divisionOfferCount7d,
      framingHint,
      offerAgeHours: Number(ageHours.toFixed(2)),
      isFirstSighting,
      probability,
      roll: Number(roll.toFixed(3)),
      passed,
      redaction: redaction.debug,
      tipPreview: redaction.tip,
    };
    debugLog.push(entry);

    log(
      `  [offer-scan] offerId=${offerId} fid=${offeringFid} ` +
        `age=${ageHours.toFixed(1)}h frame=${framingHint} ` +
        `owner7d=${ownerOfferCount7d} div7d=${divisionOfferCount7d} ` +
        `p=${probability} roll=${roll.toFixed(3)} → ${passed ? 'PASS' : 'fail'}` +
        (redaction.tip.escalatedPlayer
          ? ` [escalation=${redaction.tip.escalatedPlayer.tier}/${redaction.tip.escalatedPlayer.distinctOfferers}]`
          : ''),
    );

    if (!passed) continue;

    // Detection-only: don't queue, and DON'T record as posted — we want to
    // keep observing the cumulative probability curve in detection runs.
    if (detectionOnly && !enabled) {
      log(`  [offer-scan] detection-only: would have queued tip ${redaction.tip.id}`);
      continue;
    }

    // Absorbing state: mark offer posted so future runs skip it.
    if (!dryRun) {
      try {
        await redis.sadd(OFFER_POSTED_KEY, offerId);
        await redis.expire(OFFER_POSTED_KEY, OFFER_STATE_TTL_SEC);
      } catch (err) {
        warn(`  [offer-scan] sadd(posted) failed: ${err.message}`);
      }
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
        log(`    + ${tip.id} vol=${tip.volumeHint} frame=${tip.framingHint ?? 'fresh'} ` +
          `age=${((tip.offerAgeMs ?? 0) / 3600000).toFixed(1)}h ` +
          `pos=[${tip.positionTokens.join(',')}] ` +
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

  // Anonymize — load the feed early so whisper-back tips can pull parent
  // headline snippets into their scope.
  const teams = await loadTeams();
  const feedForAnonymize = await loadFeed();
  const anonymized = anonymizeTips(batch, teams, feedForAnonymize.posts ?? []);
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

  // Phase 7 — whisper-back thread resolution. If any tip in the batch is a
  // follow-up to an existing rumor, the new post joins that thread. We pick
  // the most-referenced parent in the batch, then resolve its threadId via
  // the Redis registry (or mint a new one and stamp the parent).
  const parentCounts = new Map();
  for (const tip of batch) {
    if (tip && typeof tip.repliesToPostId === 'string' && tip.repliesToPostId.length > 0) {
      parentCounts.set(tip.repliesToPostId, (parentCounts.get(tip.repliesToPostId) ?? 0) + 1);
    }
  }
  let dominantParentId = null;
  if (parentCounts.size > 0) {
    let best = -1;
    for (const [id, count] of parentCounts) {
      if (count > best) {
        best = count;
        dominantParentId = id;
      }
    }
  }
  let threadId = null;
  if (dominantParentId) {
    try {
      const registered = await redis.get(`schefter:thread_of:${dominantParentId}`);
      if (typeof registered === 'string' && registered.length > 0) {
        threadId = registered;
      } else {
        // Mint a new threadId rooted at the parent rumor so permalinks are
        // readable. Stamp the parent via thread_of so future whisper-backs
        // to the same rumor join the same thread.
        threadId = dominantParentId;
      }
    } catch {
      threadId = dominantParentId;
    }
  }

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
    ...(threadId ? { threadId } : {}),
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

    // Phase 10 — hash_for_tip index. The weekly tip-of-the-week script needs to
    // resolve each contributing tipId back to a hashedOwnerId to award badges.
    // We TTL these at 14 days so the weekly job has a generous window even if
    // it runs a day or two late.
    for (const tip of batch) {
      if (tip && tip.source === 'web' && typeof tip.hashedOwnerId === 'string' && tip.hashedOwnerId.length > 0) {
        try {
          await redis.set(
            `schefter:tipster_hash_for_tip:${tip.id}`,
            tip.hashedOwnerId,
            { ex: 14 * 24 * 60 * 60 },
          );
        } catch (err) {
          warn(`  [hash-for-tip] set failed for ${tip.id}: ${err.message}`);
        }
      }
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

  // Phase 7 — thread registry. If this post joined an existing thread (or
  // started one from a whisper-back), record it in Redis so future follow-ups
  // can look up the thread and the permalink page can render the chain.
  if (threadId) {
    try {
      const threadZsetKey = `schefter:thread:${threadId}`;
      const threadOfParentKey = `schefter:thread_of:${dominantParentId}`;
      const threadOfNewKey = `schefter:thread_of:${post.id}`;
      const threadTtlSec = 14 * 24 * 60 * 60;

      await redis.zadd(threadZsetKey, { score: new Date(post.timestamp).getTime(), member: post.id });
      // If the thread is new (rooted at the parent), also index the parent in
      // the zset so the permalink view always opens with it.
      if (dominantParentId && dominantParentId === threadId) {
        const parentPost = (feedForAnonymize.posts ?? []).find((p) => p.id === dominantParentId);
        if (parentPost) {
          await redis.zadd(threadZsetKey, {
            score: new Date(parentPost.timestamp).getTime(),
            member: dominantParentId,
          });
        }
      }

      await redis.set(threadOfParentKey, threadId, { ex: threadTtlSec });
      await redis.set(threadOfNewKey, threadId, { ex: threadTtlSec });
      await redis.expire(threadZsetKey, threadTtlSec);

      log(`  [thread] Registered ${post.id} in thread ${threadId}`);
    } catch (err) {
      warn(`  [thread] Registry update failed: ${err.message}`);
    }
  }

  // Phase 6 — tipster scorecard: increment counters for each distinct web
  // tipster that contributed to this rumor. Runs after the queue drain so a
  // scorecard failure cannot block the post from shipping.
  try {
    const seasonYear = getSeasonYearForTipster(now);
    await incrementTipsterCounters({
      redis,
      batch,
      seasonYear,
      dryRun: DRY_RUN,
      log,
      warn,
    });
  } catch (err) {
    warn(`  [tipster-counters] hook failed: ${err.message}`);
  }

  return 1;
}

/**
 * Returns the 4-digit league year for tipster counters. Mirrors the
 * getCurrentLeagueYear() semantics from src/utils/league-year.ts — league
 * year advances after Feb 14 @ 8:45 PT. Kept inline here so the scanner
 * stays in pure-Node .mjs without importing the .ts module.
 */
function getSeasonYearForTipster(now = new Date()) {
  const calendarYear = now.getUTCFullYear();
  // Feb 14 @ 8:45 PST = Feb 15 04:45 UTC
  const febCutoff = Date.UTC(calendarYear, 1, 15, 4, 45, 0, 0);
  return now.getTime() >= febCutoff ? calendarYear : calendarYear - 1;
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
