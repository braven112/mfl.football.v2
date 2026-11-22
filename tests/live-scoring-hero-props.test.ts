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

/**
 * Throwback Week. The card drew from the homepage's own team list — today's
 * identity — so it showed present-day crests all week while the live board it
 * sits above wore the eras (Brandon, AFL homepage, 2026-11-22). It now asks the
 * same chokepoint the board does, `applyThrowbackToBoard`.
 */
describe('the live hero in Throwback Week', () => {
  const scored = payload({ scores: { '0001': 12.5, '0002': 3 } });
  const buildWith = (throwbackImpl: Parameters<typeof buildLiveScoringHeroProps>[0]['throwbackImpl']) =>
    buildLiveScoringHeroProps({
      league: 'theleague',
      week: 4,
      teams: [
        { franchiseId: '0001', name: 'One', nameShort: 'One', icon: '/today-1.png' },
        { franchiseId: '0002', name: 'Two', nameShort: 'Two', icon: '/today-2.png' },
      ],
      loadImpl: async () => scored,
      throwbackImpl,
    });

  it('wears each franchise’s era name and crest, together, when the week is a throwback', async () => {
    const hero = await buildWith(async () => ({
      active: true,
      preview: null,
      configTeams: [
        { franchiseId: '0001', name: 'Old One', nameShort: undefined, icon: '/era-1.png' },
        { franchiseId: '0002', name: 'Two', nameShort: 'Two', icon: '/today-2.png' },
      ] as never,
    }));
    expect(hero?.teams['0001']).toMatchObject({ name: 'Old One', icon: '/era-1.png' });
    // An era's short name is cleared, never left as today's beside an old crest.
    expect(hero?.teams['0001'].nameShort).toBeUndefined();
    expect(hero?.teams['0002']).toMatchObject({ name: 'Two', icon: '/today-2.png' });
  });

  it('keeps today’s identity outside Throwback Week', async () => {
    const hero = await buildWith(async ({ configTeams }) => ({ active: false, preview: null, configTeams }));
    expect(hero?.teams['0001']).toMatchObject({ name: 'One', icon: '/today-1.png' });
  });

  it('keeps today’s identity, and the card, when the era lookup fails', async () => {
    const hero = await buildWith(async () => {
      throw new Error('redis down');
    });
    expect(hero?.teams['0001']).toMatchObject({ name: 'One', icon: '/today-1.png' });
  });

  it('asks without a session or a preview, so a homepage never shows a try-before-save era', async () => {
    let seen: { authUser: unknown; preview: string | null } | null = null;
    await buildWith(async (opts) => {
      seen = { authUser: opts.authUser, preview: opts.searchParams.get('previewEra') };
      return { active: false, preview: null, configTeams: opts.configTeams };
    });
    expect(seen).toEqual({ authUser: null, preview: null });
  });
});
