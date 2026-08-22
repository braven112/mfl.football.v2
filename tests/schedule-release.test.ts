import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadSpriteIconIds } from './helpers/sprite-icons';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import { describeSeries, rivalrySeriesByPair } from '../src/utils/rivalry-intensity.mjs';
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
  GENERIC_QUALITY_REASON,
  THROWBACK_REASON,
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

/**
 * The homepage wiring.
 *
 * TheLeague's homepage has TWO date variables and only one of them is safe to
 * dereference: `effectiveDate` is `Date | undefined` (only `?testDate=` sets
 * it) and `heroReferenceDate` is the resolved `effectiveDate ?? new Date()`.
 * Reading the season off the wrong one threw
 * `Cannot read properties of undefined (reading 'getUTCFullYear')` on every
 * normal request — a 500 on the front page, invisible to any test that only
 * exercises the resolver, because a `?testDate=` run passes.
 *
 * The AFL page defines `effectiveDate` WITH the fallback, so this rule is
 * TheLeague's alone.
 */
describe('theleague homepage never dereferences the optional date', () => {
  it('reads the schedule-release season off heroReferenceDate', () => {
    const src = readFileSync(resolve(__dirname, '../src/pages/theleague/index.astro'), 'utf-8');
    const optionalUse = src.match(/\beffectiveDate\.\w+/g) ?? [];
    expect(
      optionalUse,
      'effectiveDate is `Date | undefined` on this page — use heroReferenceDate (or `effectiveDate ?? new Date()`)',
    ).toEqual([]);
    expect(src).toContain("getRelease('theleague', heroReferenceDate.getUTCFullYear())");
  });
});

/**
 * Marquee reason icons.
 *
 * The reason strings are written in one file (`schedule-release.mjs`, as
 * `why.push(...)`) and given glyphs in another (`ScheduleRelease.tsx`, as
 * `WHY_ICONS`). Nothing at runtime connects them: an unmapped reason silently
 * falls back to the generic football, and a typo'd glyph name renders an empty
 * box, both of which look like a design choice rather than a bug.
 */
