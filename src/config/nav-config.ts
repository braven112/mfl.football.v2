/**
 * Navigation Configuration
 *
 * TypeScript wrapper for nav-config.json providing type-safe access
 * to navigation link definitions.
 *
 * Usage:
 * ```typescript
 * import { navConfig } from '../config/nav-config';
 *
 * // Access sections
 * navConfig.sections.forEach(section => { ... });
 *
 * // Check admin IDs
 * const isAdmin = isAdminFranchise(franchiseId, league);
 *
 * // Get footer links
 * navConfig.footerLinks.forEach(link => { ... });
 * ```
 */

import navConfigJson from './nav-config.json';
import type { NavConfig, NavSection, NavLink, NavFooterLink, LeagueSlug } from '../types/nav';

/**
 * Extended config interface to include verify team URL templates
 */
interface ExtendedNavConfig extends NavConfig {
  verifyTeamUrl: Record<LeagueSlug, string>;
}

/**
 * Typed navigation configuration
 */
export const navConfig: ExtendedNavConfig = navConfigJson as ExtendedNavConfig;

/**
 * Get all sections from the navigation config
 */
export function getAllSections(): NavSection[] {
  return navConfig.sections;
}

/**
 * Get a specific section by ID
 */
export function getSectionById(id: string): NavSection | undefined {
  return navConfig.sections.find(section => section.id === id);
}

/**
 * Get all links from a specific section
 */
export function getLinksBySectionId(sectionId: string): NavLink[] {
  const section = getSectionById(sectionId);
  return section?.links ?? [];
}

/**
 * Get a specific link by its ID (searches all sections)
 */
export function getLinkById(id: string): NavLink | undefined {
  for (const section of navConfig.sections) {
    const link = section.links.find(l => l.id === id);
    if (link) return link;
  }
  return undefined;
}

/**
 * Get the admin franchise IDs for one league. Admin status is league-scoped:
 * the same 4-digit franchise id belongs to different teams in each league.
 */
export function getAdminFranchiseIds(league: LeagueSlug = 'theleague'): string[] {
  return navConfig.adminFranchiseIds[league] ?? [];
}

/**
 * Check if a franchise ID is an admin — within the given league only.
 */
export function isAdminFranchise(
  franchiseId: string | null | undefined,
  league: LeagueSlug = 'theleague',
): boolean {
  if (!franchiseId) return false;
  return getAdminFranchiseIds(league).includes(franchiseId);
}

/**
 * Get footer links
 */
export function getFooterLinks(): NavFooterLink[] {
  return navConfig.footerLinks;
}

/**
 * Get route equivalence mapping
 */
export function getRouteEquivalence(): Record<string, string> {
  return navConfig.routeEquivalence ?? {};
}

/**
 * Get verify team URL template for a specific league
 */
export function getVerifyTeamUrlTemplate(league: LeagueSlug): string {
  return navConfig.verifyTeamUrl[league] ?? navConfig.verifyTeamUrl.theleague;
}
