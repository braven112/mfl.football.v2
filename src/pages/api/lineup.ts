/**
 * Lineup API — GET (fetch lineup data) & POST (submit lineup) for the
 * default league (TheLeague).
 *
 * GET  /api/lineup?week=12  → returns LineupPayload JSON
 * POST /api/lineup          → submits lineup to MFL
 *
 * Phase 2 registry sweep: thin instantiation of createLineupRoute — see
 * src/utils/lineup-route.ts for the shared implementation this and
 * api/afl-fantasy/lineup.ts now share, and for why the league is pinned per
 * route path rather than resolved from the session.
 */

import { createLineupRoute } from '../../utils/lineup-route';
import { DEFAULT_LEAGUE_SLUG } from '../../config/leagues';

export const { GET, POST } = createLineupRoute(DEFAULT_LEAGUE_SLUG);
