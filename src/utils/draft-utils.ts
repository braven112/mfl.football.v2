/**
 * Draft Pick Predictor Utilities
 * Handles draft order calculation, trade parsing, and pick ownership
 */

import type {
  DraftPrediction,
  StandingsFranchise,
  ToiletBowlResult,
} from '../types/standings';

interface TeamConfig {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
}

interface DraftResultPick {
  round?: string;
  pick?: string;
  comments?: string;
  franchise?: string;
  player?: string;
}

interface DraftResultsData {
  draftResults?: {
    draftUnit?: {
      draftPick?: DraftResultPick | DraftResultPick[];
    };
  };
}

/**
 * Calculate predicted draft order based on current standings
 * Uses reverse standings (worst record = pick 1) with same tiebreakers as playoff seeding
 * League champion always gets pick 16 (regardless of record)
 * Picks 1-15 assigned by reverse W-L record (excluding champion)
 * Toilet bowl winners get picks 1.17, 2.17, 2.18
 *
 * @param standings - Current season standings
 * @param teamConfigs - Team name and icon/banner info
 * @param leagueWinnerId - Franchise ID of league champion (empty string if not determined)
 * @param toiletBowlWinners - Results from toilet bowl tournaments
 * @returns Array of draft predictions in draft order
 */
export function calculateDraftOrder(
  standings: StandingsFranchise[],
  teamConfigs: Map<string, TeamConfig>,
  leagueWinnerId: string,
  toiletBowlWinners: ToiletBowlResult[]
): DraftPrediction[] {
  // Sort all teams by reverse record (worst to best)
  // Worst record = lowest win percentage = best draft pick
  const sortedByRecord = sortByRecordReverse(standings);

  // Build draft predictions (picks 1-16 based on reverse standings)
  const draftPredictions: DraftPrediction[] = [];

  // If league champion is determined, separate them from the draft order
  let championStanding: StandingsFranchise | undefined;
  let nonChampionTeams = sortedByRecord;

  if (leagueWinnerId) {
    championStanding = standings.find((s) => s.id === leagueWinnerId);
    // Remove champion from the sorted list
    nonChampionTeams = sortedByRecord.filter((s) => s.id !== leagueWinnerId);
  }

  // Assign picks 1-15 to non-champion teams (or picks 1-16 if no champion yet)
  nonChampionTeams.forEach((standing, index) => {
    const pickNumber = index + 1; // 1-15 (or 1-16 if no champion)
    draftPredictions.push(
      buildDraftPrediction(standing, teamConfigs, pickNumber, false, 1)
    );
  });

  // Assign pick 16 to league champion (if determined)
  if (championStanding) {
    draftPredictions.push(
      buildDraftPrediction(championStanding, teamConfigs, 16, true, 1)
    );
  }

  // Picks 1.17, 2.17, 2.18 go to toilet bowl winners
  const specialPicks = [
    { round: 1, pickInRound: 17, level: 'winner' as const },
    { round: 2, pickInRound: 17, level: 'consolation' as const },
    { round: 2, pickInRound: 18, level: 'consolation2' as const },
  ];

  specialPicks.forEach((pick) => {
    const winner = toiletBowlWinners.find((w) => w.level === pick.level);
    if (winner) {
      const winnerStanding = standings.find((t) => t.id === winner.franchiseId);
      if (winnerStanding) {
        const overallNumber = (pick.round - 1) * 16 + pick.pickInRound;
        draftPredictions.push(
          buildDraftPrediction(
            winnerStanding,
            teamConfigs,
            overallNumber,
            false,
            pick.round,
            pick.pickInRound,
            true,
            pick.level
          )
        );
      }
    }
  });

  // Continue rounds 2-3 for non-special picks
  // Picks in rounds 2-3 follow same order as round 1
  // Champion always gets pick 16 in each round
  for (let round = 2; round <= 3; round++) {
    let picksInRound = 1;

    // Assign picks to non-champion teams
    nonChampionTeams.forEach((standing) => {
      // Skip special toilet bowl picks in round 2
      if (picksInRound === 17 && round === 2) {
        picksInRound++;
      }
      if (picksInRound === 18 && round === 2) {
        picksInRound++;
      }

      const overallNumber = (round - 1) * 16 + picksInRound;
      draftPredictions.push(
        buildDraftPrediction(
          standing,
          teamConfigs,
          overallNumber,
          false,
          round,
          picksInRound
        )
      );
      picksInRound++;
    });

    // Assign pick 16 to champion in this round (if determined)
    if (championStanding) {
      const overallNumber = (round - 1) * 16 + 16;
      draftPredictions.push(
        buildDraftPrediction(
          championStanding,
          teamConfigs,
          overallNumber,
          true,
          round,
          16
        )
      );
    }
  }

  return draftPredictions;
}

