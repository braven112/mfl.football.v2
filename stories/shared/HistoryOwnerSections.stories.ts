import HistoryOwnerSections from '../../src/components/shared/league-history/HistoryOwnerSections.astro';
import { buildHistoryDataset } from '../../src/utils/league-history/dataset.mjs';
import { themeModes } from '../../.storybook/modes';

/**
 * League History sections on an owner page: banners, career plaques, the
 * season chart, the teams they ran, highs and head to head against every
 * owner. The fixture owner moves from slot 0010 to 0011 under one name, so the
 * chart shows its team strip and the legend carries years.
 */
const tenures = {
  owners: [
    { ownerId: 'own-n', displayName: 'Nate Rich', slug: 'nate', tenures: [
      { franchiseId: '0010', seasons: [{ year: 2022 }] },
      { franchiseId: '0011', seasons: [{ year: 2023 }, { year: 2024 }] },
    ] },
    { ownerId: 'own-b', displayName: 'Brandon Shields', slug: 'brandon', tenures: [
      { franchiseId: '0001', seasons: [{ year: 2022 }, { year: 2023 }, { year: 2024 }] },
    ] },
    { ownerId: 'own-d', displayName: 'David Dang', slug: 'david', tenures: [
      { franchiseId: '0006', seasons: [{ year: 2022 }, { year: 2023 }, { year: 2024 }] },
    ] },
  ],
};
const team = (year: number, franchiseId: string, name: string, wins: number, playoffResult = 'missed', extra = {}) => ({
  year, franchiseId, name, wins, losses: 14 - wins, ties: 0, pointsFor: 1400 + wins * 20,
  divisionName: 'Southwest', playoffResult, ...extra,
});
const ledgerRows = [
  team(2022, '0010', 'Midwestside Connection', 5),
  team(2022, '0001', 'Pacific Pigskins', 10, 'champion'),
  team(2022, '0006', 'Da Dangsters', 9, 'runner-up'),
  team(2023, '0011', 'Midwestside Connection', 11, 'champion', { wonDivision: true }),
  team(2023, '0001', 'Pacific Pigskins', 7),
  team(2023, '0006', 'Da Dangsters', 8, 'runner-up'),
  team(2024, '0011', 'Midwestside Connection', 9, 'runner-up'),
  team(2024, '0001', 'Pacific Pigskins', 12, 'champion'),
  team(2024, '0006', 'Da Dangsters', 4),
];
const g = (year: number, week: number, winnerId: string, winnerScore: number, loserId: string, loserScore: number, isPlayoff = false) =>
  ({ year, week, winnerId, winnerScore, loserId, loserScore, isPlayoff });
const games = [
  g(2022, 1, '0001', 131.2, '0010', 98.4),
  g(2022, 2, '0010', 120.5, '0006', 101.1),
  g(2023, 1, '0011', 142.8, '0001', 88.6),
  g(2023, 2, '0006', 110.2, '0011', 109.9),
  g(2023, 16, '0011', 125.3, '0006', 118.0, true),
  g(2024, 1, '0011', 115.0, '0006', 92.3),
  g(2024, 16, '0001', 130.1, '0011', 121.7, true),
];
const data = buildHistoryDataset({
  league: 'theleague', games, ledgerRows, ownerTenures: tenures,
  firstPlayoffWeeks: { 2022: 15, 2023: 16, 2024: 16 },
});

export default {
  title: 'Shared/League History/HistoryOwnerSections',
  component: HistoryOwnerSections,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
  args: { leagueSlug: 'theleague', data },
};

export const TwoTeamsOneName = { args: { ownerSlug: 'nate' } };
export const ViewerRowMarked = { args: { ownerSlug: 'nate', viewerFranchise: '0001' } };
