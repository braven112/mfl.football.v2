/**
 * schefter-wire-formats.mjs — the short, tweet-shaped transaction posts.
 *
 * Every pickup used to get the same shape: a model-written paragraph. Adam
 * Schefter's own feed is mostly not that. It is "Ravens released QB Austin
 * Reed." on one line, a "Notable New Orleans' roster moves today:" list with a
 * 🏈 header per kind of move, and "Lions officially placed LB Jack Campbell on
 * injured reserve." (Brandon's screenshots, Nov 2026). This module writes
 * those three shapes, in code, from the move and nothing else:
 *
 *   - a ONE-LINER for a routine move (`shouldUseOneLiner` picks about one in
 *     three, deterministically, so a re-run writes the same post),
 *   - an IR post for MFL's `IR` transaction, with the injury only when MFL's
 *     own injury report names one for that player id, and
 *   - a ROSTER LIST when one team makes several routine moves in one day.
 *
 * Pure: no fetch, no fs, no clock. The scanner (scripts/schefter-scan.mjs)
 * owns the data and the feed write; tests/schefter-wire-formats.test.ts pins
 * the wording.
 *
 * Load-bearing rules (docs/claude/rules/schefter.md § "Tweet-shaped posts"):
 *   - A post asserts only what its input carries. An injury reason comes from
 *     MFL's injury report keyed by the MFL player id, never a name match, and
 *     "Undisclosed"/"Personal"/blank print nothing.
 *   - Only MINOR, non-big-drop moves fold into a roster list. A standard or
 *     breaking move keeps its own post, because that post is what the AFL's
 *     chat and the big-drop lane send.
 *   - Text is written plain, like every other story: the feed renders a body
 *     with set:html and the Transactions page as text, so an entity escape
 *     here would print "&amp;" on one of them. Names come from MFL's players
 *     file and team config, never from a user.
 */

import { readableName, formatSalary, MOVE_STORY_VERSION } from './schefter-move-story.mjs';
import { parseRosterMove, rosterMoveString } from './roster-move-parse.mjs';

/** Bump when a format's wording changes enough to matter on old posts. */
export const WIRE_FORMAT_VERSION = 1;

/** Feed sub-type of a roster-list post. */
export const ROSTER_LIST_SUBTYPE = 'ROSTER_MOVES';
/** Feed sub-type of an IR post. */
export const IR_SUBTYPE = 'IR';

/** A roster list needs at least this many players named… */
export const ROSTER_LIST_MIN_LINES = 3;
/** …across at least this many separate MFL transactions. */
export const ROSTER_LIST_MIN_MOVES = 2;

/** One routine move in this many is written as a one-liner. */
export const ONE_LINER_EVERY = 3;

/** Names are trusted registry/MFL text and printed as-is (see header). */
const escapeHtml = (s) => String(s);

const isDefense = (player) => player?.position === 'Def' || player?.position === 'DEF';

/** "Austin Reed" from MFL's "Reed, Austin"; null when the player is unknown. */
function fullName(player) {
  return readableName(player);
}

/**
 * A player the way Schefter writes one into a sentence: "QB Austin Reed",
 * "the New Orleans Saints defense". Null when the player cannot be named.
 */
export function playerPhrase(player) {
  const name = fullName(player);
  if (!name) return null;
  if (isDefense(player)) return escapeHtml(name);
  const pos = player.position ? `${player.position} ` : '';
  return escapeHtml(`${pos}${name}`);
}

/** A list line: "QB Austin Reed", "New Orleans Saints defense". */
export function playerLine(player) {
  const phrase = playerPhrase(player);
  if (!phrase) return null;
  return phrase.replace(/^the /, (m) => (isDefense(player) ? '' : m));
}

