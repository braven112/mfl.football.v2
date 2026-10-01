/**
 * The shared hero state, in the shape TheLeague's bespoke hero components
 * take (`HeroState`, src/types/hero-state.ts).
 *
 * TheLeague's ladder is the SHARED resolver's (resolver.ts, TheLeague's
 * profile in profiles.ts): the decision is made once, for every league. What
 * stays TheLeague's is how its phases LOOK — twenty components (the auction
 * and draft heroes, the tag showcase, the cut watch, the playoff round hero,
 * the matchup split…) and the enrichment that feeds them
 * (`enrichHeroState`), all written against `HeroState`. This is the one seam
 * between the two: a pure mapping, no decisions.
 */
import type { HeroState, DailySlot } from '../../types/hero-state';
import type { WhatsNewEntry } from '../../types/whats-new';
import type { WhatsNextTimeline } from '../../types/league-events';
import type { LeagueHeroState } from './types';
import { resolveLeagueHeroState } from './resolver';

export function toSeasonHeroState(
  state: LeagueHeroState,
  meta: { referenceDate: Date; testMode: boolean },
): HeroState {
  const resolvedBy = state.resolvedBy ?? state.kind;
  const base: HeroState['metadata'] = {
    gameWindow: null,
    isLive: false,
    referenceDate: meta.referenceDate,
    testMode: meta.testMode,
    resolvedBy,
  };

  switch (state.kind) {
    case 'trade-deadline':
      return {
        phase: 'trade-deadline',
        priority: 'P0++',
        metadata: base,
        tradeDeadlineProps: { deadlineMidnightPT: state.deadlineMidnightPT },
        fallbackHero: state.content,
      };
    case 'regular-season':
    case 'playoffs':
    case 'championship':
      return {
        phase: state.kind,
        priority: 'P0',
        slot: state.slot as DailySlot | undefined,
        metadata: {
          week: state.week,
          gameWindow: state.gameWindow ?? null,
          isLive: state.isLive ?? false,
          referenceDate: meta.referenceDate,
          testMode: meta.testMode,
          resolvedBy,
        },
      };
    case 'auction':
      return {
        phase: state.live ? 'auction-live' : 'auction-preview',
        priority: 'P0',
        metadata: base,
        auctionProps: { live: state.live, leagueYear: state.leagueYear },
      };
    case 'rookie-draft':
      return {
        phase: state.live ? 'draft-live' : 'draft-announced',
        priority: 'P0',
        metadata: base,
        draftProps: { live: state.live, leagueYear: state.leagueYear, draftStartFormatted: state.draftStartFormatted },
      };
    case 'breaking-story':
      return { phase: 'breaking-story', priority: 'P0', metadata: base };
    case 'league-phase':
      return { phase: state.phase, priority: state.priority, metadata: base, fallbackHero: state.content };
    case 'event':
      if (state.resolvedBy === 'scheduleReleaseTease') {
        return { phase: 'schedule-release', priority: state.priority, metadata: base, fallbackHero: state.content };
      }
      return fallbackState(state, base);
    case 'feature':
    case 'default':
    case 'calendar-event':
    default:
      return fallbackState(state, base);
  }
}

function fallbackState(state: LeagueHeroState, base: HeroState['metadata']): HeroState {
  const withView = state as Extract<LeagueHeroState, { kind: 'feature' | 'event' | 'default' }>;
  return {
    phase: 'offseason-fallback',
    priority: state.priority === 'P0++' ? 'P0' : state.priority,
    metadata: base,
    fallbackHero: state.content,
    eventView: withView.eventView,
    eventBordered: withView.eventBordered,
  };
}

/**
 * TheLeague's homepage hero, in its components' shape — the shared resolver
 * with TheLeague's profile, mapped through `toSeasonHeroState`.
 *
 * @param referenceDate - Current date (defaults to now, overridable via ?testDate)
 * @param testMode - Whether ?testDate was used
 * @param entries - What's New entries for the fallback (undefined: no fallback)
 * @param timeline - The What's Next timeline for the fallback (undefined: no fallback)
 * @param draftComplete - The rookie draft is finished (its window closes early)
 * @param hasBreakingStory - A fresh breaking-tier story with a castable player exists
 * @param rng - Injectable random source (0..1) for the per-visit coin flips
 * @param scheduleReleaseRevealed - This season's schedule reveal is already locked
 */
export function resolveHeroState(
  referenceDate?: Date,
  testMode: boolean = false,
  entries?: WhatsNewEntry[],
  timeline?: WhatsNextTimeline,
  draftComplete?: boolean,
  hasBreakingStory: boolean = false,
  rng: () => number = Math.random,
  scheduleReleaseRevealed: boolean = false,
): HeroState {
  const now = referenceDate ?? new Date();
  const state = resolveLeagueHeroState({
    league: 'theleague',
    referenceDate: now,
    testMode,
    whatsNewEntries: entries,
    timeline,
    draftComplete,
    hasBreakingStory,
    rng,
    scheduleReleaseRevealed,
    // TheLeague's calendar is its constitution (profile `clock`), not events.
    events: [],
  });
  return toSeasonHeroState(state, { referenceDate: now, testMode });
}
