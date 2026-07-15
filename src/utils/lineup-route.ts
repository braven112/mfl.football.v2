/**
 * Lineup route factory — one implementation for the per-league lineup API.
 *
 * Phase 2 registry sweep: api/lineup.ts and api/afl-fantasy/lineup.ts were
 * 92% identical, differing only in a hardcoded MFL league id and which
 * year-rollover function they called. Both are now thin instantiations of
 * this factory.
 *
 * League identity is pinned per ROUTE PATH, not resolved from the session's
 * leagueId. That preserves the pre-merge invariant "the endpoint writes to
 * the league whose page calls it": /theleague/lineup gates only on
 * franchiseId (not session league), so a dual-league owner holding an AFL
 * session can legitimately submit a TheLeague lineup through /api/lineup.
 * Session-based resolution would silently retarget that write into the AFL
 * league — a cross-league lineup overwrite. The year clock comes from the
 * registry via getLeagueYearForSlug (TheLeague Feb 14, AFL June 1 — see
 * CLAUDE.md "Year rollover — two independent clocks").
 *
 * GET  ?week=N → { week, rosters } for the session user's franchise
 * POST {week, starters[9]} → submits lineup to MFL with the owner's cookie
 * (never commish credentials).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from './auth';
import { mflFetch } from './mfl-fetch';
import { getLeagueYearForSlug } from './league-year';
import { getCurrentWeekForYear } from './current-week';
import { buildMflExportUrl } from './mfl-url';
import { json } from './api-response';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';

export function createLineupRoute(slug: CanonicalLeagueSlug): { GET: APIRoute; POST: APIRoute } {
  const league = getLeagueBySlug(slug);
  if (!league) throw new Error(`createLineupRoute: unknown league slug '${slug}'`);

  const POST: APIRoute = async ({ request }) => {
    try {
      const user = getAuthUser(request);
      if (!user?.id) return json({ error: 'Authentication required. Please sign in.' }, 401);
      if (!user.franchiseId) return json({ error: 'No franchise associated with your account.' }, 403);

      const body = await request.json();
      const { week, starters } = body as { week?: number; starters?: string[] };

      const weekNum = typeof week === 'number' ? Math.floor(week) : NaN;
      if (isNaN(weekNum) || weekNum < 1 || weekNum > 22 || !Array.isArray(starters) || starters.length !== 9) {
        return json({ error: 'Invalid lineup: must provide week (1-22) and exactly 9 starter IDs.' }, 400);
      }

      // Validate all IDs are numeric strings (MFL player IDs)
      if (starters.some((id) => !/^\d+$/.test(id))) {
        return json({ error: 'Invalid player IDs in lineup.' }, 400);
      }

      const year = getLeagueYearForSlug(league.slug);
      const starterList = starters.join(',');

      // MFL lineup import endpoint
      const url = `https://api.myfantasyleague.com/${year}/import`;
      const postBody = `TYPE=lineup&L=${league.id}&W=${weekNum}&STARTERS=${starterList}`;

      const response = await mflFetch({
        url,
        method: 'POST',
        mflUserCookie: user.id,
        body: postBody,
        timeoutMs: 15_000,
      });

      const text = await response.text();

      // MFL returns XML: <status>OK</status> on success, <error>msg</error> on failure
      if (text.includes('<error>')) {
        const errorMsg = text.match(/<error>(.*?)<\/error>/)?.[1] || 'Unknown MFL error';
        console.error('[lineup] MFL submit error:', errorMsg);
        return json({ error: `MFL: ${errorMsg}` }, 422);
      }

      if (text.includes('<status>OK</status>') || text.includes('>OK<')) {
        return json({ success: true, message: 'Lineup submitted successfully.' });
      }

      // Unexpected response
      console.warn('[lineup] Unexpected MFL response:', text.slice(0, 500));
      return json({ error: 'Unexpected response from MFL. Your lineup may or may not have been saved.' }, 500);
    } catch (error) {
      console.error('[lineup] Submit error:', error);
      return json({ error: 'Internal server error. Please try again.' }, 500);
    }
  };

  const GET: APIRoute = async ({ request }) => {
    try {
      const user = getAuthUser(request);
      if (!user?.id) return json({ error: 'Authentication required.' }, 401);
      if (!user.franchiseId) return json({ error: 'No franchise.' }, 403);

      const year = getLeagueYearForSlug(league.slug);

      const url = new URL(request.url);
      const weekParam = url.searchParams.get('week');
      const week = weekParam ? parseInt(weekParam, 10) : getCurrentWeekForYear(year);

      if (isNaN(week) || week < 1 || week > 22) {
        return json({ error: 'Invalid week.' }, 400);
      }

      // Fetch rosters from MFL to get current starters
      const rostersUrl = buildMflExportUrl({
        type: 'rosters',
        leagueId: league.id,
        year,
        params: { FRANCHISE: user.franchiseId },
      });
      const rostersRes = await mflFetch({
        url: rostersUrl,
        method: 'GET',
        mflUserCookie: user.id,
        timeoutMs: 10_000,
      });
      const rostersData = await rostersRes.json();

      return json({ week, rosters: rostersData });
    } catch (error) {
      console.error('[lineup] GET error:', error);
      return json({ error: 'Failed to fetch lineup data.' }, 500);
    }
  };

  return { GET, POST };
}
