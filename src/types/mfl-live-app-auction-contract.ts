/**
 * Compile-time contract for the app's auction room (package R, step 3).
 *
 * `MflLiveAppAuctionRoom` (packages/shared-types/src/mfl-live-app-auction.ts)
 * is what the phone reads; `readMflLiveAuction` is what `/api/mfl-live/auction`
 * sends. If a field the app reads is renamed or retyped on the server, the
 * assignment below stops type-checking and `pnpm test:types` fails, instead of
 * the app breaking on an owner's phone. Nothing imports this file; it exists to
 * be checked.
 */

import type { MflLiveAppAuctionRoom } from '../../packages/shared-types/src/mfl-live-app-auction';
import type { readMflLiveAuction } from '../utils/live/mfl-live-auction';

type SentRoom = NonNullable<Awaited<ReturnType<typeof readMflLiveAuction>>>;
export type MflLiveAppAuctionContract = SentRoom extends MflLiveAppAuctionRoom ? true : never;
export const mflLiveAppAuctionContract: MflLiveAppAuctionContract = true;
