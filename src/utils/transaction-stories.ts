/**
 * Schefter's story for a Transactions-page row.
 *
 * The page leads each move with the feed post Schefter wrote about it and
 * keeps MFL's record behind "See details". MFL rows carry no id, so the join
 * is by what both sides DO carry: the MFL timestamp (`sourceTimestamp` on the
 * post, `at` on the row) and the franchise — narrowed by player when a
 * blind-bid batch stamps several of one team's claims on the same second.
 *
 * Only real stories join: a post Schefter wrote (`storyVersion`, from
 * scripts/lib/schefter-move-story.mjs) or a trade, which has always gone
 * through the model. A bare template ("X claims WR Cooper, Darius") would just
 * repeat the record below it less precisely, so that row shows the record.
 *
 * Pure: posts in, a lookup out. The route owns the glob.
 */

import type { SchefterPost } from '../types/schefter';
import type { TransactionRow } from './mfl-transactions';
import { unwrapFeedModule, type LazyFeedGlob } from './mfl-feed-glob';

export type MoveStory = Pick<SchefterPost, 'id' | 'headline' | 'body' | 'analysis' | 'tier'>;

const ROSTER_SUBTYPES = new Set(['FREE_AGENT', 'AUCTION_WON']);

/** A post the page may lead a row with. */
export function isMoveStory(post: SchefterPost): boolean {
  if (post?.type !== 'transaction' || !post.sourceTimestamp) return false;
  if (post.transactionSubType === 'TRADE') return true;
  return ROSTER_SUBTYPES.has(String(post.transactionSubType)) && (Number(post.storyVersion) || 0) > 0;
}

const keyOf = (seconds: string | number, franchiseId: string) => `${seconds}|${franchiseId}`;

export interface StoryIndex {
  get(row: TransactionRow): MoveStory | null;
  size: number;
}

export function indexMoveStories(posts: SchefterPost[]): StoryIndex {
  const byKey = new Map<string, SchefterPost[]>();
  let size = 0;
  for (const post of posts) {
    if (!isMoveStory(post)) continue;
    size += 1;
    for (const fid of post.franchiseIds ?? []) {
      const key = keyOf(post.sourceTimestamp!, fid);
      byKey.set(key, [...(byKey.get(key) ?? []), post]);
    }
  }

  return {
    size,
    get(row) {
      const seconds = Math.round(row.at / 1000);
      const isTrade = row.kind === 'trade';
      const candidates = (byKey.get(keyOf(seconds, row.franchiseId)) ?? []).filter(
        (p) => (p.transactionSubType === 'TRADE') === isTrade,
      );
      if (candidates.length <= 1) return candidates[0] ?? null;
      // Several of one team's moves on one second: the post must name this
      // row's players. Ambiguity shows the record, never a guess.
      const rowPlayers = new Set([...row.added, ...row.dropped]);
      const hits = candidates.filter((p) =>
        [...(p.addedIds ?? []), ...(p.droppedIds ?? []), ...(p.playerIds ?? [])].some((id) => rowPlayers.has(id)),
      );
      return hits.length === 1 ? hits[0] : null;
    },
  };
}

/**
 * Every post that could hold a story for `year`'s moves: the active feed and
 * the archive files for that calendar year and the next (a league year spans
 * two calendar years). Never throws — no stories is a page of plain records.
 */
export async function loadMoveStoryPosts(glob: LazyFeedGlob, year: number): Promise<SchefterPost[]> {
  const wanted = Object.keys(glob).filter((path) => {
    const archive = path.match(/schefter-archive\/(\d{4})\.json$/);
    if (archive) {
      const y = Number(archive[1]);
      return y === year || y === year + 1;
    }
    return /schefter-feed\.json$/.test(path);
  });
  const docs = await Promise.all(
    wanted.map(async (path) => {
      try {
        return unwrapFeedModule(await glob[path]());
      } catch {
        return null;
      }
    }),
  );
  const posts: SchefterPost[] = [];
  for (const doc of docs) {
    const list = Array.isArray(doc) ? doc : (doc as { posts?: unknown } | null)?.posts;
    if (Array.isArray(list)) posts.push(...(list as SchefterPost[]));
  }
  return posts;
}