/**
 * Sort teams by overall record in reverse order (worst to best)
 * Uses overall standings (not division-specific) with wild card tiebreakers
 */
function sortByRecordReverse(standings: StandingsFranchise[]): StandingsFranchise[] {
  return [...standings].sort((a, b) => {
    // Calculate overall win-loss records (division + non-division)
    const aWins = (parseInt(a.divw || '0') + parseInt(a.nondivw || '0'));
    const aLosses = (parseInt(a.divl || '0') + parseInt(a.nondivl || '0'));
    const bWins = (parseInt(b.divw || '0') + parseInt(b.nondivw || '0'));
    const bLosses = (parseInt(b.divl || '0') + parseInt(b.nondivl || '0'));

    // Calculate win percentages
    const aGames = aWins + aLosses;
    const bGames = bWins + bLosses;
    const aWinPct = aGames > 0 ? aWins / aGames : 0;
    const bWinPct = bGames > 0 ? bWins / bGames : 0;

    // REVERSE: Worst record (lowest win%) comes first
    if (aWinPct !== bWinPct) {
      return aWinPct - bWinPct;
    }

    // Tiebreaker 1: All-play percentage (lower is worse)
    const aAllPlay = parseFloat(a.all_play_pct || '0');
    const bAllPlay = parseFloat(b.all_play_pct || '0');
    if (aAllPlay !== bAllPlay) {
      return aAllPlay - bAllPlay;
    }

    // Tiebreaker 2: Points For (lower is worse)
    const aPF = parseFloat(a.pf || '0');
    const bPF = parseFloat(b.pf || '0');
    if (aPF !== bPF) {
      return aPF - bPF;
    }

    // Tiebreaker 3: Power Rating (lower is worse)
    const aPWR = parseFloat(a.pwr || '0');
    const bPWR = parseFloat(b.pwr || '0');
    if (aPWR !== bPWR) {
      return aPWR - bPWR;
    }

    // Tiebreaker 4: Victory Points (lower is worse)
    const aVP = parseInt(a.vp || '0');
    const bVP = parseInt(b.vp || '0');
    if (aVP !== bVP) {
      return aVP - bVP;
    }

    // Tiebreaker 5: Most Points Allowed — the team that gave up MORE points
    // wins this step, so it lands earlier in this worst-first list and gets the
    // better draft pick. Commissioner ruling 2026-08-11: "most points allowed
    // should benefit the team in all leagues." The rulebook step has always
    // read "Most Points Allowed"; this code used to prefer FEWER, handing the
    // better pick to the team that had been luckier. See
    // tests/points-allowed-tiebreaker.test.ts.
    const aPA = parseFloat(a.pa || '0');
    const bPA = parseFloat(b.pa || '0');
    return bPA - aPA;
  });
}

/**
 * Build a single draft prediction object
 */
function buildDraftPrediction(
  standing: StandingsFranchise,
  teamConfigs: Map<string, TeamConfig>,
  overallPickNumber: number,
  isLeagueWinner: boolean,
  round: number,
  pickInRound?: number,
  isToiletBowlPick?: boolean,
  toiletBowlType?: 'winner' | 'consolation' | 'consolation2'
): DraftPrediction {
  const teamConfig = teamConfigs.get(standing.id) || {};
  const actualPickInRound = pickInRound || ((overallPickNumber - 1) % 16) + 1;

  // Parse overall record (division + non-division)
  const wins = (parseInt(standing.divw || '0') + parseInt(standing.nondivw || '0'));
  const losses = (parseInt(standing.divl || '0') + parseInt(standing.nondivl || '0'));
  const ties = (parseInt(standing.divt || '0') + parseInt(standing.nondivt || '0'));

  // Parse standings metrics
  const allPlayPct = parseFloat(standing.all_play_pct || '0');
  const pointsFor = parseFloat(standing.pf || '0');
  const pointsAgainst = parseFloat(standing.pa || '0');
  const powerRating = parseFloat(standing.pwr || '0');
  const victoryPoints = parseInt(standing.vp || '0');

  return {
    overallPickNumber,
    round,
    pickInRound: actualPickInRound,
    franchiseId: standing.id,
    teamName: teamConfig.name || standing.fname,
    teamIcon: teamConfig.icon || '',
    teamBanner: teamConfig.banner || '',
    currentRecord: {
      wins,
      losses,
      ties,
    },
    currentStanding: {
      allPlayPct,
      pointsFor,
      pointsAgainst,
      powerRating,
      victoryPoints,
    },
    isToiletBowlPick: isToiletBowlPick || false,
    toiletBowlType,
    isLeagueWinner,
  };
}

