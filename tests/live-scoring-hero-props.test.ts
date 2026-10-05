/**
 * The homepage live hero's builder (src/utils/live-scoring-hero-props.ts) and
 * the UNPLAYED week: MFL answers one with every franchise at 0.00 and no
 * starters (docs/claude/rules/live-scoring.md), and so does the custom-site
 * demo's stand-in once the calendar has moved past the week its data stops
 * at. Drawn, that was a board of 0.00 marked FINAL on the demo's homepages;
 * the builder now hands back nothing and the homepage keeps its normal hero.
 */
import { describe, expect, it } from 'vitest';
import { buildLiveScoringHeroProps } from '../src/utils/live-scoring-hero-props';
import type { LiveScoringPayload } from '../src/utils/live-scoring-source';

const teams = [
  { franchiseId: '0001', name: 'One' },
  { franchiseId: '0002', name: 'Two' },
];

const payload = (over: Partial<LiveScoringPayload>): LiveScoringPayload => ({
  ok: true,
  week: 4,
  scores: { '0001': 0, '0002': 0 },
  remaining: { '0001': 0, '0002': 0 },
  matchups: [{ home: '0001', away: '0002' }],
  players: {},
  bench: {},
  playersYetToPlay: { '0001': 0, '0002': 0 },
  ...over,
});

const build = (data: LiveScoringPayload) =>
  buildLiveScoringHeroProps({ league: 'theleague', week: 4, teams, loadImpl: async () => data });

describe('the live hero and an unplayed week', () => {
  it('draws no board for a week with pairings, no starters and no points', async () => {
    expect(await build(payload({}))).toBeUndefined();
  });

  it('still draws a week whose starters have not scored yet (before kickoff, or 0-0)', async () => {
    const hero = await build(
      payload({
        players: { '0001': [{ id: '1', score: 0, status: 'starter' } as never] },
        remaining: { '0001': 3600, '0002': 3600 },
      }),
    );
    expect(hero?.matchups).toHaveLength(1);
  });

  it('still draws a week where someone has scored', async () => {
    expect(await build(payload({ scores: { '0001': 12.5, '0002': 0 } }))).toBeDefined();
  });

  it('keeps an empty week (no pairings at all) as the empty board it was', async () => {
    expect(await build(payload({ matchups: [], scores: {}, remaining: {} }))).toBeDefined();
  });

  it('still falls back on an upstream failure', async () => {
    expect(await build(payload({ ok: false }))).toBeUndefined();
  });
});
