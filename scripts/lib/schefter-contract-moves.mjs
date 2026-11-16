/**
 * Schefter's contract-move lane (Brandon, 2026-11-15) — pure logic.
 *
 * Every veteran extension, rookie extension, team option and franchise tag is
 * a contract DECLARATION (Redis hash `contract-declarations`, PR #1742) that
 * keeps the contract it replaced beside the one it asked for. This turns that
 * record into feed posts:
 *
 *   1. APPLIED moves — once a declaration reaches MFL, a one-liner with the
 *      old terms and the new ones. Franchise tags all land on Feb 15, so the
 *      tags a run finds applied fold into ONE "tags are official" list.
 *   2. PENDING franchise tags (Feb 1 – Feb 14, 8:45 PM PT) are insider info.
 *      The public Contracts page hides them, so Schefter's rumor is the only
 *      public signal before Feb 15. Brandon's rulings:
 *        - a rumor names the TEAM and the POSITION, never the player or the
 *          value; the team's other tag-eligible players at that position are
 *          "in the mix" beside the real one, so a rumor never pins a player;
 *        - the window opens with a "tag watch" post priming the audience on
 *          who might be tagged;
 *        - a cancelled tag gets a "plans have changed" post, picked exactly as
 *          often as a tag rumor (one draw over both kinds);
 *        - every pending tag is fair game; there is no owner opt-out.
 *
 * Nothing here does I/O. `scanContractMoves` in scripts/schefter-scan.mjs
 * reads the declarations and rosters, keeps the lane's state in REDIS (never
 * the feed file: the feed is committed to a public repo, and a state blob
 * naming a pending tag's player would leak exactly what the rumor holds
 * back), and writes the posts. `tests/schefter-contract-moves.test.ts` pins it.
 */

import { contractTermsChange, formatSalaryCompact } from '../../src/utils/contract-terms.mjs';
import { franchiseTagOpens, franchiseTagCloses } from '../../src/utils/franchise-tag-window.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The declaration types this lane reports. Contract-years declarations on a pickup are routine and stay out. */
export const CONTRACT_MOVE_TYPES = new Set(['veteran-extension', 'rookie-extension', 'team-option', 'franchise-tag']);

/** An applied move older than this when first seen is history, not news (first run, or a lane outage). */
export const APPLIED_MAX_AGE_MS = 3 * DAY;
/** A rumor waits at least a day after the filing, plus up to a day more, so its timing cannot be traced to the click. */
export const RUMOR_MIN_DELAY_MS = DAY;
export const RUMOR_SPREAD_MS = DAY;
/** At most one tag post a day. 20h, not 24h, so a scan cadence that drifts cannot push the drip to every other day. */
export const RUMOR_GAP_MS = 20 * HOUR;
/** No rumor in the last day of the window: a late leak would force a rival's hand. */
export const QUIET_BEFORE_CLOSE_MS = DAY;
/** How many names the tag-watch post lists, and how many per team. */
export const WATCH_LIST_SIZE = 6;
export const WATCH_PER_TEAM = 2;
/** Reported ids are kept this long, well past APPLIED_MAX_AGE_MS, then pruned. */
const REPORTED_KEEP_MS = 30 * DAY;

const POSITION_WORDS = {
  QB: 'quarterback',
  RB: 'running back',
  WR: 'receiver',
  TE: 'tight end',
  PK: 'kicker',
  K: 'kicker',
  DEF: 'defense',
  DST: 'defense',
};

/** "receiver" for WR. Unknown positions fall back to the code itself. */
export function positionWord(pos) {
  const p = String(pos ?? '').toUpperCase();
  return POSITION_WORDS[p] ?? (p || 'player');
}

/** FNV-1a, for a stable per-id delay and template pick. */
export function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = (list, seed) => list[stableHash(seed) % list.length];

