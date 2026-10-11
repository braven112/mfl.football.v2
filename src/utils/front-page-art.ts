/**
 * One franchise's art for the front-page style (src/components/shared/
 * front-page/): the theme-following icon for cards and lists, plus the
 * gradient and crest for the surfaces that are dark in both themes. Shared by
 * the homepage adapter and the header's score strip so both draw a team the
 * same way.
 */
import type { FrontTeamArt } from '../components/shared/front-page/types';
import { resolveHeroFranchiseBackdrop } from './hero-franchise-backdrop';
import { crestLeagueKey } from './dark-surface-crest';

export interface ArtTeam {
  franchiseId: string;
  name: string;
  icon?: string;
}

export function frontTeamArt(team: ArtTeam, leagueSlug: string, href: string, record?: string): FrontTeamArt {
  const backdrop = resolveHeroFranchiseBackdrop(team as never, crestLeagueKey(leagueSlug));
  return {
    franchiseId: team.franchiseId,
    name: team.name,
    icon: team.icon ?? '',
    gradient: backdrop?.gradient ?? 'var(--hero-ink)',
    crest: backdrop?.crest ?? team.icon ?? '',
    crestFilter: backdrop?.crestFilter,
    round: backdrop?.crestRound ?? false,
    href,
    record,
  };
}
