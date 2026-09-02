/**
 * Fixtures for the playoff round heroes.
 *
 * These mirror the shape `buildPlayoffRoundView` produces
 * (src/utils/hero-data/playoff-round-data.ts) but are hand-built and frozen:
 * the real builder reads live brackets, projections and the signed-in owner,
 * none of which are reachable — or stable — from a story.
 *
 * Franchise names, colors, crests and icons are the real TheLeague values from
 * src/data/theleague.config.json so the branded panels render truthfully —
 * they resolve from public/ via the `staticDirs` entry in main.ts.
 *
 * Headshots are an INLINE data-URI silhouette, not the real ESPN cutout URLs
 * they started as. A visual regression suite must never depend on a third
 * party's CDN: Chromatic waits for network idle before capturing, so a slow or
 * blocked a.espncdn.com response turns every playoff-hero snapshot into a
 * timeout, and an intermittent one turns them into false diffs. The silhouette
 * is deterministic and offline, which is the whole point.
 *
 * These fixtures live outside src/ deliberately — see .storybook/main.ts for
 * the three repo guards that scan src/ and would fail on the franchise ids and
 * league literals below.
 *
 * FOUR teams, and they are the suite's standard cast (Pigskins, Cowboy Up,
 * Wabbits, Ninjas) rather than six arbitrary franchises. A bracket needs only
 * four to fill two wild-card games, two semifinals and a final, and every
 * crest a story renders is a file the Chromatic trigger has to name.
 *
 * `crest` and `icon` are WRITTEN OUT per team, not built from a slug. They
 * used to be template literals, and an interpolated path is invisible to
 * `computeStoryAssetLiterals()` — the scan that keeps STORY_ASSET_GLOBS honest
 * — so twelve crests rendered into these snapshots with nothing in the trigger
 * matching them. A logo swap would have shipped unbuilt and been auto-accepted
 * as the new baseline. Keep them literal.
 */

import type {
  PlayoffRoundView,
  PlayoffTeamView,
  PlayoffMatchupView,
} from '../../src/utils/hero-data/playoff-round-data';

interface TeamSeed {
  franchiseId: string;
  name: string;
  medium: string;
  short: string;
  color: string;
  colorPrimary: string;
  colorSecondary: string;
  /** Written out per team, never interpolated — see the note above. */
  crest: string;
  icon: string;
  seed: number;
  record: string;
  pointsFor: string;
  proj: number;
  player: PlayoffTeamView['player'];
  isUser?: boolean;
}

const PIGSKINS: TeamSeed = {
  franchiseId: '0001',
  name: 'Pacific Pigskins',
  medium: 'Pigskins',
  short: 'Pigskins',
  color: '#cc2936',
  colorPrimary: '#bd1f2b',
  colorSecondary: '#181818',
  crest: '/assets/theleague/group-me/pigskins.png',
  icon: '/assets/theleague/icons/pigskins.png',
  seed: 1,
  record: '11-3',
  pointsFor: '1,842',
  proj: 128.4,
  player: {
    name: 'Ja’Marr Chase',
    position: 'WR',
    nflTeam: 'CIN',
    headshot: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=',
  },
  isUser: true,
};

const COWBOY_UP: TeamSeed = {
  franchiseId: '0014',
  name: 'Cowboy Up',
  medium: 'Cowboy Up',
  short: 'Cowboy',
  color: '#0d2b56',
  colorPrimary: '#153366',
  colorSecondary: '#d32a3e',
  crest: '/assets/theleague/group-me/cowboy_up.png',
  icon: '/assets/theleague/icons/cowboy_up.png',
  seed: 2,
  record: '10-4',
  pointsFor: '1,798',
  proj: 124.9,
  player: {
    name: 'Patrick Mahomes',
    position: 'QB',
    nflTeam: 'KC',
    headshot: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=',
  },
};

