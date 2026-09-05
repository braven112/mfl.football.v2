/**
 * The AFL mock draft's page assembly — everything its two routes need, so the
 * routes stay thin wrappers (`tests/page-fork-ratchet`, and `draft/mock/*` is
 * a two-league sibling the moment the AFL has one).
 *
 * Conference decisions live here for the same reason they live in
 * `afl-draft-room`: they are the part that is easy to get wrong, and keeping
 * them out of an `.astro` file is what makes them testable at all.
 */

import {
  aflRoomConferences,
  resolveAflRoomFor,
  type AflRoomSelection,
} from './afl-draft-room';
import { buildAflMockContext, type AflMockContext } from './afl-mock-draft-data';
import {
  AFL_MOCK_ROUNDS,
  availablePlayers,
  describeMockGate,
  isMockWindowOpen,
  type MockGateCopy,
} from './afl-mock-draft';
import { buildDraftPlayers, isDraftablePosition } from './build-draft-players';
import { getConferenceShort, getTeam, type ConferenceId } from './afl-conference';
import { getCurrentLeagueYear } from './league-year';
import { queueScope } from './draft-queue-storage';
import type { DraftRoomPageData } from '../types/draft-room';

export const AFL_MOCK_BASE_PATH = '/afl-fantasy/draft/mock';

/**
 * The ranking boards an AFL mock's CPU teams can draft from.
 *
 * Redraft ADP leads because the AFL redrafts every season — dynasty values
 * would have a bot spend a second-rounder on a 21-year-old it gets to keep for
 * one year. The rookie-only boards TheLeague uses (Sleeper, KTC) are absent
 * for the same reason: they rank fifty rookies against a pool of a thousand
 * veterans, which is not a draft board here.
 */
export const AFL_MOCK_RANKING_SOURCES = [
  { value: 'mfl-redraft', label: 'MFL Redraft ADP' },
  { value: 'mfl-dynasty', label: 'MFL Dynasty ADP' },
  { value: 'my-rank', label: 'My Rank' },
  { value: 'random', label: 'Chaos (random)' },
];

export const AFL_MOCK_DEFAULT_SOURCE = 'mfl-redraft';

/** Franchise display name, falling back to the id rather than throwing. */
export function aflFranchiseName(franchiseId: string): string {
  const team = getTeam(franchiseId);
  return team?.nameMedium || team?.name || `Team ${franchiseId}`;
}

export interface AflMockResolution {
  room: AflRoomSelection;
  context: AflMockContext;
  gate: MockGateCopy | null;
  /** The full available pool for this conference. */
  players: DraftRoomPageData['players'];
}

/**
 * Resolve one request's conference, window and pool.
 *
 * The POOL is the feature. It is every draftable player MINUS the twelve
 * rosters of THIS conference — never all twenty-four, because MFL allows a
 * player on one roster per conference and the AFL uses that: the same man was
 * taken 1.01 in both drafts in 2026.
 */
export async function resolveAflMock(input: {
  configConferences: Array<{ code: string; name: string }>;
  requestedConference: string | null | undefined;
  /**
   * The viewer's AUTHENTICATED franchise, or null.
   *
   * Deliberately not a browse-as selection. A mock is something you play in,
   * not something you look at, so "which team am I pretending to be" has no
   * meaning here — and `resolveAFLTeamSelection` defaults to '0001', which
   * would put a logged-out visitor in somebody's chair.
   */
  myFranchiseId: string | undefined | null;
  /**
   * Whether anyone is signed in at all. Distinguishes "signed out" (which the
   * lobby answers with its sign-in wall) from "signed in, but not to THIS
   * league" — a TheLeague admin browsing the AFL, who would otherwise be
   * offered a create button that builds a session in the wrong league.
   */
  viewerSignedIn?: boolean;
  /**
   * Build the player pool even when the window is shut. The session page sets
   * it: a mock created inside the window stays playable after the window
   * closes, and an empty board would be a silent wrong rather than a refusal.
   */
  needsPool?: boolean;
  leagueYear: number;
  leagueId: string;
  now?: Date;
}): Promise<AflMockResolution> {
  const room = resolveAflRoomFor(
    input.configConferences,
    input.requestedConference,
    input.myFranchiseId
  );

  const context = await buildAflMockContext({
    conference: room.conference,
    year: input.leagueYear,
    leagueId: input.leagueId,
    now: input.now,
  });

  // The pool is built ONLY when it will be used. Building it means loading
  // MFL's whole player catalogue (~1.4 MB, uncached) and joining ADP onto
  // ~2,500 rows, and the lobby is shut for most of the year — so on its
  // commonest state that work was all thrown away. The session page always
  // needs it, since a session created inside the window stays playable.
  //
  // The catalogue is TheLeague's players.json — MFL's player universe as this
  // app archives it — on the DEFAULT league's clock, the same arrangement the
  // AFL draft room and best-ball use. Redraft ADP because the AFL redrafts
  // every season.
  //
  // NO viewerFranchiseId. Its only effect is the licensed-RSP gate, RSP is
  // licensed inside TheLeague, and every league here has an 0001 who is a
  // different person — so an AFL id could only ever unlock it by collision.
  const needsPool = input.needsPool || isMockWindowOpen(context.window);
  const players = needsPool
    ? availablePlayers(
        buildDraftPlayers(getCurrentLeagueYear(), { adpSource: 'redraft' }),
        context.rostered,
        isDraftablePosition
      )
    : [];

  return {
    room,
    context,
    players,
    // Being on the wrong board outranks the window: an AL owner looking at the
    // NL lobby cannot start a session there whatever the NL's rosters say,
    // because they are not in its draft order and would never be on the clock.
    gate: input.viewerSignedIn && !input.myFranchiseId
      ? noTeamGate()
      : !room.isViewersConference
      ? wrongConferenceGate(room)
      : describeMockGate(context.window, {
      short: room.selected.short,
      label: room.selected.label,
      nameOf: aflFranchiseName,
      boardHref: `/afl-fantasy/draft/broadcast?conference=${room.conference}`,
      resultsHref: `/afl-fantasy/draft/results?conference=${room.conference}`,
    }),
  };
}