/** "WR, Deebo Samuel" — the feed's position-first player format. */
export function playerLabel(player, fallbackName = 'Unknown player') {
  const name = displayName(player?.name ?? fallbackName);
  const pos = String(player?.position ?? '').toUpperCase();
  return pos ? `${pos}, ${name}` : name;
}

/** MFL names are "Last, First"; the feed prints "First Last". */
function displayName(raw) {
  const s = String(raw ?? '').trim();
  const i = s.indexOf(', ');
  return i > 0 ? `${s.slice(i + 2)} ${s.slice(0, i)}` : s;
}

const ms = (iso) => {
  const t = new Date(iso ?? '').getTime();
  return Number.isFinite(t) ? t : NaN;
};

/**
 * @typedef {{ franchiseId: string, playerId: string, position: string, submittedAt?: string, firstSeenAt: string,
 *   status: string, cancelledAt?: string, leakedAt?: string, changedAt?: string }} TrackedTag
 * @typedef {{ reported: Record<string, string>, tags: Record<string, TrackedTag>, watchYear: number | null,
 *   lastRumorAt: string | null }} ContractMoveState
 * @typedef {{ kind: 'watch' } | { kind: 'leak' | 'changed', id: string }} TagItem
 */

/** A fresh state blob. @returns {ContractMoveState} */
export function emptyState() {
  return { reported: {}, tags: {}, watchYear: null, lastRumorAt: null };
}

/**
 * Coerce whatever Redis held into a state blob; anything malformed starts over.
 * @param {any} raw
 * @returns {ContractMoveState}
 */
export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    reported: s.reported && typeof s.reported === 'object' ? { ...s.reported } : {},
    tags: s.tags && typeof s.tags === 'object' ? { ...s.tags } : {},
    watchYear: Number.isFinite(Number(s.watchYear)) && s.watchYear !== null ? Number(s.watchYear) : null,
    lastRumorAt: typeof s.lastRumorAt === 'string' ? s.lastRumorAt : null,
  };
}

/**
 * This league's declarations of a reportable type.
 * @param {any[]} declarations
 * @param {string} leagueId
 * @returns {any[]}
 */
export function leagueMoves(declarations, leagueId) {
  return (declarations ?? []).filter(
    (d) => d && String(d.leagueId) === String(leagueId) && CONTRACT_MOVE_TYPES.has(d.type),
  );
}

// ── Tag candidates ───────────────────────────────────────────────────────

/**
 * Every rostered player a franchise tag could land on: one contract year
 * left, not already tagged, not on a rookie deal or team option — the
 * eligibility test in src/utils/contract-eligibility.ts (§ franchise tag).
 * Highest salary first, the closest proxy the roster carries for "the player
 * a team cannot afford to lose".
 *
 * @param {any} rostersFeed MFL `rosters` export
 * @param {Map<string, {name: string, position?: string}>} players
 */
export function tagCandidates(rostersFeed, players) {
  const franchises = rostersFeed?.rosters?.franchise ?? [];
  const list = Array.isArray(franchises) ? franchises : [franchises];
  const out = [];
  for (const f of list) {
    const rows = Array.isArray(f?.player) ? f.player : f?.player ? [f.player] : [];
    for (const r of rows) {
      if (String(r.status ?? '').toUpperCase().startsWith('TAXI')) continue;
      if (Number(r.contractYear) !== 1) continue;
      const info = String(r.contractInfo ?? '').trim().toUpperCase();
      if (info === 'F' || info === 'RC' || info === 'TO') continue;
      const p = players.get(String(r.id));
      if (!p) continue;
      out.push({
        playerId: String(r.id),
        franchiseId: String(f.id),
        name: p.name,
        position: String(p.position ?? '').toUpperCase(),
        salary: Number(r.salary) || 0,
      });
    }
  }
  return out.sort((a, b) => b.salary - a.salary || a.playerId.localeCompare(b.playerId));
}

