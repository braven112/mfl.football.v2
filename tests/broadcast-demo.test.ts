/**
 * The scripted rehearsal.
 *
 * Two classes of rule here, and they fail for different reasons:
 *
 *  - **Containment.** The demo must be unreachable without `?demo=1`, must
 *    never touch the network, and must say on screen that it is a demo. A
 *    rehearsal mistaken for live scores is worse than no rehearsal.
 *  - **Coverage.** Every scripted event must actually produce a moment. The
 *    first cut silently dropped any play it could not cast a player for, and
 *    because an opponent's starters are EMPTY before their lineup is in, that
 *    quietly deleted every opponent lower-third from a ten-minute run. The
 *    board looked fine; half the script simply never happened.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_PERIOD_MS,
  DEMO_SCRIPT,
  demoElapsed,
  demoLoopIndex,
  demoPollAt,
} from '../src/utils/broadcast-demo';
import type {
  BroadcastLeaguePanel,
  BroadcastPollResponse,
} from '../src/types/live-broadcast';
import type { LivePlayerRow, PlayerMeta } from '../src/types/live-scoring';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** See the note in `broadcast-shell-guards.test.ts` — these files document their own traps. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const team = (id: string) => ({
  franchiseId: id,
  name: `Team ${id}`,
  nameShort: `T${id}`,
  abbrev: id,
  icon: '',
  iconSmall: '',
  primary: '#225588',
  secondary: '#113344',
  swatch: '#4499dd',
  gradient: '',
});

const row = (id: string): LivePlayerRow => ({ id, live: 0, secondsRemaining: 1800, status: 'starter' });

const meta = (id: string, position: string): PlayerMeta => ({
  id,
  name: `Player ${id}`,
  position,
  nflTeam: 'KC',
  headshot: '',
  espnId: null,
  projected: 12,
});

const PLAYER_META: Record<string, PlayerMeta> = {
  m1: meta('m1', 'QB'),
  m2: meta('m2', 'RB'),
  m3: meta('m3', 'WR'),
  m4: meta('m4', 'TE'),
  m5: meta('m5', 'PK'),
  m6: meta('m6', 'DEF'),
  o1: meta('o1', 'QB'),
  o2: meta('o2', 'RB'),
  o3: meta('o3', 'WR'),
};

const panel = (leagueId: string): BroadcastLeaguePanel => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  slug: 'theleague',
  franchiseId: '0001',
  matchups: [{ index: 0, mine: team('0001'), opponent: team('0002') }],
  status: 'ok',
});

/** A board with both sides' lineups in — the ordinary Sunday case. */
const base = (leagueId: string, oppRows: LivePlayerRow[]): BroadcastPollResponse => ({
  ok: true,
  week: 3,
  fetchedAt: new Date(0).toISOString(),
  leagues: [
    {
      leagueId,
      ok: true,
      live: true,
      teams: {
        '0001': {
          live: 40,
          projectedFinal: 100,
          remainingPoints: 60,
          yetToPlay: 3,
          players: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(row),
        },
        '0002': {
          live: 38,
          projectedFinal: 96,
          remainingPoints: 58,
          yetToPlay: 3,
          players: oppRows,
        },
      },
      winProbability: [0.5],
    },
  ],
  moments: [],
  redZone: [],
  games: [],
});

const poll = (elapsed: number, oppRows: LivePlayerRow[] = ['o1', 'o2', 'o3'].map(row)) =>
  demoPollAt({
    panels: [panel('13522')],
    base: base('13522', oppRows),
    playerMeta: PLAYER_META,
    now: elapsed,
    startedAt: 0,
  });

