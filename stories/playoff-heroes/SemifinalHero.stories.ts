import SemifinalHero from '../../src/components/theleague/playoff-heroes/SemifinalHero.astro';
import { semifinalView, resolvePath } from '../fixtures/playoff-round';

/**
 * Playoff round 2 (Week 16). Both semifinal games in one hero — four players,
 * two franchise-colored pairs split by a vertical seam.
 *
 * The signed-in owner's game gets an accent ring, which is why the
 * `NoUserTeam` story exists: guest and owner are two different renders, and
 * the guest view is the one nobody ever looks at while developing.
 */
export default {
  title: 'Playoff Heroes/SemifinalHero',
  component: SemifinalHero,
  parameters: { layout: 'fullscreen' },
};

export const OwnerView = {
  args: { view: semifinalView, r: resolvePath },
};

/** Guest / logged-out: no team is the user's, so no accent ring anywhere. */
export const NoUserTeam = {
  args: {
    view: {
      ...semifinalView,
      games: semifinalView.games.map((g) => ({
        ...g,
        isUserGame: false,
        teams: g.teams.map((t) => ({ ...t, isUser: false })) as typeof g.teams,
      })),
    },
    r: resolvePath,
  },
};