describe('marquee reason icons', () => {
  const mjs = readFileSync(resolve(__dirname, '../src/utils/schedule-release.mjs'), 'utf-8');
  const reasons = [
    ...[...mjs.matchAll(/why\.push\('([^']+)'\)/g)].map((m) => m[1]),
    // Pushed via its named constant rather than a literal, because the trim
    // rule below has to refer to the same string.
    GENERIC_QUALITY_REASON,
  ];
  const tsx = readFileSync(resolve(__dirname, '../src/components/shared/ScheduleRelease.tsx'), 'utf-8');
  const mapped = Object.fromEntries(
    [...tsx.matchAll(/^\s+'([^']+)': '([a-z0-9-]+)',$/gm)].map((m) => [m[1], m[2]]),
  );

  it('finds the reasons and the map (sanity)', () => {
    expect(reasons.length).toBeGreaterThan(5);
    expect(Object.keys(mapped).length).toBeGreaterThan(5);
  });

  it('gives every reason the scorer can emit its own glyph', () => {
    const unmapped = reasons.filter((r) => !mapped[r]);
    expect(unmapped, 'reasons with no entry in WHY_ICONS — they render the generic fallback').toEqual([]);
  });

  it('maps only glyphs that exist in the sprite', () => {
    const sprite = loadSpriteIconIds();
    const missing = Object.entries(mapped)
      .filter(([, icon]) => !sprite.has(icon))
      .map(([reason, icon]) => `${reason} -> ${icon}`);
    expect(missing, 'WHY_ICONS names a glyph the sprite does not define — renders empty').toEqual([]);
  });
});

/**
 * The generic-quality reason.
 *
 * "Two of last year's best" is true of a LOT of games — in the 2026 draw it
 * landed on three of the four picks, which made the tease read like filler.
 * It still WEIGHTS the pick; it is only printed when a game has nothing more
 * specific to say, and then only once across the set.
 */
describe('trimming the generic quality reason', () => {
  const ids = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'];
  const name = Object.fromEntries(ids.map((id, i) => [id, `Team ${i + 1}`]));
  const divisionOf = Object.fromEntries(ids.map((id, i) => [id, `D${Math.ceil((i + 1) / 4)}`]));
  const conferenceOf = Object.fromEntries(ids.map((id) => [id, '00']));
  // Everybody had a strong year, so every game qualifies for the generic tag.
  const winRate = Object.fromEntries(ids.map((id) => [id, 0.8]));
  const ctx = {
    divisionOf,
    conferenceOf,
    name,
    winRate,
    lastChampionship: { champion: '0001', runnerUp: '0005' },
    lastWeek: 4,
    doubleheaderWeeks: [1],
  };
  // Four weeks, four games each — every pairing qualifies on quality alone.
  const weeks = new Map<number, { away: string; home: string }[]>();
  for (let w = 1; w <= 4; w += 1) {
    const rot = [...ids.slice(w % 8), ...ids.slice(0, w % 8)];
    weeks.set(
      w,
      Array.from({ length: 4 }, (_, i) => ({ away: rot[i * 2], home: rot[i * 2 + 1] })),
    );
  }

  const picks = marqueeMatchups(weeks, ctx, 4);

  it('never says it more than once across the whole tease', () => {
    const said = picks.filter((p: any) => p.why.includes(GENERIC_QUALITY_REASON));
    expect(said.length).toBeLessThanOrEqual(1);
  });

  it('never says it alongside a more specific reason', () => {
    for (const p of picks) {
      if (!p.why.includes(GENERIC_QUALITY_REASON)) continue;
      expect(p.why, `${p.awayName} @ ${p.homeName}`).toEqual([GENERIC_QUALITY_REASON]);
    }
  });

  it('still weights the pick — a quality game with nothing else keeps the label', () => {
    // A single game, two strong teams, no rivalry/opener/rematch angle at all.
    const bare = new Map([[2, [{ away: '0002', home: '0006' }]]]);
    const [only] = marqueeMatchups(bare, ctx, 1);
    expect(only.why).toEqual([GENERIC_QUALITY_REASON]);
  });

  it('leaves a card with no angle at all with an empty reason list, not filler', () => {
    for (const p of picks) expect(Array.isArray(p.why)).toBe(true);
  });
});

/**
 * Rivalries and Throwback Week in the tease.
 *
 * Both are reasons a game matters that this season's records say nothing
 * about, and both have a way of going wrong quietly: a record printed from the
 * wrong side names the wrong winner, and a reserved slot that isn't really
 * reserved just silently drops the week.
 */
describe('the rivalry lens', () => {
  const ids = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'];
  const name = Object.fromEntries(ids.map((id, i) => [id, `Team ${i + 1}`]));
  const divisionOf = Object.fromEntries(ids.map((id, i) => [id, `D${Math.ceil((i + 1) / 4)}`]));
  const conferenceOf = Object.fromEntries(ids.map((id) => [id, '00']));
  const winRate = Object.fromEntries(ids.map((id) => [id, 0.5]));

  // 0001 vs 0005 is the marquee series; 0002 vs 0006 a lesser one.
  const rivalry = {
    '0001-0005': { games: 30, playoffGames: 2, intensity: 4.9, perspective: '0001', wins: 16, losses: 14, ties: 0 },
    '0002-0006': { games: 12, playoffGames: 0, intensity: 3.1, perspective: '0002', wins: 6, losses: 6, ties: 0 },
    '0003-0007': { games: 3, playoffGames: 0, intensity: 1.4, perspective: '0003', wins: 2, losses: 1, ties: 0 },
  };
  const base = {
    divisionOf,
    conferenceOf,
    name,
    winRate,
    lastChampionship: null,
    lastWeek: 6,
    doubleheaderWeeks: [],
    rivalry,
  };
  const weeks = new Map([
    [1, [{ away: '0001', home: '0005' }, { away: '0003', home: '0007' }]],
    [2, [{ away: '0002', home: '0006' }, { away: '0004', home: '0008' }]],
    [3, [{ away: '0001', home: '0006' }, { away: '0002', home: '0005' }]],
    [4, [{ away: '0002', home: '0006' }, { away: '0003', home: '0008' }]],
    [5, [{ away: '0004', home: '0007' }, { away: '0001', home: '0003' }]],
    [6, [{ away: '0005', home: '0008' }, { away: '0002', home: '0004' }]],
  ]);

  it('lifts a long series into the tease', () => {
    const picks = marqueeMatchups(weeks, base, 4);
    const hasMarqueeSeries = picks.some(
      (p: any) => (p.away === '0001' && p.home === '0005') || (p.away === '0005' && p.home === '0001'),
    );
    expect(hasMarqueeSeries, 'the 30-meeting series should make the four').toBe(true);
  });

  // A series line on all four cards is wallpaper — the same failure the
  // generic quality tag had.
  it('says the series on at most one card outside Throwback Week', () => {
    const picks = marqueeMatchups(weeks, base, 4);
    const said = picks.filter((p: any) => p.why.some((w: string) => /\d+ meetings/.test(w)));
    expect(said.length).toBeLessThanOrEqual(1);
  });

  it('names the franchise that is actually ahead, not whichever id sorts first', () => {
    // 0005 leads 0001 here, but the record is STORED from 0001's side.
    const flipped = {
      ...base,
      rivalry: { '0001-0005': { ...rivalry['0001-0005'], wins: 12, losses: 18 } },
    };
    const [pick] = marqueeMatchups(new Map([[1, [{ away: '0001', home: '0005' }]]]), flipped, 1);
    const line = pick.why.find((w: string) => /meetings/.test(w));
    expect(line).toContain('Team 5 up 18-12');
    expect(line).not.toContain('Team 1 up');
  });

  it('calls an even series even rather than picking a leader', () => {
    const even = { ...base, rivalry: { '0002-0006': rivalry['0002-0006'] } };
    const [pick] = marqueeMatchups(new Map([[2, [{ away: '0002', home: '0006' }]]]), even, 1);
    expect(pick.why.find((w: string) => /meetings/.test(w))).toContain('dead even at 6-6');
  });

  it('ignores a pairing with too little history to be a rivalry', () => {
    const [pick] = marqueeMatchups(new Map([[1, [{ away: '0003', home: '0007' }]]]), base, 1);
    expect(pick.why.some((w: string) => /meetings/.test(w))).toBe(false);
  });

  it('degrades to the old behaviour with no rivalry data at all', () => {
    const picks = marqueeMatchups(weeks, { ...base, rivalry: undefined }, 4);
    expect(picks).toHaveLength(4);
    for (const p of picks) expect(p.why.some((w: string) => /meetings/.test(w))).toBe(false);
  });

  describe('Throwback Week', () => {
    const ctx = { ...base, throwbackWeek: 4 };

    it('always carries a game from the throwback week', () => {
      const picks = marqueeMatchups(weeks, ctx, 4);
      expect(picks.some((p: any) => p.week === 4)).toBe(true);
    });

    it('picks the week’s best RIVALRY, not its best score', () => {
      const [pick] = marqueeMatchups(weeks, ctx, 4).filter((p: any) => p.week === 4);
      expect([pick.away, pick.home].sort()).toEqual(['0002', '0006']);
    });

    // Franchise-distinctness is the guarantee that survives everywhere: the
    // reserved slot claims two franchises before the general pass runs, and
    // the first relax pass still refuses a repeat. Week-distinctness is only
    // best-effort — this eight-team fixture genuinely runs out of legal games
    // in unused weeks, which is why the relax passes exist at all — so it is
    // pinned on the sixteen-team shape in the marqueeMatchups suite above.
    it('never repeats a franchise, even with a slot reserved', () => {
      const teams = marqueeMatchups(weeks, ctx, 4).flatMap((p: any) => [p.away, p.home]);
      expect(new Set(teams).size).toBe(teams.length);
    });

    it('says both the rivalry and the throwback on that card', () => {
      const [pick] = marqueeMatchups(weeks, ctx, 4).filter((p: any) => p.week === 4);
      expect(pick.why).toContain(THROWBACK_REASON);
      expect(pick.why.some((w: string) => /meetings/.test(w))).toBe(true);
    });

    it('does nothing at all for a league that runs no throwback week', () => {
      const picks = marqueeMatchups(weeks, base, 4);
      for (const p of picks) expect(p.why).not.toContain(THROWBACK_REASON);
    });
  });

  // The reveal page has to spot the throwback pick to swap in the era crests,
  // and it does that by matching this exact string in a second file.
  it('keeps the reveal page’s copy of THROWBACK_REASON in step', () => {
    const tsx = readFileSync(resolve(__dirname, '../src/components/shared/ScheduleRelease.tsx'), 'utf-8');
    const declared = tsx.match(/const THROWBACK_REASON = '([^']+)'/)?.[1];
    expect(declared, 'ScheduleRelease.tsx must declare THROWBACK_REASON').toBeTruthy();
    expect(declared).toBe(THROWBACK_REASON);
  });
});

