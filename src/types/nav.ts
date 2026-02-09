/**
 * Navigation Types
 *
 * TypeScript interfaces for the unified navigation drawer component.
 * These types define the structure for nav links, sections, and configuration.
 *
 * Used by:
 * - src/config/nav-config.json (link definitions)
 * - src/components/nav/*.astro (nav components)
 * - src/utils/nav-utils.ts (visibility and routing logic)
 */

/**
 * Supported league identifiers
 */
export type LeagueSlug = 'theleague' | 'afl';

/**
 * Link visibility modes
 * - 'public': Visible to all users
 * - 'owner': Only visible when myteam cookie is set
 * - 'admin': Only visible to users whose franchise ID is in adminFranchiseIds
 */
export type NavLinkVisibility = 'public' | 'owner' | 'admin';

/**
 * Icon identifier - maps to icons in the SVG sprite
 * Example: 'banknote' -> /assets/icons/sprite.svg#icon-banknote
 */
export type NavIconId = string;

/**
 * Individual navigation link
 */
export interface NavLink {
  /** Unique identifier for this link */
  id: string;

  /** Display label (used for TheLeague unless labelAFL is provided) */
  label: string;

  /** Optional AFL-specific label override */
  labelAFL?: string;

  /** Icon identifier from SVG sprite */
  icon: NavIconId;

  /** Optional AFL-specific icon override */
  iconAFL?: NavIconId;

  /**
   * Internal path (relative to league root)
   * Example: '/rosters' -> /theleague/rosters or /afl-fantasy/rosters
   */
  path?: string;

  /**
   * External URL (full URL)
   * Use this OR path, not both
   */
  url?: string;

  /**
   * URL template with placeholders
   * Supports: {host}, {year}, {leagueId}
   * Example: 'https://{host}/{year}/home/{leagueId}'
   */
  urlTemplate?: string;

  /** Whether this link opens in a new tab */
  external?: boolean;

  /** Badge count (for notifications) - optional */
  badge?: number;

  /** Visibility restriction */
  visibility?: NavLinkVisibility;

  /** Restrict to specific league only */
  leagueOnly?: LeagueSlug;

  /** Whether this link is currently active/selected */
  isActive?: boolean;

  /** Optional description for tooltips in collapsed mode */
  description?: string;
}

/**
 * Navigation section (group of links)
 */
export interface NavSection {
  /** Unique identifier for this section */
  id: string;

  /** Section heading label */
  label: string;

  /** Links within this section */
  links: NavLink[];

  /** Visibility restriction for entire section */
  visibility?: NavLinkVisibility;

  /** Restrict section to specific league */
  leagueOnly?: LeagueSlug;

  /** Whether section is collapsible (future feature) */
  collapsible?: boolean;

  /** Whether section starts collapsed (future feature) */
  defaultCollapsed?: boolean;
}

/**
 * Footer link configuration
 * Typically for external links like "Back to MFL"
 */
export interface NavFooterLink {
  /** Unique identifier */
  id: string;

  /** Display label */
  label: string;

  /** Icon identifier */
  icon: NavIconId;

  /** URL template with placeholders */
  urlTemplate?: string;

  /** Static URL */
  url?: string;

  /** Whether this link opens in a new tab */
  external?: boolean;
}

/**
 * Team information for authenticated users
 * Displayed in the nav footer when myteam cookie is set
 */
export interface NavTeamInfo {
  /** Franchise ID (e.g., '0001') */
  franchiseId: string;

  /** Team display name */
  teamName: string;

  /** Owner display name */
  ownerName: string;

  /** URL to team icon/logo */
  iconUrl?: string;

  /** Which league this team belongs to */
  league: LeagueSlug;
}

/**
 * Navigation drawer state
 */
export interface NavDrawerState {
  /** Whether the drawer is currently open */
  isOpen: boolean;

  /** Whether the drawer is in collapsed mode (icons only) */
  isCollapsed: boolean;

