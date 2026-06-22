/**
 * AFL Fantasy Draft Pick Predictor Utilities
 * Handles two-conference draft order calculation with NIT points system
 */

import type {
  DraftPrediction,
  StandingsFranchise,
} from '../types/standings';

interface TeamConfig {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
  conference?: string;
  division?: string;
}

/**
 * Head-to-head ledger: franchiseId -> opponentId -> regular-season record.
 * Used for step 1 of the same-division standings tiebreaker.
 */
export type HeadToHeadMap = Map<string, Map<string, { w: number; l: number; t: number }>>;

interface NITResult {
  franchiseId: string;
  finishPosition: number; // 1-5 (top 5 get bonus points)
}

interface ConferenceDraftOrder {
  conference: string;
  picks: DraftPrediction[];
}

/**
 * Calculate predicted draft order for AFL Fantasy (two conferences)
 * Each conference has its own 12-team draft order
 *
 * @param standings - Current season standings
 * @param teamConfigs - Team config with conference info
 * @param conferenceChampions - Map of conference code to champion franchise ID
 * @param nitResults - Top 5 NIT finishers per conference (get +1.5 bonus points)
 * @returns Draft orders for both conferences
 */
export function calculateAFLDraftOrder(
  standings: StandingsFranchise[],
  teamConfigs: Map<string, TeamConfig>,
  conferenceChampions: Map<string, string>, // conference code -> franchise ID
  nitResults: Map<string, NITResult[]>, // conference code -> top 5 NIT finishers
  headToHead?: HeadToHeadMap // regular-season h2h for same-division tiebreaks
): ConferenceDraftOrder[] {
  // Group teams by conference
  const conferenceA = standings.filter(team => teamConfigs.get(team.id)?.conference === '00');
  const conferenceB = standings.filter(team => teamConfigs.get(team.id)?.conference === '01');

  const conferences = [
    { code: '00', name: 'American League', teams: conferenceA },
    { code: '01', name: 'National League', teams: conferenceB }
  ];

  return conferences.map(({ code, name, teams }) => {
    const championId = conferenceChampions.get(code);
    const nitTop5 = nitResults.get(code) || [];

    const picks = calculateConferenceDraftOrder(
      teams,
      teamConfigs,
      championId || '',
      nitTop5,
      code,
      headToHead
    );

    return {
      conference: name,
      picks
    };
  });
}

/**
 * Calculate draft order for a single conference (12 teams, 9 rounds)
 * Applies NIT points system to reorder Round 1 only
 */
