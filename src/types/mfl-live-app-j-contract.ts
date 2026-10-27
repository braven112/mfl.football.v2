/**
 * Compile-time contract for the app's Set Lineup screen (package J).
 *
 * `MflLiveAppLineup` (packages/shared-types/src/mfl-live-app-j.ts) is what the
 * phone reads; `loadAppLineup` (src/utils/live/mfl-live-app-lineup.ts) is what
 * `/api/mfl-live/lineup` sends. If a field the app reads is renamed or retyped
 * on the server, the assignment below stops type-checking and
 * `pnpm test:types` fails, instead of the app breaking on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppLineup } from '../../packages/shared-types/src/mfl-live-app-j';
import type { buildAppLineupView } from '../utils/live/mfl-live-app-lineup';

type ServerLineupView = ReturnType<typeof buildAppLineupView>;

export type MflLiveAppJContract = ServerLineupView extends MflLiveAppLineup ? true : never;
export const mflLiveAppJContract: MflLiveAppJContract = true;
