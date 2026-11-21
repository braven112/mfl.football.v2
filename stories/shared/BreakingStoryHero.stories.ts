import BreakingStoryHero from '../../src/components/shared/BreakingStoryHero.astro';

/**
 * The breaking-story hero: a fresh (<48h) trade, or an injury the viewer
 * should care about, leads the homepage. TheLeague and the AFL both render it.
 *
 * WHICH story reaches it is decided before render (`resolveViewerBreakingStory`):
 * a non-star's injury only leads the hero of an owner who rosters him, a
 * top-5-at-position star's leads everyone's. This component only draws it.
 *
 * Offline on purpose: the headshot is an inline data-URI silhouette and the
 * player is a free agent (`FA`), so no ESPN cutout or logo is fetched
 * (docs/claude/rules/storybook.md). The reference date is pinned so the
 * "N HRS AGO" eyebrow cannot drift between snapshots.
 */
const FACE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsbD0nbm9uZScvPjxjaXJjbGUgY3g9JzEwMCcgY3k9JzcyJyByPSc0MicgZmlsbD0nI2NmZDRkYScvPjxwYXRoIGQ9J00yMCAyMDBjMC00NiAzNi03NCA4MC03NHM4MCAyOCA4MCA3NHonIGZpbGw9JyNjZmQ0ZGEnLz48L3N2Zz4=';

const REFERENCE = new Date('2026-11-21T18:00:00Z');

export default {
  title: 'Shared/BreakingStoryHero',
  component: BreakingStoryHero,
  parameters: { layout: 'padded' },
  args: {
    league: 'theleague',
    model: { mflId: '17001', name: 'Ted Hurst', position: 'WR', nflTeam: 'FA', headshot: FACE, descriptor: 'Breaking' },
    story: {
      id: 'inj_story',
      playerIds: ['17001'],
      headline: 'Ted Hurst (FA) → Injured Reserve',
      summary: 'Confirmed: Ted Hurst (WR) → Injured Reserve. Hamstring. This changes lineup calculations across the league.',
      franchiseId: '0003',
      timestampMs: REFERENCE.getTime() - 3 * 3_600_000,
    },
    resolveLeaguePath: (path: string) => path,
    referenceDate: REFERENCE,
  },
  argTypes: {
    league: { control: 'inline-radio', options: ['theleague', 'afl-fantasy'] },
  },
};

/** TheLeague: the CTA opens the owning team's roster. */
export const TheLeagueInjury = {};

/** The AFL: the same card under its own persona's tag. */
export const AflInjury = {
  args: { league: 'afl-fantasy' },
};

/** No owning franchise: the CTA falls back to the league's news page. */
export const NoRoster = {
  args: { story: { id: 'x', playerIds: ['17001'], headline: 'Breaking news', summary: '', timestampMs: REFERENCE.getTime() - 20 * 60_000 } },
};
