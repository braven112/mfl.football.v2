/**
 * Guides — reading side.
 *
 * Mirrors whats-new-entries.ts: registry-scoped, admin-gated, fails closed on
 * an untagged guide. Kept deliberately small — guides.json is one flat file
 * with no archive, because a guide is edited rather than superseded.
 */
import rawGuides from '../data/guides.json';
import type { GuideEntry } from '../types/guides';
import { guideAppliesToLeague } from '../types/guides';
import type { LeagueSlug } from '../types/whats-new';
import { getAuthUser, isCommissionerOrAdmin } from './auth';
import { resolveLeaguePath } from './nav-utils';
import { getLeagueBySlug } from '../config/leagues';
import type { CanonicalLeagueSlug } from '../config/leagues';
import type { AstroGlobal } from 'astro';

const allGuides = rawGuides as GuideEntry[];

/** Every guide, unfiltered. For tests and admin surfaces only. */
export function getAllGuides(): GuideEntry[] {
  return allGuides;
}

/**
 * Guides visible in this league to this reader, newest edit first.
 *
 * Sorted by `updated` rather than by hand so a guide that gets a real revision
 * surfaces again — the index is a shelf, and the recently-touched belongs at
 * eye level.
 */
export function getVisibleGuides(request: Request, league: LeagueSlug): GuideEntry[] {
  const user = getAuthUser(request);
  const isAdmin = !!user && isCommissionerOrAdmin(user);
  return allGuides
    .filter((g) => guideAppliesToLeague(g, league))
    .filter((g) => g.visibility !== 'admin' || isAdmin)
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

/** One guide by slug, subject to the same visibility rules. */
export function getVisibleGuide(
  request: Request,
  league: LeagueSlug,
  slug: string | undefined,
): GuideEntry | null {
  if (!slug) return null;
  return getVisibleGuides(request, league).find((g) => g.slug === slug) ?? null;
}

export type GuideDetailResult =
  /** Unknown slug — the wrapper must `return Astro.redirect(redirectTo)`. */
  | { redirectTo: string; guide?: undefined }
  /** Resolved guide, ready to render. */
  | { redirectTo?: undefined; guide: GuideEntry };

/**
 * Shared frontmatter for the per-league guide detail routes.
 *
 * Exists for the same reason `resolveWhatsNewDetail` does: the redirect for an
 * unknown slug must run at the PAGE level, so this resolves and hands back
 * either a redirect target or the guide, and the thin wrapper does the
 * returning. It also translates the CANONICAL slug the wrapper knows
 * (`afl-fantasy`) into the navSlug the data is tagged with (`afl`) — a
 * distinction every caller otherwise has to remember, and one that silently
 * hides every guide when it is got wrong.
 */
export function resolveGuideDetail(
  Astro: AstroGlobal,
  leagueSlug: CanonicalLeagueSlug,
): GuideDetailResult {
  const league = getLeagueBySlug(leagueSlug)!;
  const guide = getVisibleGuide(Astro.request, league.navSlug, Astro.params.slug);
  if (!guide) {
    return {
      redirectTo: resolveLeaguePath(
        `/${league.slug}/guides`,
        Astro.locals.hideLeaguePrefix ?? false,
      ),
    };
  }
  return { guide };
}
