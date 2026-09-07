/**
 * Assistant posts — the nudges Schefter used to whisper only to your phone.
 *
 * Lineup warnings, deadline reminders and the like are computed PER FRANCHISE
 * and then, until now, spent entirely on a push and a group-chat broadcast.
 * The push is gone the moment it is dismissed and the broadcast describes
 * everyone's problem to everyone. Neither leaves anything on the site, so an
 * owner who opens the Schefter Report has no record of the one thing they were
 * supposed to act on.
 *
 * These posts fill that gap. Two properties make them work:
 *
 * - **`franchiseIds` is the whole point.** An assistant post frequently names
 *   no player at all ("no lineup submitted"), so the For You feed cannot find
 *   it by player id. `postConcernsFranchise` in src/utils/schefter-watching.ts
 *   is the matching half; keep them in step.
 * - **The id is deterministic**, so a re-run is a no-op rather than a
 *   duplicate. `appendToFeed` already refuses a post whose id is present, and
 *   these jobs re-run: the lineup check has an hourly-ish window and a manual
 *   dispatch, and a workflow retry replays the whole step.
 *
 * This module does NOT push. Pushes for these events already exist under their
 * own categories, and doubling them up is how push permission gets revoked
 * (see the header of scripts/push-watch-list-news.mjs).
 */

import { appendToFeed } from '../article-utils/feed-writer.mjs';

/**
 * Deterministic post id. Scoped by league + franchise + kind + week so the
 * same warning in week 5 and week 6 are two posts, but two runs in week 5 are
 * one.
 */
export function assistantPostId({ navSlug, franchiseId, kind, week }) {
  return `assist_${navSlug}_${franchiseId}_${kind}_w${week}`;
}

/**
 * Build one assistant post. `franchiseIds` is always a single-element array —
 * these are addressed to one team by construction.
 *
 * @param {object} args
 * @param {{navSlug: string}} args.league  Schefter league (navSlug-shaped slug)
 * @param {string} args.franchiseId
 * @param {string} args.kind      Stable slug for the nudge type, e.g. 'lineup'
 * @param {number} args.week
 * @param {string} args.headline
 * @param {string} args.body
 * @param {string} [args.link]
 * @param {string} [args.linkLabel]
 * @param {string[]} [args.playerIds]
 * @param {string} [args.tier]    'breaking' | 'standard' | 'minor'
 * @param {Date}   [args.now]
 */
export function buildAssistantPost({
  league,
  franchiseId,
  kind,
  week,
  headline,
  body,
  link,
  linkLabel,
  playerIds = [],
  tier = 'standard',
  now = new Date(),
}) {
  return {
    id: assistantPostId({ navSlug: league.navSlug, franchiseId, kind, week }),
    timestamp: now.toISOString(),
    type: 'assistant',
    tier,
    headline,
    body,
    authorId: 'claude',
    // The channel the For You feed matches on. Never leave this empty.
    franchiseIds: [franchiseId],
    ...(playerIds.length ? { playerIds } : {}),
    league: league.navSlug,
    ...(link ? { link, linkLabel: linkLabel ?? 'Open' } : {}),
  };
}

/**
 * Append assistant posts to a league's feed. Returns how many were actually
 * written — a duplicate id counts as zero, which is what makes a re-run quiet.
 *
 * Never throws: the caller has already done its real work (the push, the chat
 * post) and a feed write failing must not fail that job.
 *
 * `log` is typed as a partial logger, not `Console`: callers pass the script's
 * own `{ log, warn }` pair, and inferring the full Console from the default
 * would reject every one of them.
 *
 * @param {object} args
 * @param {{feedPath: string}} args.league
 * @param {object[]} args.posts
 * @param {boolean} [args.dryRun]
 * @param {{log?: (...a: any[]) => void, warn?: (...a: any[]) => void}} [args.log]
 * @returns {Promise<number>}
 */
export async function publishAssistantPosts({ league, posts, dryRun = false, log = console }) {
  if (!posts.length) return 0;
  if (dryRun) {
    log.log?.(`  [dry-run] would write ${posts.length} assistant post(s) to ${league.feedPath}`);
    for (const p of posts) log.log?.(`     ${p.id} — ${p.headline}`);
    return 0;
  }
  let written = 0;
  try {
    // Sequential on purpose: appendToFeed does a read-modify-write of one
    // JSON file, so concurrent appends would drop posts.
    for (const post of posts) {
      if (await appendToFeed(league.feedPath, post)) written += 1;
    }
  } catch (err) {
    log.warn?.(`  [assistant-post] feed write failed: ${err?.message ?? err}`);
  }
  return written;
}
