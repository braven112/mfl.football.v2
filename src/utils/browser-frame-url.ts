/**
 * Format the URL text shown in a browser-frame chrome bar: the league's apex
 * domain plus the link path with its league prefix stripped.
 *
 * Shared by BrowserFrameShot.astro (hero screenshots) and WhatsNewCard.tsx
 * (listing thumbnails) so the pill format can't drift. The prefix strip is
 * anchored — only a leading `/{slug}` segment is removed, so links that
 * merely contain the slug elsewhere (`/players/afl-fantasy-preview`) pass
 * through intact instead of being mangled.
 */
import type { LeagueDefinition } from '../config/leagues';

export function formatBrowserFrameUrl(league: LeagueDefinition, link?: string | null): string {
  if (!link) return league.domains[0];
  const prefix = `/${league.slug}`;
  const path =
    link === prefix ? '' : link.startsWith(`${prefix}/`) ? link.slice(prefix.length) : link;
  return `${league.domains[0]}${path}`;
}
