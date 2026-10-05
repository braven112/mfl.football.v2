/**
 * AFL Conference helpers.
 *
 * MFL stores conferences as numeric IDs ('00', '01', …); the AFL names its two
 * "American League" and "National League". Keep the IDs at the API boundary
 * and use the user-facing names everywhere in UI.
 *
 * The conference LIST comes from the league config (`conferences`: code, name,
 * and optionally short, logo, logoDark, color), so a league with more than two
 * conferences — the custom-site demo's 8-conference big league — is served by
 * the same helpers. The AL/NL values below are the fallbacks the real AFL's
 * config has always relied on, so its output is unchanged.
 *
 * Cross-conference trades are not allowed.
 */

import aflConfig from '../../data/afl-fantasy/afl.config.json';
import { keeperLeagueConfig } from './keeper-config';

/**
 * Which AFL-family league a call is about. The AFL is the default, so every
 * existing caller is unchanged; the custom-site demo's keeper slot (built from
 * the AFL's pages) passes 'keeper' and reads its own teams and conferences.
 */
export type AflFamilySlug = 'afl-fantasy' | 'keeper';

/** An MFL conference id: '00', '01', … (two in the AFL, eight in the demo's big league). */
export type ConferenceId = string;
export type ConferenceName = string;
export type ConferenceShort = string;

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

/** The AFL's own two conferences — the fallback for a config that names no more. */
const CONFERENCE_NAMES: Record<string, string> = {
  '00': 'American League',
  '01': 'National League',
};

const CONFERENCE_SHORT: Record<string, string> = {
  '00': 'AL',
  '01': 'NL',
};

interface ConferenceConfig {
  code: string;
  name: string;
  short?: string;
  logo?: string;
  logoDark?: string;
  color?: string;
}

const readConferences = (list: unknown): ConferenceConfig[] =>
  ((list ?? []) as ConferenceConfig[]).filter((c) => c && typeof c.code === 'string');

/** The AFL slot's conferences, in config order ('00', '01' for the real AFL). */
const AFL_CONFERENCES: ConferenceConfig[] = (() => {
  const declared = readConferences((aflConfig as { conferences?: unknown }).conferences);
  return declared.length ? declared : Object.entries(CONFERENCE_NAMES).map(([code, name]) => ({ code, name }));
})();

const ALL_TEAMS: AFLTeam[] = (aflConfig.teams as AFLTeam[]).slice();

const FRANCHISE_INDEX = new Map<string, AFLTeam>(
  ALL_TEAMS.map((t) => [t.franchiseId, t])
);

const KEEPER_TEAMS: AFLTeam[] = (keeperLeagueConfig.teams as AFLTeam[]).slice();
const KEEPER_INDEX = new Map<string, AFLTeam>(KEEPER_TEAMS.map((t) => [t.franchiseId, t]));
/** The keeper league's own conferences, from its config ({ code, name, short }). */
const KEEPER_CONFERENCES: ConferenceConfig[] = readConferences(keeperLeagueConfig.conferences);

const teamsOf = (league: AflFamilySlug) => (league === 'keeper' ? KEEPER_TEAMS : ALL_TEAMS);
const indexOf = (league: AflFamilySlug) => (league === 'keeper' ? KEEPER_INDEX : FRANCHISE_INDEX);
const conferencesOf = (league: AflFamilySlug) => (league === 'keeper' ? KEEPER_CONFERENCES : AFL_CONFERENCES);
const conferenceConfig = (id: ConferenceId, league: AflFamilySlug) =>
  conferencesOf(league).find((c) => c.code === id);

/** "Coastal Conference" → "CC": a short label for a conference that declares none. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0].toUpperCase())
    .join('') || name;

/** The conference ids a league actually has, in presentation (config) order. */
export function leagueConferenceIds(league: AflFamilySlug = 'afl-fantasy'): ConferenceId[] {
  const teams = teamsOf(league);
  return conferencesOf(league)
    .map((c) => c.code)
    .filter((id) => teams.some((t) => t.conference === id));
}

export function getConferenceName(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): ConferenceName {
  return conferenceConfig(id, league)?.name ?? CONFERENCE_NAMES[id] ?? `Conference ${Number(id) + 1}`;
}

export function getConferenceShort(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): ConferenceShort {
  const declared = conferenceConfig(id, league);
  if (declared?.short) return declared.short;
  if (CONFERENCE_SHORT[id] && (!declared || declared.name === CONFERENCE_NAMES[id])) return CONFERENCE_SHORT[id];
  return initials(getConferenceName(id, league));
}

/**
 * Resolve the branded conference logo path (served from public/).
 * Single source of truth — call sites derive the path, never hardcode it.
 */
export function getConferenceLogo(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): string {
  const declared = conferenceConfig(id, league)?.logo;
  if (declared) return declared;
  if (league === 'keeper') return '/assets/logos/keeper-logo.svg';
  return `/assets/afl/conferences/${getConferenceShort(id).toLowerCase()}.svg`;
}

/**
 * Resolve the dark-mode conference logo path. Convention: same path + `-dark`
 * suffix (see /public/assets/afl/conferences/al-dark.svg, nl-dark.svg).
 * Pair with ThemeImage (src/components/shared/ThemeImage.astro) for the CSS swap —
 * SSR can never know the resolved theme, so both variants must render and
 * the swap happens client-side via html.dark.
 */
export function getConferenceLogoDark(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): string {
  const declared = conferenceConfig(id, league);
  if (declared?.logoDark) return declared.logoDark;
  if (declared?.logo) return declared.logo;
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
const CONFERENCE_COLORS: Record<string, string> = {
  '00': '#c41e3a',
  '01': '#1d4f91',
};

export function getConferenceColor(id: ConferenceId, league: AflFamilySlug = 'afl-fantasy'): string {
  return conferenceConfig(id, league)?.color ?? CONFERENCE_COLORS[id] ?? '#002244';
}

export function getConferenceIdByName(name: ConferenceName, league: AflFamilySlug = 'afl-fantasy'): ConferenceId | undefined {
  return conferencesOf(league).find((c) => c.name === name)?.code;
}

/** Whether `value` is one of the league's conference ids. */
export function isValidConferenceId(value: string, league: AflFamilySlug = 'afl-fantasy'): value is ConferenceId {
  return typeof value === 'string' && conferencesOf(league).some((c) => c.code === value);
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
 * The order the conferences are presented in.
 *
 * A viewer's OWN conference leads, then the rest in config order (AL-then-NL
 * for the AFL). The
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
  const present = leagueConferenceIds(league);
  if (!viewerConferenceId || !present.includes(viewerConferenceId)) return present;
  return [viewerConferenceId, ...present.filter((id) => id !== viewerConferenceId)];
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
