/**
 * The TV home's drawer: which guides it links, and to which league's copy.
 *
 * A paired TV opens straight to the full-screen board (owner's call,
 * 2026-10-30), and the drawer on its right edge is where the leagues and the
 * guides live. A guide is served per LEAGUE (`/<league>/guides/<slug>`) and
 * only in the leagues it is tagged for, while a TV's owner may play in any
 * MFL league at all — so the link goes to the first of the owner's own
 * registry leagues that carries the guide, else the default league, else any
 * league that does. Never a league that would redirect it to an index.
 */
import rawGuides from '../data/guides.json';
import type { GuideEntry } from '../types/guides';
import { guideAppliesToLeague } from '../types/guides';
import { ALL_LEAGUES, DEFAULT_LEAGUE, crossHostLeagueHref, getLeagueBySlug } from '../config/leagues';
import type { LeagueDefinition } from '../config/leagues';

/** The guides the drawer offers, in the order it lists them. */
export const TV_HOME_GUIDES = ['tv-app', 'tv-score-overlay'] as const;

export interface TvGuideLink {
  slug: string;
  title: string;
  href: string;
}

const guides = rawGuides as GuideEntry[];

/** The league whose copy of a guide to open, or null when no league carries it. */
export function guideLeagueFor(guide: GuideEntry, ownSlugs: readonly string[]): LeagueDefinition | null {
  const own = ownSlugs.map((s) => getLeagueBySlug(s)).filter((l): l is LeagueDefinition => !!l);
  const candidates = [...own, DEFAULT_LEAGUE, ...ALL_LEAGUES];
  return candidates.find((l) => guideAppliesToLeague(guide, l.navSlug)) ?? null;
}

/**
 * Links for the drawer, each one a path that works from THIS host
 * (`crossHostLeagueHref`: on the shared app host a league it no longer serves
 * leaves for its own domain). A guide no league carries is left out.
 */
export function tvGuideLinks(ownSlugs: readonly string[], hostname: string): TvGuideLink[] {
  const out: TvGuideLink[] = [];
  for (const slug of TV_HOME_GUIDES) {
    const guide = guides.find((g) => g.slug === slug && g.visibility !== 'admin');
    if (!guide) continue;
    const league = guideLeagueFor(guide, ownSlugs);
    if (!league) continue;
    out.push({ slug, title: guide.title, href: crossHostLeagueHref(hostname, `/${league.slug}/guides/${slug}`) });
  }
  return out;
}

/** The MFL Football TV app adds this to its WebView's user agent (MainActivity's UA_SUFFIX). */
export function isTvApp(userAgent: string | null | undefined): boolean {
  return /\bMFLLiveTV\//.test(userAgent ?? '');
}
