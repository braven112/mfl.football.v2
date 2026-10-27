/**
 * Compile-time contract for league and team identity in the app (package E).
 *
 * `MflLiveAppIdentityBoard` (packages/shared-types/src/mfl-live-app-e.ts) is
 * what the phone reads for team colours and league logos;
 * `MflLiveAppBoardView` is what `/api/live-board?source=mfl` sends. If either
 * field is renamed or retyped on the server, the assignment below stops
 * type-checking and `pnpm test:types` fails, instead of the app quietly
 * falling back to its plain look on an owner's phone. Nothing imports this
 * file; it exists to be checked.
 */

import type { MflLiveAppIdentityBoard } from '../../packages/shared-types/src/mfl-live-app-e';
import type { MflLiveAppBoardView } from '../utils/live/mfl-live-app-view';

export type MflLiveAppEContract = MflLiveAppBoardView extends MflLiveAppIdentityBoard ? true : never;
export const mflLiveAppEContract: MflLiveAppEContract = true;
