/**
 * Compile-time contract: the board the server builds must still be readable
 * as the board the mobile app expects.
 *
 * `MflLiveAppBoard` (packages/shared-types/src/mfl-live-app.ts) is the subset
 * of `MflLiveBoard` that `apps/mobile` renders. If a field the app reads is
 * renamed or retyped here on the site, the assignment below stops
 * type-checking and `pnpm test:types` fails, instead of the app breaking on
 * an owner's phone. Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppBoard } from '../../packages/shared-types/src/mfl-live-app';
import type { MflLiveBoard } from './mfl-live';

export type MflLiveAppContract = MflLiveBoard extends MflLiveAppBoard ? true : never;
export const mflLiveAppContract: MflLiveAppContract = true;