describe('the loop', () => {
  it('wraps at the period and never goes negative', () => {
    expect(demoElapsed(0, 0)).toBe(0);
    expect(demoElapsed(DEMO_PERIOD_MS - 1, 0)).toBe(DEMO_PERIOD_MS - 1);
    expect(demoElapsed(DEMO_PERIOD_MS, 0)).toBe(0);
    expect(demoElapsed(DEMO_PERIOD_MS + 5_000, 0)).toBe(5_000);
    // A clock that went backwards (a laptop waking) must not produce a
    // negative index into the script.
    expect(demoElapsed(-5_000, 0)).toBeGreaterThanOrEqual(0);
  });

  it('counts loops so the island can let the same moments through again', () => {
    expect(demoLoopIndex(0, 0)).toBe(0);
    expect(demoLoopIndex(DEMO_PERIOD_MS - 1, 0)).toBe(0);
    expect(demoLoopIndex(DEMO_PERIOD_MS, 0)).toBe(1);
    expect(demoLoopIndex(DEMO_PERIOD_MS * 2, 0)).toBe(2);
  });

  it('is deterministic — the same second of the loop renders the same way', () => {
    // The whole value of a scripted rehearsal over a random walk: you can
    // watch it twice and compare.
    const a = poll(300_000);
    const b = poll(300_000 + DEMO_PERIOD_MS);
    expect(a.leagues[0].teams['0001'].live).toBe(b.leagues[0].teams['0001'].live);
    expect(a.moments.length).toBe(b.moments.length);
    expect(a.moments.map((m) => m.kind)).toEqual(b.moments.map((m) => m.kind));
  });

  it('gives each loop its own moment keys, so the second pass is not deduped away', () => {
    const first = poll(300_000).moments.map((m) => m.key);
    const second = poll(300_000 + DEMO_PERIOD_MS).moments.map((m) => m.key);
    expect(first.length).toBeGreaterThan(0);
    for (const key of second) expect(first).not.toContain(key);
  });
});

