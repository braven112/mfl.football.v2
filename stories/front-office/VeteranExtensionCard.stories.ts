import VeteranExtensionCard from '../../src/components/shared/front-office-hub/VeteranExtensionCard.astro';
import { themeModes } from '../../.storybook/modes';
import { buildVeteranExtensionBoard } from '../../src/utils/veteran-extension-board';

/**
 * The owner's "Your veteran extension" card on the Front Office planner.
 * `Open` has the slot unused; `Pending` shows a filed request that the
 * owner can still change or withdraw; `Used` is after MFL took it.
 */
export default {
  title: 'Shared/Front Office/Veteran Extension Card',
  component: VeteranExtensionCard,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const averages = {
  positions: { QB: { top5Average: 9_800_000 }, WR: { top5Average: 8_500_000 }, TE: { top5Average: 5_200_000 } },
};
const players = [
  { id: '1', name: 'Quarterback Example', position: 'QB', nflTeam: 'KC', headshot: '', salary: 5_000_000, contractYears: 3, contractInfo: '' },
  { id: '2', name: 'Receiver Example', position: 'WR', nflTeam: 'BUF', headshot: '', salary: 3_250_000, contractYears: 2, contractInfo: '' },
  { id: '3', name: 'Tight End Example', position: 'TE', nflTeam: 'CHI', headshot: '', salary: 853_000, contractYears: 5, contractInfo: '' },
  { id: '4', name: 'Rookie Example', position: 'WR', nflTeam: 'DAL', headshot: '', salary: 900_000, contractYears: 3, contractInfo: 'RC' },
];
const base = { leagueId: '0', franchiseId: '0001', franchiseName: 'Example Club', writesToMfl: true };
const board = (declaration?: any) =>
  buildVeteranExtensionBoard({ players, leagueYear: 2026, salaryAverages: averages, declaration });
const filed = {
  id: 'D1', type: 'veteran-extension', playerId: '2', playerName: 'Receiver Example', franchiseId: '0001',
  franchiseName: 'Example Club', leagueId: '0', currentYears: 2, currentSalary: 3_250_000, currentContractInfo: '',
  requestedYears: 4, requestedSalary: 7_500_000, submittedBy: 'Owner', submittedAt: '2026-11-20T10:00:00.000Z',
  mflSynced: false,
};

export const Open = { args: { ...base, board: board() } };
export const Pending = { args: { ...base, board: board({ ...filed, status: 'pending' }) } };
export const Used = { args: { ...base, board: board({ ...filed, status: 'applied', mflSynced: true }) } };
