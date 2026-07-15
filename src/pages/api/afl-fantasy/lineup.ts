/**
 * AFL Lineup API — GET (fetch lineup data) & POST (submit lineup), pinned
 * to the AFL league.
 *
 * Phase 2 registry sweep: api/lineup.ts and this file were 92% identical
 * (only the hardcoded league id and year-rollover function differed). Both
 * are now thin instantiations of createLineupRoute — see
 * src/utils/lineup-route.ts for the shared implementation and for why the
 * league is pinned per route path (this path always targets AFL, exactly
 * like the pre-merge route) rather than resolved from the session.
 */

import { createLineupRoute } from '../../../utils/lineup-route';

export const { GET, POST } = createLineupRoute('afl-fantasy');
