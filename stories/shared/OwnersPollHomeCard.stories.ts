import OwnersPollHomeCard from '../../src/components/shared/owners-poll/OwnersPollHomeCard.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The Owners' Poll homepage card — the top of the owners' consensus, with the
 * Δ against the computer's ranking.
 *
 * Its two islands (the stale-ballot prompt and the quick-vote pop-up) render
 * nothing until the ballot API answers for a signed-in owner, and Storybook has
 * no session, so these stories pin the card itself: a published result and the
 * pre-result "recruiting" state.
 */
const teams = {
  '0001': { nameShort: 'Pigskins' },
  '0002': { nameShort: 'Magicians' },
  '0003': { nameShort: 'Hurricanes' },
  '0004': { nameShort: 'Outlaws' },
  '0005': { nameShort: 'Gladiators' },
};

const ranked = [
  { rank: 1, franchiseId: '0002', points: 118, firstPlaceVotes: 7, delta: 1 },
  { rank: 2, franchiseId: '0001', points: 104, firstPlaceVotes: 3, delta: -1 },
  { rank: 3, franchiseId: '0004', points: 91, firstPlaceVotes: 1, delta: 2 },
  { rank: 4, franchiseId: '0003', points: 77, firstPlaceVotes: 0, delta: 0 },
  { rank: 5, franchiseId: '0005', points: 60, firstPlaceVotes: 0, delta: -2 },
];

export default {
  title: 'Shared/OwnersPollHomeCard',
  component: OwnersPollHomeCard,
  parameters: { chromatic: { modes: themeModes } },
};

export const Published = {
  args: {
    leagueSlug: 'theleague',
    ballotHref: '/theleague/owners-poll',
    teams,
    issue: { year: 2026, week: 5, ownersPoll: { ranked, ballotsIn: 11, eligibleVoters: 16 } },
  },
};

/** No consensus yet this season: the card asks for ballots instead. */
export const Recruiting = {
  args: {
    leagueSlug: 'theleague',
    ballotHref: '/theleague/owners-poll',
    teams,
    issue: null,
  },
};
