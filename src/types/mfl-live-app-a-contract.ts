/**
 * Compile-time contract for the app's Matchups board (package A).
 *
 * `MflLiveAppLiveBoard` (packages/shared-types/src/mfl-live-app-a.ts) is what
 * the phone's Matchups screen reads; `MflLiveAppBoardView` is what
 * `/api/live-board?source=mfl` sends. If a field the app reads is renamed or
 * retyped on the server, the assignment below stops type-checking and
 * `pnpm test:types` fails, instead of the app breaking on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppLiveBoard } from '../../packages/shared-types/src/mfl-live-app-a';
import type { MflLiveAppBoardView } from '../utils/live/mfl-live-app-view';

export type MflLiveAppAContract = MflLiveAppBoardView extends MflLiveAppLiveBoard ? true : never;
export const mflLiveAppAContract: MflLiveAppAContract = true;