/** "A", "A and B", "A, B and C". */
export function joinNames(parts) {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Last name for a second reference: "Robinson" from "Robinson Jr., Brian". */
export function lastName(player) {
  if (!player?.name) return null;
  if (isDefense(player)) return null;
  const last = String(player.name).split(', ')[0];
  return last.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').trim() || null;
}

/**
 * About one routine move in `ONE_LINER_EVERY` is a one-liner. Keyed on the
 * MFL timestamp (+ franchise, so a waiver run's same-second claims spread
 * out), never Math.random: a re-scan must choose the same way.
 */
export function shouldUseOneLiner(sourceTimestamp, franchiseId = '') {
  const key = `${sourceTimestamp}|${franchiseId}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % ONE_LINER_EVERY === 0;
}

const ADD_VERB = {
  FREE_AGENT: 'signed',
  WAIVER: 'claimed',
  BBID_WAIVER: 'claimed',
  AUCTION_WON: 'won',
};
const ADD_TAIL = {
  WAIVER: ' off waivers',
  BBID_WAIVER: ' off waivers',
  AUCTION_WON: ' at auction',
};

/**
 * The one-liner for a pickup, claim or cut.
 *
 * @param {object} input
 * @param {string} input.team        the franchise's display name
 * @param {string} input.rawType     MFL type: FREE_AGENT | WAIVER | BBID_WAIVER | AUCTION_WON
 * @param {object[]} input.added     player records ({name, position})
 * @param {object[]} input.dropped
 * @param {string|null} [input.price] formatted contract, printed only when given
 * @returns {{headline: string, body: string} | null}
 */
export function oneLiner({ team, rawType, added = [], dropped = [], price = null }) {
  const adds = added.map(playerPhrase);
  const drops = dropped.map(playerPhrase);
  if (adds.length + drops.length === 0) return null;
  if (adds.some((p) => !p) || drops.some((p) => !p)) return null;
  const tm = escapeHtml(team);
  const verb = ADD_VERB[rawType] ?? 'signed';
  const tail = ADD_TAIL[rawType] ?? '';
  const cost = price ? ` for ${escapeHtml(price)}` : '';

  if (adds.length === 0) {
    return {
      headline: `${tm} release ${joinNames(dropped.map((p) => escapeHtml(fullName(p))))}`,
      body: `${tm} released ${joinNames(drops)}.`,
    };
  }
  const addPart = `${verb} ${joinNames(adds)}${tail}${cost}`;
  const body = drops.length
    ? `${tm} ${addPart} and released ${joinNames(drops)}.`
    : `${tm} ${addPart}.`;
  return {
    headline: `${tm} add ${joinNames(added.map((p) => escapeHtml(fullName(p))))}`,
    body,
  };
}

/**
 * What MFL's injury report lets us say about why a player went on IR, or
 * null. `entry` is one row of `export?TYPE=injuries` keyed by MFL id:
 * `{ injuryStatus, injuryBodyPart }` (the flattened feed) or
 * `{ status, details }` (the raw export's `injury[]` rows).
 */
export function injuryReason(player, entry) {
  const last = lastName(player);
  if (!last || !entry) return null;
  const part = String(entry.injuryBodyPart ?? entry.details ?? '').trim();
  if (!part || /^(undisclosed|personal|not injury related|nir|unknown|retired)$/i.test(part)) return null;
  const name = escapeHtml(last);
  const lower = part.toLowerCase();
  if (lower === 'concussion') return `${name} is in the concussion protocol.`;
  if (lower === 'illness') return `${name} is dealing with an illness.`;
  return `${name} has a ${escapeHtml(lower)} injury.`;
}

/**
 * The post for one MFL `IR` transaction: players moved to IR
 * (`deactivated`) and/or back from it (`activated`).
 *
 * @param {object} input
 * @param {string} input.team
 * @param {object[]} input.placed      players moved to IR
 * @param {object[]} input.activated   players activated from IR
 * @param {Map<string, object>|null} [input.injuries]  MFL id → injury row
 * @param {boolean} [input.another]    this team already put someone on IR today
 * @returns {{headline: string, body: string} | null}
 */
export function irPost({ team, placed = [], activated = [], injuries = null, another = false }) {
  const placedP = placed.map(playerPhrase);
  const activeP = activated.map(playerPhrase);
  if (placedP.length + activeP.length === 0) return null;
  if (placedP.some((p) => !p) || activeP.some((p) => !p)) return null;
  const tm = escapeHtml(team);

  const parts = [];
  if (placedP.length) parts.push(`placed ${joinNames(placedP)} on injured reserve`);
  if (activeP.length) parts.push(`activated ${joinNames(activeP)} from injured reserve`);
  let body = `${tm} ${parts.join(' and ')}.`;
  if (another && placedP.length) body = `Another player added to IR: ${body}`;

  // One reason, for a lone placement: a list of three body parts reads like
  // a medical chart, and "he" would be ambiguous.
  if (placed.length === 1 && injuries) {
    const reason = injuryReason(placed[0], injuries.get(String(placed[0].id)));
    if (reason) body = `${body} ${reason}`;
  }

  const names = (list) => joinNames(list.map((p) => escapeHtml(fullName(p))));
  const headline = placed.length
    ? `${tm} place ${names(placed)} on IR`
    : `${tm} activate ${names(activated)} from IR`;
  return { headline, body };
}

const SECTION_ORDER = ['added', 'released', 'placedOnIr', 'activatedFromIr'];
const SECTION_LABEL = {
  added: 'Added',
  released: 'Released',
  placedOnIr: 'Placed on IR',
  activatedFromIr: 'Activated from IR',
};

/** How many player lines a move contributes to a roster list. */
export function linesIn(move) {
  return SECTION_ORDER.reduce((n, k) => n + (move[k]?.length ?? 0), 0);
}

/**
 * The roster list for one team's day.
 *
 * @param {object} input
 * @param {string} input.team
 * @param {Array<{added?: object[], released?: object[], placedOnIr?: object[], activatedFromIr?: object[]}>} input.moves
 *   oldest first; each player a `{name, position}` record
 * @returns {{headline: string, body: string} | null}
 */
export function rosterList({ team, moves }) {
  const sections = Object.fromEntries(SECTION_ORDER.map((k) => [k, []]));
  for (const move of moves) {
    for (const k of SECTION_ORDER) {
      for (const p of move[k] ?? []) {
        const line = playerLine(p);
        if (!line) return null;
        if (!sections[k].includes(line)) sections[k].push(line);
      }
    }
  }
  const total = SECTION_ORDER.reduce((n, k) => n + sections[k].length, 0);
  if (total === 0) return null;

  const tm = escapeHtml(team);
  // "Notable The Mariachi Ninjas roster moves" trips over its own article.
  const lead = /^the\s/i.test(team)
    ? `Notable roster moves today for ${tm}:`
    : `Notable ${tm} roster moves today:`;
  const blocks = SECTION_ORDER.filter((k) => sections[k].length).map(
    (k) => `🏈 ${SECTION_LABEL[k]}:\n${sections[k].join('\n')}`,
  );
  const tally = [
    sections.added.length && `${sections.added.length} added`,
    sections.released.length && `${sections.released.length} released`,
    sections.placedOnIr.length && `${sections.placedOnIr.length} to IR`,
    sections.activatedFromIr.length && `${sections.activatedFromIr.length} back from IR`,
  ].filter(Boolean);
  return {
    headline: `${tm} roster moves: ${tally.join(', ')}`,
    body: `${lead}\n\n${blocks.join('\n\n')}`,
  };
}

/** YYYY-MM-DD of an MFL epoch-seconds timestamp on the league's own clock. */
export function leagueDay(sourceTimestamp, zone = 'America/Los_Angeles') {
  const d = new Date(Number(sourceTimestamp) * 1000);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The stable id of a team's roster list for a day — later scans extend it. */
export function rosterListId(franchiseId, day) {
  return `sf_roster_${franchiseId}_${day.replace(/-/g, '')}`;
}

/**
 * Whether a team's day of moves earns a roster list: enough players named,
 * across more than one transaction. A single add/drop is one move with two
 * names, and keeps its own post.
 */
export function earnsRosterList(moves) {
  const lines = moves.reduce((n, m) => n + linesIn(m), 0);
  return moves.length >= ROSTER_LIST_MIN_MOVES && lines >= ROSTER_LIST_MIN_LINES;
}

/** Player ids in one of MFL's comma lists ("13418,17087,"). */
export function idList(field) {
  return String(field ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

/** An MFL `IR` row's two sides: who went on IR, who came off it. */
export function irSides(txn) {
  return { placedIds: idList(txn?.deactivated), activatedIds: idList(txn?.activated) };
}

/** The ISO time of an MFL epoch-seconds timestamp. */
const isoOf = (seconds) => new Date(Number(seconds) * 1000).toISOString();

/**
 * Whether a team already put a player on IR earlier the same league day —
 * the "Another player added to IR:" lead. `posts` is everything posted so
 * far, this scan's drafts included.
 */
export function placedOnIrEarlier(posts, franchiseId, day, zone) {
  return posts.some((p) => {
    if (!p?.franchiseIds?.includes(franchiseId) || !p.sourceTimestamp) return false;
    if (leagueDay(p.sourceTimestamp, zone) !== day) return false;
    if (p.transactionSubType === IR_SUBTYPE) return (p.placedIds?.length ?? 0) > 0;
    if (p.transactionSubType === ROSTER_LIST_SUBTYPE) return (p.moves ?? []).some((m) => (m.placedIds?.length ?? 0) > 0);
    return false;
  });
}

/** Whether a draft post may fold into a roster list: routine, and not a lane's own alert. */
function foldable({ post, txn }) {
  if (!txn || post.tier !== 'minor' || post.bigDrop) return false;
  return post.transactionSubType === IR_SUBTYPE || post.transactionSubType === 'FREE_AGENT';
}

/**
 * The record a roster list keeps for one folded move. A pickup or cut also
 * keeps its one-liner, because the Transactions page leads that MFL row with
 * it (src/utils/transaction-stories.ts expands `moves`).
 */
function moveRecord({ post, txn }, ctx) {
  const { players, teams, hasSalaries } = ctx;
  if (post.transactionSubType === IR_SUBTYPE) {
    return { sourceTimestamp: String(txn.timestamp), transactionSubType: IR_SUBTYPE, ...irSides(txn) };
  }
  const { addedIds, droppedIds, bbidAmount } = parseRosterMove(rosterMoveString(txn));
  const price = hasSalaries && Number.isFinite(bbidAmount) && bbidAmount > 100_000 ? formatSalary(bbidAmount) : null;
  const line = oneLiner({
    team: teams.get(txn.franchise)?.name ?? `Team ${txn.franchise}`,
    rawType: txn.type,
    added: addedIds.map((id) => players.get(id)),
    dropped: droppedIds.map((id) => players.get(id)),
    price,
  });
  return {
    sourceTimestamp: String(txn.timestamp),
    transactionSubType: 'FREE_AGENT',
    addedIds,
    droppedIds,
    ...(line ? { headline: line.headline, body: line.body, storyVersion: MOVE_STORY_VERSION } : {}),
  };
}

/** A move record as roster-list sections, players resolved. */
function sectionsOf(move, players) {
  const get = (ids) => (ids ?? []).map((id) => {
    const p = players.get(id);
    return p ? { ...p, id } : null;
  });
  return {
    added: get(move.addedIds),
    released: get(move.droppedIds),
    placedOnIr: get(move.placedIds),
    activatedFromIr: get(move.activatedIds),
  };
}

/**
 * Fold a scan's routine moves into roster lists.
 *
 * Drafts are `{ post, txn }` in scan order. A team's routine moves for one
 * league day become ONE list post when they earn it (`earnsRosterList`), or
 * extend the list that team already has for that day — the old copy is
 * removed from `feed.posts` and the extended one returned, so it keeps its id
 * (and its reactions) and rises to the top. Everything else passes through
 * untouched. Returns the drafts to post, oldest first; a list's `txn` is null.
 *
 * Mutates `feed.posts` only to remove a list it is replacing.
 */
export function foldRosterLists(drafts, feed, ctx) {
  const { players, teams, leagueSlug, clockZone } = ctx;
  const groups = new Map();
  for (const d of drafts) {
    if (!foldable(d)) continue;
    const key = `${d.txn.franchise}|${leagueDay(d.txn.timestamp, clockZone)}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const consumed = new Set();
  const lists = [];
  for (const [key, group] of groups) {
    const [franchiseId, day] = key.split('|');
    const id = rosterListId(franchiseId, day);
    const existing = (feed.posts ?? []).find((p) => p.id === id);
    const moves = [...(existing?.moves ?? []), ...group.map((d) => moveRecord(d, ctx))];
    const sections = moves.map((m) => sectionsOf(m, players));
    if (!existing && !earnsRosterList(sections)) continue;
    const team = teams.get(franchiseId)?.name ?? `Team ${franchiseId}`;
    const list = rosterList({ team, moves: sections });
    if (!list) continue;

    const latest = moves.reduce((max, m) => (Number(m.sourceTimestamp) > Number(max) ? m.sourceTimestamp : max), '0');
    const playerIds = [...new Set(moves.flatMap((m) => [
      ...(m.addedIds ?? []), ...(m.droppedIds ?? []), ...(m.placedIds ?? []), ...(m.activatedIds ?? []),
    ]))];
    if (existing) feed.posts = feed.posts.filter((p) => p.id !== id);
    for (const d of group) consumed.add(d);
    lists.push({
      post: {
        id,
        timestamp: isoOf(latest),
        type: 'transaction',
        transactionSubType: ROSTER_LIST_SUBTYPE,
        format: 'roster-list',
        formatVersion: WIRE_FORMAT_VERSION,
        tier: 'minor',
        headline: list.headline,
        body: list.body,
        franchiseIds: [franchiseId],
        playerIds,
        sourceTimestamp: latest,
        moves,
        league: leagueSlug,
      },
      txn: null,
    });
  }

  return [...drafts.filter((d) => !consumed.has(d)), ...lists].sort(
    (a, b) => Number(a.post.sourceTimestamp) - Number(b.post.sourceTimestamp),
  );
}
