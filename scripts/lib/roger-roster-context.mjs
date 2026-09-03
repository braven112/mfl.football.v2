/**
 * Roger roster context — the fact sheet behind a Roger clapback.
 *
 * When an owner replies to one of Roger's reminders with a shot at him, Roger
 * fires back. The joke only works if the burn is TRUE, so this module turns
 * three MFL feeds (rosters, players, league) into a small, verified fact sheet:
 * how many bodies the owner is carrying at each position, how many of those
 * they are allowed to START, and where that sits against the rest of the
 * league.
 *
 * The load-bearing number is the SURPLUS — roster count minus the starting
 * limit. TheLeague starts exactly one quarterback, so an owner sitting on four
 * of them is carrying three that can never take a snap for him. That is the
 * whole joke, and it is the reason this file exists rather than a hardcoded
 * "you have 4 QBs" string: the count is recomputed from live feeds every time
 * Roger opens his mouth, so he can never burn someone for a roster they traded
 * away last week.
 *
 * Everything here is PURE — callers hand over already-parsed JSON. The script
 * owns the fs reads so the scoring logic stays trivially testable.
 */

/**
 * Positions worth roasting. Team defenses / kickers are on the list because a
 * franchise stockpiling three kickers deserves to hear about it, but the
 * `hardCap` flag below is what actually decides who gets roasted first.
 */
const ROASTABLE = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF', 'Def']);

/** MFL writes team defenses as 'Def'; normalize so counts don't split in two. */
function normalizePosition(position) {
  if (typeof position !== 'string') return null;
  const upper = position.toUpperCase();
  if (upper === 'DEF' || upper === 'DST') return 'DEF';
  return upper;
}

/**
 * Parse an MFL starter limit. The feed writes a fixed requirement as "1" and a
 * flex range as "1-4".
 *
 * `hardCap` (min === max) is the distinction that matters: a QB slot of exactly
 * 1 means the fourth quarterback is dead weight with certainty, while an RB
 * range of 1-4 means the sixth running back MIGHT start depending on how the
 * flex falls. Roasting the certain case is fair; roasting the fuzzy one is how
 * a bot ends up factually wrong in front of sixteen owners.
 *
 * @returns {{min: number, max: number, hardCap: boolean} | null}
 */
export function parseStarterLimit(rawLimit) {
  if (typeof rawLimit !== 'string' && typeof rawLimit !== 'number') return null;
  const text = String(rawLimit).trim();
  const range = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const min = parseInt(range[1], 10);
    const max = parseInt(range[2], 10);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max, hardCap: min === max };
  }
  const exact = text.match(/^(\d+)$/);
  if (!exact) return null;
  const n = parseInt(exact[1], 10);
  if (!Number.isFinite(n)) return null;
  return { min: n, max: n, hardCap: true };
}

/**
 * Build a Map<position, {min,max,hardCap}> from the league feed's starters
 * block. Returns an empty map when the feed is missing the block — callers
 * degrade to count-only facts rather than inventing a limit.
 */
export function buildStarterLimits(leagueFeed) {
  const limits = new Map();
  const positions = leagueFeed?.league?.starters?.position;
  if (!Array.isArray(positions)) return limits;
  for (const entry of positions) {
    const pos = normalizePosition(entry?.name);
    const limit = parseStarterLimit(entry?.limit);
    if (pos && limit) limits.set(pos, limit);
  }
  return limits;
}

/** Index players.json by id so roster entries can be resolved to a position. */
export function indexPlayers(playersFeed) {
  const index = new Map();
  const list = playersFeed?.players?.player;
  if (!Array.isArray(list)) return index;
  for (const p of list) {
    if (p?.id) index.set(String(p.id), p);
  }
  return index;
}

/**
 * MFL names players "Last, First". Roger talks like a person, so flip it.
 * Falls back to the raw string when the comma isn't there (team defenses).
 */
