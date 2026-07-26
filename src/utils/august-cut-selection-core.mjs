/**
 * August Roster Cuts — pure cut-selection core (plain JS).
 *
 * This is the implementation behind src/utils/august-cut-selection.ts,
 * extracted to .mjs (the repo's established leagues-data.mjs pattern) so the
 * deadline execution script (scripts/apply-august-cuts.mjs) and the typed app
 * util share ONE implementation — the owner-facing preview and the deadline
 * job literally cannot drift.
 *
 *  - App code imports src/utils/august-cut-selection.ts (adds types and the
 *    canonical constants from salary-calculations.ts / contract-eligibility.ts).
 *  - Node scripts import this file directly.
 *
 * The default constants here MUST mirror their canonical .ts homes:
 *   AUGUST_CUT_TARGET            === TARGET_ACTIVE_COUNT (salary-calculations.ts)
 *   AUGUST_CUT_ACQUISITION_TYPES === ACQUISITION_TYPES (contract-eligibility.ts)
 * tests/august-cutdown-date.test.ts locks both equalities (and the
 * parseAcquisitionEvents ↔ parseTransactions parity) — if you change one
 * side, the test tells you to change the other.
 *
 * Rules (see docs/features/august-roster-cuts-automation-plan.md):
 *  1. Only `status === 'ROSTER'` players count toward the target and are
 *     cuttable. Taxi-squad and IR players are excluded from both the count
 *     and the cut pool.
 *  2. overage = active count − target. If ≤ 0, NO cuts — marked players are
 *     consumed only to reach the cap, never cut for their own sake.
 *  3. Marked players go first, in the owner's given order, skipping any that
 *     are no longer on the active roster (traded / already cut / taxi / IR).
 *  4. Remaining overage is filled newest-acquisition-first (acquisition
 *     timestamp descending). Players with no acquisition record are treated
 *     as oldest (cut last). Trades NEVER count as acquisitions — only
 *     the acquisition types below (BBID_WAIVER / FREE_AGENT / AUCTION_WON).
 *  5. Never cut below target: the result always contains exactly `overage`
 *     players.
 */

/** The MFL roster status that counts toward the active-roster limit. */
export const ACTIVE_ROSTER_STATUS = 'ROSTER';

/** The MFL roster status for practice-squad (taxi) players. */
export const TAXI_SQUAD_STATUS = 'TAXI_SQUAD';

/**
 * Practice-squad capacity. Mirror of the constitution ("up to 3 practice
 * squad (taxi squad) spots", rookies only) and TAXI_SQUAD_LIMIT in
 * src/pages/api/move-to-practice.ts.
 */
export const AUGUST_TAXI_LIMIT = 3;

/**
 * Transaction types that count as acquisitions for "last added" ordering.
 * Mirror of contract-eligibility.ts#ACQUISITION_TYPES — trades are excluded
 * by design (league decision #9: a player traded for is long-held).
 */
export const AUGUST_CUT_ACQUISITION_TYPES = ['BBID_WAIVER', 'FREE_AGENT', 'AUCTION_WON'];

/** Active-roster limit. Mirror of salary-calculations.ts#TARGET_ACTIVE_COUNT. */
export const AUGUST_CUT_TARGET = 22;

/**
 * Build a map of playerId → newest qualifying acquisition timestamp.
 * Order-independent: takes the max timestamp per player, so callers don't
 * need to pre-sort their transactions feed.
 *
 * @param {Array<{type: string, timestamp: number|string, addedPlayerIds: string[], franchise?: string}>} acquisitions
 * @param {string|undefined} franchiseId
 * @param {string[]} acquisitionTypes
 * @returns {Map<string, number>}
 */
function buildAcquisitionIndex(acquisitions, franchiseId, acquisitionTypes) {
  const index = new Map();
  for (const event of acquisitions) {
    // Trades (and anything else outside the acquisition types) never count.
    if (!acquisitionTypes.includes(event.type)) continue;
    if (franchiseId && event.franchise !== undefined && event.franchise !== franchiseId) continue;

    const ts = typeof event.timestamp === 'number'
      ? event.timestamp
      : parseInt(event.timestamp, 10);
    if (!Number.isFinite(ts)) continue;

    for (const playerId of event.addedPlayerIds ?? []) {
      const existing = index.get(playerId);
      if (existing === undefined || ts > existing) index.set(playerId, ts);
    }
  }
  return index;
}

