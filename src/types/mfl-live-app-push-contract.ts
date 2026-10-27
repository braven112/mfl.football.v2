/**
 * Compile-time contract: what the server sends and stores for app push must
 * still be what `apps/mobile` expects (packages/shared-types/src/mfl-live-app-push.ts).
 * Nothing imports this file; it exists to be checked by `pnpm test:types`.
 */

import type {
  MflLiveAppPushChannelId,
  MflLiveAppPushData,
} from '../../packages/shared-types/src/mfl-live-app-push';
import type { ExpoPushMessage } from '../utils/push-expo';
import type { NotificationGroupId } from '../config/notification-categories';

// Every settings group must have an Android channel the app creates.
export type MflLiveAppPushChannelContract = NotificationGroupId extends MflLiveAppPushChannelId
  ? true
  : never;
export const mflLiveAppPushChannelContract: MflLiveAppPushChannelContract = true;

export type MflLiveAppPushDataContract = ExpoPushMessage['data'] extends MflLiveAppPushData
  ? true
  : never;
export const mflLiveAppPushDataContract: MflLiveAppPushDataContract = true;
