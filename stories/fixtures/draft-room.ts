/**
 * Fixtures for the draft-room stories (src/components/shared/draft-room/).
 *
 * ── NO NETWORK AT CAPTURE TIME ────────────────────────────────────────────
 * Every image a draft-room component draws resolves on our own origin:
 *
 *  - **Headshots are the inline placeholder**, built by the SAME
 *    `buildNoHeadshotPlaceholder` the components fall back to. And no player
 *    carries `mflId` or `espnId`: BoardCell, PlayerCell and the player modal
 *    each run an onError cascade that walks ESPN (college) → MFL's photo host,
 *    and either id would arm a cross-origin fetch. That cascade is exactly
 *    what `PlayerCell/MissingHeadshot` had to give up its snapshot over.
 *  - **The splash's player cutout never fires**: `isSplashCutoutEligible`
 *    wants an ESPN CDN headshot, which no fixture has.
 *  - **DEF picks** take the local NFL mark (`/assets/nfl-logos/**`, globbed).
 *  - **Crests** are the five TheLeague files `STORY_ASSET_GLOBS` already
 *    names (pigskins, ninjas, wabbits, cowboy_up, dark_magicians), plus one
 *    franchise with NO icon, which is a real branch: the board header and the
 *    mobile row both render no avatar at all rather than a broken image.
 *
 * ── THE BOARD ─────────────────────────────────────────────────────────────
 * Six teams in a straight order, two rounds. Round 1 is complete and carries
 * one TRADED pick (the viewer's 1.03, made by Cowboy Up — the trade badge
 * draws the original owner's crest) and a DEF; round 2 has two picks made,
 * the viewer (Pigskins) ON THE CLOCK at 2.03, and three to come.
 */
import { buildNoHeadshotPlaceholder } from '../../src/utils/nfl-team-colors';
import type {
  DraftQueueItem,
  DraftRoomPick,
  DraftRoomPlayer,
  DraftRoomTeam,
  MockDraftSession,
} from '../../src/types/draft-room';
import type { PickSplashItem } from '../../src/utils/pick-reveal';

const team = (
  franchiseId: string,
  name: string,
  nameMedium: string,
  nameShort: string,
  abbrev: string,
  icon: string,
  colorPrimary: string,
): DraftRoomTeam => ({ franchiseId, name, nameMedium, nameShort, abbrev, icon, colorPrimary });

export const DRAFT_TEAMS: DraftRoomTeam[] = [
  team('0001', 'Pacific Pigskins', 'Pigskins', 'Pigskins', 'SKINS', '/assets/theleague/icons/pigskins.png', '#bd1f2b'),
  team('0005', 'The Mariachi Ninjas', 'Mariachi Ninjas', 'Ninjas', 'NINJA', '/assets/theleague/icons/ninjas.png', '#181818'),
  team('0009', 'Wascawy Wabbits', 'Wascawy Wabbits', 'Wabbits', 'WABS', '/assets/theleague/icons/wabbits.png', '#181818'),
  team('0014', 'Cowboy Up', 'Cowboy Up', 'Cowboy Up', 'CBOY', '/assets/theleague/icons/cowboy_up.png', '#153366'),
  team('0015', 'Dark Magicians of Chaos', 'Dark Magicians', 'Magicians', 'DMOC', '/assets/theleague/icons/dark_magicians.png', '#1a1440'),
  // No icon: the text-only branch.
  team('0012', 'Suh girls, one cup', 'Suh girls', 'Suh girls', 'SUH', '', '#4b2e83'),
];

export const DRAFT_TEAMS_BY_ID = new Map(DRAFT_TEAMS.map((t) => [t.franchiseId, t]));

/** The viewer's franchise. */
export const USER_TEAM_ID = '0001';

const player = (
  id: string,
  name: string,
  position: string,
  nflTeam: string,
  extra: Partial<DraftRoomPlayer> = {},
): DraftRoomPlayer => ({
  id,
  name,
  position,
  nflTeam,
  headshot: buildNoHeadshotPlaceholder(nflTeam),
  isRookie: true,
  draftYear: 2026,
  ...extra,
});

