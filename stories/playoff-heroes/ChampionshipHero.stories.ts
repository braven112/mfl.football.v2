import ChampionshipHero from '../../src/components/theleague/playoff-heroes/ChampionshipHero.astro';
import {
  championshipView,
  championshipPreGameView,
  resolvePath,
} from '../fixtures/playoff-round';

/**
 * The title game (Week 17). Dark-gold spotlight in BOTH themes on purpose,
 * trophy at center, full comparison table underneath.
 *
 * Because the spotlight is deliberately theme-invariant, this component is a
 * good canary for the opposite bug: if a future token change makes the two
 * themes diverge here, that is a regression, not a skin.
 */
export default {
  title: 'Playoff Heroes/ChampionshipHero',
  component: ChampionshipHero,
  parameters: { layout: 'fullscreen' },
};

export const Default = {
  args: { view: championshipView, r: resolvePath },
};

/**
 * Before kickoff: no record, points-for or projection. The comparison table
 * builds its rows conditionally, so this renders a structurally different
 * component — and it is reachable in production for only a few hours a year.
 */
export const PreGame = {
  args: { view: championshipPreGameView, r: resolvePath },
};

/** Seeds absent (a bracket that never seeded) — the Seed row must drop out. */
export const NoSeeds = {
  args: {
    view: {
      ...championshipView,
      games: championshipView.games.map((g) => ({
        ...g,
        teams: g.teams.map((t) => ({ ...t, seed: undefined })) as typeof g.teams,
      })),
    },
    r: resolvePath,
  },
};
