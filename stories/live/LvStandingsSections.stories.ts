import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvStandingsSections from '../../src/components/shared/live/LvStandingsSections';
import type { LiveStandingsSections } from '../../src/types/live';
import { LIVE_MATCHUP, LIVE_STANDINGS } from '../fixtures/live-kit';
import { allModes, themeModes } from '../../.storybook/modes';

/**
 * A Standings tab cut into tables under one Live / Projected / Final switch.
 * The main stories are the AFL live board's: its Premier League and D-League
 * on all-play, then its divisions on head-to-head. TheLeague draws divisions
 * only, and Archie's draws MAD POWER 99 (`MadPower99`);
 * `utils/live/league-live-standings.ts` decides which.
 *
 * The zones belong to the POSITION: in the Live view the viewer (Pigskins)
 * outscores the field and climbs out of the D-League's relegation-style zone,
 * which is the moment this tab exists to show.
 *
 * MODES. The active view pill and the viewer's row tint read
 * `--league-accent`, so `Live` opts up to all four modes.
 */
const SECTIONS: LiveStandingsSections = {
  groups: [
    {
      id: 'tiers',
      title: 'Premier League & D-League',
      sections: [
        {
          id: 'tier-Premier League',
          title: 'Premier League',
          basis: 'all-play',
          franchiseIds: ['0007', '0013', '0003'],
          zones: [null, { tone: 'danger', label: 'Relegation playoff' }, { tone: 'down', label: 'Relegated' }],
          logo: { src: '/assets/afl/premier.svg', darkSrc: '/assets/afl/premier-dark.svg' },
        },
        {
          id: 'tier-D-League',
          title: 'D-League',
          basis: 'all-play',
          franchiseIds: ['0004', '0001'],
          zones: [{ tone: 'up', label: 'Promoted' }, { tone: 'rename', label: 'Name change' }],
          logo: { src: '/assets/afl/dleague.svg', darkSrc: '/assets/afl/dleague-dark.svg' },
        },
      ],
    },
    {
      id: 'divisions',
      title: 'Divisions',
      sections: [
        { id: 'division-West', title: 'NL West', basis: 'record', franchiseIds: ['0013', '0001'] },
        { id: 'division-North', title: 'AL North', basis: 'record', franchiseIds: ['0007', '0003', '0004'] },
      ],
    },
  ],
  allPlay: {
    records: {
      '0007': { wins: 16, losses: 4, ties: 0, pointsFor: 612.4 },
      '0013': { wins: 12, losses: 8, ties: 0, pointsFor: 588.0 },
      '0003': { wins: 11, losses: 9, ties: 0, pointsFor: 560.3 },
      '0004': { wins: 7, losses: 13, ties: 0, pointsFor: 470.9 },
      '0001': { wins: 6, losses: 14, ties: 0, pointsFor: 541.7 },
    },
    weekCounted: false,
    weekInCompetition: true,
  },
};

export default {
  title: 'Live/Standings sections',
  component: LvStandingsSections,
  parameters: {
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv', style: { maxWidth: '60rem' } }, createElement(Story)),
  ],
};

/** The default view: this week added as it stands. */
export const Live = {
  args: { rows: LIVE_STANDINGS, sections: SECTIONS, leagueName: 'AFL', matchups: [LIVE_MATCHUP] },
  parameters: { chromatic: { modes: allModes } },
};

/** The last completed week, in official order. */
export const Final = {
  args: { rows: LIVE_STANDINGS, sections: SECTIONS, leagueName: 'AFL', matchups: [LIVE_MATCHUP], initialMode: 'final' },
};

/** The all-play read failed: the tier tables say so, the divisions still draw. */
export const AllPlayMissing = {
  args: { rows: LIVE_STANDINGS, sections: { ...SECTIONS, allPlay: null }, leagueName: 'AFL', matchups: [LIVE_MATCHUP] },
};

/** The standings read failed. Never an empty table. */
export const Unavailable = { args: { rows: null, sections: SECTIONS, leagueName: 'AFL' } };

/**
 * Archie's MAD POWER 99 shape: one table of the whole league in playoff seed
 * order on Victory Points, collapsed after the seeds with a "Show all".
 */
const MAD_ROWS = LIVE_STANDINGS.map((row, i) => ({ ...row, victoryPoints: 30 - i * 2 }));
const MAD: LiveStandingsSections = {
  groups: [
    {
      id: 'mad',
      title: 'MAD POWER 99',
      sections: [
        {
          id: 'mad-power-99',
          title: 'Playoff seeding',
          basis: 'mad',
          franchiseIds: MAD_ROWS.map((r) => r.franchiseId),
          seeding: { divisionLeaders: 2, runnersUp: 1, wildCards: 1 },
          divisionOf: Object.fromEntries(MAD_ROWS.map((r, i) => [r.franchiseId, i % 2 ? 'East' : 'West'])),
          collapseAfter: 4,
        },
      ],
    },
  ],
  allPlay: null,
  victoryPoints: { win: 2, loss: 0, tie: 1, buckets: [3, 2, 1] },
};

export const MadPower99 = {
  args: { rows: MAD_ROWS, sections: MAD, leagueName: "Archie's", matchups: [LIVE_MATCHUP] },
};
