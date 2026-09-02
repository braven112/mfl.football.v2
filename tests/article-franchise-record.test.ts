/**
 * Records and doubleheader shape in article fact sheets.
 *
 * Both bugs here shipped into published Schefter articles:
 *
 * 1. Five article types computed wins as `h2hw + divw + nondivw`. MFL's `h2hw`
 *    is the TOTAL head-to-head win count; `divw`/`nondivw` are its subsets. So
 *    every record handed to the model was DOUBLED — a 15-3 team was reported
 *    as 30-6, and the articles repeated it.
 * 2. TheLeague plays doubleheaders in Weeks 1, 2, 3 and 12. Franchise-keyed
 *    score maps kept only the second game, and nothing told the model a team
 *    appearing twice was the schedule rather than a contradiction.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  franchiseRecord,
  summarizeWeekFormat,
  doubleheaderBriefing,
  resultsByFranchise,
  weekSummaryLine,
} from '../scripts/article-utils/franchise-record.mjs';
import { getMatchupPairings } from '../scripts/article-utils/week-resolver.mjs';

describe('franchiseRecord — the doubling bug', () => {
  it('uses h2hw/h2hl, never the div + nondiv subsets', () => {
    // Real 2025 row: h2hwlt "15-3-0", divw 5, nondivw 10 (5 + 10 === 15).
    const row = { h2hw: '15', h2hl: '3', h2ht: '0', divw: '5', divl: '1', nondivw: '10', nondivl: '2' };
    expect(franchiseRecord(row)).toMatchObject({ wins: 15, losses: 3, display: '15-3' });
    // The old formula produced this; it must never come back.
    expect(franchiseRecord(row).wins).not.toBe(15 + 5 + 10);
  });

  it('agrees with MFL\'s own h2hwlt string for every 2025 franchise', () => {
    const p = path.join(process.cwd(), 'data/theleague/mfl-feeds/2025/standings.json');
    const rows = JSON.parse(fs.readFileSync(p, 'utf-8')).leagueStandings.franchise;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const { wins, losses, ties } = franchiseRecord(row);
      expect(`${wins}-${losses}-${ties}`).toBe(row.h2hwlt);
      // And the subsets really do sum to the total — the premise of the bug.
      expect(Number(row.divw) + Number(row.nondivw)).toBe(wins);
    }
  });

  it('shows ties only when there are any', () => {
    expect(franchiseRecord({ h2hw: '9', h2hl: '4', h2ht: '1' }).display).toBe('9-4-1');
    expect(franchiseRecord({ h2hw: '9', h2hl: '4', h2ht: '0' }).display).toBe('9-4');
  });

  it('survives a missing or malformed row', () => {
    expect(franchiseRecord({}).display).toBe('0-0');
    expect(franchiseRecord(undefined as any).display).toBe('0-0');
    expect(franchiseRecord({ h2hw: 'x' }).wins).toBe(0);
  });
});

describe('summarizeWeekFormat — doubleheader detection', () => {
  const pairs = (n: number, offset = 0) =>
    [...Array(n)].map((_, i) => ({
      franchise1Id: String(offset + i * 2 + 1).padStart(4, '0'),
      franchise2Id: String(offset + i * 2 + 2).padStart(4, '0'),
    }));

  it('calls a normal week normal', () => {
    const f = summarizeWeekFormat(pairs(8));
    expect(f.isDoubleheader).toBe(false);
    expect(f.gamesPerFranchise).toBe(1);
    expect(f.label).toBe('8 matchups');
  });

  it('detects the real 2026 Week 1 doubleheader from the committed schedule', () => {
    const p = path.join(process.cwd(), 'data/theleague/mfl-feeds/2026/schedule.json');
    const weeks = JSON.parse(fs.readFileSync(p, 'utf-8')).schedule.weeklySchedule;
    const week1 = weeks.find((w: any) => String(w.week) === '1');
    const pairings = (week1.matchup as any[]).map((m) => ({
      franchise1Id: m.franchise[0].id,
      franchise2Id: m.franchise[1].id,
    }));
    const f = summarizeWeekFormat(pairings);
    expect(f.isDoubleheader).toBe(true);
    expect(f.gameCount).toBe(16);
    expect(f.franchiseCount).toBe(16);
    expect(f.gamesPerFranchise).toBe(2);
    for (const [, opps] of f.opponentsByFranchise) expect(opps).toHaveLength(2);
  });

  it('produces a briefing only on a doubleheader week', () => {
    expect(doubleheaderBriefing(summarizeWeekFormat(pairs(8)))).toBe('');
    const dh = doubleheaderBriefing(summarizeWeekFormat([...pairs(8), ...pairs(8)]));
    expect(dh).toMatch(/DOUBLEHEADER WEEK/);
    expect(dh).toMatch(/NOT an error/);
  });

  it('handles an empty week without dividing by zero', () => {
    const f = summarizeWeekFormat([]);
    expect(f.gamesPerFranchise).toBe(0);
    expect(f.isDoubleheader).toBe(false);
  });
});

describe('resultsByFranchise — the overwrite bug', () => {
  const matchups = [
    { franchise: [{ id: '0001', score: '120.5' }, { id: '0002', score: '100.0' }] },
    { franchise: [{ id: '0001', score: '90.0' }, { id: '0003', score: '95.5' }] },
  ];

  it('keeps BOTH of a franchise\'s games instead of overwriting the first', () => {
    const byFranchise = resultsByFranchise(matchups);
    const games = byFranchise.get('0001')!;
    expect(games).toHaveLength(2);
    expect(games.map((g) => g.score)).toEqual([120.5, 90]);
    expect(games.map((g) => g.result)).toEqual(['W', 'L']);
  });

  it('surfaces the true weekly high score, which the overwrite hid', () => {
    // A franchise-keyed map would have kept only 90.0 for 0001 and reported
    // 0003's 95.5 as the week's best.
    const all = [...resultsByFranchise(matchups).values()].flat();
    expect(Math.max(...all.map((g) => g.score))).toBe(120.5);
  });

  it('summarizes a split, a sweep and a winless week', () => {
    expect(weekSummaryLine(resultsByFranchise(matchups).get('0001'))).toBe('1-1 (210.50 total)');
    expect(weekSummaryLine([{ score: 10, result: 'W' }, { score: 20, result: 'W' }] as any)).toBe('2-0 (30.00 total)');
    expect(weekSummaryLine([{ score: 10, result: 'L' }, { score: 20, result: 'L' }] as any)).toBe('0-2 (30.00 total)');
  });

  it('records a tie as a tie', () => {
    const tied = resultsByFranchise([{ franchise: [{ id: '0001', score: '100' }, { id: '0002', score: '100' }] }]);
    expect(tied.get('0001')![0].result).toBe('T');
    expect(weekSummaryLine(tied.get('0001'))).toBe('0-0-1 (100.00 total)');
  });

  it('skips malformed matchup rows', () => {
    expect(resultsByFranchise([{ franchise: [{ id: '0001' }] }, {}, null as any]).size).toBe(0);
  });
});
