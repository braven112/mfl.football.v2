/**
 * The AFL's homepage hero, stated in terms of the shared league hero.
 *
 * The AFL's hero tests were written against `resolveAflHeroState` before the
 * AFL moved onto `resolveLeagueHeroState` (src/utils/league-hero/). They pin
 * AFL behaviour, and still should — this is the one place that says how the
 * AFL's old input names map onto the shared resolver's: the viewer's
 * conference IS their player pool.
 */
import { resolveLeagueHeroState } from '../../src/utils/league-hero/resolver';
import { gameDayPreviewSlotView as sharedGameDayView, type SlotContext } from '../../src/utils/league-hero/views';
import { getLeagueHeroProfile, heroPath } from '../../src/utils/league-hero/profiles';
import type { LeagueHeroResolverInput, LeagueHeroState } from '../../src/utils/league-hero/types';
import { castLeagueHeroModel, type LeagueCastingInput } from '../../src/utils/league-hero/casting';

export type AflHeroResolverInput = Omit<LeagueHeroResolverInput, 'league' | 'userPoolId'> & {
  /** The viewer's conference ("00" = AL, "01" = NL) — their player pool. */
  userConferenceId?: '00' | '01';
};

export function resolveAflHeroState(input: AflHeroResolverInput): LeagueHeroState {
  const { userConferenceId, ...rest } = input;
  return resolveLeagueHeroState({ ...rest, league: 'afl-fantasy', userPoolId: userConferenceId });
}

/** The AFL's Saturday / Sunday-morning slot card, from the old flat context. */
export function gameDayPreviewSlotView(ctx: Omit<SlotContext, 'env'> & { now: Date }) {
  const { now, ...rest } = ctx;
  const profile = getLeagueHeroProfile('afl-fantasy');
  return sharedGameDayView({ ...rest, env: { profile, now, p: heroPath('afl-fantasy') } });
}

/** The AFL's hero casting — the shared caster, for the AFL. */
export function castAflHeroModel(state: LeagueHeroState, input: Omit<LeagueCastingInput, 'league'>) {
  return castLeagueHeroModel(state, { ...input, league: 'afl-fantasy' });
}
export type AflCastingInput = Omit<LeagueCastingInput, 'league'>;

/** What an AFL calendar id means to the hero (its AFL profile's role map). */
export function aflEventRole(eventId: string) {
  const match = getLeagueHeroProfile('afl-fantasy').roleOf?.({ definition: { id: eventId } } as never);
  return match?.role ?? 'champion-crowned';
}

/**
 * The AFL's two conference-draft pills, by conference, from the shared
 * pool-draft state (the AFL's pools are its conferences: 00 = AL, 01 = NL).
 */
export function aflPoolDraft(state: LeagueHeroState) {
  if (state.kind !== 'calendar-event' || !state.poolDraft) return undefined;
  const byId = (id: string) => state.poolDraft!.pools.find((p) => p.id === id)!;
  return { al: byId('00'), nl: byId('01'), userConference: state.poolDraft.userPool };
}
