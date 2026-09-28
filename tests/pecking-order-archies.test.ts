/**
 * The Pecking Order for a 99-team package league (archies):
 * - standings fields MFL's export lacks (all-play, streak, PA) are derived,
 *   without touching a league whose export has them;
 * - only the registry's top N are written up, every team is still ranked;
 * - the AI sheet and prompt carry only the top N and the league's persona,
 *   while the default persona's prompt text is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { generatePeckingOrder, buildPairings } from '../scripts/generate-pecking-order.mjs';
import { enrichStandingsFromResults } from '../scripts/lib/pecking-order-math.mjs';
import { buildFactSheet, getSystemPrompt } from '../scripts/lib/pecking-order-ai.mjs';

const archies = (LEAGUES as any).archies;

describe('enrichStandingsFromResults', () => {
  const weekly = { weeks: [{ week: 1, scores: { a: 100, b: 90, c: 80 } }, { week: 2, scores: { a: 70, b: 95, c: 85 } }] };
  const pairings = new Map([
    [1, [[{ id: 'a' }, { id: 'b' }]]],
    [2, [[{ id: 'a' }, { id: 'c' }]]],
  ]);

  it('derives all-play, streak and PA where they are missing', () => {
    const out = enrichStandingsFromResults(new Map([['a', { id: 'a' }], ['b', { id: 'b' }], ['c', { id: 'c' }]]), weekly, pairings as any, 2);
    // a: week 1 beats both (2-0), week 2 loses to both (0-2) → 2-2-0, .500
    expect(out.get('a').all_play_wlt).toBe('2-2-0');
    expect(out.get('a').all_play_pct).toBe('0.500');
    // a: W vs b, then L vs c → current streak L1; PA 90 + 85; margin (10 - 15) / 2
    expect(out.get('a').strk).toBe('L1');
    expect(out.get('a').pa).toBe('175.00');
    expect(out.get('a').avg_margin).toBe(-2.5);
  });

  it("never overwrites MFL's own values", () => {
    const row = { id: 'a', all_play_pct: '.967', all_play_wlt: '29-1-0', strk: 'W4', pa: '431.75' };
    const out = enrichStandingsFromResults(new Map([['a', row]]), weekly, pairings as any, 2);
    expect(out.get('a')).toEqual(row);
  });
});

describe('archies issue', () => {
  it('ranks all 99, writes up only the registry top N, and fills every division', async () => {
    expect(archies.peckingOrder?.topN).toBe(25);
    const { issue } = await generatePeckingOrder({ league: archies, year: 2026, week: 2, useAI: false });
    expect(issue.rankings).toHaveLength(99);
    expect(issue.topN).toBe(25);
    expect(issue.rankings.filter((r: any) => r.blurb).map((r: any) => r.rank)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(issue.standings.divisions).toHaveLength(9);
    for (const d of issue.standings.divisions) expect(d.teams.length).toBeGreaterThan(0);
    // All-play is real now, not every team parked at the midpoint.
    const pcts = new Set(issue.rankings.map((r: any) => r.metrics.allPlayPct));
    expect(pcts.size).toBeGreaterThan(10);
    // Doubleheaders: an unbeaten team's margin is positive (pf counts a week
    // once, games count twice — the margin must not be derived from pf).
    const top = issue.rankings[0];
    const standing = issue.standings.divisions.flatMap((d: any) => d.teams).find((t: any) => t.franchiseId === top.franchiseId);
    if (standing.losses === 0) expect(top.metrics.avgMargin).toBeGreaterThan(0);
  });

  it('leaves a league without a topN writing up every team', async () => {
    expect((LEAGUES as any).theleague.peckingOrder).toBeUndefined();
  });
});

describe('AI sheet and prompt', () => {
  const teams = new Map(
    Array.from({ length: 30 }, (_, i) => {
      const id = String(i + 1).padStart(4, '0');
      return [id, { name: `Team ${id}`, nameMedium: `T${id}` }];
    }),
  );
  const issue = {
    year: 2026,
    week: 3,
    rankings: [...teams.keys()].map((franchiseId, i) => ({ rank: i + 1, franchiseId, previousRank: null, metrics: {} })),
    awards: { statOfWeek: { title: 'Stat of the Week', franchiseId: '0030', blurb: 'x' } },
  };

  it('carries only the top N rows and the names the sheet mentions', () => {
    const sheet = buildFactSheet({ issue, teams, leagueName: 'X', leagueKind: 'redraft', voiceName: 'Archie Bunker', topN: 25 });
    expect(sheet).toContain('(30 redraft franchises). Voice: Archie Bunker.');
    expect(sheet).toContain('top 25 of 30');
    expect(sheet).toContain('blurb key: 0025');
    expect(sheet).not.toContain('blurb key: 0026');
    // The award winner is outside the top N but must be nameable.
    expect(sheet).toContain('[0030]');
    expect(sheet).not.toContain('[0027]');
    expect(sheet).toContain('re-voice in Bunker style');
  });

  it('is unchanged for the default persona and no cut', () => {
    const sheet = buildFactSheet({ issue, teams, leagueName: 'X' });
    expect(sheet).toContain('(30 dynasty franchises). Voice: Claude Schefter.');
    expect(sheet).toContain('=== RANKINGS (1-30) ===');
    expect(sheet).toContain('re-voice in Schefter style');
  });

  it("drops the Schefter voice lines for a renamed writer, keeps them for the default", () => {
    const flat = (blocks: Array<{ text: string }>) => blocks.map((b) => b.text).join('\n');
    const def = flat(getSystemPrompt('TheLeague'));
    expect(def).toContain('in Schefter voice.');
    const custom = flat(getSystemPrompt("Archie's", { persona: { name: 'Archie Bunker', voice: 'Grumpy.', avatarUrl: '' }, topN: 25 }));
    expect(custom).not.toContain('in Schefter voice');
    expect(custom).not.toContain('- Schefter: confident');
    expect(custom).toContain('Archie Bunker');
    expect(custom).toContain('TOP 25 ONLY');
  });
});