/** The tag-watch shortlist: top salaries, at most WATCH_PER_TEAM from any one team. */
export function watchList(candidates, size = WATCH_LIST_SIZE, perTeam = WATCH_PER_TEAM) {
  const perTeamCount = new Map();
  const out = [];
  for (const c of candidates) {
    const n = perTeamCount.get(c.franchiseId) ?? 0;
    if (n >= perTeam) continue;
    perTeamCount.set(c.franchiseId, n + 1);
    out.push(c);
    if (out.length >= size) break;
  }
  return out;
}

// ── 1. Applied moves ─────────────────────────────────────────────────────

const APPLIED_LINES = {
  'veteran-extension': [
    (team, who) => `The ${team} have signed ${who} to a veteran extension.`,
    (team, who) => `${team} lock up ${who} with a veteran extension.`,
    (team, who) => `Extension done: the ${team} and ${who} have agreed to more years.`,
  ],
  'rookie-extension': [
    (team, who) => `The ${team} have signed ${who} to a rookie extension.`,
    (team, who) => `${team} extend ${who}'s rookie deal.`,
  ],
  'team-option': [
    (team, who) => `The ${team} have picked up the team option on ${who}.`,
    (team, who) => `${team} exercise their option on ${who}.`,
  ],
  'franchise-tag': [
    (team, who) => `It's official: the ${team} have placed the franchise tag on ${who}.`,
  ],
};

const APPLIED_HEADLINES = {
  'veteran-extension': (team, who) => `${team} extend ${who}`,
  'rookie-extension': (team, who) => `${team} give ${who} a rookie extension`,
  'team-option': (team, who) => `${team} pick up ${who}'s option`,
  'franchise-tag': (team, who) => `${team} tag ${who}`,
};

/** "Was: $605K · 1 yr" / "Now: $9.10M · 1 yr" — the record's own terms, designation letters left out. */
export function termsLines(d) {
  const { before, after } = contractTermsChange(d, { designation: false });
  return `Was: ${before}\nNow: ${after}`;
}

/**
 * Posts for declarations that reached MFL since the last run.
 *
 * @returns {{ posts: any[], reportedIds: string[] }}
 */
export function buildAppliedPosts({ declarations, state, players, teamName, now, leagueSlug }) {
  const nowMs = now.getTime();
  const fresh = declarations.filter((d) => {
    if (d.status !== 'applied') return false;
    if (state.reported[d.id]) return false;
    const at = ms(d.mflSyncedAt ?? d.reviewedAt);
    return Number.isFinite(at) && nowMs - at <= APPLIED_MAX_AGE_MS && at <= nowMs + HOUR;
  });
  fresh.sort((a, b) => ms(a.mflSyncedAt) - ms(b.mflSyncedAt) || a.id.localeCompare(b.id));

  const posts = [];
  const who = (d) => playerLabel(players.get(String(d.playerId)) ?? { name: d.playerName });
  const team = (d) => teamName(d.franchiseId) ?? d.franchiseName ?? `Team ${d.franchiseId}`;

  for (const d of fresh.filter((x) => x.type !== 'franchise-tag')) {
    posts.push({
      id: `sf_contract_${d.id}`,
      timestamp: now.toISOString(),
      type: 'transaction',
      transactionSubType: 'CONTRACT',
      tier: d.type === 'veteran-extension' ? 'standard' : 'minor',
      headline: APPLIED_HEADLINES[d.type](team(d), who(d)),
      body: `${pick(APPLIED_LINES[d.type], d.id)(team(d), who(d))}\n\n${termsLines(d)}`,
      authorId: 'claude',
      franchiseIds: [String(d.franchiseId)],
      playerIds: [String(d.playerId)],
      contractMoveType: d.type,
      league: leagueSlug,
    });
  }

  const tags = fresh.filter((x) => x.type === 'franchise-tag');
  if (tags.length === 1) {
    const d = tags[0];
    posts.push({
      id: `sf_contract_${d.id}`,
      timestamp: now.toISOString(),
      type: 'transaction',
      transactionSubType: 'CONTRACT',
      tier: 'standard',
      headline: APPLIED_HEADLINES['franchise-tag'](team(d), who(d)),
      body: `${APPLIED_LINES['franchise-tag'][0](team(d), who(d))}\n\n${termsLines(d)}`,
      authorId: 'claude',
      franchiseIds: [String(d.franchiseId)],
      playerIds: [String(d.playerId)],
      contractMoveType: 'franchise-tag',
      league: leagueSlug,
    });
  } else if (tags.length > 1) {
    const lines = tags.map((d) => {
      const salary = formatSalaryCompact(d.requestedSalary ?? d.currentSalary);
      return `🏷️ ${team(d)}: ${who(d)} (${salary}, 1 yr)`;
    });
    posts.push({
      id: `sf_contract_tags_${tags[0].id}`,
      timestamp: now.toISOString(),
      type: 'transaction',
      transactionSubType: 'CONTRACT',
      tier: 'standard',
      headline: `Franchise tags are official: ${tags.length} players tagged`,
      body: `It's official. ${tags.length} franchise tags are on the books:\n\n${lines.join('\n')}`,
      authorId: 'claude',
      franchiseIds: [...new Set(tags.map((d) => String(d.franchiseId)))],
      playerIds: tags.map((d) => String(d.playerId)),
      contractMoveType: 'franchise-tag',
      league: leagueSlug,
    });
  }

  return { posts, reportedIds: fresh.map((d) => d.id) };
}

