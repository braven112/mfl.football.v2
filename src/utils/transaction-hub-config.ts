/**
 * Transaction Hub — the SSR half of its config.
 *
 * The hub is mounted in TheLeagueLayout, so this runs on EVERY page render.
 * That constraint is the whole shape of this file: it reads the checked-in
 * league configs (free, already bundled) and the session cookie, and it does
 * no MFL round-trip. The two live things the hub shows — the waiver order's
 * numbers and the owner's filed claims — are fetched client-side when the
 * owner actually opens that screen, because neither is worth an MFL read in
 * front of a page load for a visitor who may never click the bell.
 *
 * WHAT IS SSR AND WHY: the team names and icons. They are static per league
 * year, and the icons must be SITE-RELATIVE paths (`/assets/...`) because the
 * generated dark-variant stylesheet keys on the exact `img` src — an
 * MFL-hosted absolute URL would render the light mark in dark mode. See
 * docs/claude/rules/theming-and-assets.md.
 *
 * SCOPING IS NOT DECORATION. Both leagues have a franchise `0001`, so a
 * session is only usable here once its `leagueId` matches the league whose
 * page is being rendered — otherwise a TheLeague owner browsing the AFL would
 * see an AFL team highlighted as "You". Same reasoning as
 * src/utils/rankings-scope.ts.
 *
 * The AFL scopes further, to the owner's own CONFERENCE: priority is contested
 * per conference there, and MFL's flat league-wide number is a lie about a
 * National owner's odds (src/utils/waiver-order.ts). An owner peeking at the
 * other conference still sees their own line.
 */

import { getLeagueBySlug } from '../config/leagues';
import {
  getConferenceName,
  getConferenceTeams,
  getFranchiseConference,
} from './afl-conference';
import theLeagueConfig from '../data/theleague.config.json';
import { leagueUsesWaiverPriority } from './waiver-system';
import type { WaiverPriorityRenderTeam } from './waiver-priority-render';

export interface TransactionHubConfig {
  /** A session that belongs to THIS league and names a franchise. */
  signedIn: boolean;
  /** The viewer's franchise, highlighted in the order. Null when signed out. */
  franchiseId: string | null;
  /** e.g. "American League". Empty for a league with no conference split. */
  conferenceName: string;
  /** The teams the viewer actually competes with for claims, in config order. */
  teams: WaiverPriorityRenderTeam[];
  /**
   * Whether a waiver PRIORITY ORDER exists in this league at all — read from
   * MFL's `currentWaiverType`, never from the slug. TheLeague is BBID_FCFS and
   * has no priority order; MFL still serves it a `waiverSortOrder`, but it is
   * a default nobody set and nothing reads. False hides the row AND the screen,
   * rather than showing a queue that does not decide anything.
   */
  showWaiverPriority: boolean;
  /** Where "manage your claims" sends an owner — claims are read-only here. */
  freeAgentsPath: string;
}

/**
 * Signed-out / wrong-league shell: the hub still renders, the waiver screens
 * gate. Explicitly typed rather than `as const` — a const assertion makes
 * `teams` a `readonly []`, which is not assignable to the mutable array the
 * config declares.
 *
 * `showWaiverPriority` is omitted deliberately: it is a property of the
 * LEAGUE, not of the viewer, so every caller supplies it and none of them can
 * accidentally inherit a `false` from here.
 */
const SIGNED_OUT: Omit<TransactionHubConfig, 'freeAgentsPath' | 'showWaiverPriority'> = {
  signedIn: false,
  franchiseId: null,
  conferenceName: '',
  teams: [],
};

export function buildTransactionHubConfig(
  leagueSlug: string,
  authUser: { franchiseId?: string | null; leagueId?: string | null } | null,
  freeAgentsPath: string,
  leagueYear: number,
): TransactionHubConfig {
  const league = getLeagueBySlug(leagueSlug);
  const franchiseId = authUser?.franchiseId || null;

  // Asked once, for signed-in and signed-out alike: whether the league runs a
  // priority order is a property of the LEAGUE, not of who is looking. A
  // signed-out visitor to a blind-bid league must not be shown a sign-in gate
  // promising a spot in a line that does not exist.
  const showWaiverPriority = leagueUsesWaiverPriority(leagueSlug, leagueYear);

  // The session must name THIS league. A franchise id alone proves nothing —
  // both leagues have an 0001.
  const inThisLeague = !!league && !!franchiseId && authUser?.leagueId === league.id;
  if (!inThisLeague) return { ...SIGNED_OUT, freeAgentsPath, showWaiverPriority };

  if (leagueSlug === 'afl-fantasy') {
    const conf = getFranchiseConference(franchiseId);
    // A franchise the AFL config does not place in a conference has no line to
    // stand in; gate rather than guess one.
    if (!conf) return { ...SIGNED_OUT, freeAgentsPath, showWaiverPriority };
    return {
      signedIn: true,
      franchiseId,
      conferenceName: getConferenceName(conf),
      teams: getConferenceTeams(conf).map((t) => ({
        franchiseId: t.franchiseId,
        name: t.nameMedium || t.name,
        icon: t.icon,
      })),
      freeAgentsPath,
      showWaiverPriority,
    };
  }

  // TheLeague: one pool, no conference split, so the whole league is the line.
  return {
    signedIn: true,
    franchiseId,
    conferenceName: '',
    teams: (theLeagueConfig.teams ?? []).map((t: any) => ({
      franchiseId: t.franchiseId,
      name: t.nameMedium || t.name,
      icon: t.icon,
    })),
    freeAgentsPath,
    showWaiverPriority,
  };
}
