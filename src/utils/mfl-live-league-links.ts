/**
 * The MFL Live menu's "League sites" links: the signed-in owner's OWN MFL
 * leagues, not a fixed list of the leagues this project runs.
 *
 * A league in the registry links to this site's page for it (via `leagueUrl`,
 * so it resolves to the league's own apex, or the shared host for a league
 * with none, like Best Ball). Any other league links to its MFL home page.
 * Best Ball is included on purpose: its site is draft-only, but it is still
 * the owner's league, and our site is where it lives.
 *
 * Signed out there is nothing to list, so the caller passes no leagues and the
 * menu drops the section.
 */
import { ALL_LEAGUES, getLeagueById, leagueUrl, type LeagueDefinition } from '../config/leagues';
import type { MyLeague } from './my-leagues';

export interface MflLiveLeagueLink {
  name: string;
  href: string;
}

/**
 * The league's home page on MFL. Built with `new URL`, never by joining
 * strings. With no host from `myleagues`, MFL's `www` host redirects to the
 * league's own server.
 */
export function mflLeagueHomeUrl(leagueId: string, year: number, host: string | null): string {
  return new URL(`/${year}/home/${encodeURIComponent(leagueId)}`, host ?? 'https://www.myfantasyleague.com').href;
}

/**
 * Registered leagues first, in registry order (the owner's leagues on this
 * site), then every other league by name. MFL returns `myleagues` in a
 * nondeterministic order, so it is never the display order.
 *
 * `sessionLeagueId` is unioned in when `myleagues` missed it, because the
 * session proves the owner is in that league.
 */
export function buildMflLiveLeagueLinks(
  myLeagues: readonly MyLeague[],
  year: number,
  sessionLeagueId?: string | null,
): MflLiveLeagueLink[] {
  const registered: { league: LeagueDefinition; link: MflLiveLeagueLink }[] = [];
  const other: MflLiveLeagueLink[] = [];
  const seen = new Set<string>();

  const add = (id: string, name: string, host: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const league = getLeagueById(id);
    if (league) {
      registered.push({ league, link: { name: league.name, href: leagueUrl(league, '/') } });
    } else {
      other.push({ name: name || `League ${id}`, href: mflLeagueHomeUrl(id, year, host) });
    }
  };

  for (const l of myLeagues) add(l.id, l.name, l.host);
  if (sessionLeagueId && getLeagueById(sessionLeagueId)) add(sessionLeagueId, '', null);

  registered.sort((a, b) => ALL_LEAGUES.indexOf(a.league) - ALL_LEAGUES.indexOf(b.league));
  other.sort((a, b) => a.name.localeCompare(b.name));
  return [...registered.map((r) => r.link), ...other];
}
