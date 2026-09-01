/**
 * Compute the AFL's constitutional waiver order from a completed season's
 * feeds. Shared by the writer (scripts/set-afl-waiver-order.ts) and the drift
 * detector (scripts/check-afl-waiver-order.ts) so the two can never disagree
 * about what the order should be — the detector's whole value is that it
 * independently reproduces what the writer would produce.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  calculateAFLDraftOrder,
  parseConferenceChampions,
  parseNITResults,
  buildHeadToHeadFromRaw,
  isDraftOrderFinal,
} from './afl-draft-utils';
import { buildAflWaiverOrder, type ConferenceBaseOrder, type WaiverOrderEntry } from './afl-waiver-order';

/** MFL conference draft-unit names → the codes the registry and export use. */
const CONFERENCE_CODES: Record<string, string> = {
  'American League': '00',
  'National League': '01',
};

export interface AflWaiverOrderSource {
  /** Franchise id → display name, from the league config. */
  teamNames: Map<string, string>;
  /** Conference code → champion franchise id, for the season used. */
  champions: Map<string, string>;
  baseOrders: ConferenceBaseOrder[];
  /** The full 1..24 order, conferences serialized as blocks. */
  order: WaiverOrderEntry[];
}

/**
 * @param root          Repo root.
 * @param league        Registry entry (needs dataPath + configPath).
 * @param standingsYear The COMPLETED season the order derives from.
 * @throws If that season's champions/NIT are unresolved — the champion forcing
 *         is what makes this the base order, so a projection is not usable.
 */
export function computeAflWaiverOrder(
  root: string,
  league: { dataPath: string; configPath: string },
  standingsYear: number
): AflWaiverOrderSource {
  const readFeed = (file: string) =>
    JSON.parse(
      fs.readFileSync(path.join(root, league.dataPath, 'mfl-feeds', String(standingsYear), file), 'utf-8')
    );

  const config = JSON.parse(fs.readFileSync(path.join(root, league.configPath), 'utf-8'));
  const teamConfigMap = new Map<string, any>(
    config.teams.map((t: any) => [
      t.franchiseId,
      { id: t.franchiseId, name: t.name, conference: t.conference, division: t.division },
    ])
  );
  const teamNames = new Map<string, string>(config.teams.map((t: any) => [t.franchiseId, t.name]));

  const standingsData = readFeed('standings.json');
  const standings = Array.isArray(standingsData.leagueStandings.franchise)
    ? standingsData.leagueStandings.franchise
    : [standingsData.leagueStandings.franchise];

  // The same-division tiebreaker needs real head-to-head; the plain standings
  // feed's h2h fields only echo the overall record.
  const headToHead = buildHeadToHeadFromRaw(readFeed('weekly-results-raw.json'));
  const brackets = readFeed('playoff-brackets.json');
  const champions = parseConferenceChampions(brackets, teamConfigMap);
  const nitResults = parseNITResults(brackets, teamConfigMap);

  if (!isDraftOrderFinal(champions, nitResults)) {
    throw new Error(
      `The ${standingsYear} draft order is still a projection — conference champions and/or NIT ` +
        `finishers could not be resolved from playoff-brackets.json. The base order is not final, ` +
        `so neither is the waiver order.`
    );
  }

  const draftOrders = calculateAFLDraftOrder(standings, teamConfigMap, champions, nitResults, headToHead);

  // Round 2 IS the base order: the NIT bonus is a round-1-only adjustment, so
  // rounds 2-9 revert to reverse standings with the champion last.
  const baseOrders: ConferenceBaseOrder[] = draftOrders.map((o) => {
    const code = CONFERENCE_CODES[o.conference];
    if (!code) throw new Error(`Unrecognized conference name "${o.conference}"`);
    return {
      conference: code,
      franchiseIds: o.picks
        .filter((p: any) => p.round === 2)
        .sort((a: any, b: any) => a.pickInRound - b.pickInRound)
        .map((p: any) => p.franchiseId),
    };
  });

  return { teamNames, champions, baseOrders, order: buildAflWaiverOrder(baseOrders) };
}
