/**
 * Compile-time contract: the league board the server builds must still be
 * readable as the league board the mobile app expects.
 *
 * `MflLiveAppLeagueBoard` (packages/shared-types/src/mfl-live-app-league-board.ts)
 * is the subset of `LiveBoard` that the app's league screen renders. If a
 * field it reads is renamed or retyped on the site, the assignment below stops
 * type-checking and `pnpm test:types` fails, instead of the app breaking on an
 * owner's phone. Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppLeagueBoard } from '../../packages/shared-types/src/mfl-live-app-league-board';
import type { LiveBoard } from './live';

export type MflLiveAppLeagueBoardContract = LiveBoard extends MflLiveAppLeagueBoard ? true : never;
export const mflLiveAppLeagueBoardContract: MflLiveAppLeagueBoardContract = true;
