/**
 * The AFL half of the draft room.
 *
 * The AFL runs TWO drafts and they must never be crossed:
 *
 *  - the AMERICAN LEAGUE meets in person and picks in MFL's live-draft applet
 *    (`ajax_ld`), so its clock counts in MINUTES;
 *  - the NATIONAL LEAGUE runs a slow EMAIL draft over days off MFL's email
 *    draft page (option 52), so its clock counts in HOURS.
 *
 * MFL's `league.json` cannot express that — it carries one `draft_kind` for
 * the whole league — so the fact lives in `afl.config.json` and is read here
 * through `getConferenceDraftKind`.
 *
 * Kept out of the route so the route stays thin (`page-fork-ratchet` measures
 * exactly that, and `draft/room.astro` is a two-league sibling) and so the
 * conference/URL decisions — the part that is actually easy to get wrong —
 * are testable without rendering a page.
 */

import {
  getConferenceDraftKind,
  getConferenceTeams,
  getFranchiseConference,
  type ConferenceDraftKind,
  type ConferenceId,
} from './afl-conference';
import { buildMflLiveDraftUrl, buildMflOptionUrl } from './mfl-url';
import { buildDraftPlayers } from './build-draft-players';
import { buildDraftRoomData, resolveRoomConference, type EagerFeedGlob } from './draft-room-data';
import { getCurrentLeagueYear } from './league-year';
import type { DraftRoomPageData, DraftRoomTeam } from '../types/draft-room';

/** MFL option number for the league's Email Draft page (`O=`). */
export const MFL_EMAIL_DRAFT_OPTION = 52;

export interface AflRoomConference {
  code: string;
  label: string;
  short: string;
  draftKind: ConferenceDraftKind;
}

/** The selectable conferences, with how each one actually drafts. */
export function aflRoomConferences(
  configConferences: Array<{ code: string; name: string }>
): AflRoomConference[] {
  return configConferences.map((c) => ({
    code: c.code,
    label: c.name,
    short: c.code === '00' ? 'AL' : 'NL',
    draftKind: getConferenceDraftKind(c.code as ConferenceId),
  }));
}

/**
 * Where THIS conference makes its picks on MFL.
 *
 * Two different pages, and handing either conference the other's is a dead end
 * on the one day it matters — the AL's applet never opens for an NL owner, and
 * the email page is not where a live draft happens.
 */
export function aflPickUrlFor(
  draftKind: ConferenceDraftKind,
  opts: { leagueId: string; year: number; host: string }
): string {
  return draftKind === 'live'
    ? buildMflLiveDraftUrl(opts)
    : buildMflOptionUrl({ ...opts, option: MFL_EMAIL_DRAFT_OPTION });
}

/** This conference's twelve franchises — the only ones that pick on this board. */
export function aflRoomTeams(conference: ConferenceId): DraftRoomTeam[] {
  return getConferenceTeams(conference).map((t) => ({
    franchiseId: t.franchiseId,
    name: t.name,
    nameMedium: t.nameMedium || t.name,
    nameShort: t.nameShort || t.name,
    abbrev: t.abbrev || '',
    icon: t.icon || '',
    colorPrimary: (t as { colorPrimary?: string }).colorPrimary || '',
    colorSecondary: (t as { colorSecondary?: string }).colorSecondary || '',
  }));
}

/** The viewer's own conference, when they own a team in this league. */
export function viewerConferenceOf(franchiseId: string | undefined | null): ConferenceId | null {
  return franchiseId ? getFranchiseConference(franchiseId) : null;
}

export interface AflRoomSelection {
  conferences: AflRoomConference[];
  /** The conference being shown. */
  conference: ConferenceId;
  selected: AflRoomConference;
  teams: DraftRoomTeam[];
  /** The viewer's own conference, or null when they own no AFL team. */
  viewerConference: ConferenceId | null;
  /** True when the board shown is one the viewer actually drafts in. */
  isViewersConference: boolean;
  /** Franchise to highlight — only on the viewer's OWN board. */
  userTeamId: string;
  /** MFL draft unit to read and poll, e.g. `CONFERENCE01`. */
  unit: string;
}

/**
 * Resolve everything conference-shaped for one request.
 *
 * `userTeamId` is deliberately blank on the other conference's board: the
 * island highlights "your" team and scrolls to your pick, and doing that on a
 * draft the viewer has no part in is a lie about whose turn it is.
 */
export function resolveAflRoom(input: {
  configConferences: Array<{ code: string; name: string }>;
  requestedConference: string | null | undefined;
  myFranchiseId: string | undefined | null;
  /** Picks the conference when the request names none — see the util's own doc. */
  resolveConference: (
    requested: string | null | undefined,
    viewer: string | null | undefined,
    available: string[]
  ) => string | null;
}): AflRoomSelection {
  const conferences = aflRoomConferences(input.configConferences);
  const viewerConference = viewerConferenceOf(input.myFranchiseId);
  const conference = (input.resolveConference(
    input.requestedConference,
    viewerConference,
    conferences.map((c) => c.code)
  ) ?? conferences[0].code) as ConferenceId;
  const selected = conferences.find((c) => c.code === conference)!;
  const isViewersConference = !viewerConference || viewerConference === conference;

  return {
    conferences,
    conference,
    selected,
    teams: aflRoomTeams(conference),
    viewerConference,
    isViewersConference,
    userTeamId: viewerConference === conference ? input.myFranchiseId ?? '' : '',
    unit: `CONFERENCE${conference}`,
  };
}

/**
 * Everything the AFL room's route needs, in one call.
 *
 * The globs are still built in the route (a static import specifier can't be
 * a runtime variable) and handed in; everything done with them is here, which
 * is what keeps that route thin beside TheLeague's.
 */
export function buildAflRoomPageData(input: {
  room: AflRoomSelection;
  leagueYear: number;
  leagueId: string;
  mflHost: string;
  myFranchiseId: string | undefined | null;
  draftResultsFeeds: EagerFeedGlob;
  leagueFeeds: EagerFeedGlob;
  partyHost: string;
}): DraftRoomPageData {
  return buildDraftRoomData({
    leagueYear: input.leagueYear,
    draftResultsFeeds: input.draftResultsFeeds,
    leagueFeeds: input.leagueFeeds,
    teams: input.room.teams,
    // The pool comes from TheLeague's players.json — MFL's player universe as
    // this app archives it — on the DEFAULT league's year clock, the same
    // arrangement best-ball's room uses. Redraft ADP because the AFL redrafts
    // every season, so dynasty ranks would mis-sort the board.
    players: buildDraftPlayers(getCurrentLeagueYear(), {
      viewerFranchiseId: input.myFranchiseId ?? undefined,
      adpSource: 'redraft',
    }),
    leagueId: input.leagueId,
    partyHost: input.partyHost,
    unit: input.room.unit,
    mflHost: input.mflHost,
    draftKind: input.room.selected.draftKind,
    mflPickUrl: aflPickUrlFor(input.room.selected.draftKind, {
      leagueId: input.leagueId,
      year: input.leagueYear,
      host: `https://${input.mflHost}`,
    }),
  });
}

/** `resolveAflRoom` with this app's own conference resolver already wired in. */
export function resolveAflRoomFor(
  configConferences: Array<{ code: string; name: string }>,
  requestedConference: string | null | undefined,
  myFranchiseId: string | undefined | null
): AflRoomSelection {
  return resolveAflRoom({
    configConferences,
    requestedConference,
    myFranchiseId,
    resolveConference: resolveRoomConference,
  });
}
