import WildCardHero from '../../src/components/theleague/playoff-heroes/WildCardHero.astro';
import { wildCardView, resolvePath } from '../fixtures/playoff-round';

/**
 * Playoff round 1 (Week 15). Every game as a compact card, with the round's
 * single highest-projected team's headliner as the composite.
 *
 * This is one of the components the live site can only render for one weekend
 * a year, with the bracket in exactly the right state. It is storyable because
 * it takes a single resolved `view` plus a path resolver — no feed reads, no
 * clock, no auth.
 */
export default {
  title: 'Playoff Heroes/WildCardHero',
  component: WildCardHero,
  parameters: { layout: 'fullscreen' },
};

export const Default = {
  args: { view: wildCardView, r: resolvePath },
};

/** No featured headliner — the composite slot has to degrade, not break. */
export const NoFeaturedPlayer = {
  args: {
    view: { ...wildCardView, featured: null },
    r: resolvePath,
  },
};

/** A single-game round — the card grid has to hold with one child. */
export const SingleGame = {
  args: {
    view: { ...wildCardView, games: wildCardView.games.slice(0, 1) },
    r: resolvePath,
  },
};
