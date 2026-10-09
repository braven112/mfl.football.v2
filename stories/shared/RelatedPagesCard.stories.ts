import RelatedPagesCard from '../../src/components/shared/RelatedPagesCard.astro';
import { themeModes, leagueModes } from '../../.storybook/modes';

/**
 * The "more for game day" card at the bottom of Live Scoring — less-used
 * pages promoted where they belong instead of in the nav
 * (src/utils/related-pages.ts). Archie's has the broadcast board but no
 * Sunday Ticket, so its story pins the one-item layout.
 */
export default {
  title: 'Shared/RelatedPagesCard',
  component: RelatedPagesCard,
  parameters: { chromatic: { modes: themeModes } },
};

export const LiveScoringTheLeague = {
  args: { hostPath: '/live-scoring', leagueSlug: 'theleague' },
};

export const LiveScoringAfl = {
  args: { hostPath: '/live-scoring', leagueSlug: 'afl-fantasy' },
  parameters: { chromatic: { modes: leagueModes } },
};

export const LiveScoringSingleItem = {
  args: { hostPath: '/live-scoring', leagueSlug: 'archies' },
};
