/**
 * A future in-season week with no pairings is NOT the offseason.
 *
 * In November, Week 15 is TheLeague's first playoff round, which MFL has not
 * seeded yet, so its feed is healthy and empty — the same shape as the
 * offseason. The page used to swap in last season's replay there, labeled
 * "Week 14", which read as this season's real games. Pins that the replay is
 * offered only outside the season window (or on an explicit `?demo=1`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/league-team-brands', () => ({
  getLeagueTeamConfigs: () => [],
  getLeagueConfigStructure: () => null,
}));
vi.mock('../src/utils/live/league-live-standings', () => ({
  readLiveStandings: vi.fn(async () => undefined),
  withBoardIdentities: (s: unknown) => s,
}));
vi.mock('../src/utils/live/read', () => ({
  readLeagueLive: vi.fn(async () => ({ ok: true, panels: [{ matchups: [] }] })),
  buildBoardFromSnapshot: vi.fn(() => ({ ok: true, panels: [{ matchups: [{}] }] })),
}));
vi.mock('../src/data/live-scoring-sample', () => ({
  preloadLiveScoringSample: vi.fn(async () => undefined),
  getLiveScoringSample: vi.fn(() => ({ week: 14, playerMeta: {}, nflGames: [] })),
  preloadCurrentRosterSample: vi.fn(async () => undefined),
  getCurrentRosterSample: vi.fn(() => ({ week: 14, playerMeta: {}, nflGames: [] })),
}));

import { assembleLeagueBoard } from '../src/utils/live/league-board';

const assemble = (now: Date, demo?: string) =>
  assembleLeagueBoard({
    slug: 'theleague',
    leagueId: 'x',
    week: 15,
    year: 2026,
    authUser: null,
    searchParams: new URLSearchParams(demo ? { demo } : {}),
    sample: true,
    now,
  });

describe('the offseason replay and a future week', () => {
  it('shows the real (empty) week in season, never the replay', async () => {
    const out = await assemble(new Date('2026-11-20T08:00:00Z'));
    expect(out.isSample).toBe(false);
    expect(out.demoLabel).toBeUndefined();
  });

  it('still offers the replay in the offseason', async () => {
    const out = await assemble(new Date('2027-05-01T12:00:00Z'));
    expect(out.isSample).toBe(true);
  });

  it('still honors an explicit ?demo=1 in season', async () => {
    const out = await assemble(new Date('2026-11-20T08:00:00Z'), '1');
    expect(out.isSample).toBe(true);
  });
});