  /** Current league context */
  currentLeague: LeagueSlug;

  /** Currently authenticated team (if any) */
  team?: NavTeamInfo;
}

/**
 * Main navigation configuration
 * This is the shape of nav-config.json
 */
export interface NavConfig {
  /** All navigation sections */
  sections: NavSection[];

  /** Franchise IDs that have admin access */
  adminFranchiseIds: string[];

  /** Footer links (like "Back to MFL") */
  footerLinks: NavFooterLink[];

  /**
   * Route equivalence mapping for league switching
   * Maps paths from one league to another
   * Example: { '/salary': '/salary', '/calculator': '/calculator' }
   */
  routeEquivalence?: Record<string, string>;
}

/**
 * Props for the main NavDrawer component
 */
export interface NavDrawerProps {
  /** Current league context */
  league: LeagueSlug;

  /** MFL host for external links */
  host: string;

  /** Current year for MFL links */
  year: string | number;

  /** MFL league ID */
  leagueId: string;

  /** Current page path for active state */
  currentPath?: string;

  /** Initial collapsed state (from cookie) */
  initialCollapsed?: boolean;

  /** Team info if authenticated */
  team?: NavTeamInfo;
}

/**
 * Props for NavHeader component
 */
export interface NavHeaderProps {
  /** Current league */
  league: LeagueSlug;

  /** URL to league logo */
  logoUrl: string;
}

/**
 * Props for NavLinks component
 */
export interface NavLinksProps {
  /** Sections to render */
  sections: NavSection[];

  /** Current league for path construction */
  league: LeagueSlug;

  /** Current path for active state */
  currentPath?: string;

  /** Whether drawer is collapsed (icons only mode) */
  isCollapsed?: boolean;

  /** Franchise ID for visibility checks */
  franchiseId?: string;
}

/**
 * Props for NavFooter component
 */
export interface NavFooterProps {
  /** Team info (if authenticated) */
  team?: NavTeamInfo;

  /** Footer links to display */
  footerLinks: NavFooterLink[];

  /** MFL host for URL templates */
  host: string;

  /** Year for URL templates */
  year: string | number;

  /** League ID for URL templates */
  leagueId: string;

  /** Whether drawer is collapsed */
  isCollapsed?: boolean;

  /** Verify team URL (when not authenticated) */
  verifyTeamUrl?: string;
}

/**
 * Props for LeagueSwitcher component
 */
export interface LeagueSwitcherProps {
  /** Currently active league */
  currentLeague: LeagueSlug;

  /** Current page path for smart routing */
  currentPath: string;
}

/**
 * Props for NavToggleButton component
 */
export interface NavToggleButtonProps {
  /** Whether menu is currently open */
  isOpen?: boolean;

  /** Accessible label for the button */
  ariaLabel?: string;
}

/**
 * Utility type for resolved nav link
 * After URL templates are processed and league-specific values applied
 */
export interface ResolvedNavLink extends Omit<NavLink, 'path' | 'url' | 'urlTemplate'> {
  /** Final resolved URL (internal or external) */
  href: string;

  /** Resolved label (after AFL override applied) */
  label: string;

  /** Resolved icon (after AFL override applied) */
  icon: NavIconId;
}

/**
 * Cookie names used by the navigation system
 */
export const NAV_COOKIES = {
  /** Stores the user's franchise ID */
  MY_TEAM: 'myteam',

  /** Stores which league the team belongs to */
  MY_TEAM_LEAGUE: 'myteam-league',

  /** Stores user's preferred collapsed state */
  NAV_COLLAPSED: 'nav-collapsed',

  /** Stores last viewed league */
  NAV_LEAGUE: 'nav-league',

  /** Stores drawer open state (desktop only) */
  NAV_OPEN: 'nav-open',
} as const;

/**
 * Type for cookie names
 */
export type NavCookieName = (typeof NAV_COOKIES)[keyof typeof NAV_COOKIES];