/**
 * Parse draft pick comments to extract trade information
 * Format: "[Pick traded from Team Name.]" or no comment for original pick
 *
 * Returns the TEAM NAME alone. Callers render it after a preposition they
 * supply themselves ("via X", "from X", "Originally owned by X") and match it
 * against `TeamConfig.name` to resolve the original team's crest, so anything
 * but a bare name is wrong in both directions.
 *
 * The alternation this used to open with — `(?:traded|traded from)` — could
 * never reach its second branch: regex alternation is ordered, `traded` always
 * matched first, and the ` from ` was left for `(.+?)` to swallow. Since every
 * comment MFL actually writes says "traded from", the capture began "from " on
 * literally all of them. That shipped as `· via from Bring the Pain` on the
 * broadcast, and silently broke every `config.name === originalTeamName`
 * lookup, so the traded-from crest never rendered anywhere.
 *
 * `from` is now REQUIRED rather than optional, because MFL also writes
 * `Pick traded to <TEAM>` — which names the team that RECEIVED the pick. An
 * optional `from` matches that line too and reports the recipient as the
 * origin, i.e. exactly backwards. There is no `[Pick traded <TEAM>.]` form in
 * any committed feed; the dead alternation branch was never a real shape.
 *
 * Trimmed because MFL's own feed contains double spaces after "from"
 * (`[Pick traded from  Running Down The Dream.]`) — a leading space fails an
 * exact name match exactly as invisibly as the "from " prefix did.
 *
 * WHY NOT ANCHOR ON THE BRACKETS. Requiring `\[…\]` around the statement, as
 * this did, silently dropped two thirds of the real corpus:
 *
 * - `[Pick traded from A.\nPick made from Pre-Draft List]` — MFL puts several
 *   statements in ONE bracket block, newline-separated, so `.]` does not
 *   follow the team name. `.` does not match `\n`, so this simply did not
 *   match and the pick read as UNTRADED.
 * - `Pick traded from A.` — 77 comments carry no brackets at all.
 * - `[Pick made based on Pre-Draft List] Pick traded from A.` — the statement
 *   can also sit AFTER a closed block, so line-anchoring with `^` fails too.
 *
 * The terminator is therefore "period, then end of line, `]`, or end of
 * string" — which also keeps a team name that legitimately ends in a period
 * (`Be Gentle. It's my first time.`) intact, since the lazy `(.+?)` only stops
 * at a period that is actually followed by one of those.
 *
 * FIRST match wins: MFL appears to APPEND a line per hop, oldest first, so the
 * first names the ORIGINAL owner — the shape `formatTradeChain` already
 * renders as "from <first> via <rest>".
 *
 * Be honest about how well that is established. It can only be checked where
 * pick position N maps to one franchise in every round, which needs
 * `draftType: SAME` AND every round the same size; of the corpus's 47
 * multi-hop picks, exactly 3 clear both gates (TheLeague 2023) and all 3 put
 * the original owner FIRST — position 07 is The Music City Mafia and 3.07
 * leads with it, position 09 is Wascawy Wabbits and 3.09 leads with it. The
 * other 44 sit in league-years with uneven rounds (TheLeague 2024 opens with
 * 17 picks in round 1), where the inference is INVALID and reads first, last
 * and neither more or less at random — do not mistake that noise for
 * counter-evidence, and do not mistake n=3 for proof. If a twice-traded pick
 * ever shows the wrong crest, this ordering is the first thing to re-check.
 *
 * KNOWN LIMIT: MFL sometimes appends free prose to its own statement line, and
 * a team name may itself end in a period ("Be Gentle. It's my first time."),
 * so `Pick traded from A. Great value here.` cannot be told apart from a team
 * called "A. Great value here" by any regex. The capture is bounded to one
 * line and cannot cross a `]`, which is as far as this can be taken here; the
 * residue would need resolving the name against the league's franchises, which
 * only the caller can do. Every one of the corpus's 287 statements parses to a
 * real franchise name today.
 *
 * @param comment - Draft pick comment from draftResults
 * @returns Original owner's team name if traded, undefined if never traded
 */
