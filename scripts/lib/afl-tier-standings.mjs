/**
 * AFL tier (Premier League / D-League) standings + promotion/relegation logic.
 *
 * Extracted into a pure, importable module so the season-end compute script
 * (scripts/compute-afl-tier-movement.mjs) and the unit tests
 * (tests/afl-tier-movement.test.ts) share one source of truth. NOTHING here
 * touches the filesystem or the network — callers pass plain data in and get
 * plain data out, mirroring scripts/lib/roger-reminder-window.mjs.
 *
 * Background — why this exists:
 *   The AFL runs an all-play "side competition" split into two 12-team tiers.
 *   MFL has NO concept of these tiers: its all-play export (leagueStandings /
 *   O=101) returns ONE all-play-sorted list of all 24 teams with no tier
 *   markers. The split lives only in per-year membership data the league
 *   maintains (data/afl-fantasy/tier-history.json). Given that membership plus
 *   the season's weekly scores, everything below is deterministic.
 *
 * The movement rule (AFL constitution §146–148):
 *   - Premier League bottom 2 (ranks 11–12) are relegated automatically.
 *   - D-League top 2 (ranks 1–2) are promoted automatically.
 *   - A 4-team promotion/relegation playoff among Premier 9th & 10th and
 *     D-League 3rd & 4th: the top 2 BY ALL-PLAY RECORD earn/keep the two
 *     remaining Premier League spots; the other 2 land in D-League.
 *   Ties (here and in within-tier ranking) break on Total Points Scored (PF),
 *   per the constitution, then on franchise id for a stable, reproducible sort.
 *
 *   Because MFL all-play is league-wide (every team vs. all 23 others each
 *   week), the four swing teams' all-play records are directly comparable — no
 *   separate head-to-head replay is needed to resolve the playoff.
 */

// Single source of truth for the all-play accumulation, shared with the live
// standings page via src/utils/standings.ts. Plain `node` resolves this src
// .mjs the same way scripts/schefter-scan.mjs imports src/config/leagues-data.mjs.
import { accumulateAllPlay } from '../../src/utils/all-play.mjs';

export const PREMIER = 'Premier League';
export const DLEAGUE = 'D-League';

/**
 * The current (12-team-tier) constitution movement rule. Ranks are 1-based.
 * Kept as data so a future format change is a one-object edit, and so the
 * compute script can persist the exact rule it applied alongside the output.
 */
export const CONSTITUTION_MOVEMENT_RULES = {
  tierSize: 12,
  autoPromote: 2, // D-League ranks 1–2
  autoRelegate: 2, // Premier ranks 11–12
  swing: {
    premierRanks: [9, 10],
    dleagueRanks: [3, 4],
    promoteCount: 2, // top-N of the 4 by all-play stay/earn Premier
  },
};

/**
 * All-play record for every franchise from compact weekly results, gated to a
 * cutoff week. Compact shape: { weeks: [{ week, scores: { id: number } }] }.
 * Delegates to the shared accumulator the live standings page uses
 * (src/utils/all-play.mjs) so the script and the page can never diverge, then
 * re-derives `games` for callers/tests that want the total comparison count.
 *
 * @param {{weeks: Array<{week:number, scores:Record<string,number>}>}} weeklyResults
 * @param {number} cutoffWeek inclusive
 * @returns {Map<string, {wins:number, losses:number, ties:number, pf:number, games:number, pct:number}>}
 */
export function computeAllPlayThroughCutoff(weeklyResults, cutoffWeek) {
  const records = accumulateAllPlay(weeklyResults, cutoffWeek);
  for (const rec of records.values()) {
    rec.games = rec.wins + rec.losses + rec.ties;
  }
  return records;
}

/**
 * Comparator over franchise ids using an all-play record map. Better team
 * first: all-play pct desc, then PF desc, then id asc (stable).
 * @param {Map<string, {pct:number, pf:number}>} allPlay
 */
