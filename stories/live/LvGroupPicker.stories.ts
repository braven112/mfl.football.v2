import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvGroupPicker from '../../src/components/shared/live/LvGroupPicker';
import { allModes } from '../../.storybook/modes';

/**
 * The board's division chips: "My division" first, then All, then every other
 * division with its " Division" suffix trimmed (`groupChipLabel`).
 *
 * MODES. The active chip's border and the focus ring read `--league-accent`,
 * so the league axis is real here — all four modes, like `Live/Standings`'
 * Live story. The viewer's own division is the one selected, so the accent is
 * on screen in every capture.
 */
export default {
  title: 'Live/GroupPicker',
  component: LvGroupPicker,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: allModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv', style: { maxWidth: '40rem' } }, createElement(Story)),
  ],
};

const GROUPS = [
  { id: 'd1', name: 'Northwest Division', franchiseIds: ['0001', '0003'] },
  { id: 'd2', name: 'Southwest Division', franchiseIds: ['0004', '0007'] },
  { id: 'd3', name: 'Central Division', franchiseIds: ['0009', '0011'] },
  { id: 'd4', name: 'East', franchiseIds: ['0013', '0015'] },
];

/** Viewing your own division. "East" has no suffix to trim and stays whole. */
export const MyDivision = {
  args: { groups: GROUPS, viewerGroupId: 'd1', value: 'd1', onChange: () => {} },
};
