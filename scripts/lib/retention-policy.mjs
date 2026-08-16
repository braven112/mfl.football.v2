/**
 * retention-policy.mjs — the single home for data-retention rules.
 *
 * Writers (fetch-mfl-feeds daily roster snapshots, the weekly changelog
 * rollup) and the consolidation/pruning scripts import these constants so
 * the "what do we keep" question has exactly one answer. Same spirit as
 * SEASONS_KEPT living in archived-feed-files.mjs.
 *
 * Roster-history retention, by consumer audit (2026-08):
 * - AFL keeper determination reads the July 16-31 snapshots
 *   (src/pages/afl-fantasy/keeper-analysis.astro globs
 *   `roster-history/rosters-*-07-{1[6-9],[2-3][0-9]}.json`) — those dates
 *   are the official keeper record and are kept FOREVER.
 * - Schefter's auction article reads current-season August snapshots
 *   (scripts/schefter-article.mjs findPreAuctionSnapshot) — covered by the
 *   keep-everything rule for the newest season directory.
 * - Nothing else reads a specific historical date, so completed seasons
 *   keep weekly Tuesday keyframes + first/last snapshot for trend work.
 */

/** Max entries kept in src/data/whats-new.json; older entries move to the
 *  per-year archive files (src/data/whats-new-archive/<year>.json), which
 *  only the archive index + permalink pages load. ~40 ≈ nine months of
 *  weekly rollups plus launches. */
export const WHATS_NEW_ACTIVE_MAX = 40;

/** Repo-relative directory for archived What's New entries. */
export const WHATS_NEW_ARCHIVE_DIR = 'src/data/whats-new-archive';

/**
 * The AFL keeper window: any snapshot dated July 16-31 (any year) is the
 * official keeper record and must never be pruned — and the daily snapshot
 * writer must never SKIP a write inside this window either, or an unchanged
 * roster would leave the window with no file for the keeper page to glob.
 */
export const isKeeperWindowDate = (isoDate) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return false;
  return m[1] === '07' && Number(m[2]) >= 16;
};

/** Weekly keyframe day for completed seasons: Tuesday (post-Monday-night,
 *  pre-waivers — the weekly roster state analytics care about). */
const KEYFRAME_UTC_DAY = 2;

export const isWeeklyKeyframeDate = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.getUTCDay() === KEYFRAME_UTC_DAY;
};

/**
 * Should a completed season's snapshot dated `isoDate` (YYYY-MM-DD) be
 * retained? `bounds` carries the season directory's first/last snapshot
 * dates, which are always kept as season endpoints.
 */
export const shouldRetainSnapshot = (isoDate, bounds = {}) =>
  isKeeperWindowDate(isoDate) ||
  isWeeklyKeyframeDate(isoDate) ||
  isoDate === bounds.first ||
  isoDate === bounds.last;
