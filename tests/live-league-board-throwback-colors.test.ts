/**
 * `assembleLeagueBoard` — which throwback eras hand their palette to the board.
 *
 * Live, 2026 Throwback Week: Cowboy Up wore the green Degenerates crest but
 * kept its present-day red, which won the colour clash and drew the viewer's
 * Pigskins grey. The fix passes an era's palette as an identity override — and
 * the first cut detected an era palette by `colorPrimary` alone, which missed
 * Da Dangsters' 2015 era (same primary as today, dark variants cleared by
 * `applyThrowbackOverrides`) and let the modern dark-mode colours back in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigTeam } from '../src/utils/live-scoring-data';

const today: ConfigTeam[] = [
  {
    franchiseId: '0001',
    name: 'Pacific Pigskins',
    color: '#cc2936',
    colorPrimary: '#bd1f2b',
    colorSecondary: '#181818',
    colorPrimaryDark: '#e23b46',
    colorSecondaryDark: '#cfcfcf',
  } as ConfigTeam,
  {
    franchiseId: '0002',
    name: 'Da Dangsters',
    color: '#8b6914',
    colorPrimary: '#1b435f',
    colorSecondary: '#8b8f93',
    colorPrimaryDark: '#3f7fb0',
    colorSecondaryDark: '#c9a24a',
  } as ConfigTeam,
  {
    franchiseId: '0014',
    name: 'Cowboy Up',
    color: '#0d2b56',
    colorPrimary: '#153366',
    colorSecondary: '#d32a3e',
    colorPrimaryDark: '#d8384b',
  } as ConfigTeam,
];

vi.mock('../src/utils/league-team-brands', () => ({
  getLeagueTeamConfigs: () => today.map((t) => ({ ...t })),
}));
vi.mock('../src/utils/throwback-live-scoring', () => ({
  applyThrowbackToBoard: vi.fn(),
}));
vi.mock('../src/utils/live/read', () => ({
  readLeagueLive: vi.fn(async () => ({ ok: true, panels: [{ matchups: [{}] }] })),
  buildBoardFromSnapshot: vi.fn(),
}));

import { assembleLeagueBoard } from '../src/utils/live/league-board';
import { applyThrowbackToBoard } from '../src/utils/throwback-live-scoring';
import { readLeagueLive } from '../src/utils/live/read';

/** What `applyThrowbackOverrides` produces for an era that brings colours. */
const dressed = (t: ConfigTeam, era: { name: string; colorPrimary: string; colorSecondary: string }) => ({
  ...t,
  name: era.name,
  color: era.colorPrimary,
  colorPrimary: era.colorPrimary,
  colorSecondary: era.colorSecondary,
  colorPrimaryDark: undefined,
  colorSecondaryDark: undefined,
});

async function overridesFor(configTeams: ConfigTeam[]) {
  vi.mocked(applyThrowbackToBoard).mockResolvedValue({ configTeams, preview: null } as never);
  await assembleLeagueBoard({
    slug: 'theleague',
    leagueId: 'x',
    week: 4,
    year: 2026,
    authUser: null,
    searchParams: new URLSearchParams(),
    throwbackScope: 'theleague' as never,
  });
  return vi.mocked(readLeagueLive).mock.calls.at(-1)![0].identityOverrides!;
}

beforeEach(() => {
  vi.mocked(readLeagueLive).mockClear();
});

describe('throwback era palettes reach the live board', () => {
  it('passes an era palette whose primary differs from today', async () => {
    const over = await overridesFor([
      today[0],
      today[1],
      dressed(today[2], { name: 'Degenerates', colorPrimary: '#286528', colorSecondary: '#dec341' }),
    ]);
    expect(over['0014'].colors).toEqual({
      color: '#286528',
      colorPrimary: '#286528',
      colorSecondary: '#dec341',
    });
  });

  it('passes an era palette that SHARES today’s primary', async () => {
    // Da Dangsters 2015: same primary, but the era clears the dark variants.
    const over = await overridesFor([
      today[0],
      dressed(today[1], { name: 'Da Dangsters', colorPrimary: '#1b435f', colorSecondary: '#8b8f93' }),
      today[2],
    ]);
    expect(over['0002'].colors?.colorPrimary).toBe('#1b435f');
  });

  it('leaves a franchise wearing today’s colours on the registry claim', async () => {
    const over = await overridesFor(today.map((t) => ({ ...t })));
    for (const fid of ['0001', '0002', '0014']) expect(over[fid].colors).toBeUndefined();
  });
});
