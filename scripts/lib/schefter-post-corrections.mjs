/**
 * Hand corrections to Schefter posts already published.
 *
 * The feed lives in Redis and every merge lets the live copy win on a shared
 * post id, so editing the committed snapshot cannot fix a post. A correction
 * listed here is applied on the two seams every reader and writer passes
 * through:
 *
 *   - the site's read (`getSchefterFeed`, src/utils/schefter-league-data.ts),
 *     so the fix shows the moment it deploys, and
 *   - every feed job's pull (`pullFeedFile`, schefter-feed-store.mjs), so the
 *     next job writes the corrected post back into Redis and the next daily
 *     snapshot commits it. Each correction carries a `storyVersion` above the
 *     post's, so a writer that pulled before it landed cannot merge the old
 *     text back over it (merge-schefter-feed.mjs keeps the higher version).
 *
 * Once the snapshot in git carries a corrected post, its entry here is dead
 * weight and can be removed.
 *
 * Keyed by post id (ids embed the MFL timestamp, so they are unique across
 * leagues). Only the listed fields are replaced.
 */

/** @type {Record<string, { reason: string, storyVersion: number, headline?: string, body?: string, analysis?: string }>} */
export const POST_CORRECTIONS = {
  // TheLeague, 2026-11-13. Written before #1728: MFL's "Last, First" names
  // split each player in two, and the AI rewrite sent the assets the wrong
  // way. MFL: 0015 gave 16190 (Zay Flowers); 0002 gave 14136 (Deebo Samuel)
  // and FP_0002_2027_1.
  sf_1794629243_h9i7: {
    reason: 'split "Last, First" names; assets sent the wrong way',
    storyVersion: 1,
    headline: 'Dark Magicians of Chaos trade with Da Dangsters for WR, Deebo Samuel',
    body: "League sources tell me Dark Magicians of Chaos and Da Dangsters have agreed to a blockbuster swap! I'm told Dark Magicians of Chaos are landing WR, Deebo Samuel and Da Dangsters' 2027 1st-round pick, sending WR, Zay Flowers the other way. Boom! This one just got a whole lot more interesting!",
    analysis: "Dark Magicians of Chaos get the best of this deal, adding a proven playmaker in Deebo Samuel plus a 2027 1st for one receiver. Grade: Dark Magicians of Chaos A-, Da Dangsters C-. Da Dangsters are betting big on Zay Flowers, and attaching their own first to do it is a steep price.",
  },
  // TheLeague, 2026-11-10. Same cause. MFL: 0015 gave 13130 (Christian
  // McCaffrey) and FP_0015_2027_3; 0016 gave 12626 (Derrick Henry), 16620
  // (Xavier Worthy) and FP_0016_2027_1.
  sf_1794373804_vr38: {
    reason: 'split "Last, First" names; assets sent the wrong way; take graded the wrong side',
    storyVersion: 1,
    body: "Boom! League sources tell me Dark Magicians of Chaos and Running down the Dream have agreed to a blockbuster dynasty swap. Dark Magicians of Chaos land RB, Derrick Henry; WR, Xavier Worthy; and a 2027 1st, sending RB, Christian McCaffrey and a 2027 3rd to Running down the Dream. I'm told this one has been brewing for days, and it's a big one for both rosters.",
    analysis: "Running down the Dream go all-in on Christian McCaffrey, but Dark Magicians of Chaos walk away with the bigger haul: Derrick Henry, a young receiver in Xavier Worthy and a 2027 1st, for a 3rd on top. Grade: Dark Magicians of Chaos A-, Running down the Dream B. A star back makes sense for a contender, but that is a lot of future to hand over.",
  },
  // TheLeague, 2026-11-10. Body and take were right; only the headline
  // carried the raw "Last, First" name.
  sf_1794365771_9aqf: {
    reason: 'raw "Last, First" name in the headline',
    storyVersion: 1,
    headline: 'Bring The Pain trade with Wascawy Wabbits for QB, Kirk Cousins',
    body: "Boom! League sources tell me Bring The Pain and Wascawy Wabbits have agreed to a blockbuster swap, with Bring The Pain landing QB, Kirk Cousins and Wascawy Wabbits securing WR, Josh Downs. I'm told both sides were motivated to shake up their rosters before the trade deadline, and this one has been in the works for a few days.",
  },
};

/**
 * The feed with every listed correction applied. Returns the same object when
 * nothing applies; otherwise a shallow copy, so a memoized or bundled feed is
 * never mutated. A post already at or above the correction's storyVersion is
 * left alone (it is the corrected copy, or a later rewrite).
 *
 * @template {{ posts?: any[] }} F
 * @param {F} feed
 * @param {typeof POST_CORRECTIONS} [corrections]
 * @returns {F}
 */
export function applyPostCorrections(feed, corrections = POST_CORRECTIONS) {
  if (!feed || !Array.isArray(feed.posts)) return feed;
  let changed = false;
  const posts = feed.posts.map((post) => {
    const fix = post && typeof post.id === 'string' ? corrections[post.id] : undefined;
    if (!fix || (Number(post.storyVersion) || 0) >= fix.storyVersion) return post;
    changed = true;
    const { reason: _reason, ...fields } = fix;
    return { ...post, ...fields };
  });
  return changed ? { ...feed, posts } : feed;
}
