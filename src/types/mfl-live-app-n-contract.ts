/**
 * Compile-time contract for the app's league chat (package N).
 *
 * `MflLiveAppChatMessage` (packages/shared-types/src/mfl-live-app-n.ts) is what
 * the phone reads from `/api/mfl-live/chat`; `ChatMessageView` is what the
 * server builds. If a field the app reads is renamed or retyped on the server,
 * the assignment below stops type-checking and `pnpm test:types` fails,
 * instead of the app breaking on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppChatMessage } from '../../packages/shared-types/src/mfl-live-app-n';
import type { ChatMessageView } from '../utils/live/mfl-live-app-chat';

export type MflLiveAppChatContract = ChatMessageView extends MflLiveAppChatMessage ? true : never;
export const mflLiveAppChatContract: MflLiveAppChatContract = true;
