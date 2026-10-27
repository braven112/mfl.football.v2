/**
 * Compile-time contract for the app's My Team page (package P).
 *
 * `MflLiveAppTeamPage` (packages/shared-types/src/mfl-live-app-team.ts) is what
 * the phone's My Team screen reads; `readMflLiveTeam` is what
 * `/api/mfl-live/team` sends. If a field the app reads is renamed or retyped on
 * the server, the assignment below stops type-checking and `pnpm test:types`
 * fails, instead of the app breaking on an owner's phone. Nothing imports this
 * file; it exists to be checked.
 */

import type { MflLiveAppTeamPage } from '../../packages/shared-types/src/mfl-live-app-team';
import type { readMflLiveTeam } from '../utils/live/mfl-live-team';

type Sent = NonNullable<Awaited<ReturnType<typeof readMflLiveTeam>>>;
export type MflLiveAppTeamContract = Sent extends MflLiveAppTeamPage ? true : never;
export const mflLiveAppTeamContract: MflLiveAppTeamContract = true;
