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
import { keeperLeagueConfig } from './keeper-config';

/**
 * Which AFL-family league a call is about. The AFL is the default, so every
 * existing caller is unchanged; the custom-site demo's keeper slot (built from
 * the AFL's pages) passes 'keeper' and reads its own teams and conferences.
 */
export type AflFamilySlug = 'afl-fantasy' | 'keeper';

export type ConferenceId = '00' | '01';
export type ConferenceName = 'American League' | 'National League';
export type ConferenceShort = 'AL' | 'NL';

/**
 * How a conference actually drafts.
 *
 * MFL's `league.json` carries ONE `draft_kind` for the whole league ("email"),
 * which is wrong for half of it: the AL meets in person and picks in MFL's
 * live-draft applet, while the NL runs a slow email draft over days. The two
 * are different events on different MFL pages, so the fact lives in the league
 * config rather than being inferred from a feed that cannot express it.
 *
 * `tests/afl-conference-draft-kind.test.ts` pins this against the draft-day
 * hero, which encodes the same fact in its own AL/NL card builders — if the
 * two ever disagree, one of them is sending owners to the wrong page on the
 * one day it matters.
 */
export type ConferenceDraftKind = 'live' | 'email';

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

const KEEPER_TEAMS: AFLTeam[] = (keeperLeagueConfig.teams as AFLTeam[]).slice();
const KEEPER_INDEX = new Map<string, AFLTeam>(KEEPER_TEAMS.map((t) => [t.franchiseId, t]));
/** The keeper league's own conference names, from its config ({ code, name, short }). */
const KEEPER_CONFERENCES = new Map<string, { name: string; short: string }>(
  ((keeperLeagueConfig.conferences ?? []) as Array<{ code: string; name: string; short?: string }>).map((c) => [
    c.code,
    { name: c.name, short: c.short ?? c.name },
  ]),
);

const teamsOf = (league: AflFamilySlug) => (league === 'keeper' ? KEEPER_TEAMS : ALL_TEAMS);
const indexOf = (league: AflFamilySlug) => (league === 'keeper' ? KEEPER_INDEX : FRANCHISE_INDEX);

/** The conference ids a league actually has, in presentation order. */
export function leagueConferenceIds(league: AflFamilySlug = 'afl-fantasy'): ConferenceId[] {
  if (league !== 'keeper') return ['00', '01'];
  return (['00', '01'] as ConferenceId[]).filter((id) => KEEPER_TEAMS.some((t) => t.conference === id));
}

export function getConferenceName(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): ConferenceName {
  if (league === 'keeper') return (KEEPER_CONFERENCES.get(id)?.name ?? CONFERENCE_NAMES[id]) as ConferenceName;
  return CONFERENCE_NAMES[id];
}

export function getConferenceShort(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): ConferenceShort {
  if (league === 'keeper') return (KEEPER_CONFERENCES.get(id)?.short ?? CONFERENCE_SHORT[id]) as ConferenceShort;
  return CONFERENCE_SHORT[id];
}

/**
 * Resolve the branded conference logo path (served from public/).
 * Single source of truth — call sites derive the path, never hardcode it.
 */
export function getConferenceLogo(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): string {
  if (league === 'keeper') return '/assets/logos/keeper-logo.svg';
  return `/assets/afl/conferences/${getConferenceShort(id).toLowerCase()}.svg`;
}

/**
 * Resolve the dark-mode conference logo path. Convention: same path + `-dark`
 * suffix (see /public/assets/afl/conferences/al-dark.svg, nl-dark.svg).
 * Pair with ThemeImage (src/components/ThemeImage.astro) for the CSS swap —
 * SSR can never know the resolved theme, so both variants must render and
 * the swap happens client-side via html.dark.
 */
export function getConferenceLogoDark(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): string {
  if (league === 'keeper') return '/assets/logos/keeper-logo-dark.svg';
  return `/assets/afl/conferences/${getConferenceShort(id).toLowerCase()}-dark.svg`;
}

/**
 * The conference's own accent, SAMPLED FROM ITS MARK rather than configured.
 *
 * Same contract as `getConferenceLogo` above — call sites derive it, never
 * hardcode it — and taken from the same place the logo comes from, so the two
 * cannot disagree: `al.svg` carries `#c41e3a` and `nl.svg` `#1d4f91` as their
 * one distinguishing hue (both also carry the shared `#002244` navy and
 * `#b0b7bc` silver, which is exactly why neither of those can stand for a
 * conference).
 *
 * Both clear white ink comfortably — 5.9:1 and 8.6:1 — which is what the
 * roster header's vertical rail needs.
 */
