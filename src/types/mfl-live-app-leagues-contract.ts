/**
 * Compile-time contract: what `/api/live-leagues` returns must still be
 * readable as what the mobile app's Leagues tab expects
 * (packages/shared-types/src/mfl-live-app-leagues.ts). A renamed or retyped
 * field fails `pnpm test:types` here instead of the app on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type {
  MflLiveAppLeagueChoice,
  MflLiveAppLeagues,
} from '../../packages/shared-types/src/mfl-live-app-leagues';
import type { MflLiveLeagueChoice } from '../utils/mfl-live-selection-store';

export type MflLiveAppLeaguesContract = MflLiveLeagueChoice extends MflLiveAppLeagueChoice
  ? { ok: true; leagues: MflLiveLeagueChoice[]; explicit: boolean } extends MflLiveAppLeagues
    ? true
    : never
  : never;
export const mflLiveAppLeaguesContract: MflLiveAppLeaguesContract = true;
