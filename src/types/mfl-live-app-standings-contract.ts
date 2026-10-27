/**
 * Compile-time contract: the standings the server builds must still be
 * readable as the standings the mobile app expects.
 *
 * `MflLiveAppStandings` (packages/shared-types/src/mfl-live-app-standings.ts)
 * is the subset of `/api/live-standings?source=mfl` that `apps/mobile`
 * renders. If a field the app reads is renamed or retyped here on the site,
 * the assignment below stops type-checking and `pnpm test:types` fails,
 * instead of the app breaking on an owner's phone. Nothing imports this file;
 * it exists to be checked.
 */

import type { MflLiveAppStandings } from '../../packages/shared-types/src/mfl-live-app-standings';
import type { MflLiveStandings } from '../utils/live/mfl-live-standings';

/** What the endpoint answers in store mode: the assembly plus its `ok` flag. */
type MflLiveStandingsResponse = MflLiveStandings & { ok: boolean };

export type MflLiveAppStandingsContract = MflLiveStandingsResponse extends MflLiveAppStandings
  ? true
  : never;
export const mflLiveAppStandingsContract: MflLiveAppStandingsContract = true;
