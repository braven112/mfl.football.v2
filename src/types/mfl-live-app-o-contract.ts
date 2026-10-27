/**
 * Compile-time contract for the app's Transactions screen (package O).
 *
 * `MflLiveAppTransactionsFeed` (packages/shared-types/src/mfl-live-app-o.ts)
 * is what the phone reads; `buildTransactionsFeed` is what
 * `/api/mfl-live/transactions` sends. If a field the app reads is renamed or
 * retyped on the server, the assignment below stops type-checking and
 * `pnpm test:types` fails, instead of the app breaking on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppTransactionsFeed } from '../../packages/shared-types/src/mfl-live-app-o';
import type { buildTransactionsFeed } from '../utils/live/mfl-live-transactions';

export type MflLiveAppOContract = ReturnType<typeof buildTransactionsFeed> extends MflLiveAppTransactionsFeed
  ? true
  : never;
export const mflLiveAppOContract: MflLiveAppOContract = true;