/**
 * Select which players the August cutdown automation cuts for one franchise.
 * Pure — no I/O, no clock, deterministic for a given input.
 *
 * @param {{
 *   activeRoster: Array<{id: string, status: string}>,
 *   markedPlayerIds?: string[],
 *   acquisitions?: Array<{type: string, timestamp: number|string, addedPlayerIds: string[], franchise?: string}>,
 *   target?: number,
 *   franchiseId?: string,
 *   acquisitionTypes?: string[],
 * }} input
 * @returns {{
 *   cuts: Array<{playerId: string, reason: 'marked'|'last-added', acquisitionTimestamp?: number}>,
 *   activeCount: number,
 *   overage: number,
 *   target: number,
 * }}
 */
export function selectAutoCuts({
  activeRoster,
  markedPlayerIds = [],
  acquisitions = [],
  target = AUGUST_CUT_TARGET,
  franchiseId,
  acquisitionTypes = AUGUST_CUT_ACQUISITION_TYPES,
}) {
  const activePlayers = activeRoster.filter((p) => p.status === ACTIVE_ROSTER_STATUS);
  const activeCount = activePlayers.length;
  const overage = activeCount - target;

  if (overage <= 0) {
    return { cuts: [], activeCount, overage, target };
  }

  const acquisitionIndex = buildAcquisitionIndex(acquisitions, franchiseId, acquisitionTypes);
  const activeIds = new Set(activePlayers.map((p) => p.id));
  const cuts = [];
  const selected = new Set();

  // Phase 1: marked players, in owner order, skipping departed / non-active
  // players and duplicates. Consume at most `overage`.
  for (const playerId of markedPlayerIds) {
    if (cuts.length >= overage) break;
    if (!activeIds.has(playerId) || selected.has(playerId)) continue;

    const acquisitionTimestamp = acquisitionIndex.get(playerId);
    cuts.push({
      playerId,
      reason: 'marked',
      ...(acquisitionTimestamp !== undefined ? { acquisitionTimestamp } : {}),
    });
    selected.add(playerId);
  }

  // Phase 2: fill the remainder newest-acquisition-first. Players with no
  // acquisition record sort last (oldest / safest). Sort is stable, so
  // ties (and the whole no-record group) keep roster order — deterministic.
  if (cuts.length < overage) {
    const fallbackPool = activePlayers
      .filter((p) => !selected.has(p.id))
      .sort((a, b) => {
        const tsA = acquisitionIndex.get(a.id) ?? Number.NEGATIVE_INFINITY;
        const tsB = acquisitionIndex.get(b.id) ?? Number.NEGATIVE_INFINITY;
        return tsB - tsA;
      });

    for (const player of fallbackPool) {
      if (cuts.length >= overage) break;
      const acquisitionTimestamp = acquisitionIndex.get(player.id);
      cuts.push({
        playerId: player.id,
        reason: 'last-added',
        ...(acquisitionTimestamp !== undefined ? { acquisitionTimestamp } : {}),
      });
      selected.add(player.id);
    }
  }

  // Invariant: exactly `overage` cuts — never below target. The fallback
  // pool always covers the remainder (marked ⊆ active), but clamp anyway.
  return { cuts: cuts.slice(0, overage), activeCount, overage, target };
}

/**
 * Select which active-roster rookies the August cutdown automation moves to
 * the practice squad BEFORE cutting anyone (league rule, decided July 2026):
 * a rookie in an open taxi spot is a free compliance move — the owner keeps
 * the player — so the automation never cuts a player while a taxi-eligible
 * rookie and an open spot both exist. Pure — no I/O, deterministic.
 *
 * Rules:
 *  1. Only rookies (MFL `status === 'R'`, passed in as `rookieIds`) are
 *     eligible — the practice squad is rookies-only per the constitution.
 *  2. Moves are capped by ALL of: the overage (never taxi more than
 *     compliance requires — minimal intervention, mirroring "never cut below
 *     target"), the open taxi spots (taxiLimit − current TAXI_SQUAD count),
 *     and the eligible rookies on the active roster.
 *  3. `rookieIds` is a PRIORITY order (first = first to protect) — callers
 *     pass league-draft order so the owner's premium picks get the spots
 *     when there are more rookies than room.
 *  4. Owner-marked players are never taxied: a rookie on the owner's own cut
 *     list is explicitly slated to be cut, not saved.
 *
 * @param {{
 *   roster: Array<{id: string, status: string}>,
 *   rookieIds?: string[],
 *   markedPlayerIds?: string[],
 *   target?: number,
 *   taxiLimit?: number,
 * }} input
 * @returns {{
 *   taxiMoves: Array<{playerId: string, reason: 'rookie-taxi'}>,
 *   activeCount: number,
 *   overage: number,
 *   openTaxiSpots: number,
 * }}
 */
