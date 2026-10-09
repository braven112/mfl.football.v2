import TopPlayersPromo from '../../src/components/shared/hp-sections/TopPlayersPromo.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The homepage poster for the Top Players page: the season's leading scorer
 * as an ESPN cut-out, the pitch to the left. Dark in BOTH themes by design, so the theme
 * modes should render it identically. A fixed sample, NOT the derived file:
 * that file changes with every data sync and would re-trigger the snapshot.
 */
export default {
  title: 'Shared/TopPlayersPromo',
  component: TopPlayersPromo,
  parameters: { chromatic: { modes: themeModes } },
};

const player = (id: string, name: string, position: string, team: string, espnId: string, total: number, owners: string[]) => ({
  id, name, position, team, espnId, total, posRank: 1, rank: 1, games: 4, avg: total / 4, best: 0, weeks: {},
  owners: owners.map((o, i) => ({ id: `000${i + 1}`, name: o, icon: null })),
});

const data = (twoOwners: boolean) => ({
  seasonYear: 2026, startWeek: 1, endWeek: 17, lastRegularSeasonWeek: 14, completedWeeks: [1, 2, 3, 4], positions: [],
  players: [
    player('13589', 'Josh Allen', 'QB', 'BUF', '3918298', 123.46, twoOwners ? ['Fullybaked', 'Titsburgh Feelers'] : ['Vitside Mafia']),
    player('16149', 'Jahmyr Gibbs', 'RB', 'DET', '4429795', 116.0, ['Smokane FC']),
    player('16201', 'Jaxon Smith-Njigba', 'WR', 'SEA', '4430878', 100.7, ['Running Down The Dream']),
    player('15880', 'Trey McBride', 'TE', 'ARI', '4361307', 69.2, ['Da Dangsters']),
  ],
});

// The live banner picks a position at random per view; stories pin it so the
// snapshot is stable.
export const TopScorer = { args: { leagueSlug: 'theleague', data: data(false), position: 'QB' } };
export const PositionLeader = { args: { leagueSlug: 'theleague', data: data(false), position: 'RB' } };
export const AflLeague = { args: { leagueSlug: 'afl-fantasy', data: data(true), position: 'QB' } };
