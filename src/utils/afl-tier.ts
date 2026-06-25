/**
 * AFL tier helpers.
 *
 * The AFL runs an all-play side competition split into two tiers —
 * Premier League and D-League — with promotion/relegation between them.
 * Keep the tier→logo mapping here so every call site derives the path
 * instead of hardcoding it (mirrors getConferenceLogo in afl-conference.ts).
 */

export type AflTier = 'Premier League' | 'D-League';

/**
 * Resolve the tier logo path (served from public/). Anything that isn't
 * "Premier League" falls back to the D-League mark.
 */
export function getTierLogo(tierName: string): string {
  return tierName === 'Premier League'
    ? '/assets/afl/premier.svg'
    : '/assets/afl/dleague.svg';
}
