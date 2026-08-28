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
  slug: string;
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
  slug: 'pigskins',
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

const DANGSTERS: TeamSeed = {
  franchiseId: '0002',
  name: 'Da Dangsters',
  medium: 'Da Dangsters',
  short: 'Dangsters',
  color: '#8b6914',
  colorPrimary: '#1b435f',
  colorSecondary: '#8b8f93',
  slug: 'da_dangsters',
  seed: 4,
  record: '8-6',
  pointsFor: '1,703',
  proj: 119.7,
  player: {
    name: 'Justin Jefferson',
    position: 'WR',
    nflTeam: 'MIN',
    headshot: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=',
  },
};

const MAVERICK: TeamSeed = {
  franchiseId: '0003',
  name: 'Maverick',
  medium: 'Mavericks',
  short: 'Mavericks',
  color: '#c4b060',
  colorPrimary: '#181818',
  colorSecondary: '#b5884a',
  slug: 'maverick',
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

const DEAD_CAP: TeamSeed = {
  franchiseId: '0004',
  name: 'Dead Cap Walking',
  medium: 'Dead Cap',
  short: 'Dead Cap',
  color: '#65b32e',
  colorPrimary: '#203b5b',
  colorSecondary: '#7eb458',
  slug: 'dead_cap_walking',
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
  slug: 'ninjas',
  seed: 5,
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

const MUSIC_CITY: TeamSeed = {
  franchiseId: '0006',
  name: 'Music City Mafia',
  medium: 'Music City',
  short: 'Music City',
  color: '#4b92db',
  colorPrimary: '#113469',
  colorSecondary: '#c8102e',
  slug: 'music_city',
  seed: 6,
  record: '7-7',
  pointsFor: '1,640',
  proj: 112.8,
  player: {
    name: 'Bijan Robinson',
    position: 'RB',
    nflTeam: 'ATL',
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
    crest: `/assets/theleague/group-me/${seed.slug}.png`,
    icon: `/assets/theleague/icons/${seed.slug}.png`,
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
    game('wc-1', DEAD_CAP, MUSIC_CITY),
    game('wc-2', DANGSTERS, NINJAS),
  ],
  featured: team(DEAD_CAP),
};

/** Round 2 (Week 16) — two games, four faces, split by a vertical seam. */
export const semifinalView: PlayoffRoundView = {
  kind: 'semifinals',
  label: 'Semifinals',
  week: 16,
  games: [
    game('sf-1', PIGSKINS, DEAD_CAP),
    game('sf-2', MAVERICK, DANGSTERS),
  ],
  featured: null,
};

/** Round 3 (Week 17) — the title game, with the full comparison table. */
export const championshipView: PlayoffRoundView = {
  kind: 'championship',
  label: 'Championship',
  week: 17,
  games: [game('final', PIGSKINS, MAVERICK)],
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
      { ...MAVERICK, record: '', pointsFor: '', proj: 0 },
    ),
  ],
  featured: null,
};

/** Path resolver stand-in — the real one prefixes the league slug. */
export const resolvePath = (path: string) => `/theleague${path}`;
