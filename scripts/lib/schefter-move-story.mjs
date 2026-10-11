/**
 * schefter-move-story.mjs — Schefter's write-up of ONE roster move.
 *
 * Before this, every pickup, waiver claim, auction win and cut was a code
 * template ("Drunk Indians claims WR Cooper, Darius"), and only trades and
 * $3M auctions reached the model. The Transactions page now leads with
 * Schefter's story for each move and keeps MFL's record behind "See details",
 * so a template reads as the page's headline 300 times a season.
 *
 * One call per move, the add and its drop together. Used by two callers:
 *   - scripts/schefter-scan.mjs, for every new move as it is scanned, and
 *   - scripts/schefter-backfill-move-stories.mjs, once, for the season so far.
 *
 * Load-bearing rules (docs/claude/rules/schefter.md):
 *   - The model is never handed a franchise name. It gets `{{TEAM:<fid>}}` and
 *     the name is substituted in code; any other `{{…}}` in its output is a
 *     FAILED generation and the template stays.
 *   - A post may only assert what its input carries. The payload is the move
 *     and nothing else: no lore, no memory block, no stats. The prompt forbids
 *     inventing injuries, stats, quotes or a price.
 *   - A first-come-first-served pickup is never free in a salary league, so a
 *     price is printed only when the caller passes one, and the model is told
 *     never to call a move free.
 *   - Any failure (no key, HTTP error, bad JSON, a story that does not name the
 *     player) returns null and the caller keeps the template post. A move is
 *     never dropped because the model misbehaved.
 */

import { rosterMoveString } from './roster-move-parse.mjs';

/** Bump when the story shape or prompt changes enough to rewrite old posts. */
export const MOVE_STORY_VERSION = 2;

/** Same model the scanner's other transaction lanes use. */
export const MOVE_STORY_MODEL = 'claude-haiku-4-5-20251001';

/** Feed sub-types this writer covers. Trades keep their own breaking lane. */
export const MOVE_STORY_SUBTYPES = new Set(['FREE_AGENT', 'AUCTION_WON']);

const KIND_LABEL = {
  FREE_AGENT: 'first-come free-agent pickup',
  WAIVER: 'waiver claim',
  BBID_WAIVER: 'blind-bid waiver claim',
  AUCTION_WON: 'auction win',
};