export function displayName(mflName) {
  if (typeof mflName !== 'string') return '';
  const parts = mflName.split(',');
  if (parts.length !== 2) return mflName.trim();
  return `${parts[1].trim()} ${parts[0].trim()}`.trim();
}

/**
 * Count rostered players by position for every franchise in the feed.
 *
 * Only ROSTER/TAXI_SQUAD/INJURED_RESERVE bodies count — a player the owner has
 * already dropped is not theirs to be mocked for.
 *
 * @returns {Map<string, Map<string, Array<{id: string, name: string}>>>}
 *   franchiseId → position → players
 */
export function countRosterPositions(rostersFeed, playerIndex) {
  const byFranchise = new Map();
  const franchises = rostersFeed?.rosters?.franchise;
  if (!Array.isArray(franchises)) return byFranchise;

  for (const franchise of franchises) {
    const franchiseId = franchise?.id;
    if (!franchiseId) continue;
    const positions = new Map();
    // MFL collapses a single-player roster to an object rather than an array.
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];

    for (const entry of players) {
      const status = String(entry?.status ?? 'ROSTER').toUpperCase();
      if (status !== 'ROSTER' && status !== 'TAXI_SQUAD' && status !== 'INJURED_RESERVE') continue;
      const meta = playerIndex.get(String(entry?.id));
      const pos = normalizePosition(meta?.position);
      if (!pos || !ROASTABLE.has(pos)) continue;
      if (!positions.has(pos)) positions.set(pos, []);
      positions.get(pos).push({ id: String(entry.id), name: displayName(meta.name) });
    }
    byFranchise.set(String(franchiseId), positions);
  }
  return byFranchise;
}

/**
 * Score how roastable a positional surplus is.
 *
 * A hard-capped position counts double because the burn is unarguable there:
 * a fourth QB in a start-one league is three players of pure decoration, while
 * a sixth RB in a 1-4 flex range might genuinely play. Doubling is what makes
 * QB win the tiebreak against a numerically similar RB pile, which is exactly
 * the ranking a human would apply.
 */
export function roastScore({ count, limit }) {
  if (!limit) return 0;
  const surplus = count - limit.max;
  if (surplus <= 0) return 0;
  return surplus * (limit.hardCap ? 2 : 1);
}

/**
 * One position's surplus for a franchise: how many they carry, how many the
 * league lets them start, and the names behind the gap.
 *
 * `topRoast` is the highest-scoring element of `positions`, so it is this same
 * shape — declaring it as a bare `object` (as this did originally) let every
 * caller read `.startMax` off it without the checker ever confirming the field
 * exists, which is a poor trade on a module whose entire job is to be factually
 * correct out loud in front of two dozen owners.
 *
 * @typedef {{
 *   position: string,
 *   count: number,
 *   startMax: number|null,
 *   hardCap: boolean,
 *   surplus: number,
 *   score: number,
 *   names: string[]
 * }} RosterPositionSurplus
 */

/**
 * How one franchise's count at a position compares with the rest of the league.
 *
 * @typedef {{
 *   position: string,
 *   count: number,
 *   leagueMax: number,
 *   leagueMedian: number,
 *   isLeagueMax: boolean,
 *   tiedAtMax: number
 * }} RosterLeagueContext
 */

/**
 * Everything Roger is allowed to know about one franchise's roster.
 *
 * @typedef {{
 *   franchiseId: string,
 *   rosterSize: number,
 *   positions: RosterPositionSurplus[],
 *   topRoast: RosterPositionSurplus|null,
 *   leagueContext: RosterLeagueContext|null
 * }} RosterRoast
 */

/**
 * Assemble the full fact sheet for one franchise.
 *
 * @param {object} opts
 * @param {string} opts.franchiseId
 * @param {object} opts.rostersFeed  parsed rosters.json
 * @param {object} opts.playersFeed  parsed players.json
 * @param {object} [opts.leagueFeed]  parsed league.json (for starter limits)
 * @returns {RosterRoast|null}  null when the franchise isn't in the feed at all.
 */