export function parseTradeFromComment(comment: string): string | undefined {
  if (!comment) return undefined;

  const tradeMatch = comment.match(/Pick traded from ([^\]\n]+?)\.(?=\s*(?:\]|\n|$))/);
  if (tradeMatch) {
    return tradeMatch[1].trim();
  }

  return undefined;
}

/**
 * One entry of MFL's `draftResults.draftUnit`.
 *
 * Generic in the pick shape so a caller that knows what a pick looks like gets
 * it back typed. Declaring `draftPick` as a bare `unknown` here kept this
 * module from depending on the API route's `RawDraftPick`, but it pushed the
 * looseness onto every call site — `/api/draft/status` then had to hand an
 * `unknown` to a function expecting real picks, which is a type error rather
 * than a cast waiting to happen.
 */
export interface RawDraftUnit<TPick = unknown> {
  unit?: string;
  draftPick?: TPick | TPick[];
}

/**
 * Pick the requested draft unit out of MFL's object-or-array `draftUnit`.
 *
 * `draftUnit` is an OBJECT in a single-draft league (TheLeague, best-ball) but
 * an ARRAY in a league that drafts by conference — the AFL runs CONFERENCE00 +
 * CONFERENCE01 as two independent 108-pick boards. Reading `.draftPick`
 * straight off the raw value therefore yielded `undefined` for the AFL, and
 * because callers treated that as "no picks" the board looked EMPTY rather
 * than broken. That is the bug this function exists to make impossible.
 *
 * With no `unit` requested the first unit wins, which keeps single-draft
 * leagues (where there IS only one) behaving exactly as before. A requested
 * unit that doesn't exist returns null rather than silently falling back to
 * unit 0 — showing the American League's board on a page that asked for the
 * National League's is worse than showing an error.
 */
export function selectDraftUnit<TPick = unknown>(
  rawUnit: RawDraftUnit<TPick> | RawDraftUnit<TPick>[] | undefined,
  requestedUnit?: string | null
): RawDraftUnit<TPick> | null {
  if (!rawUnit) return null;
  const units = Array.isArray(rawUnit) ? rawUnit : [rawUnit];
  if (units.length === 0) return null;
  if (!requestedUnit) return units[0] ?? null;

  const wanted = requestedUnit.trim().toUpperCase();
  return (
    units.find((u) => (u?.unit || '').trim().toUpperCase() === wanted) ??
    // MFL names them CONFERENCE00/CONFERENCE01; accept a bare "00"/"01" too so
    // callers can pass the conference code straight from the league config.
    units.find((u) => (u?.unit || '').trim().toUpperCase() === `CONFERENCE${wanted}`) ??
    null
  );
}

/**
 * Whether the draft order is FINAL (official) rather than a projection.
 *
 * TheLeague's order stops being a prediction once the playoffs wrap: the
 * champion (pick 16) is crowned and all three toilet bowl compensatory
 * slots (1.17, 2.17, 2.18) are settled. Consumers use this to switch
 * framing — "Draft Predictor / projected" during the season, "Draft
 * Order / official" once the playoffs finish. If any bracket result can't
 * be resolved we stay in "projected" framing — the safe direction to fail.
 */
export function isLeagueDraftOrderFinal(
  leagueWinnerId: string,
  toiletBowlWinners: ToiletBowlResult[]
): boolean {
  if (!leagueWinnerId) return false;
  const levels = new Set(toiletBowlWinners.map((w) => w.level));
  return levels.has('winner') && levels.has('consolation') && levels.has('consolation2');
}

/**
 * Whether the draft has actually been CONDUCTED (players selected), as
 * opposed to draft results that merely stub out the pick slots. Once true,
 * the order isn't "official upcoming" anymore — it's history, and the page
 * flips back toward predictor framing for the next cycle.
 *
 * Accepts both draftResults shapes: TheLeague's single `draftUnit` object
 * and the AFL's two-element `draftUnit` array (one unit per conference).
 */
export function isDraftConducted(draftResults: unknown): boolean {
  return flattenDraftPicks(draftResults).some(isMadeSelection);
}

