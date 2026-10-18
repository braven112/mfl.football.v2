/**
 * Client half of player search, shared by the header's inline search
 * (HeaderSearch.astro) and the /search page (SearchPage.astro), so both list
 * the same players and send a tap to the same place.
 *
 * The index is the prerendered file per league built by
 * src/utils/player-search-index.ts (/api/player-search/<league>.json). A
 * rostered player is one link per team holding him (an AFL player is often
 * held once in each conference) to that team's roster with his sheet up; a
 * free agent is one link to Free Agents, his sheet up
 * (src/utils/player-search-deeplink.ts opens it there).
 */
export interface SearchPlayer {
  id: string;
  name: string;
  pos: string;
  team: string;
  owners: string[];
}

export interface ClientPlayerIndex {
  teams: Record<string, string>;
  players: Array<SearchPlayer & { search: string; rank: number }>;
}

export interface PlayerLink {
  href: string;
  name: string;
  pos: string;
  /** "WR · BUF · Pacific Pigskins", or "… · Free agent". */
  detail: string;
  /** Full page load: TheLeague's roster wires its player sheet only on one. */
  reload: boolean;
}

/** Indexes per URL, kept across ClientRouter navigations. */
const indexes = new Map<string, Promise<ClientPlayerIndex>>();

export function loadPlayerIndex(url: string): Promise<ClientPlayerIndex> {
  let hit = indexes.get(url);
  if (!hit) {
    hit = fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { teams: Record<string, string>; players: SearchPlayer[] }) => ({
        teams: body.teams,
        // Rostered players first: they are who owners look up.
        players: body.players.map((p) => ({
          ...p,
          search: `${p.name} ${p.team} ${p.pos}`.toLowerCase(),
          rank: p.owners.length ? 0 : 1,
        })),
      }))
      // A failed load is not cached: the next search tries again.
      .catch((err) => { indexes.delete(url); throw err; });
    indexes.set(url, hit);
  }
  return hit;
}

const withParams = (href: string, params: Record<string, string>) =>
  `${href}${href.includes('?') ? '&' : '?'}${new URLSearchParams(params).toString()}`;

export function playerLinks(
  index: ClientPlayerIndex,
  player: SearchPlayer,
  hrefs: { rostersHref: string; freeAgentsHref: string },
): PlayerLink[] {
  const base = `${player.pos}${player.team && player.team !== 'FA' ? ` · ${player.team}` : ''}`;
  if (!player.owners.length) {
    return [{
      href: withParams(hrefs.freeAgentsHref, { player: player.id, q: player.name }),
      name: player.name,
      pos: player.pos,
      detail: `${base} · Free agent`,
      reload: false,
    }];
  }
  return player.owners.map((fid) => ({
    href: withParams(hrefs.rostersHref, { franchise: fid, player: player.id }),
    name: player.name,
    pos: player.pos,
    detail: `${base} · ${index.teams[fid] ?? 'Rostered'}`,
    // Through the ClientRouter, TheLeague's roster consumed ?player= before
    // its sheet was wired and opened nothing; a real load opens it.
    reload: true,
  }));
}