function calculateConferenceDraftOrder(
  standings: StandingsFranchise[],
  teamConfigs: Map<string, TeamConfig>,
  championId: string,
  nitTop5: NITResult[],
  conferenceCode: string,
  headToHead?: HeadToHeadMap
): DraftPrediction[] {
  // Step 1: Sort by reverse record (worst to best)
  const sortedByRecord = sortByRecordReverse(standings, teamConfigs, headToHead);

  // Step 2: Assign base draft positions.
  //
  // Per the AFL constitution, the conference champion is pulled out of the
  // standings-based order and forced to the LAST base position (worst pick,
  // 1 point). The remaining teams fill positions 1..(N-1) by reverse record
  // (worst record = position 1 = most points). Pulling the champion out first
  // is what keeps the positions contiguous: assigning the champion position N
  // while still numbering everyone else by raw index would collide at N (and
  // skip a position) whenever the champion is not the best-record team.
  const teamCount = sortedByRecord.length;
  const championTeam = championId
    ? sortedByRecord.find(team => team.id === championId)
    : undefined;
  const nonChampions = championTeam
    ? sortedByRecord.filter(team => team.id !== championId)
    : sortedByRecord;

  const teamsWithPoints = nonChampions.map((team, index) => {
    const basePosition = index + 1; // 1 = worst record (best pick)
    const basePoints = teamCount + 1 - basePosition; // N points for position 1 ... 2 for position N-1

    // Check if team is in top 5 NIT finishers (+1.5 bonus)
    const isNITTop5 = nitTop5.some(nit => nit.franchiseId === team.id);
    const bonusPoints = isNITTop5 ? 1.5 : 0;
    const totalPoints = basePoints + bonusPoints;

    return {
      team,
      basePosition,
      totalPoints,
      isChampion: false
    };
  });

  // Champion always lands at the last base position (1 point, no NIT bonus —
  // the conference champion plays in the championship bracket, not the NIT).
  if (championTeam) {
    teamsWithPoints.push({
      team: championTeam,
      basePosition: teamCount,
      totalPoints: 1,
      isChampion: true
    });
  }

  // Step 3: Reorder Round 1 by total points (highest points = pick 1 / best pick)
  const round1Order = [...teamsWithPoints].sort((a, b) => {
    // Higher points = better pick (lower pick number)
    if (a.totalPoints !== b.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    // Tiebreaker: Higher original draft position (worse record) wins
    return a.basePosition - b.basePosition;
  });

  // Rounds 2-9 follow the BASE order (reverse standings, champion last) — the
  // NIT bonus is a Round 1 ONLY adjustment per the constitution ("The first
  // round will be reordered by total points earned"). Verified against the
  // live MFL draft board: a team bumped up in Round 1 by its NIT bonus reverts
  // to its base slot in Round 2 onward.
  const baseOrder = [...teamsWithPoints].sort((a, b) => a.basePosition - b.basePosition);

  const teamCountPerRound = teamsWithPoints.length;

  // Build all draft predictions
  const draftPredictions: DraftPrediction[] = [];

  // Round 1: Use NIT-adjusted order
  round1Order.forEach((item, index) => {
    const pickNumber = index + 1; // 1-12
    draftPredictions.push(
      buildAFLDraftPrediction(
        item.team,
        teamConfigs,
        pickNumber,
        item.isChampion,
        1,
        pickNumber,
        conferenceCode
      )
    );
  });

  // Rounds 2-9: Follow the base (reverse-standings) order, NOT Round 1
  for (let round = 2; round <= 9; round++) {
    baseOrder.forEach((item, index) => {
      const pickInRound = index + 1; // 1-12
      const overallNumber = (round - 1) * teamCountPerRound + pickInRound;

      draftPredictions.push(
        buildAFLDraftPrediction(
          item.team,
          teamConfigs,
          overallNumber,
          item.isChampion,
          round,
          pickInRound,
          conferenceCode
        )
      );
    });
  }

  return draftPredictions;
}

const numField = (v: string | undefined): number => {
  const n = parseFloat(v ?? '0');
  return Number.isFinite(n) ? n : 0;
};

/** Overall won-lost-tied percentage ((W + 0.5T) / G), ties counted as half. */
function overallPct(f: StandingsFranchise): number {
  const w = parseInt(f.divw || '0') + parseInt(f.nondivw || '0');
  const l = parseInt(f.divl || '0') + parseInt(f.nondivl || '0');
  const t = parseInt(f.divt || '0') + parseInt(f.nondivt || '0');
  const g = w + l + t;
  return g > 0 ? (w + 0.5 * t) / g : 0;
}

/**
 * Head-to-head comparison for the draft (worst picks first). Returns a negative
 * number if `a` should pick earlier (i.e. lost the season series to `b`), a
 * positive number if `b` should pick earlier, and 0 if they never met / split.
 */
function headToHeadDelta(
  a: StandingsFranchise,
  b: StandingsFranchise,
  headToHead?: HeadToHeadMap
): number {
  const rec = headToHead?.get(a.id)?.get(b.id);
  if (!rec) return 0;
  const g = rec.w + rec.l + rec.t;
  if (g === 0) return 0;
  const aPct = (rec.w + 0.5 * rec.t) / g;
  const bPct = (rec.l + 0.5 * rec.t) / g; // b's share of the same series
  return aPct - bPct; // higher h2h % = better = picks later
}

/**
 * Sort teams worst-to-best to produce the base (reverse-standings) draft order,
 * following the AFL constitution's official standings tiebreakers.
 *
 * Primary key is overall W-L-T %. Equal records are broken by the constitution's
 * chain, which DIFFERS by whether the tied teams share a division ("ties are
 * always broken within divisions first"):
 *
 *   Same division:  head-to-head -> division % -> conference % -> Power Rank ->
 *                   total points -> all-play % -> victory points ->
 *                   most points allowed -> coin flip
 *   Cross-division: conference % -> Power Rank -> total points -> all-play % ->
 *   (wild card)     victory points -> most points allowed -> coin flip
 *
 * For draft order the WORSE team picks first, so every "higher is better" metric
 * sorts ascending (lower first), and "most points allowed" sorts descending
 * (more points allowed = worse = earlier pick). The coin flip is rendered
 * deterministically (by franchise id) so the prediction is stable across loads.
 *
 * Note: ties among 3+ teams are resolved pairwise rather than via the
 * constitution's "eliminate, then revert to step 1" recursion. The chains share
 * every step after head-to-head, so pairwise ordering matches the constitution
 * for all realistic cases; exotic non-transitive 3-way ties are not modeled.
 */
function sortByRecordReverse(
  standings: StandingsFranchise[],
  teamConfigs?: Map<string, TeamConfig>,
  headToHead?: HeadToHeadMap
): StandingsFranchise[] {
  return [...standings].sort((a, b) => {
    // Primary: overall record — worst (lowest %) picks first.
    const pctDelta = overallPct(a) - overallPct(b);
    if (pctDelta !== 0) return pctDelta;

    const divA = teamConfigs?.get(a.id)?.division;
    const divB = teamConfigs?.get(b.id)?.division;
    const sameDivision = !!divA && !!divB && divA === divB;

    // Same-division ties lead with head-to-head, then division record.
    if (sameDivision) {
      const h2h = headToHeadDelta(a, b, headToHead);
      if (h2h !== 0) return h2h;

      const divDelta = numField(a.divpct) - numField(b.divpct);
      if (divDelta !== 0) return divDelta;
    }

    // Shared tail (and the full chain for cross-division / wild-card ties).
    const confDelta = numField(a.confpct) - numField(b.confpct);
    if (confDelta !== 0) return confDelta;

    const pwrDelta = numField(a.pwr) - numField(b.pwr);
    if (pwrDelta !== 0) return pwrDelta;

    const pfDelta = numField(a.pf) - numField(b.pf);
    if (pfDelta !== 0) return pfDelta;

    const allPlayDelta = numField(a.all_play_pct) - numField(b.all_play_pct);
    if (allPlayDelta !== 0) return allPlayDelta;

    const vpDelta = numField(a.vp) - numField(b.vp);
    if (vpDelta !== 0) return vpDelta;

    // Most points allowed: higher PA is worse -> sort descending (worse first).
    const paDelta = numField(b.pa) - numField(a.pa);
    if (paDelta !== 0) return paDelta;

    // Deterministic stand-in for the constitution's coin flip.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Build a regular-season head-to-head ledger from MFL's raw weekly results
 * (`weekly-results-raw.json`). Only matchups flagged `regularSeason === '1'`
 * count — playoff/NIT games never factor into standings tiebreakers.
 */
export function buildHeadToHeadFromRaw(raw: unknown): HeadToHeadMap {
  const ledger: HeadToHeadMap = new Map();
  const weeks = Array.isArray(raw) ? raw : Object.values(raw ?? {});

  const bump = (from: string, to: string, result: string) => {
    if (!ledger.has(from)) ledger.set(from, new Map());
    const row = ledger.get(from)!;
    const rec = row.get(to) ?? { w: 0, l: 0, t: 0 };
    if (result === 'W') rec.w++;
    else if (result === 'L') rec.l++;
    else rec.t++;
    row.set(to, rec);
  };

  for (const weekEntry of weeks as any[]) {
    const wr = weekEntry?.weeklyResults ?? weekEntry?.[0]?.weeklyResults;
    if (!wr) continue;
    const matchups = Array.isArray(wr.matchup) ? wr.matchup : wr.matchup ? [wr.matchup] : [];
    for (const m of matchups) {
      if (m?.regularSeason !== '1') continue;
      const fr = m.franchise;
      if (!Array.isArray(fr) || fr.length !== 2) continue;
      const [x, y] = fr;
      if (!x?.id || !y?.id) continue;
      bump(x.id, y.id, x.result);
      bump(y.id, x.id, y.result);
    }
  }

  return ledger;
}

/**
 * Build a single draft prediction object for AFL Fantasy
 */
function buildAFLDraftPrediction(
  standing: StandingsFranchise,
  teamConfigs: Map<string, TeamConfig>,
  overallPickNumber: number,
  isConferenceChampion: boolean,
  round: number,
  pickInRound: number,
  conferenceCode: string
): DraftPrediction {
  const teamConfig = teamConfigs.get(standing.id);

  // Parse overall record
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
    pickInRound,
    franchiseId: standing.id,
    teamName: teamConfig?.name || standing.fname,
    teamIcon: teamConfig?.icon || '',
    teamBanner: teamConfig?.banner || '',
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
    isToiletBowlPick: false,
    isLeagueWinner: isConferenceChampion,
    conference: conferenceCode
  };
}

/**
 * Mock NIT results for testing/preview before NIT is complete
 * Returns empty array - no bonus points awarded yet
 */
export function getMockNITResults(): Map<string, NITResult[]> {
  return new Map([
    ['00', []],
    ['01', []]
  ]);
}

/**
 * Parse conference champions from playoff bracket data.
 *
 * Per the AFL constitution each conference draft is independent, and EACH
 * conference champion automatically receives the 12th (last) pick in their own
 * conference draft — not just the overall Super Bowl winner. The conference
 * championships are separate brackets from the Super Bowl:
 *   - Bracket 1 = AFL Championship (Super Bowl, AL champ vs NL champ)
 *   - Bracket 2 = AL Championship  -> American League champion (conference '00')
 *   - Bracket 3 = NL Championship  -> National League champion (conference '01')
 *
 * We read brackets 2 and 3 and slot each winner into its actual conference
 * (looked up from the team config, so a misnumbered bracket can't mis-slot a
 * champion). Returns a map of conference code ('00' | '01') -> franchise ID.
 */
export function parseConferenceChampions(
  playoffBracketsData: any,
  teamConfigs: Map<string, TeamConfig>
): Map<string, string> {
  const champions = new Map<string, string>();

  if (!playoffBracketsData?.brackets) {
    return champions;
  }

  // Bracket 2 = AL Championship, Bracket 3 = NL Championship.
  for (const bracketId of ['2', '3']) {
    const champion = getWinnerOfBracket(playoffBracketsData.brackets[bracketId]);
    if (!champion) continue;

    const conference = teamConfigs.get(champion)?.conference;
    if (conference === '00' || conference === '01') {
      champions.set(conference, champion);
    }
  }

  return champions;
}

/**
 * Get the winner of a playoff bracket by following the bracket rounds
 * Returns franchise ID of winner, or undefined if bracket not complete
 */
function getWinnerOfBracket(bracket: any): string | undefined {
  if (!bracket?.playoffBracket?.playoffRound) {
    return undefined;
  }

  // Get the last round (championship game)
  const rounds = Array.isArray(bracket.playoffBracket.playoffRound)
    ? bracket.playoffBracket.playoffRound
    : [bracket.playoffBracket.playoffRound];

  const finalRound = rounds[rounds.length - 1];
  const finalGame = finalRound?.playoffGame;

  if (!finalGame) {
    return undefined;
  }

  // Check if game has been played (points are filled in)
  const homePoints = parseFloat(finalGame.home?.points || '');
  const awayPoints = parseFloat(finalGame.away?.points || '');

  if (isNaN(homePoints) || isNaN(awayPoints)) {
    return undefined; // Game not played yet
  }

  // Determine winner based on points
  if (homePoints > awayPoints) {
    return resolveTeamId(finalGame.home);
  } else if (awayPoints > homePoints) {
    return resolveTeamId(finalGame.away);
  }

  return undefined;
}

/**
 * Resolve a team reference to an actual franchise ID
 * Handles direct franchise_id or references to winner/loser of other games
 */
function resolveTeamId(team: any): string | undefined {
  if (team?.franchise_id) {
    return team.franchise_id;
  }

  // TODO: Implement recursive resolution of winner_of_game/loser_of_game references
  // For now, return undefined if not a direct franchise_id
  return undefined;
}

/**
 * Parse NIT results from playoff bracket data
 * Identifies top 5 finishers who get +1.5 bonus points
 *
 * Top 5 NIT positions (each gets +1.5 draft points):
 * 1. Winner of bracket 6 (NIT Championship)
 * 2. Loser of bracket 6 final (NIT Runner-up)
 * 3. Winner of bracket 7 (NIT 3rd Place)
 * 4. Winner of bracket 8 (NIT 4th Place)
 * 5. Winner of bracket 9 (NIT 5th Place)
 *
 * NIT is a single 16-team tournament with teams from both conferences,
 * so we need to filter results by conference after determining the top 5
 */
export function parseNITResults(
  playoffBracketsData: any,
  teamConfigs: Map<string, TeamConfig>
): Map<string, NITResult[]> {
  const results = new Map<string, NITResult[]>([
    ['00', []],
    ['01', []]
  ]);

  if (!playoffBracketsData?.brackets) {
    return results;
  }

  const allNITFinishers: Array<{ franchiseId: string; position: number }> = [];

  // Position 1: NIT Champion (winner of bracket 6)
  const nitChampion = getWinnerOfBracket(playoffBracketsData.brackets['6']);
  if (nitChampion) {
    allNITFinishers.push({ franchiseId: nitChampion, position: 1 });
  }

  // Position 2: NIT Runner-up (loser of bracket 6 final)
  const nitRunnerUp = getLoserOfBracketFinal(playoffBracketsData.brackets['6']);
  if (nitRunnerUp) {
    allNITFinishers.push({ franchiseId: nitRunnerUp, position: 2 });
  }

  // Position 3: NIT 3rd Place (winner of bracket 7)
  const nit3rdPlace = getWinnerOfBracket(playoffBracketsData.brackets['7']);
  if (nit3rdPlace) {
    allNITFinishers.push({ franchiseId: nit3rdPlace, position: 3 });
  }

  // Position 4: NIT 4th Place (winner of bracket 8)
  const nit4thPlace = getWinnerOfBracket(playoffBracketsData.brackets['8']);
  if (nit4thPlace) {
    allNITFinishers.push({ franchiseId: nit4thPlace, position: 4 });
  }

  // Position 5: NIT 5th Place (winner of bracket 9)
  const nit5thPlace = getWinnerOfBracket(playoffBracketsData.brackets['9']);
  if (nit5thPlace) {
    allNITFinishers.push({ franchiseId: nit5thPlace, position: 5 });
  }

  // Distribute finishers to their respective conferences
  allNITFinishers.forEach(finisher => {
    const teamConfig = teamConfigs.get(finisher.franchiseId);
    const conference = teamConfig?.conference;

    if (conference === '00' || conference === '01') {
      const conferenceResults = results.get(conference) || [];
      conferenceResults.push({
        franchiseId: finisher.franchiseId,
        finishPosition: finisher.position
      });
      results.set(conference, conferenceResults);
    }
  });

  return results;
}

/**
 * Get the loser of a bracket's final game
 */
function getLoserOfBracketFinal(bracket: any): string | undefined {
  if (!bracket?.playoffBracket?.playoffRound) {
    return undefined;
  }

  const rounds = Array.isArray(bracket.playoffBracket.playoffRound)
    ? bracket.playoffBracket.playoffRound
    : [bracket.playoffBracket.playoffRound];

  const finalRound = rounds[rounds.length - 1];
  const finalGame = finalRound?.playoffGame;

  if (!finalGame) {
    return undefined;
  }

  const homePoints = parseFloat(finalGame.home?.points || '');
  const awayPoints = parseFloat(finalGame.away?.points || '');

  if (isNaN(homePoints) || isNaN(awayPoints)) {
    return undefined;
  }

  // Return loser (opposite of winner)
  if (homePoints > awayPoints) {
    return resolveTeamId(finalGame.away);
  } else if (awayPoints > homePoints) {
    return resolveTeamId(finalGame.home);
  }

  return undefined;
}