const CONFERENCE_COLORS: Record<ConferenceId, string> = {
  '00': '#c41e3a',
  '01': '#1d4f91',
};

export function getConferenceColor(id: ConferenceId): string {
  return CONFERENCE_COLORS[id];
}

export function getConferenceIdByName(name: ConferenceName): ConferenceId {
  return NAME_TO_ID[name];
}

export function isValidConferenceId(value: string): value is ConferenceId {
  return value === '00' || value === '01';
}

export function getTeam(franchiseId: string, league: AflFamilySlug = 'afl-fantasy'): AFLTeam | undefined {
  return indexOf(league).get(franchiseId);
}

export function getFranchiseConference(franchiseId: string, league: AflFamilySlug = 'afl-fantasy'): ConferenceId | null {
  return indexOf(league).get(franchiseId)?.conference ?? null;
}

/** Whether this conference drafts live in MFL's applet or by slow email. */
export function getConferenceDraftKind(id: ConferenceId): ConferenceDraftKind {
  const declared = (aflConfig.conferences as Array<{ code: string; draftKind?: string }>).find(
    (c) => c.code === id
  )?.draftKind;
  // Falling back to 'email' is the SAFE direction: an email draft's timer is
  // measured in hours, so a live draft mislabelled email merely shows a
  // generous deadline, while the reverse would put a 90-second clock on a
  // draft that runs for days.
  return declared === 'live' ? 'live' : 'email';
}

export function getConferenceTeams(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): AFLTeam[] {
  return teamsOf(league).filter((t) => t.conference === id);
}

export function getAllTeams(league: AflFamilySlug = 'afl-fantasy'): AFLTeam[] {
  return teamsOf(league).slice();
}

export function sameConference(a: string, b: string, league: AflFamilySlug = 'afl-fantasy'): boolean {
  const ca = getFranchiseConference(a, league);
  const cb = getFranchiseConference(b, league);
  return ca !== null && cb !== null && ca === cb;
}

/**
 * The order the two conferences are presented in.
 *
 * A viewer's OWN conference leads; everyone else keeps AL-then-NL. The
 * argument is the viewer's conference, never the conference of whatever club
 * is being looked at — an NL owner clicking into an AL club keeps NL first,
 * because an order that followed the VIEWED club would reshuffle the team
 * switcher under the cursor on every click, sending the crest just clicked to
 * the far end of the row.
 *
 * Null (signed out, or signed into the other league) keeps the historical
 * order, so a viewer who has chosen nothing sees exactly what they saw before.
 */
export function conferenceOrder(
  viewerConferenceId?: ConferenceId | null,
  league: AflFamilySlug = 'afl-fantasy'
): ConferenceId[] {
  const order: ConferenceId[] = viewerConferenceId === '01' ? ['01', '00'] : ['00', '01'];
  const present = leagueConferenceIds(league);
  return order.filter((id) => present.includes(id));
}

/**
 * Group teams by conference for UI dropdowns / lists.
 *
 * Defaults to AL first, then NL. Pass the VIEWER's conference to lead with
 * their own — see `conferenceOrder` for why it is the viewer's and not the
 * viewed club's.
 */
export function getTeamsGroupedByConference(
  viewerConferenceId?: ConferenceId | null,
  league: AflFamilySlug = 'afl-fantasy'
): Array<{
  conferenceId: ConferenceId;
  conferenceName: ConferenceName;
  teams: AFLTeam[];
}> {
  return conferenceOrder(viewerConferenceId, league).map((id) => ({
    conferenceId: id,
    conferenceName: getConferenceName(id, league),
    teams: getConferenceTeams(id, league),
  }));
}

/**
 * Filter a generic list of items that have a franchise ID to a single
 * conference. Useful for tradeBait / freeAgents / rosters when we only
 * want one conference's worth.
 */
export function filterByConference<T extends { franchiseId?: string; id?: string }>(
  items: T[],
  conferenceId: ConferenceId,
  league: AflFamilySlug = 'afl-fantasy'
): T[] {
  return items.filter((item) => {
    const fid = item.franchiseId ?? item.id;
    return fid != null && getFranchiseConference(fid, league) === conferenceId;
  });
}