/**
 * Rookies, with the scouting and ADP fields the pool and the modal read. The
 * long name ("Marvin Harrison-Jeudy III") is there to make a board cell and a
 * pool row wrap.
 */
export const DRAFT_PLAYERS: DraftRoomPlayer[] = [
  player('r1', 'Jeremiah Love', 'RB', 'KC', { age: 21, college: 'Notre Dame', rspTier: 'A', rspPositionRank: 'RB1', rspScore: 92, adpRank: 1, adpAveragePick: 1.4, adpMinPick: 1, adpMaxPick: 3 }),
  player('r2', 'Carnell Tate', 'WR', 'PHI', { age: 21, college: 'Ohio State', rspTier: 'A', rspPositionRank: 'WR1', rspScore: 90, adpRank: 2, adpAveragePick: 2.6, adpMinPick: 1, adpMaxPick: 5 }),
  player('r3', 'Fernando Mendoza', 'QB', 'LV', { age: 22, college: 'Indiana', rspTier: 'B', rspPositionRank: 'QB1', rspScore: 84, adpRank: 4, adpAveragePick: 4.2, adpMinPick: 2, adpMaxPick: 8 }),
  player('r4', 'Marvin Harrison-Jeudy III', 'WR', 'NYJ', { age: 21, college: 'Texas', rspTier: 'B', rspPositionRank: 'WR3', rspScore: 81, adpRank: 6, adpAveragePick: 6.8, adpMinPick: 3, adpMaxPick: 11 }),
  player('r5', 'Kenyon Sadiq', 'TE', 'CHI', { age: 21, college: 'Oregon', rspTier: 'B', rspPositionRank: 'TE1', rspScore: 80, adpRank: 5, adpAveragePick: 5.5, adpMinPick: 3, adpMaxPick: 9 }),
  player('r6', 'Seattle Seahawks', 'DEF', 'SEA', { isRookie: false, draftYear: undefined }),
  player('r7', 'Makai Lemon', 'WR', 'DEN', { age: 21, college: 'USC', rspTier: 'C', rspPositionRank: 'WR4', rspScore: 76, adpRank: 9, adpAveragePick: 9.3, adpMinPick: 5, adpMaxPick: 15 }),
  player('r8', 'Jadarian Price', 'RB', 'ARI', { age: 22, college: 'Notre Dame', rspTier: 'C', rspPositionRank: 'RB3', rspScore: 74, adpRank: 8, adpAveragePick: 8.1, adpMinPick: 5, adpMaxPick: 13 }),
  // Still available — the pool, the queue and the modal draw from here.
  player('r9', 'Jordyn Tyson', 'WR', 'NO', { age: 22, college: 'Arizona State', rspTier: 'B', rspPositionRank: 'WR2', rspScore: 83, adpRank: 3, adpAveragePick: 3.9, adpMinPick: 2, adpMaxPick: 7, rspComparison: 'Chris Godwin', rspTypes: ['Possession', 'Slot'] }),
  player('r10', 'Nicholas Singleton', 'RB', 'TEN', { age: 22, college: 'Penn State', rspTier: 'C', rspPositionRank: 'RB4', rspScore: 73, adpRank: 11, adpAveragePick: 11.6, adpMinPick: 7, adpMaxPick: 17 }),
  player('r11', 'Garrett Nussmeier', 'QB', 'PIT', { age: 23, college: 'LSU', rspTier: 'D', rspPositionRank: 'QB3', rspScore: 66, adpRank: 15, adpAveragePick: 15.2, adpMinPick: 10, adpMaxPick: 22 }),
  player('r12', 'Eli Stowers', 'TE', 'DET', { age: 22, college: 'Vanderbilt', rspTier: 'C', rspPositionRank: 'TE2', rspScore: 71, adpRank: 13, adpAveragePick: 13.4, adpMinPick: 9, adpMaxPick: 19 }),
];

export const DRAFT_PLAYERS_BY_ID = new Map(DRAFT_PLAYERS.map((p) => [p.id, p]));

