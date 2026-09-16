import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildPlayerPoints, weeklyEntries } from '../scripts/lib/player-season-points.mjs';

/**
 * Season points counted once per week.
 *
 * A doubleheader week lists a franchise under two matchups with the same
 * lineup and the same scores, so a plain sum over matchup players bills that
 * week twice. TheLeague's 2024 season had four such weeks, which put the
 * committed week-1-to-14 totals ~34% high for a full-season starter — and those
 * totals are on screen on the MVP page and drive the Dead Money awards.
 */

const lineup = (id: string, score: string) => ({ id, score, status: 'starter' });

/** One week in the committed per-week shape: an array of `{ weeklyResults }`. */
const week = (w: number, matchups: Array<Array<{ id: string; players: Array<[string, string]> }>>) => ({
  weeklyResults: {
    week: String(w),
    matchup: matchups.map((franchises) => ({
      franchise: franchises.map((f) => ({ id: f.id, player: f.players.map(([id, s]) => lineup(id, s)) })),
    })),
  },
});

describe('buildPlayerPoints', () => {
  it('counts a doubleheader week once, not once per game', () => {
    // Week 1 is a doubleheader: franchise 0001 appears in two matchups with
    // the same lineup. Week 2 is a normal week.
    const payload = [
      week(1, [
        [{ id: '0001', players: [['P1', '20.00']] }, { id: '0002', players: [['P2', '5.00']] }],
        [{ id: '0001', players: [['P1', '20.00']] }, { id: '0003', players: [['P3', '7.00']] }],
      ]),
      week(2, [[{ id: '0001', players: [['P1', '10.00']] }, { id: '0002', players: [['P2', '4.00']] }]]),
    ];
    const pts = buildPlayerPoints(payload);
    expect(pts.get('P1')).toBe(30); // 20 + 10 — the old sum said 50
    expect(pts.get('P2')).toBe(9);
    expect(pts.get('P3')).toBe(7);
  });

  it('stops at the freeze week', () => {
    const payload = [
      week(14, [[{ id: '0001', players: [['P1', '10.00']] }]]),
      week(15, [[{ id: '0001', players: [['P1', '99.00']] }]]),
    ];
    expect(buildPlayerPoints(payload, 14).get('P1')).toBe(10);
    expect(buildPlayerPoints(payload).get('P1')).toBe(109);
  });

  it('reads the live W=YTD shape as well as the committed per-week one', () => {
    const ytd = {
      allWeeklyResults: {
        weeklyResults: [
          { week: '1', matchup: [{ franchise: [{ id: '0001', player: lineup('P1', '6.50') }] }] },
          { week: '1', matchup: [{ franchise: [{ id: '0001', player: lineup('P1', '6.50') }] }] },
          { week: '2', matchup: { franchise: { id: '0001', player: [lineup('P1', '3.50')] } } },
        ],
      },
    };
    expect(weeklyEntries(ytd)).toHaveLength(3);
    // The repeated week-1 entry is the same performance, whatever shape it came in.
    expect(buildPlayerPoints(ytd).get('P1')).toBe(10);
  });

  it('keeps entries with no readable week distinct instead of collapsing them', () => {
    // Keyed as "week 0", these would overwrite each other and undercount a
    // whole season down to one week — the opposite bug.
    const payload = {
      allWeeklyResults: {
        weeklyResults: [
          { matchup: { franchise: { id: '0001', player: lineup('P1', '4.00') } } },
          { matchup: { franchise: { id: '0001', player: lineup('P1', '6.00') } } },
        ],
      },
    };
    expect(buildPlayerPoints(payload).get('P1')).toBe(10);
  });

  it('keeps zero and negative weeks, and skips blank or unparseable rows', () => {
    const payload = [
      week(1, [[{ id: '0001', players: [['DEF', '-4.00'], ['P0', '0.00']] }]]),
      week(2, [[{ id: '0001', players: [['DEF', '6.00'], ['', '9.00']] }]]),
      { weeklyResults: { week: '3', matchup: { franchise: { id: '0001', player: { id: 'P0', score: 'n/a' } } } } },
    ];
    const pts = buildPlayerPoints(payload);
    expect(pts.get('DEF')).toBe(2);
    expect(pts.get('P0')).toBe(0);
    expect(pts.has('')).toBe(false);
  });

  it('does not count top-level (idle) franchise blocks — unchanged from before', () => {
    const payload = [
      {
        weeklyResults: {
          week: '15',
          matchup: [{ franchise: { id: '0001', player: lineup('P1', '5.00') } }],
          franchise: [{ id: '0009', player: lineup('P9', '40.00') }],
        },
      },
    ];
    const pts = buildPlayerPoints(payload);
    expect(pts.get('P1')).toBe(5);
    expect(pts.has('P9')).toBe(false);
  });
});

describe('the real 2024 feed', () => {
  // Pinned against the committed data rather than a fixture, because the
  // failure this guards against was invisible in every hand-written example:
  // it only exists where MFL actually scheduled doubleheaders.
  const raw = JSON.parse(readFileSync('data/theleague/mfl-feeds/2024/weekly-results-raw.json', 'utf8'));

  it('had doubleheader weeks — the premise of this fix', () => {
    const doubled = weeklyEntries(raw).filter((e: any) => {
      const ids = [e.matchup ?? []].flat().flatMap((m: any) => [m.franchise ?? []].flat().map((f: any) => f.id));
      return ids.length !== new Set(ids).size;
    });
    expect(doubled.length).toBeGreaterThan(0);
  });

  it("totals Saquon Barkley's weeks 1-14 at MFL's own figure", () => {
    // MFL's per-week playerScores for 2024 weeks 1-14 sum to 278.25 for him
    // (id 13604). The pre-fix sum said 373.35 — the four doubleheader weeks
    // (1, 2, 3 and 13) counted a second time.
    expect(buildPlayerPoints(raw, 14).get('13604')).toBeCloseTo(278.25, 2);
  });
});

describe('update-salary-averages uses the shared function', () => {
  it('imports buildPlayerPoints instead of carrying its own sum', () => {
    const src = readFileSync('scripts/update-salary-averages.mjs', 'utf8');
    expect(src).toContain("from './lib/player-season-points.mjs'");
    // A local definition is how the double count would grow back.
    expect(src).not.toMatch(/const\s+buildPlayerPoints\s*=/);
    expect(src).not.toMatch(/function\s+buildPlayerPoints\s*\(/);
  });
});
