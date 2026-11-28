/**
 * Compile-time contract: what `/api/mfl-live/league-themes` builds must stay
 * readable as what the app expects
 * (packages/shared-types/src/mfl-live-app-themes.ts). A renamed or retyped
 * field fails `pnpm test:types` here instead of on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type { MflLiveAppLeagueTheme } from '../../packages/shared-types/src/mfl-live-app-themes';
import type { AppLeagueTheme } from '../utils/live/app-league-themes';

export type MflLiveAppThemesContract = AppLeagueTheme extends MflLiveAppLeagueTheme ? true : never;
export const mflLiveAppThemesContract: MflLiveAppThemesContract = true;
