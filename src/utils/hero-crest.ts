/**
 * The crest behind a composite hero — the FANTASY franchise's when one owns the
 * story, the cast player's NFL team otherwise.
 *
 * Every composite hero is about one of two things, and the watermark should say
 * which:
 *
 *   - A fantasy team's story — your bubble player on cut watch, your keeper
 *     cornerstone, the franchise that rostered the week's top scorer. The crest
 *     is that club's.
 *   - A player's story with no fantasy owner in it — the auction's best
 *     available, the rookies on the UDFA board, the opener's headliner. The
 *     crest is his NFL team's.
 *
 * "Owns the story" is the CALLER's answer, not this module's, and deliberately
 * so: only the hero knows whether its franchise is the viewer's own team, the
 * team over the roster limit, or the one that rostered the top scorer. Pass a
 * `franchiseId` when a club owns it and omit it when none does. In the AFL that
 * id should come from `resolveHeroFranchiseAccent`, which already answers the
 * harder question of WHICH franchise, given that the league rosters the same
 * player in both conferences.
 *
 * ARTWORK IS RESOLVED FOR A DARK SURFACE, server-side. A composite hero is a
 * deep-ink card in BOTH themes, so the site's `html.dark` crest machinery — the
 * `TeamIconDarkStyles` swap and its measured white stroke — never fires for a
 * light-theme reader looking at one. `resolveDarkSurfaceCrest` is the same call
 * the recap hero already made for the same reason; see dark-surface-crest.ts.
 */
import { getLeagueTeamBrands } from './league-team-brands';
import { resolveDarkSurfaceCrest } from './dark-surface-crest';
import { getNFLTeamLogo, isValidTeamCode } from './nfl-logo';
import type { CanonicalLeagueSlug } from '../config/leagues';

export interface HeroCrest {
  src: string;
  /** Inline outline filter, only ever set for a light franchise cut. */
  filter?: string;
  /** Which branch answered — for tests, and for a caption that names the mark. */
  kind: 'franchise' | 'nfl';
}

export interface HeroCrestInput {
  /** The club that owns this hero's story, or null/undefined when none does. */
  franchiseId?: string | null;
  league: CanonicalLeagueSlug;
  /** The cast player's NFL team code — the fallback mark. */
  nflTeam?: string | null;
}

/**
 * Resolve the watermark. Returns null only when neither branch can produce
 * artwork, and every caller treats that as "render no crest" rather than
 * substituting a league logo: a hero with no mark reads as clean, while a hero
 * wearing the wrong club's mark reads as broken.
 */
export function resolveHeroCrest({ franchiseId, league, nflTeam }: HeroCrestInput): HeroCrest | null {
  if (franchiseId) {
    const brand = getLeagueTeamBrands(league)[franchiseId];
    if (brand) {
      const art = resolveDarkSurfaceCrest(brand, league);
      if (art?.src) {
        return { src: art.src, ...(art.filter ? { filter: art.filter } : {}), kind: 'franchise' };
      }
    }
    // A franchise that owns the story but ships no artwork falls through to its
    // player's NFL mark rather than to nothing — the hero still gets a subject.
  }

  // VALIDATED, not just normalized: `normalizeTeamCode` passes any non-empty
  // string through uppercased, so a free agent's blank team or a junk code
  // would otherwise mint a doomed ESPN URL. The 404 handler would hide it, but
  // a request we know will fail is not worth making.
  if (!nflTeam || !isValidTeamCode(nflTeam)) return null;
  // The same call the panel board makes for its per-panel watermark, so the two
  // watermark surfaces on the site cannot drift to different NFL artwork.
  const src = getNFLTeamLogo(nflTeam);
  return src ? { src, kind: 'nfl' } : null;
}
