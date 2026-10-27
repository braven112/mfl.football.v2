/**
 * Compile-time contract for the app's waivers (package L).
 *
 * `MflLiveAppWaivers` (packages/shared-types/src/mfl-live-app-l.ts) is what
 * the phone's Waivers screen and add/drop sheet read; `MflLiveAppWaiversView`
 * is what `GET /api/mfl-live/waivers` sends. If a field the app reads is
 * renamed or retyped on the server, the assignment below stops type-checking
 * and `pnpm test:types` fails, instead of the app breaking on an owner's
 * phone. Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppWaivers } from '../../packages/shared-types/src/mfl-live-app-l';
import type { MflLiveAppWaiversView } from '../utils/live/mfl-live-app-waivers';

export type MflLiveAppLContract = MflLiveAppWaiversView extends MflLiveAppWaivers ? true : never;
export const mflLiveAppLContract: MflLiveAppLContract = true;