export function selectAutoTaxiMoves({
  roster,
  rookieIds = [],
  markedPlayerIds = [],
  target = AUGUST_CUT_TARGET,
  taxiLimit = AUGUST_TAXI_LIMIT,
}) {
  const activePlayers = roster.filter((p) => p.status === ACTIVE_ROSTER_STATUS);
  const activeCount = activePlayers.length;
  const overage = activeCount - target;
  const taxiCount = roster.filter((p) => p.status === TAXI_SQUAD_STATUS).length;
  const openTaxiSpots = Math.max(0, taxiLimit - taxiCount);

  if (overage <= 0 || openTaxiSpots === 0) {
    return { taxiMoves: [], activeCount, overage, openTaxiSpots };
  }

  const activeIds = new Set(activePlayers.map((p) => p.id));
  const marked = new Set(markedPlayerIds);
  const budget = Math.min(overage, openTaxiSpots);
  const taxiMoves = [];
  const selected = new Set();

  for (const playerId of rookieIds) {
    if (taxiMoves.length >= budget) break;
    if (!activeIds.has(playerId) || marked.has(playerId) || selected.has(playerId)) continue;
    taxiMoves.push({ playerId, reason: 'rookie-taxi' });
    selected.add(playerId);
  }

  return { taxiMoves, activeCount, overage, openTaxiSpots };
}

/**
 * The full deadline decision for one franchise: rookie taxi moves first,
 * then cuts for whatever overage remains. This is the function every
 * consumer (deadline job, cut-watch preview, admin report) should call —
 * calling selectAutoCuts directly overstates the cuts for a team with
 * rookies and open practice-squad spots.
 *
 * `overage` in the result is the PRE-taxi overage;
 * `taxiMoves.length + cuts.length === overage` whenever overage > 0.
 *
 * @param {{
 *   roster: Array<{id: string, status: string}>,
 *   rookieIds?: string[],
 *   markedPlayerIds?: string[],
 *   acquisitions?: Array<{type: string, timestamp: number|string, addedPlayerIds: string[], franchise?: string}>,
 *   target?: number,
 *   franchiseId?: string,
 *   acquisitionTypes?: string[],
 *   taxiLimit?: number,
 * }} input
 * @returns {{
 *   taxiMoves: Array<{playerId: string, reason: 'rookie-taxi'}>,
 *   cuts: Array<{playerId: string, reason: 'marked'|'last-added', acquisitionTimestamp?: number}>,
 *   activeCount: number,
 *   overage: number,
 *   openTaxiSpots: number,
 *   target: number,
 * }}
 */
export function selectAutoMoves({
  roster,
  rookieIds = [],
  markedPlayerIds = [],
  acquisitions = [],
  target = AUGUST_CUT_TARGET,
  franchiseId,
  acquisitionTypes = AUGUST_CUT_ACQUISITION_TYPES,
  taxiLimit = AUGUST_TAXI_LIMIT,
}) {
  const taxi = selectAutoTaxiMoves({ roster, rookieIds, markedPlayerIds, target, taxiLimit });
  const taxied = new Set(taxi.taxiMoves.map((m) => m.playerId));
  const { cuts, target: cutTarget } = selectAutoCuts({
    activeRoster: roster.filter((p) => !taxied.has(p.id)),
    markedPlayerIds,
    acquisitions,
    target,
    franchiseId,
    acquisitionTypes,
  });
  return {
    taxiMoves: taxi.taxiMoves,
    cuts,
    activeCount: taxi.activeCount,
    overage: taxi.overage,
    openTaxiSpots: taxi.openTaxiSpots,
    target: cutTarget,
  };
}

