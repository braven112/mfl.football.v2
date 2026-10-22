import ScheduleSwap from '../../src/components/shared/schedule-strength/ScheduleSwap.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The Gauntlet's Schedule Swap: one team's record on every other team's
 * schedule, best first. The story opens a team (the server-rendered state a
 * signed-in owner lands on) so the list — not the "Pick a team" prompt — is
 * what gets snapshotted; the desktop-only grid shows under the list at the
 * canvas's width. The picker's script is a plain `<script>`, which the static
 * build does not run (storybook.md Trap 3) — the story asserts the markup.
 */
export default {
  title: 'Shared/Gauntlet/Schedule Swap',
  component: ScheduleSwap,
  parameters: { layout: 'padded', chromatic: { modes: themeModes } },
};

const names = ['Pigskins', 'Vitside', 'Mavericks', 'Cowboy Up'];
const abbrevs = ['SKINS', 'VIT', 'MAVS', 'CBOY'];
// records[i][j] = team i on team j's schedule (diagonal = actual).
const records = [
  ['8-1', '7-2', '3-6', '6-3'],
  ['8-1', '8-1', '5-4', '7-2'],
  ['1-8', '2-7', '0-9', '1-8'],
  ['5-4', '6-3', '4-5', '4-5'],
];
const wins = (r: string) => Number(r.split('-')[0]);

const teams = names.map((name, i) => ({
  franchiseId: String(i + 1).padStart(4, '0'),
  displayName: name,
  abbrev: abbrevs[i],
  pool: '',
  actual: records[i][i],
  rows: names
    .map((other, j) => ({
      franchiseId: String(j + 1).padStart(4, '0'),
      displayName: other,
      record: records[i][j],
      delta: wins(records[i][j]) - wins(records[i][i]),
    }))
    .filter((_, j) => j !== i)
    .sort((a, b) => b.delta - a.delta),
}));

export const TeamSelected = { args: { teams, myTeamId: '0001' } };
export const NoTeamYet = { args: { teams } };
