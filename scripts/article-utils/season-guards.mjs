/**
 * Season guards — determine whether each article type should run.
 * Each guard returns true if the article should be generated, false to skip.
 */

import { getAugustCutdownDay } from '../lib/august-cutdown.mjs';

/**
 * Regular season + playoffs guard (weeks 1-17).
 * Used by: weekly-recap, waiver-pickups, weekend-preview, matchup-preview
 */
export function isRegularSeasonOrPlayoffs(week) {
  return week >= 1 && week <= 17;
}

/**
 * Cut watch window: July 15 through the August cutdown deadline (3rd Sunday
 * of August — day 15-21 depending on the year, NOT a fixed Aug 16; a fixed
 * end date ends the window before the deadline in most years, silencing the
 * deadline-week and deadline-day articles). Teams must trim to 22-man
 * active rosters by the cutdown.
 */
export function isCutWindow(now = new Date()) {
  const month = now.getMonth(); // 0-indexed
  const day = now.getDate();
  // July = 6, August = 7
  if (month === 6 && day >= 15) return true;
  if (month === 7 && day <= getAugustCutdownDay(now.getFullYear())) return true;
  return false;
}

/**
 * Championship complete: week 17 has all non-zero scores.
 * @param {number} completedWeek - The last completed week from weekly results.
 */
export function isChampionshipComplete(completedWeek) {
  return completedWeek >= 17;
}

/**
 * Draft complete: at least one pick has a non-empty player field.
 */
export function isDraftComplete(draftResults) {
  const picks = draftResults?.draftResults?.draftUnit?.draftPick;
  if (!Array.isArray(picks)) return false;
  return picks.some(p => p.player && p.player.trim() !== '');
}

/**
 * Pre-season window for team grades: ~3 weeks before NFL kickoff.
 * Roughly August 18 – September 10.
 */
export function isPreSeasonWindow(now = new Date()) {
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 7 && day >= 18) return true; // Aug 18+
  if (month === 8 && day <= 10) return true;  // Sep 1-10
  return false;
}