/**
 * League-wide rookie ids in taxi-priority order, from raw MFL feed objects
 * (players export with DETAILS, draftResults export). Rookies are MFL's own
 * classification (`status === 'R'` — the same gate MFL enforces on the
 * taxi_squad import); priority is league rookie-draft order so an owner's
 * premium picks win the practice-squad spots, with undrafted rookies after.
 * Shared by the deadline job, the cut-watch fact sheet, and the admin
 * report so all three agree byte-for-byte.
 *
 * @param {{ playersFeed?: any, draftResultsFeed?: any }} feeds — raw parsed
 *   JSON of the two exports (either may be null/undefined; missing players
 *   feed → empty list → zero taxi moves, never a crash).
 * @returns {string[]}
 */
export function buildRookiePriorityFromFeeds({ playersFeed, draftResultsFeed }) {
  const toList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

  const rookies = new Set(
    toList(playersFeed?.players?.player)
      .filter((p) => p?.status === 'R' && p.id)
      .map((p) => `${p.id}`),
  );
  if (rookies.size === 0) return [];

  const ordered = [];
  const seen = new Set();
  for (const unit of toList(draftResultsFeed?.draftResults?.draftUnit)) {
    for (const pick of toList(unit?.draftPick)) {
      const pid = `${pick?.player ?? ''}`;
      if (pid && rookies.has(pid) && !seen.has(pid)) {
        ordered.push(pid);
        seen.add(pid);
      }
    }
  }
  for (const pid of rookies) {
    if (!seen.has(pid)) ordered.push(pid);
  }
  return ordered;
}

/**
 * Extract the player ids ADDED by one raw MFL transaction string.
 *
 * Mirrors the add-side of contract-eligibility.ts#parseTransactionString
 * (the script only needs adds for acquisition ordering). Formats:
 *   "|playerId,"          -> drop only (no adds)
 *   "addId|dropId,"       -> add/drop swap
 *   "addId|,"             -> add only (no drop)
 *   "addId,|bbid|dropId," -> BBID add/drop with bid amount
 *   "addId,|bbid|,"       -> BBID add only
 *   "playerId|amount|"    -> auction won (AUCTION_WON)
 *
 * @param {string} txnString
 * @returns {string[]}
 */
export function parseAcquisitionAdds(txnString) {
  if (!txnString || txnString.trim() === '') return [];

  // BBID formats: "addId,|bbidAmount|dropId," and "addId,|bbidAmount|,"
  const bbidMatch = txnString.match(/^(\d+),\|(\d+)\|(\d+),$/) || txnString.match(/^(\d+),\|(\d+)\|,$/);
  if (bbidMatch) return [bbidMatch[1]];

  // Drop-only: "|playerId," — nothing added.
  if (txnString.startsWith('|')) return [];

  // Auction format: "playerId|amount|" (no commas, trailing pipe)
  const auctionMatch = txnString.match(/^(\d+)\|(\d+)\|$/);
  if (auctionMatch) return [auctionMatch[1]];

  // Add/drop swap: "addId|dropId," or "addId|,"
  const parts = txnString.split('|');
  if (parts.length === 2) {
    const addId = parts[0].replace(',', '').trim();
    if (addId && /^\d+$/.test(addId)) return [addId];
  }
  return [];
}

/**
 * Parse a raw MFL transactions feed (transactions.transaction[]) into the
 * acquisition-event shape selectAutoCuts consumes. Filters to acquisition
 * types with actual adds — trades, drop-onlys, and batch markers are skipped,
 * matching contract-eligibility.ts#parseTransactions (parity locked by
 * tests/august-cutdown-date.test.ts).
 *
 * @param {Array<{type?: string, timestamp?: string|number, transaction?: string, franchise?: string}>} rawTransactions
 * @param {string[]} [acquisitionTypes]
 * @returns {Array<{type: string, franchise: string|undefined, timestamp: number, addedPlayerIds: string[]}>}
 */
export function parseAcquisitionEvents(rawTransactions, acquisitionTypes = AUGUST_CUT_ACQUISITION_TYPES) {
  const events = [];
  for (const raw of rawTransactions ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    if (!acquisitionTypes.includes(raw.type)) continue;
    if (!raw.transaction || `${raw.transaction}`.trim() === '') continue;

    const addedPlayerIds = parseAcquisitionAdds(`${raw.transaction}`);
    if (addedPlayerIds.length === 0) continue;

    const timestamp = parseInt(raw.timestamp, 10);
    events.push({ type: raw.type, franchise: raw.franchise, timestamp, addedPlayerIds });
  }
  return events;
}
