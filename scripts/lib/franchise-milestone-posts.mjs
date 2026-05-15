/**
 * Franchise milestone posts — Phase 5.
 *
 * Pure module. Diffs the badges that `scripts/badges.mjs` computed in this
 * run against the badges from the previous committed `franchise-history.json`,
 * and emits Schefter feed posts for any newly-earned awards.
 *
 * Idempotent by post id: re-emitting the same milestone produces an
 * identical post id, so `appendMilestonePosts` skips duplicates.
 *
 * No LLM call — phrasing is template-based, voiced per Schefter's
 * personality.md (short, deadpan, no exclamation marks).
 */

const SLUG_RE = /[^a-z0-9]+/g;

const slug = (s) =>
  String(s).toLowerCase().replace(SLUG_RE, '-').replace(/^-+|-+$/g, '');

/**
 * Stable identifier for one award instance on a badge.
 *
 * Year-keyed badges (top-scorer, worst-to-first, cellar-dweller, etc.) fire
 * once per qualifying year. Game-keyed badges include the week. Career
 * milestones with no year/week fire exactly once when first earned —
 * later runs that update the same badge's `value` don't re-fire.
 */
export function awardKey(badgeId, award) {
  const parts = [badgeId];
  if (award?.year != null) parts.push(`y${award.year}`);
  if (award?.week != null) parts.push(`w${award.week}`);
  return parts.join(':');
}

const collectAwardKeys = (badges) => {
  const set = new Set();
  for (const b of badges || []) {
    for (const a of b.awards || []) set.add(awardKey(b.id, a));
  }
  return set;
};

/**
 * Diff previous vs current badges across all franchises. Returns a list of
 * newly-earned awards in stable order (franchiseId asc, badgeId asc).
 *
 * Pass an empty object for `prevFranchises` on first run — the diff
 * yields nothing and the run silently seeds the snapshot.
 */
export function diffNewAwards(prevFranchises, nextFranchises) {
  const out = [];
  const fids = Object.keys(nextFranchises || {}).sort();
  for (const fid of fids) {
    const prevKeys = collectAwardKeys(prevFranchises?.[fid]?.badges);
    const next = nextFranchises[fid];
    const badges = next?.badges || [];
    // Stable order: sort by badgeId so test output is deterministic.
    const sortedBadges = [...badges].sort((a, b) => a.id.localeCompare(b.id));
    for (const badge of sortedBadges) {
      for (const award of badge.awards || []) {
        const key = awardKey(badge.id, award);
        if (prevKeys.has(key)) continue;
        out.push({ franchiseId: fid, badge, award });
      }
    }
  }
  return out;
}

// ── Phrasing ─────────────────────────────────────────────────────────

// Visual tier: league-wide records jump to 'breaking'; one-time career
// milestones land at 'standard'; season honors stay 'minor'.
const TIER_OVERRIDES = {
  'highest-scoring-season-ever': 'breaking',
  'all-time-highest-score': 'breaking',
  'all-time-biggest-blowout': 'breaking',
  'all-time-lowest-score': 'breaking',
  'most-active-trader': 'breaking',
  'perfect-regular-season': 'breaking',
};

const STANDARD_BADGES = new Set([
  'triple-century',
  'double-century',
  'century-club',
  'playoff-legend',
  'playoff-veteran',
  'decade-of-service',
  'worst-to-first',
]);

export function tierFor(badgeId) {
  if (TIER_OVERRIDES[badgeId]) return TIER_OVERRIDES[badgeId];
  if (STANDARD_BADGES.has(badgeId)) return 'standard';
  return 'minor';
}

const fmtPts = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/**
 * Build headline + body for a milestone. `name` is the team's medium-form
 * display name as of the current run (e.g. "Pigskins"). Templates are
 * deterministic — no randomness — so re-runs produce the same text.
 */