/**
 * Whether the draft has FINISHED — every pick slot in the results carries a
 * real player selection. Distinct from isDraftConducted, which flips true at
 * the FIRST made pick: TheLeague's rookie draft is a multi-day slow draft,
 * so "conducted" holds for days while picks remain on the board. Any gate
 * that treats undrafted rookies as available (the free-agent page's default
 * rookie filter) must use this stricter predicate — mid-draft, the remaining
 * rookies are exactly the players about to be drafted, not free agents.
 * MFL stubs unmade picks with an empty/placeholder player field, so "every
 * listed slot has a real id" is the completion signal. Missing or empty
 * results → false.
 */
export function isDraftComplete(draftResults: unknown): boolean {
  const picks = flattenDraftPicks(draftResults);
  return picks.length > 0 && picks.every(isMadeSelection);
}

/** Flatten both draftResults shapes (TheLeague's single draftUnit object and
 * the AFL's per-conference draftUnit array) into one pick list. */
function flattenDraftPicks(draftResults: unknown): DraftResultPick[] {
  const unitRaw = (draftResults as DraftResultsData | null | undefined)?.draftResults?.draftUnit as
    | { draftPick?: DraftResultPick | DraftResultPick[] }
    | Array<{ draftPick?: DraftResultPick | DraftResultPick[] }>
    | undefined;
  const units = Array.isArray(unitRaw) ? unitRaw : unitRaw ? [unitRaw] : [];
  return units.flatMap((unit) => {
    const picks = unit?.draftPick;
    return Array.isArray(picks) ? picks : picks ? [picks] : [];
  });
}

// MFL stubs unmade picks with an empty/placeholder player field — only a
// real player id (digits, nonzero) counts as a made selection.
function isMadeSelection(p: DraftResultPick): boolean {
  return !!(p?.player && /^\d+$/.test(p.player) && parseInt(p.player, 10) > 0);
}

/**
 * Build trade chain from draft results
 * Combines trade comments with MFL assets data to create full trade history
 *
 * @param draftResults - Draft results data with comments
 * @param teamConfigs - Map of franchise IDs to team names
 * @returns Map of pick ID to trade chain
 */
export function buildTradeChains(
  draftResults: DraftResultsData,
  teamConfigs: Map<string, TeamConfig>
): Map<string, { original: string; chain: string[] }> {
  const chains = new Map<string, { original: string; chain: string[] }>();

  const picks = draftResults?.draftResults?.draftUnit?.draftPick;
  if (!picks) return chains;

  const pickArray = Array.isArray(picks) ? picks : [picks];

  pickArray.forEach((pick) => {
    if (!pick.round || !pick.pick || !pick.franchise) return;

    const pickId = `${pick.round}.${pick.pick}`;
    const comment = pick.comments || '';
    const currentFranchise = pick.franchise;

    const tradedFromTeam = parseTradeFromComment(comment);
    if (tradedFromTeam) {
      // Find franchise ID of original team by name
      let originalFranchiseId = '';
      for (const [fId, config] of teamConfigs.entries()) {
        if (config.name === tradedFromTeam) {
          originalFranchiseId = fId;
          break;
        }
      }

      chains.set(pickId, {
        original: tradedFromTeam,
        chain: [tradedFromTeam], // Will be enhanced with intermediate trades
      });
    }
  });

  return chains;
}

/**
 * Format trade chain for display
 * @param chain - Array of team names in trade chain
 * @returns Formatted string like "from Team A" or "from Team A via Team B"
 */
export function formatTradeChain(chain: string[]): string {
  if (chain.length === 0) return '';
  if (chain.length === 1) return `from ${chain[0]}`;
  return `from ${chain[0]} via ${chain.slice(1).join(' via ')}`;
}

/**
 * Extract actual draft assets (picks each team owns) from draft results
 * Compares current owner vs original owner to identify trades
 *
 * @param draftResults - Draft results data from MFL
 * @param teamConfigs - Map of franchise IDs to team config
 * @returns Map of pick ID (round.pick) to actual asset info
 */
