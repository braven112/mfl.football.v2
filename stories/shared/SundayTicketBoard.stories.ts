import SundayTicketBoard from '../../src/components/shared/sunday-ticket/SundayTicketBoard.astro';
import { themeModes } from '../../.storybook/modes';
import { leagues, leagueWide, multiLeague, nothingRelevant, noGames, singleLeague } from '../fixtures/sunday-ticket';

/**
 * The Sunday Ticket multiview board — league chips, the two Sunday windows as
 * 2×2 grids, and the national games outside them.
 *
 * Pure: a `slate` plus the chip inputs, no feeds and no auth. The page
 * (`SundayTicketPage.astro`) is the only thing that reads the world; this is
 * what it hands down. Every branch the slate builder can produce is pinned
 * here — full boxes, RedZone fill, overflow, the multi-league group line, the
 * league-wide fallback with its capped player list, and the empty week.
 *
 * Snapshotted light + dark only: the board reads `--league-accent` for chips
 * and counts, but the AFL skin only recolors that accent, and the bezel is a
 * deliberate literal in both themes (sunday-ticket.css). 12 snapshots, not 24.
 */
export default {
  title: 'Shared/SundayTicketBoard',
  component: SundayTicketBoard,
  parameters: {
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  args: {
    week: 2,
    pathname: '/theleague/sunday-ticket',
    weekParam: null,
    country: 'US',
  },
  argTypes: {
    country: { control: 'inline-radio', options: ['US', 'CA', 'AU'] },
  },
};

/** Three leagues on, both windows, overflow under the early grid, two national games. */
export const MultiLeague = {
  args: { slate: multiLeague, leagues, enabled: null },
};

/** One league toggled off — its chip goes hollow and an "All leagues" chip appears. */
export const OneLeagueOff = {
  args: { slate: multiLeague, leagues, enabled: [leagues[0].id, leagues[2].id] },
};

/** Same board seen from Canada: CBS/FOX become DAZN, NBC becomes CTV, the header mark is DAZN. */
export const Canada = {
  args: { slate: multiLeague, leagues, enabled: null, country: 'CA' },
};

/** A single-league owner: no chips, no league line inside the boxes, RedZone fills the third box. */
export const SingleLeague = {
  args: { slate: singleLeague, leagues: [leagues[0]], enabled: null },
};

/** None of your players play Sunday afternoon — RedZone alone, both windows. */
export const NothingRelevant = {
  args: { slate: nothingRelevant, leagues: [leagues[0]], enabled: null },
};

/** Signed out: league-wide points ranking, the long list capped with "+N more". */
export const LeagueWide = {
  args: { slate: leagueWide, leagues: [], enabled: null },
};

/** No schedule for the week yet. */
export const NoGames = {
  args: { slate: noGames, leagues: [leagues[0]], enabled: null },
};