const WABBITS: TeamSeed = {
  franchiseId: '0009',
  name: 'Wascawy Wabbits',
  medium: 'Wabbits',
  short: 'Wabbits',
  color: '#5c5c5c',
  colorPrimary: '#181818',
  colorSecondary: '#e9e9e9',
  crest: '/assets/theleague/group-me/wabbits.png',
  icon: '/assets/theleague/icons/wabbits.png',
  seed: 3,
  record: '9-5',
  pointsFor: '1,755',
  proj: 121.2,
  player: {
    name: 'Christian McCaffrey',
    position: 'RB',
    nflTeam: 'SF',
    headshot: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=',
  },
};

const NINJAS: TeamSeed = {
  franchiseId: '0005',
  name: 'The Mariachi Ninjas',
  medium: 'Mariachi Ninjas',
  short: 'Ninjas',
  color: '#006847',
  colorPrimary: '#181818',
  colorSecondary: '#2f8b59',
  crest: '/assets/theleague/group-me/ninjas.png',
  icon: '/assets/theleague/icons/ninjas.png',
  seed: 4,
  record: '8-6',
  pointsFor: '1,688',
  proj: 116.3,
  player: {
    name: 'Travis Kelce',
    position: 'TE',
    nflTeam: 'KC',
    headshot: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=',
  },
};

function team(seed: TeamSeed): PlayoffTeamView {
  return {
    franchiseId: seed.franchiseId,
    name: seed.name,
    medium: seed.medium,
    short: seed.short,
    seed: seed.seed,
    color: seed.color,
    colorPrimary: seed.colorPrimary,
    colorSecondary: seed.colorSecondary,
    crest: seed.crest,
    icon: seed.icon,
    record: seed.record,
    pointsFor: seed.pointsFor,
    proj: seed.proj,
    player: seed.player,
    isUser: seed.isUser ?? false,
  };
}

function game(
  gameId: string,
  a: TeamSeed,
  b: TeamSeed,
  opts: { isComplete?: boolean } = {},
): PlayoffMatchupView {
  const teams: [PlayoffTeamView, PlayoffTeamView] = [team(a), team(b)];
  return {
    gameId,
    isComplete: opts.isComplete ?? false,
    teams,
    isUserGame: teams.some((t) => t.isUser),
  };
}

/** Round 1 (Week 15) — every game as a compact card, one featured headliner. */
export const wildCardView: PlayoffRoundView = {
  kind: 'wild-card',
  label: 'Wild Card Weekend',
  week: 15,
  games: [
    // Seeds 2v3 and 1v4. The featured headliner is deliberately NOT the user's
    // team: `featured` and `isUser` drive different treatments (composite slot
    // vs accent ring) and a fixture that fuses them tests one axis twice.
    game('wc-1', COWBOY_UP, WABBITS),
    game('wc-2', PIGSKINS, NINJAS),
  ],
  featured: team(COWBOY_UP),
};

/** Round 2 (Week 16) — two games, four faces, split by a vertical seam. */
export const semifinalView: PlayoffRoundView = {
  kind: 'semifinals',
  label: 'Semifinals',
  week: 16,
  games: [
    game('sf-1', PIGSKINS, WABBITS),
    game('sf-2', COWBOY_UP, NINJAS),
  ],
  featured: null,
};

/** Round 3 (Week 17) — the title game, with the full comparison table. */
export const championshipView: PlayoffRoundView = {
  kind: 'championship',
  label: 'Championship',
  week: 17,
  games: [game('final', PIGSKINS, COWBOY_UP)],
  featured: null,
};

/**
 * Pre-kickoff championship: no records, no points-for, no projections.
 * The comparison table builds its rows conditionally, so this renders a
 * genuinely different component — the state you cannot reach in the live app
 * except during a few hours in late December.
 */
export const championshipPreGameView: PlayoffRoundView = {
  kind: 'championship',
  label: 'Championship',
  week: 17,
  games: [
    game(
      'final',
      { ...PIGSKINS, record: '', pointsFor: '', proj: 0 },
      { ...COWBOY_UP, record: '', pointsFor: '', proj: 0 },
    ),
  ],
  featured: null,
};

/** Path resolver stand-in — the real one prefixes the league slug. */
export const resolvePath = (path: string) => `/theleague${path}`;
