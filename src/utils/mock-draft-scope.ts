/**
 * Which registry a mock draft session belongs to.
 *
 * Sessions are listed out of a PartyKit "registry" room, and the room id is
 * the only thing separating one lobby's sessions from another's. TheLeague
 * needs just its league id; the AFL needs the CONFERENCE too, because its two
 * conferences run independent drafts from different pools — an AL mock in the
 * NL's lobby is a session an NL owner can open and then never be on the clock
 * in, since they are not in its draft order.
 *
 * TheLeague's key is returned byte-for-byte unchanged so sessions already in
 * flight keep their home. Same idiom, and the same reason, as `queueScope`.
 */

import { isValidConferenceId, type ConferenceId } from './afl-conference';

/** PartyKit room holding a lobby's session list. */
export function mockRegistryRoom(leagueId: string, unit?: string | null): string {
  return unit ? `${leagueId}-${unit.toLowerCase()}-registry` : `${leagueId}-registry`;
}

/**
 * The conference a request is asking about, or null.
 *
 * Accepts the bare code and MFL's `CONFERENCE00` unit id, matching every other
 * page here that takes `?conference=` — a URL copied between them must not
 * land on a different conference than the one that was copied. An unknown
 * value returns null rather than a default: for a WRITE, guessing is worse
 * than refusing.
 */
export function parseConference(value: unknown): ConferenceId | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/^CONFERENCE/, '');
  return isValidConferenceId(code) ? code : null;
}

/** MFL draft unit for a conference, e.g. `CONFERENCE01`. */
export function conferenceUnit(conference: ConferenceId): string {
  return `CONFERENCE${conference}`;
}