// ── 2. Pending franchise tags ────────────────────────────────────────────

/**
 * Fold this run's declarations into the tracked tags.
 *
 * A pending tag is tracked from the first run that sees it. A tracked tag
 * that is no longer pending either reached MFL (`applied`, no post — the
 * Feb 15 list covers it) or was CANCELLED: deleted (declare.ts removes a
 * cancelled declaration outright), rejected or expired. A cancel the same
 * team immediately re-filed for the same player is `superseded`, never a
 * "plans have changed" — nothing changed.
 */
export function trackPendingTags(state, declarations, players, now) {
  const nowIso = now.toISOString();
  const tags = { ...state.tags };
  const byId = new Map(declarations.filter((d) => d.type === 'franchise-tag').map((d) => [d.id, d]));
  const pending = [...byId.values()].filter((d) => d.status === 'pending');

  for (const d of pending) {
    if (tags[d.id]) continue;
    const player = players.get(String(d.playerId));
    tags[d.id] = {
      franchiseId: String(d.franchiseId),
      playerId: String(d.playerId),
      position: String(player?.position ?? '').toUpperCase(),
      submittedAt: d.submittedAt ?? nowIso,
      firstSeenAt: nowIso,
      status: 'pending',
    };
  }

  for (const [id, t] of Object.entries(tags)) {
    if (t.status !== 'pending') continue;
    const d = byId.get(id);
    if (d && d.status === 'pending') continue;
    if (d && d.status === 'applied') {
      tags[id] = { ...t, status: 'applied' };
      continue;
    }
    const refiled = pending.some(
      (p) => p.id !== id && String(p.franchiseId) === t.franchiseId && String(p.playerId) === t.playerId,
    );
    tags[id] = { ...t, status: refiled ? 'superseded' : 'cancelled', cancelledAt: nowIso };
  }

  return { ...state, tags };
}

/** The window this instant belongs to, and whether a tag post may run now. */
export function tagWindowGate(now) {
  const year = now.getUTCFullYear();
  const opens = franchiseTagOpens(year);
  const closes = franchiseTagCloses(year);
  const t = now.getTime();
  return {
    year,
    opens,
    closes,
    open: t >= opens.getTime() && t < closes.getTime() - QUIET_BEFORE_CLOSE_MS,
  };
}

