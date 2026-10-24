import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DPAD_IDLE,
  dpadKeyFrom,
  gameKey,
  isSteering,
  listGames,
  stepDpad,
  stripPanelsFor,
  type DpadState,
} from '../src/utils/broadcast-dpad';
import type { BroadcastLeaguePanel, BroadcastTeam } from '../src/types/live-broadcast';

const team = (franchiseId: string) => ({ franchiseId, name: franchiseId }) as BroadcastTeam;
const panel = (leagueId: string, opponents: (string | null)[]): BroadcastLeaguePanel =>
  ({
    leagueId,
    leagueName: leagueId,
    matchups: opponents.map((o, index) => ({ index, mine: team('0001'), opponent: o ? team(o) : null })),
  }) as unknown as BroadcastLeaguePanel;

// Archie's doubleheader (two games), then a league with a bye.
const panels = [panel('archies', ['0003', '0007']), panel('afl', ['0002']), panel('bye', [null])];
const games = listGames(panels);

const run = (keys: Parameters<typeof stepDpad>[1][], from: DpadState = DPAD_IDLE) =>
  keys.reduce((s, k) => stepDpad(s, k, games).state, from);

describe('listGames', () => {
  it('is every game with an opponent, in header order, both halves of a doubleheader included', () => {
    expect(games).toEqual(['archies:0', 'archies:1', 'afl:0']);
  });
});

describe('the strip', () => {
  it('Down takes it and stops the rotation; Left/Right turn its pages', () => {
    const down = stepDpad(DPAD_IDLE, 'down', games);
    expect(down.state.zone).toBe('strip');
    expect(stepDpad(down.state, 'right', games).page).toBe('next');
    expect(stepDpad(down.state, 'left', games).page).toBe('prev');
  });

  it('Left/Right from hands-free take the strip and turn at once', () => {
    const step = stepDpad(DPAD_IDLE, 'right', games);
    expect(step).toMatchObject({ handled: true, page: 'next', state: { zone: 'strip' } });
  });
});

describe('the games', () => {
  it('Up highlights the first game and Left/Right wrap through all of them', () => {
    expect(run(['up']).zone).toBe('games');
    expect(run(['up']).game).toBe(0);
    expect(run(['up', 'right', 'right']).game).toBe(2);
    expect(run(['up', 'right', 'right', 'right']).game).toBe(0);
    expect(run(['up', 'left']).game).toBe(2);
  });

  it('OK features the highlighted game; OK on it again is back to hands-free', () => {
    const featured = run(['up', 'right', 'ok']);
    expect(featured.featured).toBe(gameKey('archies', 1));
    expect(run(['ok'], featured)).toEqual(DPAD_IDLE);
  });

  it('Up returns to the featured game, not to the first', () => {
    const s = run(['up', 'right', 'right', 'ok', 'down', 'up']);
    expect(s.game).toBe(2);
  });

  it('leaves Up in the header to the page, so the controls above stay reachable', () => {
    expect(stepDpad(run(['up']), 'up', games).handled).toBe(false);
  });

  it('a board with no games never enters the header', () => {
    expect(stepDpad(DPAD_IDLE, 'up', []).handled).toBe(false);
  });
});

describe('Back', () => {
  it('returns any steering, featured game included, to the hands-free board', () => {
    for (const s of [run(['down']), run(['up']), run(['up', 'ok', 'down'])]) {
      expect(isSteering(s)).toBe(true);
      expect(stepDpad(s, 'back', games)).toEqual({ state: DPAD_IDLE, handled: true });
    }
  });

  it('is not the board’s on a hands-free board, so it still leaves the page', () => {
    expect(stepDpad(DPAD_IDLE, 'back', games).handled).toBe(false);
  });

  it('a featured game stays featured while the remote moves on', () => {
    expect(run(['up', 'ok', 'down', 'right', 'up', 'right']).featured).toBe('archies:0');
  });
});

describe('stripPanelsFor', () => {
  it('narrows the strip to the featured game alone, even inside a doubleheader', () => {
    const only = stripPanelsFor(panels, 'archies:1');
    expect(only).toHaveLength(1);
    expect(only[0].matchups.map((m) => m.opponent?.franchiseId)).toEqual(['0007']);
  });

  it('shows everything when nothing is featured or the game has left the board', () => {
    expect(stripPanelsFor(panels, null)).toBe(panels);
    expect(stripPanelsFor(panels, 'gone:0')).toBe(panels);
  });
});

describe('dpadKeyFrom', () => {
  it('maps arrows, OK and every Back a remote or keyboard sends', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].map(dpadKeyFrom)).toEqual([
      'up',
      'down',
      'left',
      'right',
      'ok',
    ]);
    for (const k of ['Escape', 'Backspace', 'GoBack', 'BrowserBack']) expect(dpadKeyFrom(k)).toBe('back');
    expect(dpadKeyFrom('f')).toBeNull();
  });
});

describe('the island', () => {
  const src = readFileSync('src/components/shared/live-broadcast/LiveBroadcast.tsx', 'utf8');

  it('takes the D-pad on the full board only, never the landing preview', () => {
    expect(src).toMatch(/const dpadEnabled = mode === 'tv' && !data\.modeHint;/);
  });

  it('stops the rotation while the remote holds the strip, and keeps the spotlight off while steering', () => {
    expect(src).toMatch(/stripPaused = [^;]*dpad\.zone === 'strip'/);
    expect(src).toMatch(/spotlightAllowed = [^;]*!steering/);
  });

  it('catches Back in the capture phase, ahead of the page router', () => {
    expect(src).toMatch(/addEventListener\('popstate', onPop, \{ capture: true \}\)/);
    expect(src).toMatch(/e\.stopImmediatePropagation\(\)/);
  });
});
