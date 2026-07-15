/**
 * Shared frontmatter logic for the per-league What's New detail routes.
 *
 * The redirect for an unknown entry id must run at the page level (Astro only
 * honors `return Astro.redirect(...)` from a page's frontmatter, not from a
 * nested component), so this helper resolves the entry / adjacency and hands
 * back either a redirect target or the render props. The thin route wrappers
 * call it, return the redirect if present, then render WhatsNewDetailPage.
 */
import type { AstroGlobal } from 'astro';
import type { WhatsNewEntry } from '../types/whats-new';
import { getVisibleWhatsNewEntries } from './whats-new-entries';
import { getAdjacentEntries } from './whats-new-helpers';
import { resolveLeaguePath } from './nav-utils';
import { getLeagueBySlug } from '../config/leagues';
import type { CanonicalLeagueSlug } from '../config/leagues';

export type WhatsNewDetailResult =
  /** Unknown id — the wrapper must `return Astro.redirect(redirectTo)`. */
  | { redirectTo: string; entry?: undefined }
  /** Resolved entry with prev/next adjacency. */
  | { redirectTo?: undefined; entry: WhatsNewEntry; prev: WhatsNewEntry | null; next: WhatsNewEntry | null };

export function resolveWhatsNewDetail(
  Astro: AstroGlobal,
  leagueSlug: CanonicalLeagueSlug
): WhatsNewDetailResult {
  const league = getLeagueBySlug(leagueSlug)!;
  const hideLeaguePrefix = Astro.locals.hideLeaguePrefix ?? false;

  const sorted = getVisibleWhatsNewEntries(Astro.request, league.navSlug);
  const id = Astro.params.id;
  const entry = sorted.find((e) => e.id === id);

  if (!entry) {
    return { redirectTo: resolveLeaguePath(`/${league.slug}/whats-new`, hideLeaguePrefix) };
  }

  const { prev, next } = getAdjacentEntries(sorted, entry.id);
  return { entry, prev, next };
}
