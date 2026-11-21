/**
 * Which injury posts may take the homepage hero as BREAKING news.
 *
 * Doc Rivers tags every rostered player's move to Out / IR / Suspended as
 * `tier: 'breaking'`, and the breaking-story hero takes any breaking post from
 * the last 48 hours — so every designation change in the league led the
 * homepage. Brandon's rule (Nov 2026): an injury is league-wide news only when
 * the player is a STAR (top 5 at his position); otherwise it leads the hero
 * only for the owner who rosters him. Signed-out visitors see stars only.
 * Non-injury breaking posts (trades, auction wins) are untouched.
 *
 * "Star" is the union of two public signals:
 *  - preseason CONSENSUS: average overall rank across the public built-in
 *    ranking sources (data/ranking-sources/<year>.json), top 5 per position;
 *  - this season's PRODUCTION: top 5 per position by YTD fantasy points in the
 *    league's own scoring (playerScores-ytd.json), so a breakout counts too.
 * Private sources (FantasyPros ECR, RSP) must never feed this — it is public.
 */

export const STAR_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export const STAR_TOP_N = 5;

/**
 * The public built-in sources that make up "consensus". Redraft ranks and ADP
 * only: dynasty trade values (FantasyCalc) rank youth, and superflex ranks
 * inflate QBs, so neither describes "who is a star this season".
 */
export const CONSENSUS_SOURCE_IDS = ['mfl-adp', 'sharks', 'sleeper-adp', 'espn'] as const;

interface RankedSource {
  id?: string;
  players?: Array<{ id?: string | number; rank?: number }>;
}

/**
 * Average overall rank per player across the consensus sources. A player a
 * source does not list is ranked just past that source's last entry, so a
 * player listed by one source alone cannot ride a single high rank.
 */
export function consensusRanks(sources: readonly RankedSource[] | null | undefined): Map<string, number> {
  const picked = (sources ?? []).filter(
    (s) => s && (CONSENSUS_SOURCE_IDS as readonly string[]).includes(String(s.id)) && Array.isArray(s.players) && s.players.length > 0,
  );
  if (picked.length === 0) return new Map();
  const perSource = picked.map((s) => {
    const m = new Map<string, number>();
    for (const p of s.players!) {
      const rank = Number(p?.rank);
      if (p?.id == null || !Number.isFinite(rank) || rank <= 0) continue;
      m.set(String(p.id), rank);
    }
    return m;
  });
  const ids = new Set<string>();
  for (const m of perSource) for (const id of m.keys()) ids.add(id);
  const out = new Map<string, number>();
  for (const id of ids) {
    let sum = 0;
    for (const m of perSource) sum += m.get(id) ?? m.size + 1;
    out.set(id, sum / perSource.length);
  }
  return out;
}

function topPerPosition(
  scored: Iterable<[string, number]>,
  positionOf: (id: string) => string | undefined,
  better: (a: number, b: number) => number,
  topN: number,
): string[] {
  const byPos = new Map<string, Array<[string, number]>>();
  for (const [id, value] of scored) {
    const pos = positionOf(id);
    if (!pos || !(STAR_POSITIONS as readonly string[]).includes(pos)) continue;
    const list = byPos.get(pos);
    if (list) list.push([id, value]);
    else byPos.set(pos, [[id, value]]);
  }
  const out: string[] = [];
  for (const list of byPos.values()) {
    list.sort((a, b) => better(a[1], b[1]) || a[0].localeCompare(b[0]));
    for (const [id] of list.slice(0, topN)) out.push(id);
  }
  return out;
}

export interface StarInputs {
  /** MFL player id → position (QB/RB/WR/TE/…). */
  positionOf: (id: string) => string | undefined;
  /** `sources` array of data/ranking-sources/<seasonYear>.json. */
  rankingSources?: readonly RankedSource[] | null;
  /** `playerScores.playerScore` of playerScores-ytd.json. */
  ytdScores?: ReadonlyArray<{ id?: string | number; score?: string | number }> | null;
  topN?: number;
}

/** Top-N-at-position players by preseason consensus OR by YTD points. */
export function computeStarPlayerIds({ positionOf, rankingSources, ytdScores, topN = STAR_TOP_N }: StarInputs): Set<string> {
  const stars = new Set<string>();
  const consensus = consensusRanks(rankingSources);
  for (const id of topPerPosition(consensus, positionOf, (a, b) => a - b, topN)) stars.add(id);

  const ytd: Array<[string, number]> = [];
  for (const row of ytdScores ?? []) {
    const score = Number(row?.score);
    if (row?.id == null || !Number.isFinite(score) || score <= 0) continue;
    ytd.push([String(row.id), score]);
  }
  for (const id of topPerPosition(ytd, positionOf, (a, b) => b - a, topN)) stars.add(id);
  return stars;
}

export interface BreakingViewer {
  /** The viewer's franchise in THIS league (session-scoped), or null. */
  franchiseId: string | null | undefined;
  starIds: ReadonlySet<string>;
  /**
   * Who rosters a player NOW, as a list (an AFL player is routinely rostered
   * in both conferences). Optional: without it, the post's own
   * `franchiseIds` — the owner when Doc filed it — decide.
   */
  ownersOf?: (playerId: string) => readonly string[];
}

/**
 * May this breaking post lead the hero for this viewer? Non-injury posts
 * always may; an injury post only when the viewer owns the player or the
 * player is a star.
 */
export function isBreakingPostForViewer(post: any, viewer: BreakingViewer): boolean {
  if (post?.type !== 'injury') return true;
  const playerIds: string[] = Array.isArray(post.playerIds) ? post.playerIds.map(String) : [];
  if (playerIds.some((id) => viewer.starIds.has(id))) return true;
  const fid = viewer.franchiseId ? String(viewer.franchiseId) : '';
  if (!fid) return false;
  const franchiseIds: string[] = Array.isArray(post.franchiseIds) ? post.franchiseIds.map(String) : [];
  if (franchiseIds.includes(fid)) return true;
  return !!viewer.ownersOf && playerIds.some((id) => viewer.ownersOf!(id).map(String).includes(fid));
}
