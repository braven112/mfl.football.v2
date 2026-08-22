import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import {
  aflNationalLeagueDraft,
  laborDay,
  marqueeMatchups,
  priorWinRates,
  releaseIsReady,
  scheduleReleaseDate,
  scheduleReleaseTease,
  scheduleReleaseTeaseCopy,
} from '../src/utils/schedule-release.mjs';

/**
 * Schedule Release Day.
 *
 * The date math is the part worth pinning: it runs once a year, so a bug in it
 * is invisible for twelve months and then fires on the wrong day. The AFL's
 * date is derived twice over — Labor Day, then the NL draft eight days before
 * it, then two weeks before that — and none of those are fixed calendar dates.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayName = (d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031, 2032];

describe('Labor Day anchor', () => {
  it('is the first Monday in September, every year', () => {
    for (const y of YEARS) {
      const d = laborDay(y);
      expect(dayName(d), `${y}`).toBe('Mon');
      expect(d.getUTCMonth(), `${y} month`).toBe(8);
      expect(d.getUTCDate(), `${y} must be the FIRST Monday`).toBeLessThanOrEqual(7);
    }
  });

  it('matches the known 2026 date', () => {
    expect(iso(laborDay(2026))).toBe('2026-09-07');
  });
});

describe('AFL National League draft', () => {
  it('is the Sunday eight days before Labor Day', () => {
    for (const y of YEARS) {
      const draft = aflNationalLeagueDraft(y);
      expect(dayName(draft), `${y}`).toBe('Sun');
      const gap = (laborDay(y).getTime() - draft.getTime()) / 86_400_000;
      expect(gap, `${y} gap to Labor Day`).toBe(8);
    }
  });
});

describe('scheduleReleaseDate', () => {
  it('The League reveals on June 1', () => {
    for (const y of YEARS) {
      const d = scheduleReleaseDate('theleague', y);
      expect(iso(d)).toBe(`${y}-06-01`);
    }
  });

  it('the AFL reveals on the Sunday two weeks before its NL draft', () => {
    for (const y of YEARS) {
      const d = scheduleReleaseDate('afl-fantasy', y);
      expect(dayName(d), `${y}`).toBe('Sun');
      const gap = (aflNationalLeagueDraft(y).getTime() - d.getTime()) / 86_400_000;
      expect(gap, `${y} gap to the NL draft`).toBe(14);
    }
  });

  it('gives the two leagues different days, so each reveal is its own event', () => {
    for (const y of YEARS) {
      expect(iso(scheduleReleaseDate('theleague', y))).not.toBe(iso(scheduleReleaseDate('afl-fantasy', y)));
    }
  });

  it('lands both reveals after a normal mid-May NFL schedule release', () => {
    // The NFL has released on May 11-15 in every recent year. Neither reveal
    // should be anywhere near that — the guard below is the real protection,
    // but a date that crowded the release would be a design mistake.
    for (const y of YEARS) {
      for (const slug of ['theleague', 'afl-fantasy']) {
        expect(scheduleReleaseDate(slug, y).getTime(), `${slug} ${y}`).toBeGreaterThan(Date.UTC(y, 4, 20));
      }
    }
  });

  it('returns null for a league with no configured release', () => {
    expect(scheduleReleaseDate('best-ball-1', 2026)).toBeNull();
  });
});

describe('releaseIsReady', () => {
  const fullByes = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [`T${i}`, 5 + (i % 10)]),
  );

  it('holds until the release date arrives', () => {
    const r = releaseIsReady('theleague', 2026, new Date(Date.UTC(2026, 4, 31)), fullByes);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('2026-06-01');
  });

  it('fires on the day', () => {
    expect(releaseIsReady('theleague', 2026, new Date(Date.UTC(2026, 5, 1)), fullByes).ready).toBe(true);
  });

  // The load-bearing guard. A reveal without bye data would build a schedule
  // against nothing, and the NFL has already moved this release once (April to
  // May in 2020) — the date arriving is not proof the data has.
  it('refuses to reveal before the NFL bye calendar lands', () => {
    const r = releaseIsReady('theleague', 2026, new Date(Date.UTC(2026, 6, 1)), null);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('bye calendar');
  });

  it('refuses a partial bye calendar', () => {
    const partial = Object.fromEntries(Object.entries(fullByes).slice(0, 20));
    expect(releaseIsReady('theleague', 2026, new Date(Date.UTC(2026, 6, 1)), partial).ready).toBe(false);
  });
});

describe('scheduleReleaseTease', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const phase = (iso: string, opts?: any) => scheduleReleaseTease('theleague', at(iso), opts);

  it('stays quiet until the lead window opens', () => {
    expect(phase('2026-05-05').show).toBe(false);
    expect(phase('2026-05-11').show).toBe(true);
  });

  it('counts down inside the window', () => {
    expect(phase('2026-05-31')).toMatchObject({ show: true, phase: 'countdown', daysUntil: 1 });
  });

  // This is the one that bit. An unbounded "drops today" hijacked the homepage
  // for the rest of the offseason any time a reveal failed to fire — it turned
  // eighteen hero-resolver tests red in late June and July on first wiring.
  it('gives up on "drops today" after a short grace period', () => {
    expect(phase('2026-06-01')).toMatchObject({ show: true, phase: 'imminent' });
    expect(phase('2026-06-03')).toMatchObject({ show: true, phase: 'imminent' });
    expect(phase('2026-06-04')).toMatchObject({ show: false, phase: 'overdue' });
    expect(phase('2026-07-20').show).toBe(false);
  });

  it('teases the result for a week once it is revealed, then stops', () => {
    expect(phase('2026-06-02', { revealed: true })).toMatchObject({ show: true, phase: 'out' });
    expect(phase('2026-06-08', { revealed: true }).show).toBe(true);
    expect(phase('2026-06-10', { revealed: true }).show).toBe(false);
  });

  it('never reports a negative countdown', () => {
    for (const d of ['2026-06-01', '2026-06-02', '2026-07-01']) {
      const t = phase(d);
      if (t.daysUntil != null) expect(t.daysUntil).toBeGreaterThanOrEqual(0);
    }
  });

  it('runs on each league’s own date', () => {
    // Mid-August is the AFL's window and nowhere near The League's.
    expect(scheduleReleaseTease('afl-fantasy', at('2026-08-10')).show).toBe(true);
    expect(scheduleReleaseTease('theleague', at('2026-08-10')).show).toBe(false);
  });

  it('says nothing for a league with no release date', () => {
    expect(scheduleReleaseTease('best-ball-1', at('2026-06-01')).show).toBe(false);
  });

  it('writes copy that never shows a raw negative or NaN', () => {
    for (const d of ['2026-05-12', '2026-05-31', '2026-06-01']) {
      const copy = scheduleReleaseTeaseCopy(phase(d), 'The League');
      expect(copy).not.toBeNull();
      expect(copy!.title).not.toMatch(/-\d|NaN|undefined/);
      expect(copy!.kicker).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('priorWinRates', () => {
  it('reads the record, ties counting a half', () => {
    const r = priorWinRates([
      { id: '0001', h2hwlt: '12-5-0' },
      { id: '0002', h2hwlt: '8-8-1' },
      { id: '0003', h2hwlt: '' },
    ]);
    expect(r['0001']).toBeCloseTo(12 / 17);
    expect(r['0002']).toBeCloseTo(8.5 / 17);
    expect(r['0003']).toBe(0.5); // no record — neutral, never NaN
  });
});

describe('marqueeMatchups', () => {
  const name: Record<string, string> = {};
  const divisionOf: Record<string, string> = {};
  const conferenceOf: Record<string, string> = {};
  const winRate: Record<string, number> = {};
  const ids: string[] = [];
  for (let i = 1; i <= 16; i += 1) {
    const id = String(i).padStart(4, '0');
    ids.push(id);
    name[id] = `Team ${i}`;
    divisionOf[id] = `D${Math.ceil(i / 4)}`;
    conferenceOf[id] = i <= 8 ? '00' : '01';
    winRate[id] = 0.9 - i * 0.05;
  }
  // Eight weeks, every team playing once a week.
  const weeks = new Map<number, { away: string; home: string }[]>();
  for (let w = 1; w <= 8; w += 1) {
    const rot = [...ids.slice(w % 16), ...ids.slice(0, w % 16)];
    weeks.set(
      w,
      Array.from({ length: 8 }, (_, i) => ({ away: rot[i * 2], home: rot[i * 2 + 1] })),
    );
  }
  const ctx = {
    divisionOf,
    conferenceOf,
    name,
    winRate,
    lastChampionship: { champion: '0003', runnerUp: '0004' },
    lastWeek: 8,
    doubleheaderWeeks: [1, 2],
  };

  it('returns exactly the requested number', () => {
    expect(marqueeMatchups(weeks, ctx, 4)).toHaveLength(4);
    expect(marqueeMatchups(weeks, ctx, 2)).toHaveLength(2);
  });

  it('is deterministic — every owner must see the same four', () => {
    const a = JSON.stringify(marqueeMatchups(weeks, ctx, 4));
    const b = JSON.stringify(marqueeMatchups(weeks, ctx, 4));
    expect(a).toBe(b);
  });

  // The AFL plays all twelve cross-conference games in Week 1, so the raw
  // top four came back as four Week 1 games — a tease covering one week of a
  // fourteen-week season.
  it('spreads the picks across different weeks', () => {
    const picks = marqueeMatchups(weeks, ctx, 4);
    expect(new Set(picks.map((p: any) => p.week)).size).toBe(4);
  });

  it('does not put the same franchise in every pick', () => {
    const picks = marqueeMatchups(weeks, ctx, 4);
    const teams = picks.flatMap((p: any) => [p.away, p.home]);
    expect(new Set(teams).size).toBe(teams.length);
  });

  it('returns them in week order for display', () => {
    const picks = marqueeMatchups(weeks, ctx, 4);
    const order = picks.map((p: any) => p.week);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('explains every pick', () => {
    for (const p of marqueeMatchups(weeks, ctx, 4)) {
      expect(Array.isArray(p.why)).toBe(true);
      expect(p.awayName).toBeTruthy();
      expect(p.homeName).toBeTruthy();
    }
  });

  it('surfaces a championship rematch when the schedule contains one', () => {
    const rematch = new Map([[3, [{ away: '0003', home: '0004' }]]]);
    const [pick] = marqueeMatchups(rematch, ctx, 1);
    expect(pick.why).toContain('championship rematch');
  });

  it('survives a league with no championship history', () => {
    const picks = marqueeMatchups(weeks, { ...ctx, lastChampionship: null }, 4);
    expect(picks).toHaveLength(4);
    for (const p of picks) expect(p.why).not.toContain('championship rematch');
  });
});