export function buildRosterRoast({ franchiseId, rostersFeed, playersFeed, leagueFeed }) {
  const playerIndex = indexPlayers(playersFeed);
  const limits = buildStarterLimits(leagueFeed);
  const byFranchise = countRosterPositions(rostersFeed, playerIndex);

  const mine = byFranchise.get(String(franchiseId));
  if (!mine) return null;

  const positions = [];
  let rosterSize = 0;
  for (const [position, players] of mine) {
    rosterSize += players.length;
    const limit = limits.get(position) ?? null;
    const score = roastScore({ count: players.length, limit });
    positions.push({
      position,
      count: players.length,
      startMax: limit ? limit.max : null,
      hardCap: limit ? limit.hardCap : false,
      surplus: limit ? Math.max(0, players.length - limit.max) : 0,
      score,
      names: players.map((p) => p.name),
    });
  }
  positions.sort((a, b) => b.score - a.score || b.count - a.count);

  const topRoast = positions.length > 0 && positions[0].score > 0 ? positions[0] : null;

  // League-wide context for the roasted position, so "most in the league" is a
  // checkable claim rather than a flourish the LLM invented.
  let leagueContext = null;
  if (topRoast) {
    const counts = [];
    for (const positionsForFranchise of byFranchise.values()) {
      counts.push(positionsForFranchise.get(topRoast.position)?.length ?? 0);
    }
    counts.sort((a, b) => a - b);
    const leagueMax = counts[counts.length - 1] ?? 0;
    const mid = Math.floor(counts.length / 2);
    const leagueMedian =
      counts.length === 0
        ? 0
        : counts.length % 2 === 0
          ? (counts[mid - 1] + counts[mid]) / 2
          : counts[mid];
    leagueContext = {
      position: topRoast.position,
      count: topRoast.count,
      leagueMax,
      leagueMedian,
      isLeagueMax: topRoast.count === leagueMax,
      tiedAtMax: counts.filter((c) => c === leagueMax).length,
    };
  }

  return { franchiseId: String(franchiseId), rosterSize, positions, topRoast, leagueContext };
}

/**
 * How many players at each position the franchise took in this year's rookie
 * draft, and how many of those were made by MFL off a pre-draft list rather
 * than by a human at a keyboard.
 *
 * The autodraft marker is MFL's own comment text — it stamps
 * "[Pick made from Pre-Draft List]" on any pick the clock made for you. That is
 * the difference between "you drafted four quarterbacks" and "a robot drafted
 * four quarterbacks for you", and Roger should know which one he's looking at
 * before he swings.
 *
 * @typedef {{
 *   position: string,
 *   drafted: number,
 *   autodrafted: number,
 *   names: string[]
 * }} DraftContext
 *
 * @returns {DraftContext}
 */
export function buildDraftContext({ franchiseId, draftFeed, playersFeed, position }) {
  const playerIndex = indexPlayers(playersFeed);
  const unit = draftFeed?.draftResults?.draftUnit;
  const units = Array.isArray(unit) ? unit : unit ? [unit] : [];
  const target = normalizePosition(position);

  let drafted = 0;
  let autodrafted = 0;
  const names = [];

  for (const u of units) {
    const picks = Array.isArray(u?.draftPick) ? u.draftPick : u?.draftPick ? [u.draftPick] : [];
    for (const pick of picks) {
      if (String(pick?.franchise) !== String(franchiseId)) continue;
      const meta = playerIndex.get(String(pick?.player));
      if (!meta || normalizePosition(meta.position) !== target) continue;
      drafted += 1;
      const auto = /pre-draft list/i.test(String(pick?.comments ?? ''));
      if (auto) autodrafted += 1;
      names.push(displayName(meta.name));
    }
  }

  return { position: target, drafted, autodrafted, names };
}