export function extractActualAssets(
  draftResults: DraftResultsData,
  teamConfigs: Map<string, TeamConfig>
): Map<string, { round: string; pick: string; currentFranchiseId: string; currentTeamName: string; originalTeamName?: string; isTraded: boolean }> {
  const assets = new Map<string, { round: string; pick: string; currentFranchiseId: string; currentTeamName: string; originalTeamName?: string; isTraded: boolean }>();

  const picks = draftResults?.draftResults?.draftUnit?.draftPick;
  if (!picks) return assets;

  const pickArray = Array.isArray(picks) ? picks : [picks];

  pickArray.forEach((pick) => {
    if (!pick.round || !pick.pick || !pick.franchise) return;

    const pickId = `${pick.round}.${pick.pick}`;
    const currentFranchiseId = pick.franchise;
    const currentTeamName = teamConfigs.get(currentFranchiseId)?.name || 'Unknown Team';

    // Check if pick was traded by looking at comments
    const tradedFromTeam = parseTradeFromComment(pick.comments || '');
    const isTraded = !!tradedFromTeam;

    assets.set(pickId, {
      round: pick.round,
      pick: pick.pick,
      currentFranchiseId,
      currentTeamName,
      originalTeamName: tradedFromTeam,
      isTraded,
    });
  });

  return assets;
}

/**
 * Build a list of actual draft picks from results with current ownership
 * Used to show which team actually owns each pick after trades
 *
 * @param draftResults - Draft results from MFL
 * @param teamConfigs - Team name and metadata
 * @returns Array of picks sorted by pick number with ownership info
 */
export function buildActualDraftPicks(
  draftResults: DraftResultsData,
  teamConfigs: Map<string, TeamConfig>
): Array<{
  round: string;
  pick: string;
  overallPickNumber: number;
  currentFranchiseId: string;
  currentTeamName: string;
  originalTeamName?: string;
  originalTeamIcon?: string;
  isTraded: boolean;
}> {
  const assets = extractActualAssets(draftResults, teamConfigs);
  const picks: Array<{
    round: string;
    pick: string;
    overallPickNumber: number;
    currentFranchiseId: string;
    currentTeamName: string;
    originalTeamName?: string;
    originalTeamIcon?: string;
    isTraded: boolean;
  }> = [];

  assets.forEach((asset) => {
    const roundNum = parseInt(asset.round);
    const pickNum = parseInt(asset.pick);
    const overallPickNumber = (roundNum - 1) * 16 + pickNum;

    // Find original team's icon if this pick was traded
    let originalTeamIcon: string | undefined;
    if (asset.isTraded && asset.originalTeamName) {
      // Find the team by name to get its icon
      for (const [_, config] of teamConfigs.entries()) {
        if (config.name === asset.originalTeamName) {
          originalTeamIcon = config.icon;
          break;
        }
      }
    }

    picks.push({
      round: asset.round,
      pick: asset.pick,
      overallPickNumber,
      currentFranchiseId: asset.currentFranchiseId,
      currentTeamName: asset.currentTeamName,
      originalTeamName: asset.originalTeamName,
      originalTeamIcon,
      isTraded: asset.isTraded,
    });
  });

  return picks.sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

/**
 * Convert actual draft picks to DraftPrediction format for grid display
 * Maps pick ownership data to the format expected by DraftPredictorGrid
 *
 * @param actualPicks - Actual draft picks from buildActualDraftPicks
 * @param teamConfigs - Map of franchise IDs to team config
 * @returns Array of DraftPrediction objects
 */
export function convertActualPicksToPredictions(
  actualPicks: Array<{
    round: string;
    pick: string;
    overallPickNumber: number;
    currentFranchiseId: string;
    currentTeamName: string;
    originalTeamName?: string;
    originalTeamIcon?: string;
    isTraded: boolean;
  }>,
  teamConfigs: Map<string, TeamConfig>
): DraftPrediction[] {
  return actualPicks.map((pick) => {
    const teamConfig = teamConfigs.get(pick.currentFranchiseId);

    return {
      overallPickNumber: pick.overallPickNumber,
      round: parseInt(pick.round),
      pickInRound: parseInt(pick.pick),
      franchiseId: pick.currentFranchiseId,
      teamName: pick.currentTeamName,
      teamIcon: teamConfig?.icon || '',
      teamBanner: teamConfig?.banner || '',
      currentRecord: {
        wins: 0,
        losses: 0,
        ties: 0,
      },
      currentStanding: {
        allPlayPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        powerRating: 0,
        victoryPoints: 0,
      },
      isToiletBowlPick: false,
      isLeagueWinner: false,
      originalTeamName: pick.originalTeamName,
      originalTeamIcon: pick.originalTeamIcon || '',
      isTraded: pick.isTraded,
    };
  });
}
