/**
 * First kickoff of each NFL week, as published by MFL — GENERATED FILE.
 *
 * Regenerate with `node scripts/fetch-nfl-week-starts.mjs`; do not hand-edit.
 * Read it through src/utils/nfl-week-starts.mjs, never directly: that module
 * falls back to the Labor-Day derivation for seasons absent here (the NFL does
 * not publish next year's schedule until spring), and nothing else should have
 * to know which of the two it got.
 *
 * Values are ISO 8601 in the league clock (Pacific). The DATE half is the one
 * most callers want — a Wednesday opener is Thursday in UTC, and that
 * off-by-one is the bug this file exists to prevent.
 *
 * A .mjs module rather than JSON so plain node scripts, Vite and the browser
 * all import it the same way, with no fs access and no import attributes —
 * same reasoning as src/data/theleague/throwback-weeks.mjs.
 */

/** @type {Record<number, Record<number, string>>} */
export const NFL_WEEK_STARTS = {
  2024: {
    1: '2024-09-05T17:20:00-07:00',
    2: '2024-09-12T17:15:00-07:00',
    3: '2024-09-19T17:15:00-07:00',
    4: '2024-09-26T17:15:00-07:00',
    5: '2024-10-03T17:15:00-07:00',
    6: '2024-10-10T17:15:00-07:00',
    7: '2024-10-17T17:15:00-07:00',
    8: '2024-10-24T17:15:00-07:00',
    9: '2024-10-31T17:15:00-07:00',
    10: '2024-11-07T17:15:00-08:00',
    11: '2024-11-14T17:15:00-08:00',
    12: '2024-11-21T17:15:00-08:00',
    13: '2024-11-28T09:30:00-08:00',
    14: '2024-12-05T17:15:00-08:00',
    15: '2024-12-12T17:15:00-08:00',
    16: '2024-12-19T17:15:00-08:00',
    17: '2024-12-25T10:00:00-08:00',
    18: '2025-01-04T13:30:00-08:00',
  },
  2025: {
    1: '2025-09-04T17:20:00-07:00',
    2: '2025-09-11T17:15:00-07:00',
    3: '2025-09-18T17:15:00-07:00',
    4: '2025-09-25T17:15:00-07:00',
    5: '2025-10-02T17:15:00-07:00',
    6: '2025-10-09T17:15:00-07:00',
    7: '2025-10-16T17:15:00-07:00',
    8: '2025-10-23T17:15:00-07:00',
    9: '2025-10-30T17:15:00-07:00',
    10: '2025-11-06T17:15:00-08:00',
    11: '2025-11-13T17:15:00-08:00',
    12: '2025-11-20T17:15:00-08:00',
    13: '2025-11-27T10:00:00-08:00',
    14: '2025-12-04T17:15:00-08:00',
    15: '2025-12-11T17:15:00-08:00',
    16: '2025-12-18T17:15:00-08:00',
    17: '2025-12-25T10:00:00-08:00',
    18: '2026-01-03T13:30:00-08:00',
  },
  2026: {
    1: '2026-09-09T17:20:00-07:00',
    2: '2026-09-17T17:15:00-07:00',
    3: '2026-09-24T17:15:00-07:00',
    4: '2026-10-01T17:15:00-07:00',
    5: '2026-10-08T17:15:00-07:00',
    6: '2026-10-15T17:15:00-07:00',
    7: '2026-10-22T17:15:00-07:00',
    8: '2026-10-29T17:15:00-07:00',
    9: '2026-11-05T17:15:00-08:00',
    10: '2026-11-12T17:15:00-08:00',
    11: '2026-11-19T17:15:00-08:00',
    12: '2026-11-25T17:00:00-08:00',
    13: '2026-12-03T17:15:00-08:00',
    14: '2026-12-10T17:15:00-08:00',
    15: '2026-12-17T17:15:00-08:00',
    16: '2026-12-24T17:15:00-08:00',
    17: '2026-12-31T17:15:00-08:00',
    18: '2027-01-10T10:00:00-08:00',
  },
};
