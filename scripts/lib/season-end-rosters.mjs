/**
 * Rebuild a past season's end-of-season rosters.
 *
 * MFL's rosters export for an old league year is not that season's roster:
 * it is whatever survived the league-year rollover, so every player whose
 * contract expired is gone. TheLeague's 2015 teams came back with 11-24
 * players (the real rosters were ~20-22), and the AFL's 2015 export lost a
 * whole conference. The exports were all fetched years later, so the data is
 * not recoverable from MFL's rosters endpoint at all (W= does not help).
 *
 * What MFL DOES keep is that season's weekly results, which list every
 * franchise's starters AND bench for each week. So the end-of-season roster
 * is the export (it still carries the salaries and contracts of the players
 * it kept) plus every player from one chosen week's lineup that the export
 * lost.
 *
 * A restored player's contract is gone with him. Where a league kept its own
 * record of that season's contracts (TheLeague's frozen salary files), that
 * contract is used as is. Otherwise, when the same season's records name the
 * price he was signed at — his auction winning bid or his blind-bid waiver
 * amount — that is his salary; otherwise his salary is unknown, and he carries `salaryUnknown: '1'` so a renderer can say so
 * rather than print $0. Every restored row carries `restored: '1'`.
 *
 * Plain JS so it runs in bare node (compute scripts) and from tests.
 */

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * Every franchise's lineup (starters + bench) in one week of a season's
 * weekly-results-raw.json, as franchiseId → player ids in feed order.
 *
 * @param {any} weeklyRaw - parsed weekly-results-raw.json (array of weeks)
 * @param {number|string} week
 * @returns {Map<string, string[]>}
 */
export function lineupsForWeek(weeklyRaw, week) {
  const target = String(week);
  const lineups = new Map();
  for (const entry of asArray(weeklyRaw)) {
    const results = entry?.weeklyResults;
    if (!results || String(results.week) !== target) continue;
    const franchises = [
      ...asArray(results.matchup).flatMap((m) => asArray(m?.franchise)),
      ...asArray(results.franchise),
    ];
    for (const franchise of franchises) {
      if (!franchise?.id) continue;
      const ids = lineups.get(franchise.id) ?? [];
      for (const player of asArray(franchise.player)) {
        if (player?.id && !ids.includes(player.id)) ids.push(player.id);
      }
      lineups.set(franchise.id, ids);
    }
  }
  return lineups;
}

/**
 * The salary each player was signed at during the season, from the season's
 * own records: auction winning bids, then blind-bid waiver claims in time
 * order (the latest signing wins). A free-agent pickup carries no price in
 * MFL's feed, so it is not guessed.
 *
 * @param {any} auctionResults - parsed auctionResults.json (or null)
 * @param {any} transactions - parsed transactions.json (or null)
 * @returns {Map<string, number>}
 */
export function seasonSigningPrices(auctionResults, transactions) {
  const prices = new Map();
  const units = asArray(auctionResults?.auctionResults?.auctionUnit);
  const auctions = units
    .flatMap((unit) => asArray(unit?.auction))
    .sort((a, b) => Number(a?.lastBidTime ?? 0) - Number(b?.lastBidTime ?? 0));
  for (const auction of auctions) {
    const bid = Number(auction?.winningBid);
    if (auction?.player && Number.isFinite(bid) && bid > 0) prices.set(auction.player, bid);
  }
  const claims = asArray(transactions?.transactions?.transaction)
    .filter((t) => t?.type === 'BBID_WAIVER' && typeof t.transaction === 'string')
    .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
  for (const claim of claims) {
    const [playerId, amount] = claim.transaction.split('|');
    const bid = Number(amount);
    if (playerId && Number.isFinite(bid) && bid > 0) prices.set(playerId, bid);
  }
  return prices;
}

/**
 * The export plus every player the chosen week's lineups name and the export
 * lost, in the rosters.json shape. A player the export still has stays where
 * the export put him. A franchise the export lost entirely comes back with
 * its lineup.
 *
 * @param {any} rostersFeed - parsed rosters.json for the season
 * @param {Map<string, string[]>} lineups - from lineupsForWeek
 * @param {Map<string, number>} [prices] - from seasonSigningPrices
 * @param {Map<string, {salary: any, contractYear: any}>} [contracts] - the
 *   league's own record of the season's contracts, which outranks `prices`
 * @returns {{ feed: any, restored: number }}
 */
export function restoreSeasonEndRosters(rostersFeed, lineups, prices = new Map(), contracts = new Map()) {
  const exported = asArray(rostersFeed?.rosters?.franchise);
  const onAnyRoster = new Set(
    exported.flatMap((f) => asArray(f?.player).map((p) => p?.id).filter(Boolean)),
  );

  const byId = new Map();
  for (const franchise of exported) {
    if (!franchise?.id) continue;
    byId.set(franchise.id, { ...franchise, player: [...asArray(franchise.player)] });
  }

  let restored = 0;
  for (const [franchiseId, ids] of [...lineups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const id of ids) {
      if (onAnyRoster.has(id)) continue;
      onAnyRoster.add(id);
      const franchise = byId.get(franchiseId) ?? { id: franchiseId, player: [] };
      byId.set(franchiseId, franchise);
      const contract = contracts.get(id);
      const price = prices.get(id);
      franchise.player.push(
        contract
          ? { id, status: 'ROSTER', salary: String(contract.salary), contractYear: String(contract.contractYear ?? '1'), restored: '1' }
          : price != null
          ? { id, status: 'ROSTER', salary: String(price), contractYear: '1', restored: '1' }
          : { id, status: 'ROSTER', contractYear: '1', salaryUnknown: '1', restored: '1' },
      );
      restored += 1;
    }
  }

  const franchise = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    feed: { ...rostersFeed, rosters: { ...(rostersFeed?.rosters ?? {}), franchise } },
    restored,
  };
}