/**
 * Draft order — a straight order (both rounds the same), with the viewer
 * THIRD so round 2's on-the-clock pick (2.03) is theirs.
 */
const ORDER = ['0005', '0009', '0001', '0014', '0015', '0012'];

/**
 * Fixed epoch-second timestamps for made picks — history only. The timer
 * banner reads the CURRENT pick's timestamp, and the timer stories leave that
 * empty and drive the clock themselves (see `USER_PICK_ON_CLOCK`).
 */
const MADE_AT = 1790000000;

const pick = (round: number, pickInRound: number, playerId = '', extra: Partial<DraftRoomPick> = {}): DraftRoomPick => ({
  round,
  pickInRound,
  overallPickNumber: (round - 1) * ORDER.length + pickInRound,
  franchiseId: ORDER[pickInRound - 1],
  playerId,
  timestamp: playerId ? String(MADE_AT + (round - 1) * 600 + pickInRound * 60) : '',
  comments: '',
  isTraded: false,
  ...extra,
});

export const DRAFT_PICKS: DraftRoomPick[] = [
  pick(1, 1, 'r1'),
  pick(1, 2, 'r2'),
  // Traded: Cowboy Up made the 1.03 with the Pigskins' original pick.
  pick(1, 3, 'r3', { franchiseId: '0014', isTraded: true, originalTeamName: 'Pacific Pigskins', comments: '[Pick traded from Pacific Pigskins.]' }),
  pick(1, 4, 'r4'),
  pick(1, 5, 'r5'),
  pick(1, 6, 'r6'),
  pick(2, 1, 'r7'),
  pick(2, 2, 'r8'),
  pick(2, 3),
  pick(2, 4),
  pick(2, 5),
  pick(2, 6),
];

/** 2.03 — the Pigskins (the viewer) are on the clock. */
export const CURRENT_PICK_NUMBER = 9;

/** The viewer's queue: two available players and one taken since queuing (r4). */
export const DRAFT_QUEUE: DraftQueueItem[] = [
  { id: 'q-r9', playerId: 'r9', addedAt: 1 },
  { id: 'q-r4', playerId: 'r4', addedAt: 2 },
  { id: 'q-r12', playerId: 'r12', addedAt: 3 },
];

/**
 * The pick on the clock, for the timer banner — the viewer's (2.03) and,
 * for the other-team states, the Mariachi Ninjas' (2.01, shown unmade).
 *
 * The banner's own countdown re-reads `new Date()` every second against the
 * previous pick's timestamp, which no snapshot can hold still. The stories
 * never use it: they pass `mockClockSeconds`, which overrides that timer
 * entirely (the mock draft's server-driven clock), and an EMPTY timestamp here
 * leaves the internal timer with no deadline, so it never even starts.
 */
export const USER_PICK_ON_CLOCK: DraftRoomPick = { ...pick(2, 3), timestamp: '' };
export const OTHER_PICK_ON_CLOCK: DraftRoomPick = { ...pick(2, 1), playerId: '', timestamp: '' };

/** One splash in the reveal queue: Cowboy Up take Jordyn Tyson at 2.04. */
export const SPLASH_QUEUE: PickSplashItem[] = [
  { id: 'splash-1', pickLabel: '2.04', team: DRAFT_TEAMS_BY_ID.get('0014'), player: DRAFT_PLAYERS_BY_ID.get('r9') },
];

/**
 * A mock draft mid-way through, created by the viewer: every other team is
 * CPU-drafted by default, and one (Cowboy Up) has been switched to manual —
 * the override the settings dialog exists to make.
 */
export const MOCK_SESSION: MockDraftSession = {
  id: 'mock-story',
  leagueId: 'story',
  leagueYear: 2026,
  createdBy: USER_TEAM_ID,
  createdAt: '2026-04-20T18:00:00Z',
  status: 'active',
  draftOrder: [...ORDER, ...ORDER.slice().reverse()],
  picksPerRound: ORDER.length,
  totalRounds: 2,
  currentPickIndex: 8,
  timerSeconds: 120,
  picks: [],
  participants: [],
  useRealOrder: true,
  autoDraft: { '0014': false },
};