/**
 * Signed in, but not to this league.
 *
 * The create endpoint keys everything off the SESSION's league, so a
 * TheLeague owner who pressed the button here would get a TheLeague mock
 * behind an AFL URL. Refusing at the button is the honest fix; the sign-in
 * wall would be a lie, since they are signed in.
 */
function noTeamGate(): MockGateCopy {
  return {
    heading: 'You don’t have a team in the AFL',
    body: 'A mock puts you in a chair, so it needs a franchise to put you in. You can look around the draft section all you like — the board, the order and every draft the league has held are all open.',
  };
}

/** You can watch the other conference's draft; you cannot mock it. */
function wrongConferenceGate(room: AflRoomSelection): MockGateCopy {
  const yours = room.conferences.find((c) => c.code === room.viewerConference);
  return {
    heading: `This is the ${room.selected.short}'s board`,
    body: `You draft in the ${yours?.label ?? 'other conference'}, so you would not be in this mock's order — there would be no pick for you to make. Switch above to run one on your own board.`,
  };
}

/** The franchises on this board, shaped for the lobby's team map. */
export function aflMockFranchises(room: AflRoomSelection) {
  return room.teams.map((t) => ({
    franchiseId: t.franchiseId,
    name: aflFranchiseName(t.franchiseId),
    icon: t.icon,
  }));
}

/** Conference chips for the lobby's switcher. */
export function aflMockConferences(configConferences: Array<{ code: string; name: string }>) {
  return aflRoomConferences(configConferences).map((c) => ({
    code: c.code,
    label: c.label,
    short: c.short,
  }));
}

/**
 * The lobby's subtitle — it states the pool size, because "N available" is the
 * one number that tells an owner whether the board is real yet.
 */
export function aflMockSubtitle(resolution: AflMockResolution): string {
  const { context, room, players } = resolution;
  if (context.window.state !== 'open') {
    return `Practice the ${room.selected.label}'s ${context.year} draft — ${AFL_MOCK_ROUNDS} rounds from whatever your conference didn't keep.`;
  }
  return `${players.length.toLocaleString()} players are unkept and available in the ${room.selected.short}. Nine rounds, same order as the real thing.`;
}

/** Pool provenance, said out loud when it is not live. */
export function aflMockPoolNote(resolution: AflMockResolution): string {
  const { context, room } = resolution;
  const scope = `Drafting from the ${room.selected.label}'s available pool — players kept in the ${getConferenceShort(
    otherConference(room.conference)
  )} are still draftable here.`;
  return context.rosterSource === 'live'
    ? scope
    : `${scope} Rosters are from the last committed snapshot rather than live MFL, so a very recent cut may be missing.`;
}

function otherConference(id: ConferenceId): ConferenceId {
  return id === '00' ? '01' : '00';
}

/** The `pageData` the mock room island renders from. */
export function buildAflMockSessionData(input: {
  resolution: AflMockResolution;
  leagueId: string;
  partyHost: string;
}): DraftRoomPageData {
  const { resolution } = input;
  return {
    leagueYear: resolution.context.year,
    // A mock runs on its own clock, never MFL's — the NL's real draft is an
    // email draft counted in hours, which is not what a practice run is.
    draftKind: 'live',
    draftLimitHours: '',
    draftTimerSusp: '',
    totalRounds: resolution.context.rounds,
    picksPerRound: resolution.room.teams.length,
    teams: resolution.room.teams,
    // Picks start empty — PartyKit session sync populates them.
    picks: [],
    players: resolution.players,
    partyHost: input.partyHost,
    leagueId: input.leagueId,
    // Scopes the queue and the mock's chat channel to THIS conference.
    pollUnit: resolution.context.unit,
  };
}

/** localStorage scope for the queue backing the `my-rank` board. */
export function aflMockQueueScope(leagueId: string, unit: string): string {
  return queueScope(leagueId, unit);
}
