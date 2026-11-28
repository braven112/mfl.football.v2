/**
 * Which league themes the MFL Football app may offer an account (store-app
 * plan decision 22). The colors are built from each league's website theme by
 * `scripts/build-app-league-themes.mjs`; this only joins them to the leagues
 * the account owns a team in.
 */

import themes from '../../data/mfl-live-app-league-themes.json';
import { getLeagueById } from '../../config/leagues';
import { appLeagueLogo } from './app-league-logo';

export interface AppLeagueThemeColors {
  ground?: string;
  card?: string;
  border?: string;
  field?: string;
  text?: string;
  muted?: string;
  accent?: string;
  onAccent?: string;
  accentText?: string;
}

export interface AppLeagueTheme {
  leagueId: string;
  slug: string;
  name: string;
  logo: string;
  colors: AppLeagueThemeColors;
}

const BY_SLUG = themes as Record<string, { theme: string; colors: AppLeagueThemeColors }>;

/**
 * One theme per league we run among `leagueIds`, in the order given, with
 * duplicates (two teams in one league) dropped. Any other league is skipped.
 */
export function appLeagueThemesFor(leagueIds: readonly string[]): AppLeagueTheme[] {
  const seen = new Set<string>();
  const out: AppLeagueTheme[] = [];
  for (const id of leagueIds) {
    const league = getLeagueById(id);
    const entry = league ? BY_SLUG[league.slug] : undefined;
    if (!league || !entry || seen.has(league.slug)) continue;
    seen.add(league.slug);
    out.push({
      leagueId: id,
      slug: league.slug,
      name: league.name,
      logo: appLeagueLogo(league.slug),
      colors: { ...entry.colors },
    });
  }
  return out;
}
