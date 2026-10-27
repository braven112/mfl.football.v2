/**
 * Compile-time contract for the app's draft room (package R).
 *
 * `MflLiveAppDraftRoom` / `MflLiveAppDraftPool`
 * (packages/shared-types/src/mfl-live-app-draft.ts) are what the phone's Draft
 * screen reads; `readMflLiveDraft` / `readMflLiveDraftPool` are what
 * `/api/mfl-live/draft` and `/api/mfl-live/draft-pool` send. If a field the app
 * reads is renamed or retyped on the server, the assignments below stop
 * type-checking and `pnpm test:types` fails, instead of the app breaking on an
 * owner's phone. Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppDraftPool, MflLiveAppDraftRoom } from '../../packages/shared-types/src/mfl-live-app-draft';
import type { readMflLiveDraft, readMflLiveDraftPool } from '../utils/live/mfl-live-draft';

type SentRoom = NonNullable<Awaited<ReturnType<typeof readMflLiveDraft>>>;
type SentPool = NonNullable<Awaited<ReturnType<typeof readMflLiveDraftPool>>>;
export type MflLiveAppDraftContract = SentRoom extends MflLiveAppDraftRoom
  ? SentPool extends MflLiveAppDraftPool
    ? true
    : never
  : never;
export const mflLiveAppDraftContract: MflLiveAppDraftContract = true;
