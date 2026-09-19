/**
 * Fixtures for the shared live-scoring kit's stories.
 *
 * ── WHY THESE PARTICULAR VALUES ───────────────────────────────────────────
 * Every row here is chosen to put a documented hazard on screen. The kit is
 * already covered by ~70 non-visual cases (`live-kit-leaves`,
 * `live-board-shell`, `live-scoring-layout-css`, `live-ground-literals`), so a
 * story only earns its snapshots where a RENDERED result is the thing at risk
 * and a text assertion cannot see it:
 *
 *  - **A name that genuinely needs three lines.** `live-scoring-layout-css`
 *    asserts `grid-template-rows: subgrid` is declared, and declared LAST. It
 *    cannot assert the two sides actually end up sharing a bottom edge — which
 *    is the entire point of the subgrid chain, and which silently reverts to
 *    per-side tracks if the fallback declaration is ordered after it. Reserving
 *    two lines equalises one- against two-line names; only a real three-line
 *    name tests the mechanism. Measured at 390px: `Mike Washington Jr.` wraps
 *    to THREE and is the row that carries this (its pair is 122px against the
 *    others' 96-109); `San Francisco 49ers` wraps to two.
 *  - **A DEF row.** It takes the local NFL mark instead of a headshot, and gets
 *    NO stat line by design: ESPN's box score is athlete-keyed and MFL's 32
 *    defences carry no ESPN athlete id, so a plausible wrong number beside a
 *    real MFL score is worse than a blank.
 *  - **Both possession branches.** `isPlayerInRedZone` and
 *    `playerDownDistance` are BOTH gated on the player's team having the ball,
 *    and the row prefers the red-zone flag when it has one. So three distinct
 *    outcomes need three distinct situations, and the fixture supplies all
 *    three: KC has the ball inside the 20 (RED ZONE), ATL has the ball outside
 *    it (down-and-distance), and PHI is in KC's game without the ball (neither
 *    — a receiver flagged while his team is on defense is the bug).
 *  - **A lopsided pair.** The two sides legitimately differ in length, and the
 *    pair count is the longer of the two so no row is dropped.
 *
 * ── NO NETWORK AT CAPTURE TIME ────────────────────────────────────────────
 * `headshot` is `''` throughout, so the avatar renders as its team-coloured
 * chip and no image is fetched. A cross-origin fetch during capture is what
 * made ESPN weather — rather than a code change — fail a Chromatic build, and
 * it is why `PlayerCell/MissingHeadshot` carries `disableSnapshot`. The only
 * images here are same-origin: the local NFL marks (`/assets/nfl-logos/**`,
 * already globbed) and two crests that are already named individually in
 * `STORY_ASSET_GLOBS`, so these fixtures add nothing to the Chromatic trigger.
 *
 * `espnId` is null throughout as well. Nothing here needs one, and a fixture
 * is a bad place to normalise carrying them around.
 */
import { resolveMatchupColorVars } from '../../src/utils/live/model';
import type { LiveMatchup, LiveTeam } from '../../src/types/live';
import type {
  LivePlayerRow,
  NflGame,
  PlayerBoxScore,
  PlayerMeta,
} from '../../src/types/live-scoring';

const who = (
  id: string,
  name: string,
  position: string,
  nflTeam: string,
  projected: number,
): PlayerMeta => ({ id, name, position, nflTeam, headshot: '', espnId: null, projected });

/**
 * Two lineups' worth of identity. Position order is the kit's reading order
 * (QB, RB, WR, TE, K, DEF) because `orderLineupRows` has already applied it by
 * the time a row reaches the view — the fixture mirrors the output, not the
 * feed, which MFL returns in nondeterministic order.
 */
export const LIVE_META: Record<string, PlayerMeta> = {
  // Side 0.
  p1: who('p1', 'Jalen Hurts', 'QB', 'PHI', 21.4),
  p2: who('p2', 'Bijan Robinson', 'RB', 'ATL', 16.2),
  // The three-line name, and the reason this fixture exists.
  p3: who('p3', 'Mike Washington Jr.', 'WR', 'KC', 12.8),
  p4: who('p4', 'Trey McBride', 'TE', 'ARI', 9.6),
  p5: who('p5', 'Cameron Dicker', 'K', 'LAC', 8.1),
  // The other three-line name, and the DEF branch: local mark, no stat line.
  p6: who('p6', 'San Francisco 49ers', 'DEF', 'SF', 7.0),
  // Side 1.
  q1: who('q1', 'Baker Mayfield', 'QB', 'TB', 19.1),
  q2: who('q2', 'De’Von Achane', 'RB', 'MIA', 15.5),
  q3: who('q3', 'Puka Nacua', 'WR', 'LAR', 14.0),
  q4: who('q4', 'Dalton Kincaid', 'TE', 'BUF', 8.4),
  q5: who('q5', 'Chris Boswell', 'K', 'PIT', 8.9),
  // Side 1 runs one starter short — a real shape, and the one that proves the
  // pair count takes the LONGER side rather than dropping a row.
  // Bench.
  b1: who('b1', 'Jaylen Wright', 'RB', 'MIA', 6.2),
  b2: who('b2', 'Romeo Doubs', 'WR', 'GB', 7.4),
};

