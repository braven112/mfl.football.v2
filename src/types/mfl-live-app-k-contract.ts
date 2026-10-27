/**
 * Compile-time contract for the app's Players tab and player card (package K).
 *
 * `packages/shared-types/src/mfl-live-app-k.ts` is what the phone reads; the
 * builders in `src/utils/live/mfl-players.ts` are what `/api/mfl-live/players`
 * and `/api/mfl-live/player` send. If either side drifts, the assignments
 * below stop type-checking and `pnpm test:types` fails. Nothing imports this.
 */

import type {
  MflLiveAppPlayerCardResponse,
  MflLiveAppPlayersResponse,
} from '../../packages/shared-types/src/mfl-live-app-k';
import type { buildPlayerCard, buildPlayerList } from '../utils/live/mfl-players';

type ListView = ReturnType<typeof buildPlayerList>;
type CardView = NonNullable<ReturnType<typeof buildPlayerCard>>;

export type MflLiveAppKContract = [ListView extends MflLiveAppPlayersResponse ? true : never, CardView extends MflLiveAppPlayerCardResponse ? true : never];
export const mflLiveAppKContract: MflLiveAppKContract = [true, true];
