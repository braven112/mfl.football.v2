/**
 * AFL Conference helpers.
 *
 * MFL stores conferences as numeric IDs ('00', '01'); the league names them
 * "American League" and "National League". Keep the IDs at the API boundary
 * and use the user-facing names everywhere in UI.
 *
 * Cross-conference (AL <-> NL) trades are not allowed.
 */

import aflConfig from '../../data/afl-fantasy/afl.config.json';

export type ConferenceId = '00' | '01';
export type ConferenceName = 'American League' | 'National League';
export type ConferenceShort = 'AL' | 'NL';

export interface AFLTeam {
  franchiseId: string;
  name: string;
  nameMedium: string;
  nameShort: string;
  abbrev: string;
  aliases: string[];
  conference: ConferenceId;
  division: string;
  tier: string;
  icon: string;
  banner: string;
}

const CONFERENCE_NAMES: Record<ConferenceId, ConferenceName> = {
  '00': 'American League',
  '01': 'National League',
};

const CONFERENCE_SHORT: Record<ConferenceId, ConferenceShort> = {
  '00': 'AL',
  '01': 'NL',
};

const NAME_TO_ID: Record<ConferenceName, ConferenceId> = {
  'American League': '00',
  'National League': '01',
};

const ALL_TEAMS: AFLTeam[] = (aflConfig.teams as AFLTeam[]).slice();

const FRANCHISE_INDEX = new Map<string, AFLTeam>(
  ALL_TEAMS.map((t) => [t.franchiseId, t])
);

export function getConferenceName(id: ConferenceId): ConferenceName {
  return CONFERENCE_NAMES[id];
}

export function getConferenceShort(id: ConferenceId): ConferenceShort {
  return CONFERENCE_SHORT[id];
}

export function getConferenceIdByName(name: ConferenceName): ConferenceId {
  return NAME_TO_ID[name];
}

export function isValidConferenceId(value: string): value is ConferenceId {
  return value === '00' || value === '01';
}

export function getTeam(franchiseId: string): AFLTeam | undefined {
  return FRANCHISE_INDEX.get(franchiseId);
}

export function getFranchiseConference(franchiseId: string): ConferenceId | null {
  return FRANCHISE_INDEX.get(franchiseId)?.conference ?? null;
}

export function getConferenceTeams(id: ConferenceId): AFLTeam[] {
  return ALL_TEAMS.filter((t) => t.conference === id);
}

export function getAllTeams(): AFLTeam[] {
  return ALL_TEAMS.slice();
}

export function sameConference(a: string, b: string): boolean {
  const ca = getFranchiseConference(a);
  const cb = getFranchiseConference(b);
  return ca !== null && cb !== null && ca === cb;
}

/**
 * Group teams by conference for UI dropdowns / lists.
 * Returns AL first, then NL.
 */
export function getTeamsGroupedByConference(): Array<{
  conferenceId: ConferenceId;
  conferenceName: ConferenceName;
  teams: AFLTeam[];
}> {
  return (['00', '01'] as ConferenceId[]).map((id) => ({
    conferenceId: id,
    conferenceName: CONFERENCE_NAMES[id],
    teams: getConferenceTeams(id),
  }));
}

/**
 * Filter a generic list of items that have a franchise ID to a single
 * conference. Useful for tradeBait / freeAgents / rosters when we only
 * want one conference's worth.
 */
export function filterByConference<T extends { franchiseId?: string; id?: string }>(
  items: T[],
  conferenceId: ConferenceId
): T[] {
  return items.filter((item) => {
    const fid = item.franchiseId ?? item.id;
    return fid != null && getFranchiseConference(fid) === conferenceId;
  });
}
