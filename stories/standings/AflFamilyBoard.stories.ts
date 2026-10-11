import AflFamilyBoard from '../../src/components/shared/standings/AflFamilyBoard.astro';
import { TIERING } from '../../src/components/shared/standings/standings-table-config';
import { themeModes } from '../../.storybook/modes';
import { aflConferences, aflDivisionsSeeded, aflTeams, aflTiers } from '../fixtures/standings-board';

/**
 * The AFL family's standings board in both site themes: divisions badged on
 * their conference ladder, one playoff field per conference, and the league's
 * own Premier League / D-League tiers.
 */
export default {
  title: 'Shared/Standings/AFL board',
  component: AflFamilyBoard,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const conferenceOf = new Map(aflConferences.flatMap((c) => c.teams.map((t) => [t.division, c] as const)));
const base = {
  leagueSlug: 'afl-fantasy',
  teams: aflTeams,
  hrefFor: () => undefined,
  divisions: aflDivisionsSeeded.map((d) => ({
    name: d.name,
    teams: d.teams,
    seeding: TIERING.conferenceSeed(conferenceOf.get(d.name)?.divisionWinners ?? 2),
  })),
  conferences: aflConferences.map((c) => ({
    id: c.id,
    name: c.name,
    teams: c.teams,
    seeding: TIERING.conferenceSeed(c.divisionWinners),
  })),
  tiers: aflTiers,
};

export const DivisionsEditorial = { args: { ...base, theme: 'editorial', view: 'division' } };
export const PlayoffsPrimetime = { args: { ...base, theme: 'primetime', view: 'league' } };
export const TiersEditorial = { args: { ...base, theme: 'editorial', view: 'all_play' } };
export const TiersPrimetime = { args: { ...base, theme: 'primetime', view: 'all_play' } };