const row = (id: string, live: number, secondsRemaining: number): LivePlayerRow => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

/** Mixed game states, so the pre / live / final dots all appear in one shot. */
export const SIDE0_STARTERS: LivePlayerRow[] = [
  row('p1', 18.7, 900), // live
  row('p2', 21.1, 900), // live, and over projection -> the "boom" tone
  row('p3', 4.2, 2700), // live, early
  row('p4', 9.9, 0), // final
  row('p5', 6.0, 0), // final
  row('p6', 11.0, 3600), // not kicked off
];

export const SIDE1_STARTERS: LivePlayerRow[] = [
  row('q1', 14.3, 900),
  row('q2', 8.8, 900),
  row('q3', 17.6, 0),
  row('q4', 2.1, 3600),
  row('q5', 9.4, 0),
];

export const SIDE0_BENCH: LivePlayerRow[] = [{ ...row('b1', 5.5, 900), status: 'nonstarter' }];
export const SIDE1_BENCH: LivePlayerRow[] = [{ ...row('b2', 12.2, 0), status: 'nonstarter' }];

/**
 * ESPN games by canonical team code.
 *
 * `possession: 'KC'` plus `isRedZone` is what flags ONE row. Both KC and PHI
 * are in this live game; only the team with the ball may light up, which is
 * the rule `isPlayerInRedZone` enforces and the thing a snapshot can show.
 */
export const LIVE_GAMES: Record<string, NflGame> = {
  KC: {
    id: '4011',
    state: 'in',
    shortDetail: '8:12 - 3rd',
    period: 3,
    clock: '8:12',
    home: { code: 'KC', score: 17 },
    away: { code: 'PHI', score: 14 },
    possession: 'KC',
    date: '2026-09-20T17:00Z',
    situation: {
      isRedZone: true,
      possession: 'KC',
      downDistanceText: '1st & Goal at PHI 8',
      shortDownDistanceText: '1st & Goal',
      lastPlay: 'M.Washington Jr. rush to the PHI 8',
    },
  },
  PHI: {
    id: '4011',
    state: 'in',
    shortDetail: '8:12 - 3rd',
    period: 3,
    clock: '8:12',
    home: { code: 'KC', score: 17 },
    away: { code: 'PHI', score: 14 },
    // Same game, and PHI does NOT have the ball — so this row gets NEITHER
    // the red-zone flag nor a down-and-distance. `playerDownDistance` is
    // possession-gated too; "the other team's situation" is not this player's
    // to show.
    possession: 'KC',
    date: '2026-09-20T17:00Z',
    situation: {
      isRedZone: true,
      possession: 'KC',
      downDistanceText: '1st & Goal at PHI 8',
      shortDownDistanceText: '1st & Goal',
      lastPlay: 'M.Washington Jr. rush to the PHI 8',
    },
  },
  // Possession WITHOUT the red zone — the only situation that renders
  // `.lv-dd`. Without this game the down-and-distance branch never appears in
  // any story, because the one possessing team was inside the 20 and the row
  // prefers the red-zone flag.
  ATL: {
    id: '4014',
    state: 'in',
    shortDetail: '2:41 - 2nd',
    period: 2,
    clock: '2:41',
    home: { code: 'ATL', score: 10 },
    away: { code: 'NO', score: 13 },
    possession: 'ATL',
    date: '2026-09-20T17:00Z',
    situation: {
      isRedZone: false,
      possession: 'ATL',
      downDistanceText: '2nd & 7 at ATL 38',
      shortDownDistanceText: '2nd & 7',
      lastPlay: 'B.Robinson rush to the ATL 38',
    },
  },
  ARI: {
    id: '4012',
    state: 'post',
    shortDetail: 'Final',
    period: 4,
    clock: '0:00',
    home: { code: 'ARI', score: 24 },
    away: { code: 'LAR', score: 20 },
    possession: null,
    date: '2026-09-20T17:00Z',
  },
  SF: {
    id: '4013',
    state: 'pre',
    shortDetail: 'Sun 8:20 PM ET',
    period: 0,
    clock: '0:00',
    home: { code: 'SF', score: 0 },
    away: { code: 'SEA', score: 0 },
    possession: null,
    date: '2026-09-21T00:20Z',
  },
};

