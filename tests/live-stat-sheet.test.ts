/**
 * The live board's stat sheet: ESPN box score → MFL stat codes → a league's
 * own scoring rules → points per stat, reconciled to MFL's official total.
 *
 * Measured against real data before this shipped (2026 week 3): every
 * TheLeague row (500/500) and every AFL row (326/326) itemized to MFL's score
 * to the hundredth. What these pin is the set of shapes that got it there —
 * each case below was a miss on that census before it was fixed:
 *
 *  - `UY+KY` requires ANY part, not both — a kick returner with no punt
 *    returns lost his return yards (Malik Washington, 55 KR yds).
 *  - Two-point conversions live only in ESPN's play PROSE ("Dak Prescott Pass
 *    to CeeDee Lamb for Two-Point Conversion") — seven +2.00 misses in one week.
 *  - Each field goal is scored by its own length; the box score has only the
 *    longest.
 *
 * And the two honesty rules: a rule whose stat we cannot see is SKIPPED, not
 * scored at zero; and the sheet's total is MFL's, with the gap on one
 * "not itemized" line (Archie's league scores first downs, which no box score
 * breaks out per player).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRange,
  parsePoints,
  parseScoringRules,
  scorePlayerStats,
} from '../src/utils/live/scoring-rules';
import {
  boxScoreToMflStats,
  fieldGoalLength,
  parseBoxScore,
  parseTwoPointConversion,
} from '../src/utils/espn-game-detail';
import {
  clearScoringRulesCache,
  loadLeagueScoringRules,
} from '../src/utils/live/scoring-rules-source';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf-8'));

const theLeagueRules = parseScoringRules(fixture('mfl-rules-theleague.json'))!;
const outsideRules = parseScoringRules(fixture('mfl-rules-outside-league.json'))!;

describe('parsing MFL rules', () => {
  it('reads ranges, including a negative low end', () => {
    expect(parseRange('0-10')).toEqual([0, 10]);
    expect(parseRange('-50-999')).toEqual([-50, 999]);
    expect(parseRange('nonsense')).toBeNull();
  });

  it('reads per-unit, per-N-units and flat points', () => {
    expect(parsePoints('*.04')).toEqual({ kind: 'per', points: 0.04, every: 1 });
    expect(parsePoints('*-.6')).toEqual({ kind: 'per', points: -0.6, every: 1 });
    expect(parsePoints('*1/10')).toEqual({ kind: 'per', points: 1, every: 10 });
    expect(parsePoints('15')).toEqual({ kind: 'flat', points: 15, every: 1 });
    // Slash notation without the `*` is still per-unit (Archie's ".1/2.5").
    expect(parsePoints('.1/2.5')).toEqual({ kind: 'per', points: 0.1, every: 2.5 });
  });

  it('keeps every rule in a real outside league, including slash-notation ones', () => {
    const def = outsideRules.find((b) => b.positions.includes('Def'))!;
    expect(def.rules.find((r) => r.event.join('+') === 'UY')).toMatchObject({ kind: 'per', every: 2.5 });
  });

  it('splits combined events and multi-position blocks', () => {
    const skill = theLeagueRules.find((b) => b.positions.includes('QB'))!;
    expect(skill.positions).toEqual(['QB', 'RB', 'WR', 'TE', 'PK']);
    expect(skill.rules.some((r) => r.event.join('+') === 'UY+KY')).toBe(true);
  });

  it('a league with no published rules parses to null', () => {
    expect(parseScoringRules({ error: { $t: 'Error - No League Scoring Rules' } })).toBeNull();
  });
});

describe('scoring a line', () => {
  it('position-specific blocks stack on the shared one (TheLeague WR: 0.5 PPR)', () => {
    const s = scorePlayerStats({
      rules: theLeagueRules,
      position: 'WR',
      stats: { CC: 7, CY: 112, '#C': 1 },
      total: 20.7,
    });
    expect(s.lines.map((l) => [l.event, l.points])).toEqual([
      ['CC', 3.5],
      ['CY', 11.2],
      ['#C', 6],
    ]);
    expect(s.itemized).toBe(20.7);
    expect(s.unitemized).toBe(0);
  });

  it('every value carries its unit, so the column needs no "Value" heading', () => {
    const s = scorePlayerStats({
      rules: theLeagueRules,
      position: 'QB',
      stats: { PY: 186, '#P': 2, RA: 6, RY: 50, IN: 1 },
      total: 22.44,
    });
    expect(Object.fromEntries(s.lines.map((l) => [l.event, l.value]))).toMatchObject({
      PY: '186 yds',
      '#P': '2 TD',
      IN: '1 INT',
      RY: '50 yds',
    });
  });

  it('a combined event needs only ONE part (kick returns, no punt returns)', () => {
    const s = scorePlayerStats({
      rules: theLeagueRules,
      position: 'WR',
      stats: { '#K': 2, KY: 55 },
      total: 1.65,
    });
    expect(s.lines.find((l) => l.event === 'UY+KY')?.points).toBe(1.65);
    expect(s.unitemized).toBe(0);
  });

  it('scores each field goal by its own length, flat and per-yard rules adding', () => {
    // TheLeague: 3 flat for 0-30, ×0.1/yd for 31-99.
    const s = scorePlayerStats({
      rules: theLeagueRules,
      position: 'K', // rows say K; MFL's rules say PK
      stats: { EP: 3 },
      fgLengths: [28, 41, 53],
      total: 15.4,
    });
    const fg = s.lines.find((l) => l.event === 'FG')!;
    expect(fg.points).toBeCloseTo(3 + 4.1 + 5.3, 5);
    expect(fg.value).toBe('28, 41, 53 yds');
    expect(s.unitemized).toBe(0);
  });

  it('a stat ESPN does not report is skipped, never scored as zero', () => {
    // Archie's league scores first downs (FD) — not in a box score.
    const s = scorePlayerStats({
      rules: outsideRules,
      position: 'WR',
      stats: { CC: 2, CY: 32, TGT: 5 },
      total: 99,
    });
    expect(s.lines.some((l) => l.event === 'FD')).toBe(false);
    // …and the sheet still adds up to MFL's number.
    expect(s.itemized + s.unitemized).toBeCloseTo(99, 5);
    expect(s.unitemized).not.toBe(0);
  });

  it('a stat that did nothing and paid nothing is not listed', () => {
    const s = scorePlayerStats({
      rules: theLeagueRules,
      position: 'RB',
      stats: { RY: 40, '#R': 0, FL: 0 },
      total: 4,
    });
    expect(s.lines.map((l) => l.event)).toEqual(['RY']);
  });

  it('with no rules, lists the raw line unscored and claims no gap', () => {
    const s = scorePlayerStats({
      rules: null,
      position: 'WR',
      stats: { CC: 3, CY: 40 },
      total: 7,
    });
    expect(s.scored).toBe(false);
    expect(s.lines.every((l) => l.points === null)).toBe(true);
    expect(s.unitemized).toBe(0);
  });

  it('a rounding hair is agreement, not an unitemized line', () => {
    const s = scorePlayerStats({
      rules: theLeagueRules,
      position: 'QB',
      stats: { PY: 204 },
      total: 8.17,
    });
    expect(s.unitemized).toBe(0);
  });
});

describe('ESPN box score → MFL stat codes', () => {
  const lines = parseBoxScore(fixture('espn-game-summary.json'));
  const byName = (n: string) => boxScoreToMflStats(lines.find((l) => l.athleteName === n)!);

  it('maps passing, rushing and sacks', () => {
    const hurts = byName('Jalen Hurts');
    expect(hurts).toMatchObject({ PC: 19, PA: 23, INC: 4, PY: 152, '#P': 0, IN: 0, TSK: 1, TSY: 8, RA: 14, RY: 62, '#R': 2 });
  });

  it('maps receiving and kicking', () => {
    expect(byName('Saquon Barkley')).toMatchObject({ RY: 60, '#R': 1, CC: 4, CY: 24, TGT: 5 });
    expect(byName('Brandon Aubrey')).toMatchObject({ '#F': 2, '#A': 2, '#M': 0 });
  });

  it('a group the player never appeared in emits no codes', () => {
    expect('PY' in byName('Saquon Barkley')).toBe(false);
  });

  it('reads each made field goal from the scoring play', () => {
    expect(fieldGoalLength('FG', 'Brandon Aubrey 53 Yd Field Goal')).toBe(53);
    expect(fieldGoalLength('TD', 'Javonte Williams 1 Yd Rush (Brandon Aubrey Kick)')).toBeNull();
  });

  it('credits a two-point conversion from the play prose', () => {
    expect(
      parseTwoPointConversion(
        'Jake Ferguson 19 Yd pass from Dak Prescott (Dak Prescott Pass to CeeDee Lamb for Two-Point Conversion)',
      ),
    ).toEqual({ passer: 'Dak Prescott', receiver: 'CeeDee Lamb' });
    expect(
      parseTwoPointConversion('Bijan Robinson 3 Yd Rush (Bijan Robinson Run for Two-Point Conversion)'),
    ).toEqual({ rusher: 'Bijan Robinson' });
    expect(parseTwoPointConversion('Javonte Williams 1 Yd Rush (Brandon Aubrey Kick)')).toBeNull();
  });
});

describe('loading a league\'s rules', () => {
  beforeEach(() => clearScoringRulesCache());

  const ok = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('refuses a league id that is not digits, without fetching', async () => {
    const f = ok({});
    const r = await loadLeagueScoringRules('evil.example.com', '2026', f);
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('reads a league outside the registry through api.myfantasyleague.com', async () => {
    const f = ok(fixture('mfl-rules-outside-league.json'));
    const r = await loadLeagueScoringRules('54321', '2026', f);
    expect(r.ok).toBe(true);
    expect(String((f as any).mock.calls[0][0])).toMatch(/^https:\/\/api\.myfantasyleague\.com\/2026\/export\?TYPE=rules&L=54321/);
  });

  it('"No League Scoring Rules" is an answer (ok, rules null), and is cached', async () => {
    const f = ok({ error: { $t: 'Error - No League Scoring Rules' } });
    const a = await loadLeagueScoringRules('37610', '2026', f);
    const b = await loadLeagueScoringRules('37610', '2026', f);
    expect(a).toMatchObject({ ok: true, rules: null });
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('never caches a failed read', async () => {
    const html = vi.fn(async () => new Response('<html>busy</html>', { status: 200 })) as unknown as typeof fetch;
    expect((await loadLeagueScoringRules('10105', '2026', html)).ok).toBe(false);
    const good = ok(fixture('mfl-rules-outside-league.json'));
    expect((await loadLeagueScoringRules('10105', '2026', good)).ok).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
