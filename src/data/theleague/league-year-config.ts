import type { LeagueYearOverrides } from '../../types/league-events';
import fetchedDates from './nfl-draft-dates-fetched.json';

/**
 * Hand-maintained fallback overrides. Used when the ESPN-fetched JSON
 * (nfl-draft-dates-fetched.json) is missing a year — for example when the
 * prebuild fetch fails, or for a historical year we haven't scraped.
 *
 * To refresh the fetched dates, run: `node scripts/fetch-nfl-draft-date.mjs`
 */
const HARDCODED_OVERRIDES: Record<number, LeagueYearOverrides> = {
  // 2027 must be pinned: it is the one year between 2022 and 2035 where the
  // getNflDraftDate() fallback ("4th Thursday of April") is wrong. The draft
  // actually tracks the Super Bowl — Thursday = SB Sunday + 74 days — and
  // SB LXI is Feb 14, 2027, so the draft slides to the 5th Thursday, Apr 29.
  // Confirmed by the commissioner, ESPN, and Schefter ("2027 NFL Draft in
  // Washington DC will be held April 29 — May 1").
  2027: {
    nflDraftDate: '2027-04-29',
  },
  2026: {
    nflDraftDate: '2026-04-23',
  },
  2025: {
    nflDraftDate: '2025-04-24',
  },
};

/**
 * Merge hardcoded fallbacks with ESPN-fetched dates.
 * Fetched dates win when present — they are the deterministic source of truth.
 */
function buildOverrides(): Record<number, LeagueYearOverrides> {
  const fetched = (fetchedDates.dates ?? {}) as Record<string, string>;
  const merged: Record<number, LeagueYearOverrides> = { ...HARDCODED_OVERRIDES };
  for (const [year, date] of Object.entries(fetched)) {
    const y = Number(year);
    if (!Number.isFinite(y) || !date) continue;
    merged[y] = { ...merged[y], nflDraftDate: date };
  }
  return merged;
}

export const LEAGUE_YEAR_OVERRIDES: Record<number, LeagueYearOverrides> = buildOverrides();