/** One line per row that has touches. A row with no entry shows no stat line. */
export const LIVE_BOX: Record<string, PlayerBoxScore> = {
  p1: { playerId: 'p1', nflTeam: 'PHI', statLine: '18/26, 214 yds, 2 TD, 1 INT', gameId: '4011' },
  p2: { playerId: 'p2', nflTeam: 'ATL', statLine: '17 car, 96 yds, 1 TD', gameId: '4014' },
  p3: { playerId: 'p3', nflTeam: 'KC', statLine: '3 rec (6 tgt), 41 yds', gameId: '4011' },
  p4: { playerId: 'p4', nflTeam: 'ARI', statLine: '5 rec (7 tgt), 62 yds, 1 TD', gameId: '4012' },
  q1: { playerId: 'q1', nflTeam: 'TB', statLine: '15/24, 188 yds, 1 TD', gameId: '4015' },
  q3: { playerId: 'q3', nflTeam: 'LAR', statLine: '8 rec (11 tgt), 124 yds, 1 TD', gameId: '4012' },
};

const team = (
  franchiseId: string,
  name: string,
  nameShort: string,
  initials: string,
  icon: string,
  totals: { live: number; projectedFinal: number; remainingPoints: number; yetToPlay: number },
  players: LivePlayerRow[],
  bench: LivePlayerRow[],
): LiveTeam => ({
  franchiseId,
  name,
  nameShort,
  initials,
  icon,
  iconAlt: name,
  rung: 'league',
  ...totals,
  players,
  bench,
});

export const SIDE0: LiveTeam = team(
  '0001',
  'Pacific Pigskins',
  'Pigskins',
  'PP',
  '/assets/theleague/icons/pigskins.png',
  { live: 71.9, projectedFinal: 104.3, remainingPoints: 32.4, yetToPlay: 1 },
  SIDE0_STARTERS,
  SIDE0_BENCH,
);

export const SIDE1: LiveTeam = team(
  '0013',
  'Nagoya Ninjas',
  'Ninjas',
  'NN',
  '/assets/afl/icons/ninjas.png',
  { live: 52.2, projectedFinal: 88.6, remainingPoints: 36.4, yetToPlay: 1 },
  SIDE1_STARTERS,
  SIDE1_BENCH,
);

/**
 * A NEAR-BLACK franchise pair, resolved through production code.
 *
 * `#181818` is seven TheLeague franchises' real colour and `#002244` is the one
 * that shipped at 1.07:1 on the AFL's navy card. The claims go through
 * `resolveMatchupColorVars` rather than being written out as resolved hexes,
 * for two reasons: a literal cannot be checked against the real tokens, and
 * `live-ground-literals` makes `live/surface.ts` the only place a card ground
 * may be named — so the fixture names a SURFACE and lets the resolver answer.
 *
 * WHAT THE STORY USING THIS DOES AND DOES NOT PIN. Resolution is server-side
 * and already guarded by `live-surface-grounds` / `live-ground-literals`; a
 * story cannot re-test it, because `colorVars` is one static set of four
 * properties and a story's args cannot vary per Chromatic mode. What it DOES
 * pin is the half that lives in CSS: that `live.css` aliases `--t0`/`--t1`
 * from the light/dark pair correctly, and keeps doing so on all three card
 * grounds. Resolved here against the AFL — the surface whose ground differs
 * most from the one the old island hardcoded.
 */
export const NEAR_BLACK_COLOR_VARS = resolveMatchupColorVars(
  { color: '#181818', colorPrimary: '#181818', colorSecondary: '#d4af37' },
  { color: '#002244', colorPrimary: '#002244', colorSecondary: '#869397' },
  'afl',
);

/** A live matchup the viewer owns side 0 of. */
export const LIVE_MATCHUP: LiveMatchup = {
  index: 0,
  sides: [SIDE0, SIDE1],
  viewerSide: 0,
  p0: 0.68,
  colorVars: resolveMatchupColorVars(
    { color: '#1c497c', colorPrimary: '#1c497c', colorSecondary: '#c8a44d' },
    { color: '#c41e3a', colorPrimary: '#c41e3a', colorSecondary: '#101820' },
    'theleague',
  ),
};

/** The same pairing with the near-black colours, and nobody's matchup. */
export const NEAR_BLACK_MATCHUP: LiveMatchup = {
  ...LIVE_MATCHUP,
  index: 4,
  viewerSide: null,
  p0: 0.52,
  colorVars: NEAR_BLACK_COLOR_VARS,
};
