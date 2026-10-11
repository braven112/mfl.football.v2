import StandingsBoard from '../../src/components/shared/standings/board/StandingsBoard.astro';
import { standingsPageProfile } from '../../src/components/shared/standings/standings-page-profile';
import { themeModes } from '../../.storybook/modes';
import { theleagueAllPlay, theleagueDivisions, theleagueLeague, theleagueTeams } from '../fixtures/standings-board';

/**
 * The standings board, in both site themes. Editorial is the classic look
 * TheLeague and the AFL wear; Primetime is the front-page look Archie's wears.
 * The same rows render in each, so the two read side by side for a league
 * choosing its theme (`?theme=` previews it on the live site).
 */
export default {
  title: 'Shared/Standings/Board',
  component: StandingsBoard,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const base = {
  leagueSlug: 'theleague',
  profile: standingsPageProfile('theleague', theleagueDivisions.length, undefined),
  divisions: theleagueDivisions,
  league: theleagueLeague,
  allPlay: theleagueAllPlay,
  teams: theleagueTeams,
  preferredTeamId: theleagueTeams[0].franchiseId,
  hrefFor: () => undefined,
};

export const DivisionsEditorial = { args: { ...base, theme: 'editorial', view: 'division' } };
export const DivisionsPrimetime = { args: { ...base, theme: 'primetime', view: 'division' } };
export const PlayoffsEditorial = { args: { ...base, theme: 'editorial', view: 'league' } };
export const PlayoffsPrimetime = { args: { ...base, theme: 'primetime', view: 'league' } };
export const AllPlayEditorial = { args: { ...base, theme: 'editorial', view: 'all_play' } };
export const AllPlayPrimetime = { args: { ...base, theme: 'primetime', view: 'all_play' } };
