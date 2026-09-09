/**
 * Which lane a Schefter post belongs to — ONE definition, shared by every
 * surface that splits the feed.
 *
 * These predicates were born inside `resolveSchefterNewsView`, next to the tab
 * list, precisely so a tab could never disagree with what clicking it shows.
 * The homepage rail then grew its own idea of "league news" and the two
 * surfaces drifted: /news?source=theleague carried every transaction post
 * while the rail's personal tab carried only the ones that named a player the
 * reader watches. Both now read from here.
 *
 * The lanes are mutually exclusive by construction — `nfl` excludes every
 * persona that has a tab of its own — so a post lands in at most one of them.
 * `tests/schefter-sources.test.ts` asserts the partition rather than mere
 * membership, which is what caught the two overlaps this file was extracted
 * to fix.
 */

import type { SchefterPost } from '../types/schefter';
import { SCHEFTER_AUTHORS } from '../types/schefter';

export const DRAFT_AUTHOR_IDS = new Set(['nfl-draft']);
export const INSIDER_AUTHOR_IDS = new Set(['doc-rivers', 'vegas-vic']);
const NFL_EXCLUDE_IDS = new Set([...DRAFT_AUTHOR_IDS, ...INSIDER_AUTHOR_IDS]);

/** ESPN contributors, minus the personas that have their own tab. */
export const ESPN_AUTHOR_IDS = new Set(
  Object.values(SCHEFTER_AUTHORS)
    .filter((a) => a.external && !NFL_EXCLUDE_IDS.has(a.id))
    .map((a) => a.id),
);

/** The four lanes a post can be filtered to. Group chat and Watching are
 * account-scoped and live outside this map. */
export type FeedSource = 'theleague' | 'nfl' | 'draft' | 'insider';

/**
 * ESPN's wire, minus the personas that have their own tab.
 *
 * The exclusion has to be `NFL_EXCLUDE_IDS`, not just the draft ids: the
 * `wire_` prefix branch bypasses `ESPN_AUTHOR_IDS` entirely, so an insider
 * post carrying a wire id would otherwise satisfy `nfl` AND `insider` and
 * render under both tabs. It cannot happen today only because
 * `scripts/schefter-scan.mjs` gives those posts `inj_`/`odds_` ids — which
 * puts the guarantee in the producer's id prefixes rather than here, where
 * the lanes are actually defined.
 */
function isWirePost(p: SchefterPost): boolean {
  const authorId = p.authorId ?? '';
  return (
    (ESPN_AUTHOR_IDS.has(authorId) || p.id.startsWith('wire_')) && !NFL_EXCLUDE_IDS.has(authorId)
  );
}

export const SOURCE_PREDICATES: Record<FeedSource, (p: SchefterPost) => boolean> = {
  /**
   * The league's own desk — Schefter's transaction posts, recaps and articles,
   * plus Roger's deadline reminders. An untagged post predates authorId and is
   * Schefter's by definition, which is why the default matters — but ONLY when
   * nothing else claims it. A `wire_` item that arrives without a byline is
   * still the wire; without that exclusion it matched two lanes at once, and
   * the homepage rail (which now files this lane into My News) would have put
   * it in the quiet tab the wire is meant to stay out of.
   */
  theleague: (p) => {
    if (isWirePost(p)) return false;
    const authorId = p.authorId ?? 'claude';
    return authorId === 'claude' || authorId === 'roger';
  },
  nfl: isWirePost,
  draft: (p) => p.authorId === 'nfl-draft',
  insider: (p) => INSIDER_AUTHOR_IDS.has(p.authorId ?? ''),
};

/** A post from the group chat, mirrored into the feed by `toSchefterPosts`. */
export function isGroupMePost(p: SchefterPost): boolean {
  return p.type === 'groupme';
}
