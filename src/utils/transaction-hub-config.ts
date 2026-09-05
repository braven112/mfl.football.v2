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
  /** Where "manage your claims" sends an owner — claims are read-only here. */
  freeAgentsPath: string;
}

/** Signed-out / wrong-league shell: the hub still renders, the waiver screens gate. */
const SIGNED_OUT: Omit<TransactionHubConfig, 'freeAgentsPath'> = {
  signedIn: false,
  franchiseId: null,
  conferenceName: '',
  teams: [],
};

export function buildTransactionHubConfig(
  leagueSlug: string,
  authUser: { franchiseId?: string | null; leagueId?: string | null } | null,
  freeAgentsPath: string,
): TransactionHubConfig {
  const league = getLeagueBySlug(leagueSlug);
  const franchiseId = authUser?.franchiseId || null;

  // The session must name THIS league. A franchise id alone proves nothing —
  // both leagues have an 0001.
  const inThisLeague = !!league && !!franchiseId && authUser?.leagueId === league.id;
  if (!inThisLeague) return { ...SIGNED_OUT, freeAgentsPath };

  if (leagueSlug === 'afl-fantasy') {
    const conf = getFranchiseConference(franchiseId);
    // A franchise the AFL config does not place in a conference has no line to
    // stand in; gate rather than guess one.
    if (!conf) return { ...SIGNED_OUT, freeAgentsPath };
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
  };
}