/** MFL's salary figures (whole dollars) as the scanner prints them. */
export function formatSalary(amount) {
  if (!Number.isFinite(amount) || amount === 0) return '$0';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

const isDefense = (player) => player?.position === 'Def' || player?.position === 'DEF';

/**
 * A player as a reader says it: "Case Keenum", "the New Orleans Saints
 * defense". MFL stores "Keenum, Case" and "Saints, New Orleans".
 */
export function readableName(player) {
  if (!player?.name) return null;
  const [last, first] = String(player.name).split(', ');
  if (isDefense(player)) {
    return first ? `the ${first} ${last} defense` : `the ${player.name} defense`;
  }
  return first ? `${first} ${last}` : String(player.name);
}

/**
 * The word a story has to contain to prove it is about this player: the last
 * name, or a defense's nickname ("Saints"). Lowercased.
 */
export function anchorWord(player) {
  if (!player?.name) return null;
  const last = String(player.name).split(', ')[0];
  // "Washington Jr." → "washington"; a suffix is not what a writer reliably keeps.
  return last.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').trim().toLowerCase() || null;
}

/**
 * @typedef {{ id: string, name: string, position: string, nflTeam: string, anchor: string | null }} MovePlayer
 */

/** @returns {MovePlayer | null} */
function describe(id, players) {
  const player = players.get(id);
  const name = readableName(player);
  if (!name) return null;
  return {
    id,
    name,
    position: isDefense(player) ? 'DEF' : (player.position ?? ''),
    nflTeam: player.nflTeam ?? '',
    anchor: anchorWord(player),
  };
}

/**
 * The facts for one move, or null when a player cannot be named (the story
 * would have to say "Player 16171", which is worse than the template).
 *
 * @param {object} input
 * @param {string} input.rawType   MFL type: FREE_AGENT | WAIVER | BBID_WAIVER | AUCTION_WON
 * @param {string} input.franchiseId
 * @param {string[]} input.addedIds
 * @param {string[]} input.droppedIds
 * @param {Map<string, {name:string, position?:string, nflTeam?:string}>} input.players
 * @param {string|null} [input.price]       already-formatted cost of the add, or null
 * @param {string|null} [input.dropSalary]  already-formatted contract walked away from, or null
 * @param {string} input.leagueName
 * @param {boolean} input.hasSalaries
 */
export function buildMoveFacts(input) {
  const { rawType, franchiseId, addedIds = [], droppedIds = [], players } = input;
  const addedRaw = addedIds.map((id) => describe(id, players));
  const droppedRaw = droppedIds.map((id) => describe(id, players));
  if (addedRaw.length + droppedRaw.length === 0) return null;
  if (addedRaw.some((p) => !p) || droppedRaw.some((p) => !p)) return null;
  const added = /** @type {MovePlayer[]} */ (addedRaw);
  const dropped = /** @type {MovePlayer[]} */ (droppedRaw);
  return {
    kind: added.length === 0 ? 'release (a cut, nothing added)' : (KIND_LABEL[rawType] ?? 'roster move'),
    franchiseId,
    team: `{{TEAM:${franchiseId}}}`,
    added,
    dropped,
    price: added.length > 0 ? (input.price ?? null) : null,
    dropSalary: input.dropSalary ?? null,
    leagueName: input.leagueName,
    hasSalaries: !!input.hasSalaries,
  };
}

/**
 * Facts straight from a raw MFL transaction row — the one path both the
 * scanner and the backfill take, so the two cannot describe a move
 * differently. `parseRosterMove` is passed in (scripts/lib/roster-move-parse)
 * rather than re-implemented: a hand split of MFL's pipe string has shipped
 * "Player 16171" twice (docs/claude/rules/schefter.md).
 *
 * @param {object} raw  the MFL row
 * @param {object} ctx  { players, parseRosterMove, leagueName, hasSalaries, dropSalary? }
 */
export function factsFromRawMove(raw, ctx) {
  const { players, parseRosterMove, leagueName, hasSalaries } = ctx;
  const move = rosterMoveString(raw);
  if (!move || !raw?.franchise) return null;

  if (raw.type === 'AUCTION_WON') {
    // "|playerId,|salary|" — read the player, price only a real salary.
    const parts = String(raw.transaction).replace(/^\|/, '').replace(/\|$/, '').split('|').filter(Boolean);
    const playerId = parts[0]?.replace(/,$/, '');
    const salary = parts[1] ? parseInt(parts[1], 10) : NaN;
    return buildMoveFacts({
      rawType: raw.type,
      franchiseId: raw.franchise,
      addedIds: playerId ? [playerId] : [],
      droppedIds: [],
      players,
      price: hasSalaries && Number.isFinite(salary) && salary > 100_000 ? formatSalary(salary) : null,
      leagueName,
      hasSalaries,
    });
  }

  const { addedIds, droppedIds, bbidAmount } = parseRosterMove(move);
  // The scanner's own threshold: below it the "bid" is a FAAB-style token
  // amount or MFL's zero, not a salary worth printing.
  const price = hasSalaries && Number.isFinite(bbidAmount) && bbidAmount > 100_000 ? formatSalary(bbidAmount) : null;
  return buildMoveFacts({
    rawType: raw.type,
    franchiseId: raw.franchise,
    addedIds,
    droppedIds,
    players,
    price,
    dropSalary: ctx.dropSalary ?? null,
    leagueName,
    hasSalaries,
  });
}

/** The system + user prompt for one move. Exported for tests. */
export function buildMovePrompt(facts) {
  const system = [
    `You are Claude Schefter, the insider beat reporter for ${facts.leagueName}, a fantasy football league.`,
    `You write the one-paragraph wire story for a single roster move, in Adam Schefter's voice: confident, quick, plugged-in ("I'm told", "Sources say", "Smart move" — vary it, never the same opener twice in a row).`,
    '',
    'HARD RULES',
    '1. The team is written ONLY as the exact token given (e.g. {{TEAM:9999}}). Never write a team name, nickname or any other {{…}} token.',
    '2. Assert only what the payload says. Do not invent stats, injuries, depth-chart news, quotes, matchups or a reason the team gave. You may read the move in hedged terms ("looks like depth", "a flier", "streaming the defense").',
    '3. Mention a price only if the payload has one, exactly as written. Never call any move free or say it cost nothing.',
    '4. Name every added and dropped player from the payload. Use the names exactly as given.',
    '5. No emojis, no hashtags, no "BREAKING" — this is the everyday wire, not a blockbuster.',
    '6. headline: at most 80 characters, present tense, names the team token and the main player. body: 1-2 sentences, at most 260 characters.',
    '',
    'Reply with JSON only: {"headline": "...", "body": "..."}',
    '',
    'Example payload: {"kind":"waiver claim","team":"{{TEAM:9999}}","added":[{"name":"Roschon Johnson","position":"RB","nflTeam":"CHI"}],"dropped":[{"name":"Darnell Washington","position":"TE","nflTeam":"PIT"}],"price":null}',
    'Example reply: {"headline":"{{TEAM:9999}} claim Roschon Johnson, cut Darnell Washington","body":"{{TEAM:9999}} put in the claim on Bears RB Roschon Johnson and let TE Darnell Washington go to make room. Smells like a depth play at running back."}',
  ].join('\n');

  const payload = {
    kind: facts.kind,
    team: facts.team,
    added: facts.added.map(({ name, position, nflTeam }) => ({ name, position, nflTeam })),
    dropped: facts.dropped.map(({ name, position, nflTeam }) => ({ name, position, nflTeam })),
    price: facts.price,
    ...(facts.dropSalary ? { droppedContract: facts.dropSalary } : {}),
    ...(facts.hasSalaries ? {} : { note: 'This league has no salaries; do not mention money.' }),
  };
  return { system, user: `Write the story for this move:\n${JSON.stringify(payload)}` };
}

/**
 * Substitute the team token. Returns null when anything token-shaped survives
 * — the model invented a token or copied the example's 9999 — because a
 * literal `{{…}}` on the page is worse than the template.
 */
export function resolveMoveTokens(text, facts, teams) {
  const name = teams.get(facts.franchiseId)?.name;
  if (!name || typeof text !== 'string') return null;
  const out = text.split(`{{TEAM:${facts.franchiseId}}}`).join(name);
  return /\{\{|\}\}/.test(out) ? null : out;
}

/**
 * Parse and check a model reply. Null unless it is JSON with both fields, in
 * bounds, token-clean, and names the move's main player.
 */
export function parseMoveStory(text, facts, teams) {
  const match = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null;
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const headline = resolveMoveTokens(String(parsed?.headline ?? '').trim(), facts, teams);
  const body = resolveMoveTokens(String(parsed?.body ?? '').trim(), facts, teams);
  if (!headline || !body) return null;
  if (headline.length < 10 || headline.length > 120) return null;
  if (body.length < 20 || body.length > 420) return null;
  // The move is the add AND every drop: a story that leaves one out is a
  // different move. Anchors are lowercase; the placeholder check is not.
  const story = `${headline} ${body}`;
  const lower = story.toLowerCase();
  for (const p of [...facts.added, ...facts.dropped]) {
    if (p.anchor && !lower.includes(p.anchor)) return null;
  }
  if (/\bPlayer \d+\b/i.test(story)) return null;
  return { headline, body };
}

/**
 * Ask the model for the story. Null on any failure — the caller keeps its
 * template post.
 */
export async function writeMoveStory({ facts, teams, apiKey, fetchImpl = fetch }) {
  if (!facts || !apiKey) return null;
  const { system, user } = buildMovePrompt(facts);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MOVE_STORY_MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      console.warn(`  [move-story] API returned ${res.status} — keeping template`);
      return null;
    }
    const data = await res.json();
    const story = parseMoveStory(data?.content?.[0]?.text ?? '', facts, teams);
    if (!story) console.warn('  [move-story] Reply failed validation — keeping template');
    return story;
  } catch (err) {
    console.warn(`  [move-story] ${err.message} — keeping template`);
    return null;
  }
}

/**
 * Stamp a story onto a feed post. `addedIds`/`droppedIds` are what the
 * Transactions page joins a post to its MFL row by (with the timestamp and
 * franchise); `playerIds` is left alone, because the watch-list push and the
 * player tagger already read it.
 */
export function applyMoveStory(post, story, facts) {
  post.headline = story.headline;
  post.body = story.body;
  post.storyVersion = MOVE_STORY_VERSION;
  post.addedIds = facts.added.map((p) => p.id);
  post.droppedIds = facts.dropped.map((p) => p.id);
  return post;
}
