/**
 * Compile-time contract: every answer the TV approval can give is one the
 * mobile app's Pair a TV screen knows how to show.
 *
 * `approvePairing` (src/utils/broadcast-tv-pairing.ts) decides the outcome of
 * a real approval; `MflLiveAppPairTvResult`
 * (packages/shared-types/src/mfl-live-app-pair-tv.ts) is what the app
 * switches on. A new outcome added on the server stops this type-checking and
 * fails `pnpm test:types`, instead of reaching an owner's phone as an
 * unhandled string. The endpoint's own answers (`invalid`, `signed-out`, …)
 * are pinned by `tests/mfl-live-app-pair-tv.test.ts`.
 */

import type { MflLiveAppPairTvResult } from '../../packages/shared-types/src/mfl-live-app-pair-tv';
import type { ApproveResult } from '../utils/broadcast-tv-pairing';

export type MflLiveAppPairTvContract = ApproveResult extends MflLiveAppPairTvResult ? true : never;
export const mflLiveAppPairTvContract: MflLiveAppPairTvContract = true;