/** When a tracked tag's rumor (or its correction) may first run: a day, plus 0–24h by id. */
export function rumorReadyAt(id, sinceIso, kind) {
  const since = ms(sinceIso);
  return since + RUMOR_MIN_DELAY_MS + (stableHash(`${kind}:${id}`) % RUMOR_SPREAD_MS);
}

/**
 * The rumor-shaped items that are due now. A leak and a "plans have changed"
 * sit in ONE list, so the daily draw picks either kind exactly as often
 * (Brandon: "just as likely as a franchise tag rumor").
 */
export function dueRumors(state, now, windowYear) {
  const t = now.getTime();
  const due = [];
  for (const [id, tag] of Object.entries(state.tags)) {
    if (new Date(tag.firstSeenAt).getUTCFullYear() !== windowYear) continue;
    if (tag.status === 'pending' && !tag.leakedAt) {
      const since = Math.max(ms(tag.firstSeenAt), ms(tag.submittedAt) || 0);
      if (t >= rumorReadyAt(id, new Date(since).toISOString(), 'leak')) due.push({ kind: 'leak', id });
    } else if (tag.status === 'cancelled' && !tag.changedAt) {
      if (t >= rumorReadyAt(id, tag.cancelledAt, 'changed')) due.push({ kind: 'changed', id });
    }
  }
  return due.sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
}

/**
 * What the tag lane posts this run, if anything: the tag watch on the
 * window's first run, then at most one rumor a day.
 *
 * @param {{ state: any, now: Date, rng?: () => number }} args
 * @returns {{ kind: 'watch' } | { kind: 'leak' | 'changed', id: string } | null}
 */
export function nextTagPost({ state, now, rng = Math.random }) {
  const gate = tagWindowGate(now);
  if (!gate.open) return null;
  const last = ms(state.lastRumorAt);
  if (Number.isFinite(last) && now.getTime() - last < RUMOR_GAP_MS) return null;
  if (state.watchYear !== gate.year) return { kind: 'watch' };
  const due = dueRumors(state, now, gate.year);
  if (due.length === 0) return null;
  return due[Math.min(due.length - 1, Math.floor(rng() * due.length))];
}

const LEAK_LINES = [
  (team, pos) => `Hearing the ${team} are leaning toward using the franchise tag on a ${pos}.`,
  (team, pos) => `League sources tell me the ${team} have a ${pos} in mind for the franchise tag.`,
  (team, pos) => `Tag buzz: I'm told the ${team} are prepared to tag a ${pos} before the deadline.`,
  (team, pos) => `Don't be surprised if the ${team} use the franchise tag on a ${pos}. That's the word I'm getting.`,
];

const CHANGED_AFTER_LEAK = [
  (team, pos) => `Update on the ${team}: plans have changed. I'm told they've backed off the franchise tag on their ${pos}.`,
  (team, pos) => `Plans have changed in the ${team} front office. The tag on that ${pos} is off the table, for now.`,
];

const CHANGED_NO_LEAK = [
  (team, pos) => `Plans have changed for the ${team}. They were set to tag a ${pos}, but I'm told that's off the table for now.`,
  (team, pos) => `Hearing the ${team} had a franchise tag lined up for a ${pos}. Plans have changed.`,
];

const andList = (names) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * The tag-watch post that opens the window.
 * @param {{ shortlist: ReturnType<typeof tagCandidates>, teamName: (fid: string) => string | null, now: Date, year: number, leagueSlug: string }} args
 */