describe('the script covers every screen', () => {
  it('fires both sides', () => {
    const sides = new Set(poll(DEMO_PERIOD_MS - 1).moments.map((m) => m.side));
    expect(sides).toContain('mine');
    expect(sides).toContain('opponent');
  });

  it('gives every scoring position a turn', () => {
    const positions = new Set(DEMO_SCRIPT.map((e) => e.position));
    for (const p of ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']) expect(positions).toContain(p);
  });

  it('fires every reveal kind the board can draw', () => {
    const kinds = new Set(poll(DEMO_PERIOD_MS - 1).moments.map((m) => m.kind));
    for (const k of ['touchdown', 'field-goal', 'big-play', 'two-point', 'turnover', 'safety']) {
      expect(kinds).toContain(k);
    }
  });

  it('queues two plays close enough together to exercise the backlog', () => {
    const gaps = DEMO_SCRIPT.slice(1).map((e, i) => e.at - DEMO_SCRIPT[i].at);
    // The reveal holds the screen for 10s; a gap under that forces a queue.
    expect(Math.min(...gaps)).toBeLessThan(10_000);
  });

  it('ends quiet, so the board can be judged at rest', () => {
    const last = DEMO_SCRIPT[DEMO_SCRIPT.length - 1].at;
    expect(DEMO_PERIOD_MS - last).toBeGreaterThanOrEqual(60_000);
  });

  it('raises and then clears the red-zone banner inside one loop', () => {
    const windows = Array.from({ length: DEMO_PERIOD_MS / 5_000 }, (_, i) => poll(i * 5_000).redZone.length > 0);
    expect(windows.some(Boolean)).toBe(true);
    expect(windows.some((x) => !x)).toBe(true);
  });

  it('keeps the slate live, so the screensaver does not take over mid-rehearsal', () => {
    const games = poll(200_000).games;
    expect(games.length).toBeGreaterThan(0);
    expect(games.every((g) => g.state === 'in')).toBe(true);
  });
});

describe('nothing in the script is silently dropped', () => {
  it('casts every event even when the OPPONENT has no starters at all', () => {
    // This is the bug. A rehearsal run before the week's lineups are in reads
    // an opponent with an empty starter list; the first cut returned undefined
    // from the cast and `continue`d, so not one opponent lower-third fired in
    // ten minutes and it looked like a rendering fault.
    const moments = poll(DEMO_PERIOD_MS - 1, []).moments;
    expect(moments.length).toBe(DEMO_SCRIPT.length);
    expect(moments.some((m) => m.side === 'opponent')).toBe(true);
  });

  it('casts every event when NEITHER side has starters', () => {
    const empty: BroadcastPollResponse = {
      ...base('13522', []),
      leagues: [
        {
          leagueId: '13522',
          ok: true,
          live: true,
          teams: {
            '0001': { live: 0, projectedFinal: 0, remainingPoints: 0, yetToPlay: 0, players: [row('m1')] },
            '0002': { live: 0, projectedFinal: 0, remainingPoints: 0, yetToPlay: 0, players: [] },
          },
          winProbability: [0.5],
        },
      ],
    };
    const moments = demoPollAt({
      panels: [panel('13522')],
      base: empty,
      playerMeta: PLAYER_META,
      now: DEMO_PERIOD_MS - 1,
      startedAt: 0,
    }).moments;
    expect(moments.length).toBe(DEMO_SCRIPT.length);
  });

  it('names a real player on every moment — never a bare id', () => {
    for (const m of poll(DEMO_PERIOD_MS - 1, []).moments) {
      expect(m.playerName).toBeTruthy();
      expect(m.text).toContain(m.playerName);
    }
  });

  it('stamps a wallclock that is fresh at the instant the play lands', () => {
    // `isMomentFresh` drops anything older than 90s, so a stamp taken from the
    // loop origin rather than the event would let the whole first minute
    // through at once on a mid-loop mount.
    const at = DEMO_SCRIPT[3].at;
    const m = poll(at + 1_000).moments.find((x) => x.key.endsWith(':3'));
    expect(m).toBeDefined();
    const age = at + 1_000 - Date.parse(m!.wallclock);
    expect(age).toBeLessThan(90_000);
  });
});

describe('the score climbs', () => {
  it('adds every fired event to the right franchise', () => {
    const start = poll(0).leagues[0].teams['0001'].live;
    const end = poll(DEMO_PERIOD_MS - 1).leagues[0].teams['0001'].live;
    const mine = DEMO_SCRIPT.filter((e) => e.side === 'mine').reduce((s, e) => s + e.points, 0);
    expect(end - start).toBeCloseTo(mine, 5);
  });

  it('moves the win-probability bar off its hard stops', () => {
    const wp = poll(DEMO_PERIOD_MS - 1).leagues[0].winProbability[0];
    expect(wp).toBeGreaterThan(0);
    expect(wp).toBeLessThan(1);
    expect(wp).not.toBe(poll(0).leagues[0].winProbability[0]);
  });
});

describe('containment — the demo can never be mistaken for live scores', () => {
  const ISLAND = code(read('src/components/shared/live-broadcast/LiveBroadcast.tsx'));
  const PAGE = code(read('src/components/shared/live-broadcast/LiveBroadcastPage.astro'));
  const DEMO = code(read('src/utils/broadcast-demo.ts'));
  const CSS = code(read('src/styles/live-broadcast.css'));

  it('only turns on from the URL, and is never remembered in a cookie', () => {
    expect(PAGE).toMatch(/searchParams\.get\(['"]demo['"]\)/);
    // A television that silently resumed last week's demo is the failure mode.
    expect(PAGE).not.toMatch(/cookies\.set\([^)]*demo/i);
  });

  it('stops the real poller while it runs', () => {
    expect(ISLAND).toMatch(/if\s*\(data\.demo\)\s*return;/);
  });

  it('never fetches — the script is pure', () => {
    expect(DEMO).not.toMatch(/\bfetch\s*\(/);
  });

  it('badges itself on screen', () => {
    expect(ISLAND).toMatch(/lbc__demo-badge/);
    expect(CSS).toMatch(/\.lbc__demo-badge/);
  });

  it('drives itself faster than the 8s poll, so the timing can be judged', () => {
    expect(ISLAND).toMatch(/setInterval\(tick,\s*1000\)/);
  });
});
