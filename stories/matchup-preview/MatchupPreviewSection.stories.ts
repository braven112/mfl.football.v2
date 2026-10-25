import MatchupPreviewSection from '../../src/components/shared/matchup-preview/MatchupPreviewSection.astro';
import { themeModes } from '../../.storybook/modes';
import { matchupVisuals, matchupTeams } from '../fixtures/matchup-preview';

/**
 * The Matchup Preview article's visuals. `Top` is the Game of the Week rivalry
 * panel that leads the column; `Cards` is the tale-of-the-tape stack under the
 * copy, including a disputed series (no record) and a first meeting.
 */
export default {
  title: 'Shared/Matchup Preview/Article Visuals',
  component: MatchupPreviewSection,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const base = { visuals: matchupVisuals, teams: matchupTeams, rivalriesBase: '/theleague/rivalries' };

export const Top = { args: { ...base, part: 'top' } };
export const Cards = { args: { ...base, part: 'cards' } };
