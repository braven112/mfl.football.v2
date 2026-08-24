/**
 * Shared frontmatter logic for the per-league owner detail routes.
 *
 * Astro only honours `return Astro.redirect(...)` from a PAGE's frontmatter.
 * Returning it from a nested component just stops rendering that component —
 * the response is still a 200, now with a blank body. That exact mistake
 * shipped when TheLeague's /cr page was extracted into a shared component and
 * unauthorized visitors got an empty page instead of a bounce.
 *
 * So this helper resolves the owner (and their slot neighbours) and hands back
 * either a redirect target or the render props. The thin route wrappers call
 * it, return the redirect if present, then render OwnerDetailPage.
 */
import type { AstroGlobal } from 'astro';
import type { Owner, OwnerTenuresFile } from '../types/owner-tenures';
import { resolveLeaguePath } from './nav-utils';
import { getLeagueBySlug } from '../config/leagues';
import type { CanonicalLeagueSlug } from '../config/leagues';

export type OwnerDetailResult =
  /** Unknown or renamed slug — the wrapper must `return Astro.redirect(redirectTo)`. */
  | { redirectTo: string; owner?: undefined }
  /** Resolved owner plus the neighbours the succession footer needs. */
  | {
      redirectTo?: undefined;
      owner: Owner;
      /** slug → the owner it names, for succession + cross-league links. */
      related: Record<string, Owner>;
    };

/**
 * Resolve an owner by slug, honouring `previousSlugs` with a redirect so an
 * old URL keeps working after a rename.
 */
export function resolveOwnerDetail(
  Astro: AstroGlobal,
  leagueSlug: CanonicalLeagueSlug,
  data: OwnerTenuresFile
): OwnerDetailResult {
  const league = getLeagueBySlug(leagueSlug)!;
  const hideLeaguePrefix = Astro.locals.hideLeaguePrefix ?? false;
  const indexPath = resolveLeaguePath(`/${league.slug}/owners`, hideLeaguePrefix);

  const slug = Astro.params.slug;
  if (!slug) return { redirectTo: indexPath };

  const owner = data.owners.find((o) => o.slug === slug);
  if (owner) {
    // Only the owners actually referenced by this page — succession
    // neighbours — so the render props stay small.
    const related: Record<string, Owner> = {};
    for (const succession of Object.values(owner.slotSuccession ?? {})) {
      for (const neighbour of [succession.previous, succession.next]) {
        if (!neighbour || related[neighbour]) continue;
        const found = data.owners.find((o) => o.slug === neighbour);
        if (found) related[neighbour] = found;
      }
    }
    return { owner, related };
  }

  // A renamed slug 301s to its current home rather than 404ing.
  const renamed = data.owners.find((o) => (o.previousSlugs ?? []).includes(slug));
  if (renamed) {
    return {
      redirectTo: resolveLeaguePath(`/${league.slug}/owners/${renamed.slug}`, hideLeaguePrefix),
    };
  }

  return { redirectTo: indexPath };
}

/** Career win percentage, formatted the way the franchise pages format it. */
export function ownerWinPct(owner: Owner): string {
  const { wins, losses, ties } = owner.totals;
  const games = wins + losses + ties;
  if (games === 0) return '—';
  return ((wins + ties / 2) / games).toFixed(3).replace(/^0/, '');
}

export function formatOwnerRecord(owner: Owner): string {
  const { wins, losses, ties } = owner.totals;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** "2007–2010", or "2016–present" for a tenure still running. */
export function formatOwnerYears(owner: Owner, currentSeasonYear: number): string {
  const end = owner.isCurrent || owner.yearEnd >= currentSeasonYear ? 'present' : owner.yearEnd;
  return owner.yearStart === end ? String(owner.yearStart) : `${owner.yearStart}–${end}`;
}