export function phraseFor({ badgeId, award, name, fullName }) {
  const yr = award?.year;
  const wk = award?.week;
  const val = award?.value;
  const long = fullName || name;
  switch (badgeId) {
    case 'triple-century':
      return {
        headline: `300 career wins for ${name}`,
        body: `${long} just crossed 300 all-time wins. Three centuries. Rare air in TheLeague's record book.`,
      };
    case 'double-century':
      return {
        headline: `${name} hits 200 career wins`,
        body: `${long} now has 200 career wins. Two-hundred-win club. The kind of number you don't fake your way to.`,
      };
    case 'century-club':
      return {
        headline: `${name} joins the Century Club`,
        body: `${long} clipped 100 career wins. Welcome to the Century Club. Plaque pending.`,
      };
    case 'playoff-legend':
      return {
        headline: `${name} reaches 10 playoff appearances`,
        body: `${long} just earned a 10th playoff appearance. Postseason fixture. Hard to fluke that number.`,
      };
    case 'playoff-veteran':
      return {
        headline: `${name} earns Playoff Veteran status`,
        body: `${long} clipped a 5th playoff appearance. Not a tourist anymore.`,
      };
    case 'decade-of-service':
      return {
        headline: `${name} marks a decade in the league`,
        body: `${long} just closed a 10th season as the same franchise. Decade-of-service plaque on the wall.`,
      };
    case 'founding-member':
      // Founding member only fires for franchises that show up in 2007 — a
      // backfill case. Phrase it as a recognition, not breaking news.
      return {
        headline: `${name} — Class of 2007`,
        body: `${long} logged as a founding member. Active in the inaugural 2007 season. Charter desk.`,
      };
    case 'best-record':
      return {
        headline: `${name} finishes #1 in the standings (${yr})`,
        body: `${long} took the regular-season top seed in ${yr}. The standings don't lie.`,
      };
    case 'perfect-regular-season':
      return {
        headline: `${name} runs the table (${yr})`,
        body: `${long} finished ${yr} undefeated. Perfect regular season. No notes.`,
      };
    case 'top-scorer':
      return {
        headline: `${name} is the ${yr} scoring champ`,
        body: `${long} led TheLeague in regular-season points for ${yr}. Scoring title goes to the desk that put up the numbers.`,
      };
    case 'highest-scoring-season-ever':
      return {
        headline: `League record: ${name} sets the points-for mark`,
        body: `${long} put up ${fmtPts(val)} points in ${yr}. New high-water mark for a single season. The board has been updated.`,
      };
    case 'worst-to-first':
      return {
        headline: `${name} pulls off worst-to-first`,
        body: `${long} went from dead last to the playoffs in ${yr}. Worst-to-first. A rare league bit.`,
      };
    case 'cellar-dweller':
      return {
        headline: `${name} finishes dead last (${yr})`,
        body: `${long} closed ${yr} at the bottom of the standings. The boards don't lie. Cellar-dweller plaque is in the mail.`,
      };
    case 'all-time-highest-score':
      return {
        headline: `League record: ${name} sets single-game high`,
        body: `${long} dropped ${fmtPts(val)} in Week ${wk}, ${yr}. New all-time single-game record. League office has updated the book.`,
      };
    case 'all-time-biggest-blowout':
      return {
        headline: `League record: ${name} hangs the biggest blowout`,
        body: `${long} won by ${fmtPts(val)} in Week ${wk}, ${yr}. New all-time blowout record. Mercy rule unavailable.`,
      };
    case 'all-time-lowest-score':
      return {
        headline: `League record (the bad kind): ${name} sets the low`,
        body: `${long} put up ${fmtPts(val)} in Week ${wk}, ${yr}. New all-time single-game low. Brock Osweiler tier.`,
      };
    case 'most-active-trader':
      return {
        headline: `${name} is the all-time trade leader`,
        body: `${long} now leads TheLeague in all-time trades — ${fmtPts(val)} deals on the books. Wheeler-and-dealer desk.`,
      };
    default:
      return {
        headline: `${name} earns a new badge`,
        body: `${long} just unlocked a milestone${yr ? ` in ${yr}` : ''}. Quiet drop on the badge board.`,
      };
  }
}

/**
 * Build a SchefterPost object for one new award.
 *
 * The id is deterministic from (franchiseId, badgeId, awardKey) so the
 * feed-append step can dedupe a re-emission to a no-op.
 */
export function buildMilestonePost({ franchiseId, badge, award, franchise, now }) {
  const name =
    franchise?.currentNameMedium ||
    franchise?.currentNameShort ||
    franchise?.currentName ||
    `Franchise ${franchiseId}`;
  const fullName = franchise?.currentName || name;
  const key = awardKey(badge.id, award);
  const idSlug = slug(`${franchiseId}-${key}`);
  const { headline, body } = phraseFor({ badgeId: badge.id, award, name, fullName });
  return {
    id: `sf_milestone_${idSlug}`,
    timestamp: now.toISOString(),
    type: 'transaction',
    transactionSubType: 'milestone',
    tier: tierFor(badge.id),
    headline,
    body,
    authorId: 'claude',
    franchiseIds: [franchiseId],
    league: 'theleague',
    milestone: {
      badgeId: badge.id,
      badgeName: badge.name,
      icon: badge.icon,
      tier: badge.tier,
      awardKey: key,
      award: { ...award },
    },
  };
}

/**
 * Dedup-aware prepend. Returns `{posts, added}` — `added` is the count of
 * newly-inserted posts. Existing posts in `feed.posts` with matching ids
 * are preserved as-is (the first write wins on body text).
 */
export function mergeMilestonePosts(feedPosts, milestonePosts) {
  const existingIds = new Set((feedPosts || []).map((p) => p.id));
  const toAdd = milestonePosts.filter((p) => !existingIds.has(p.id));
  return {
    posts: [...toAdd, ...(feedPosts || [])],
    added: toAdd.length,
  };
}
