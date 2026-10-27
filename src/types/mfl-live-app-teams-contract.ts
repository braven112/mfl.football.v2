/**
 * Compile-time contract for the app's league and team switcher (package F2).
 *
 * `MflLiveAppMyTeam` (packages/shared-types/src/mfl-live-app-teams.ts) is what
 * the phone reads from `/api/mfl-live/my-teams`; `OwnerLeague` is what the
 * server builds it from. If a field the app reads is renamed or retyped on
 * the server, the assignment below stops type-checking and `pnpm test:types`
 * fails, instead of the app breaking on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppMyTeam } from '../../packages/shared-types/src/mfl-live-app-teams';
import type { OwnerLeague } from '../utils/live/owner-league';

export type MflLiveAppTeamsContract = OwnerLeague extends MflLiveAppMyTeam ? true : never;
export const mflLiveAppTeamsContract: MflLiveAppTeamsContract = true;