export function buildWatchPost({ shortlist, teamName, now, year, leagueSlug }) {
  const lines = shortlist.map((c) => `🏷️ ${playerLabel(c)} (${teamName(c.franchiseId) ?? `Team ${c.franchiseId}`})`);
  const body = lines.length
    ? `The franchise tag window is open through Feb 14 at 8:45 PM PT. Tags go official Feb 15. Names I'm watching:\n\n${lines.join('\n')}`
    : `The franchise tag window is open through Feb 14 at 8:45 PM PT. Tags go official Feb 15. Keep your phones close.`;
  return {
    id: `sf_tagwatch_${year}`,
    timestamp: now.toISOString(),
    type: 'transaction',
    transactionSubType: 'tag_rumor',
    tagRumorKind: 'watch',
    tier: 'rumor',
    headline: `Franchise tag watch: the window is open`,
    body,
    authorId: 'claude',
    franchiseIds: [...new Set(shortlist.map((c) => c.franchiseId))],
    playerIds: shortlist.map((c) => c.playerId),
    league: leagueSlug,
  };
}

/**
 * A leak or a correction. Carries the team and the position ONLY — no
 * playerIds, no declaration id, no value — so neither the card, the feed JSON
 * nor the watch-list tagger can say more than the sentence does. When the
 * team has two or more tag-eligible players at that position, they are
 * "in the mix" together, the real one among them; with one, nobody is named,
 * because a lone name WOULD be the player.
 */
export function buildRumorPost({ item, tag, candidates, teamName, now, leagueSlug }) {
  const team = teamName(tag.franchiseId) ?? `Team ${tag.franchiseId}`;
  const pos = positionWord(tag.position);
  const salt = `${item.kind}:${item.id}`;
  let body;
  let headline;
  if (item.kind === 'leak') {
    const peers = candidates.filter((c) => c.franchiseId === tag.franchiseId && c.position === tag.position);
    const mix = peers.length >= 2 ? ` Names in the mix: ${andList(peers.slice(0, 3).map((c) => displayName(c.name)))}.` : '';
    body = `${pick(LEAK_LINES, salt)(team, pos)}${mix} Nothing's official until Feb 15.`;
    headline = `Tag buzz: ${team} eye a ${pos}`;
  } else {
    body = pick(tag.leakedAt ? CHANGED_AFTER_LEAK : CHANGED_NO_LEAK, salt)(team, pos);
    headline = `Tag buzz: plans change for the ${team}`;
  }
  return {
    id: `sf_tagrumor_${stableHash(salt).toString(36)}`,
    timestamp: now.toISOString(),
    type: 'transaction',
    transactionSubType: 'tag_rumor',
    tagRumorKind: item.kind,
    tier: 'rumor',
    headline,
    body,
    authorId: 'claude',
    franchiseIds: [tag.franchiseId],
    league: leagueSlug,
  };
}

/**
 * The state after a run: reported ids added, tag posts stamped, stale rows pruned.
 * @param {ContractMoveState} state
 * @param {{ reportedIds?: string[], tagPost?: any, tagItem?: { kind: string, id?: string } | null, now: Date }} args
 * @returns {ContractMoveState}
 */
export function settleState(state, { reportedIds = [], tagPost = null, tagItem = null, now }) {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  /** @type {Record<string, string>} */
  const reported = {};
  for (const [id, at] of Object.entries(state.reported)) {
    if (nowMs - ms(at) <= REPORTED_KEEP_MS) reported[id] = at;
  }
  for (const id of reportedIds) reported[id] = nowIso;

  const year = tagWindowGate(now).year;
  /** @type {Record<string, TrackedTag>} */
  const tags = {};
  for (const [id, t] of Object.entries(state.tags)) {
    // A tag from an earlier window is resolved history; nothing reads it.
    if (new Date(t.firstSeenAt).getUTCFullYear() >= year) tags[id] = t;
  }
  let { watchYear, lastRumorAt } = state;
  if (tagPost && tagItem) {
    lastRumorAt = nowIso;
    if (tagItem.kind === 'watch') watchYear = year;
    else if (tagItem.id && tags[tagItem.id]) {
      const tid = tagItem.id;
      tags[tid] = { ...tags[tid], [tagItem.kind === 'leak' ? 'leakedAt' : 'changedAt']: nowIso };
    }
  }
  return { reported, tags, watchYear, lastRumorAt };
}