export function byAllPlay(allPlay) {
  return (a, b) => {
    const ra = allPlay.get(a) ?? { pct: 0, pf: 0 };
    const rb = allPlay.get(b) ?? { pct: 0, pf: 0 };
    if (rb.pct !== ra.pct) return rb.pct - ra.pct;
    if (rb.pf !== ra.pf) return rb.pf - ra.pf;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/**
 * Rank a list of franchise ids by all-play (best first). Pure — returns a new
 * array and does not mutate the input.
 */
export function rankWithinTier(ids, allPlay) {
  return ids.slice().sort(byAllPlay(allPlay));
}

/**
 * Normalize a membership input into { 'Premier League': string[], 'D-League': string[] }.
 * Accepts either that shape, or a flat { franchiseId: tierName } map.
 */
export function splitMembership(membership) {
  if (
    membership &&
    Array.isArray(membership[PREMIER]) &&
    Array.isArray(membership[DLEAGUE])
  ) {
    return {
      [PREMIER]: membership[PREMIER].slice(),
      [DLEAGUE]: membership[DLEAGUE].slice(),
    };
  }
  const out = { [PREMIER]: [], [DLEAGUE]: [] };
  for (const [id, tier] of Object.entries(membership ?? {})) {
    if (tier === PREMIER) out[PREMIER].push(id);
    else if (tier === DLEAGUE) out[DLEAGUE].push(id);
  }
  return out;
}

/** Flat { id: tierName } membership map from a {Premier:[],D-League:[]} split. */
export function flattenMembership(split) {
  const out = {};
  for (const id of split[PREMIER]) out[id] = PREMIER;
  for (const id of split[DLEAGUE]) out[id] = DLEAGUE;
  return out;
}

/**
 * Compute end-of-season tier outcomes: champions, promotion/relegation, the
 * swing playoff, and next season's membership. Pure and deterministic.
 *
 * @param {object} membership { 'Premier League': string[], 'D-League': string[] } or flat map
 * @param {Map<string,{pct:number,pf:number}>} allPlay all-play records (cutoff-gated)
 * @param {object} [rules] movement rule (defaults to the constitution)
 * @returns {{
 *   standings: { 'Premier League': string[], 'D-League': string[] },
 *   champions: { 'premier-league': string, 'dleague-champion': string },
 *   autoPromoted: string[], autoRelegated: string[],
 *   swing: { pool: string[], promoted: string[], relegated: string[] } | null,
 *   next: { 'Premier League': string[], 'D-League': string[] },
 *   nextMembership: Record<string,string>,
 * }}
 */
export function computeTierMovement(
  membership,
  allPlay,
  rules = CONSTITUTION_MOVEMENT_RULES
) {
  const split = splitMembership(membership);
  const premier = rankWithinTier(split[PREMIER], allPlay);
  const dleague = rankWithinTier(split[DLEAGUE], allPlay);

  const standings = { [PREMIER]: premier, [DLEAGUE]: dleague };
  const champions = {
    'premier-league': premier[0] ?? null,
    'dleague-champion': dleague[0] ?? null,
  };

  // Whether the 4-team swing playoff applies. It needs enough teams in each
  // tier to address the configured ranks; otherwise (e.g. the pre-2024 8-team
  // era) fall back to a plain auto promote/relegate of the configured counts.
  const swingCfg = rules.swing;
  const swingApplies =
    swingCfg &&
    premier.length >= Math.max(...swingCfg.premierRanks) &&
    dleague.length >= Math.max(...swingCfg.dleagueRanks);

  const autoRelegated =
    rules.autoRelegate > 0 ? premier.slice(premier.length - rules.autoRelegate) : [];
  const autoPromoted = rules.autoPromote > 0 ? dleague.slice(0, rules.autoPromote) : [];

  let swing = null;
  const toDLeague = new Set(autoRelegated);
  const toPremier = new Set(autoPromoted);

  if (swingApplies) {
    const pool = [
      ...swingCfg.premierRanks.map((r) => premier[r - 1]),
      ...swingCfg.dleagueRanks.map((r) => dleague[r - 1]),
    ];
    const ranked = rankWithinTier(pool, allPlay);
    const promoted = ranked.slice(0, swingCfg.promoteCount);
    const relegated = ranked.slice(swingCfg.promoteCount);
    swing = { pool, promoted, relegated };
    // A swing winner already in Premier simply stays; a D-League swing winner
    // moves up. Likewise a swing loser from Premier moves down; a D-League
    // swing loser stays. The set membership below handles all four cases.
    for (const id of promoted) toPremier.add(id);
    for (const id of relegated) {
      if (split[PREMIER].includes(id)) toDLeague.add(id);
    }
  }

  const nextPremier = [
    ...premier.filter((id) => !toDLeague.has(id)),
    ...dleague.filter((id) => toPremier.has(id)),
  ];
  const nextDLeague = [
    ...dleague.filter((id) => !toPremier.has(id)),
    ...premier.filter((id) => toDLeague.has(id)),
  ];

  const next = {
    [PREMIER]: rankWithinTier(nextPremier, allPlay),
    [DLEAGUE]: rankWithinTier(nextDLeague, allPlay),
  };

  return {
    standings,
    champions,
    autoPromoted,
    autoRelegated,
    swing,
    next,
    nextMembership: flattenMembership(next),
  };
}