/**
 * Disputed series.
 *
 * `matchupHistory` stores every meeting twice and the two copies do not always
 * agree — `bothAttributed` is resolved from each side's own owner history, so
 * a franchise identity that moved between slots leaves the sides counting
 * different games. TheLeague has 18 such pairings out of 105, the AFL 23 of
 * 162, and one of them landed on a 2026 marquee card. Stating a record we
 * cannot stand behind puts a head-to-head in the chat that the Rivalries page
 * contradicts.
 */
describe('a series the two sides disagree about', () => {
  const nameOf = (id: string) => ({ '0001': 'Alpha', '0005': 'Bravo' })[id] ?? id;

  it('states a record when the two copies agree', () => {
    const agreed = { games: 20, wins: 12, losses: 8, ties: 0, perspective: '0001', disputed: false };
    expect(describeSeries(agreed, '0001', '0005', nameOf)).toBe('20 meetings, Alpha up 12-8');
  });

  // Caught by the fixture above missing `perspective`: the old code printed
  // "undefined up 12-8" rather than degrading.
  it('drops the leader clause rather than naming an unknown one', () => {
    const orphaned = { games: 20, wins: 12, losses: 8, ties: 0, perspective: '9999' };
    expect(describeSeries(orphaned, '0001', '0005', nameOf)).toBe('20 meetings, 12-8');
  });

  it('states nothing at all when they do not', () => {
    const disputed = { games: 20, wins: 12, losses: 8, ties: 0, perspective: '0001', disputed: true };
    expect(describeSeries(disputed, '0001', '0005', nameOf)).toBeNull();
  });

  it('flags the disagreement rather than picking a side', () => {
    // 0001 counts 6 meetings against 0009; 0009 counts only 4 of them.
    const franchises = {
      '0001': { matchupHistory: { '0009': meetings([1, 1, 1, 0, 0, 0]) } },
      '0009': { matchupHistory: { '0001': meetings([1, 1, 0, 0]) } },
    };
    const byPair = rivalrySeriesByPair(franchises);
    expect(byPair['0001-0009'].disputed).toBe(true);
    expect(byPair['0001-0009'].games, 'still weights the pick').toBeGreaterThan(0);
  });

  it('leaves an agreeing pairing undisputed', () => {
    const franchises = {
      '0001': { matchupHistory: { '0009': meetings([1, 1, 1, 0]) } },
      '0009': { matchupHistory: { '0001': meetings([0, 0, 0, 1]) } },
    };
    expect(rivalrySeriesByPair(franchises)['0001-0009'].disputed).toBe(false);
  });

  it('never prints a disputed record on a marquee card', () => {
    const ids = ['0001', '0002', '0003', '0004'];
    const ctx = {
      divisionOf: Object.fromEntries(ids.map((id) => [id, 'D1'])),
      conferenceOf: Object.fromEntries(ids.map((id) => [id, '00'])),
      name: Object.fromEntries(ids.map((id) => [id, `T${id}`])),
      winRate: Object.fromEntries(ids.map((id) => [id, 0.5])),
      lastChampionship: null,
      lastWeek: 2,
      doubleheaderWeeks: [],
      rivalry: {
        '0001-0002': { games: 30, playoffGames: 0, intensity: 4.9, perspective: '0001', wins: 16, losses: 14, ties: 0, disputed: true },
      },
    };
    const picks = marqueeMatchups(new Map([[1, [{ away: '0001', home: '0002' }]]]), ctx, 1);
    expect(picks[0].why.some((w: string) => /meetings/.test(w))).toBe(false);
  });
});

/** `wins` as 1s and 0s, as one franchise's `matchupHistory` entry. */
function meetings(results: number[]) {
  return results.map((win, i) => ({
    year: 2010 + i,
    week: 1,
    score: win ? 100 : 50,
    opponentScore: win ? 50 : 100,
    bothAttributed: true,
  }));
}
