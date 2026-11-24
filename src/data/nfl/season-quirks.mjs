/**
 * NFL season quirks, per season, as published by MFL — GENERATED FILE.
 *
 * Regenerate with `node scripts/fetch-nfl-season-quirks.mjs`; do not hand-edit.
 * The opener, Christmas Day games and every Tuesday, Wednesday or Friday game,
 * in Pacific time; see src/utils/nfl-season-quirks.mjs. A season is absent
 * until the NFL publishes its schedule.
 *
 * A .mjs module rather than JSON so the Schedule Release island, plain node
 * scripts and Vite all import it the same way — same reasoning as
 * src/data/nfl/week-starts.mjs.
 */

/** @type {Record<number, Array<{week: number, kickoff: string, date: string, label: string, time: string, away: string, home: string, awayName: string, homeName: string, tags: string[], affectsWaivers: boolean}>>} */
export const NFL_SEASON_QUIRKS = {
  2024: [
    {
      "week": 1,
      "kickoff": "2024-09-05T17:20:00-07:00",
      "date": "2024-09-05",
      "label": "Thu Sep 5",
      "time": "5:20 PM",
      "away": "BAL",
      "home": "KCC",
      "awayName": "Ravens",
      "homeName": "Chiefs",
      "tags": [
        "opener"
      ],
      "affectsWaivers": false
    },
    {
      "week": 1,
      "kickoff": "2024-09-06T17:15:00-07:00",
      "date": "2024-09-06",
      "label": "Fri Sep 6",
      "time": "5:15 PM",
      "away": "GBP",
      "home": "PHI",
      "awayName": "Packers",
      "homeName": "Eagles",
      "tags": [
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 13,
      "kickoff": "2024-11-29T12:00:00-08:00",
      "date": "2024-11-29",
      "label": "Fri Nov 29",
      "time": "12:00 PM",
      "away": "LVR",
      "home": "KCC",
      "awayName": "Raiders",
      "homeName": "Chiefs",
      "tags": [
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 17,
      "kickoff": "2024-12-25T10:00:00-08:00",
      "date": "2024-12-25",
      "label": "Wed Dec 25",
      "time": "10:00 AM",
      "away": "KCC",
      "home": "PIT",
      "awayName": "Chiefs",
      "homeName": "Steelers",
      "tags": [
        "christmas",
        "wednesday"
      ],
      "affectsWaivers": true
    },
    {
      "week": 17,
      "kickoff": "2024-12-25T13:30:00-08:00",
      "date": "2024-12-25",
      "label": "Wed Dec 25",
      "time": "1:30 PM",
      "away": "BAL",
      "home": "HOU",
      "awayName": "Ravens",
      "homeName": "Texans",
      "tags": [
        "christmas",
        "wednesday"
      ],
      "affectsWaivers": true
    }
  ],
  2025: [
    {
      "week": 1,
      "kickoff": "2025-09-04T17:20:00-07:00",
      "date": "2025-09-04",
      "label": "Thu Sep 4",
      "time": "5:20 PM",
      "away": "DAL",
      "home": "PHI",
      "awayName": "Cowboys",
      "homeName": "Eagles",
      "tags": [
        "opener"
      ],
      "affectsWaivers": false
    },
    {
      "week": 1,
      "kickoff": "2025-09-05T17:00:00-07:00",
      "date": "2025-09-05",
      "label": "Fri Sep 5",
      "time": "5:00 PM",
      "away": "KCC",
      "home": "LAC",
      "awayName": "Chiefs",
      "homeName": "Chargers",
      "tags": [
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 13,
      "kickoff": "2025-11-28T12:00:00-08:00",
      "date": "2025-11-28",
      "label": "Fri Nov 28",
      "time": "12:00 PM",
      "away": "CHI",
      "home": "PHI",
      "awayName": "Bears",
      "homeName": "Eagles",
      "tags": [
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 17,
      "kickoff": "2025-12-25T10:00:00-08:00",
      "date": "2025-12-25",
      "label": "Thu Dec 25",
      "time": "10:00 AM",
      "away": "DAL",
      "home": "WAS",
      "awayName": "Cowboys",
      "homeName": "Commanders",
      "tags": [
        "christmas"
      ],
      "affectsWaivers": false
    },
    {
      "week": 17,
      "kickoff": "2025-12-25T13:30:00-08:00",
      "date": "2025-12-25",
      "label": "Thu Dec 25",
      "time": "1:30 PM",
      "away": "DET",
      "home": "MIN",
      "awayName": "Lions",
      "homeName": "Vikings",
      "tags": [
        "christmas"
      ],
      "affectsWaivers": false
    },
    {
      "week": 17,
      "kickoff": "2025-12-25T17:15:00-08:00",
      "date": "2025-12-25",
      "label": "Thu Dec 25",
      "time": "5:15 PM",
      "away": "DEN",
      "home": "KCC",
      "awayName": "Broncos",
      "homeName": "Chiefs",
      "tags": [
        "christmas"
      ],
      "affectsWaivers": false
    }
  ],
  2026: [
    {
      "week": 1,
      "kickoff": "2026-09-09T17:20:00-07:00",
      "date": "2026-09-09",
      "label": "Wed Sep 9",
      "time": "5:20 PM",
      "away": "NEP",
      "home": "SEA",
      "awayName": "Patriots",
      "homeName": "Seahawks",
      "tags": [
        "opener",
        "wednesday"
      ],
      "affectsWaivers": true
    },
    {
      "week": 12,
      "kickoff": "2026-11-25T17:00:00-08:00",
      "date": "2026-11-25",
      "label": "Wed Nov 25",
      "time": "5:00 PM",
      "away": "GBP",
      "home": "LAR",
      "awayName": "Packers",
      "homeName": "Rams",
      "tags": [
        "wednesday"
      ],
      "affectsWaivers": true
    },
    {
      "week": 12,
      "kickoff": "2026-11-27T12:00:00-08:00",
      "date": "2026-11-27",
      "label": "Fri Nov 27",
      "time": "12:00 PM",
      "away": "DEN",
      "home": "PIT",
      "awayName": "Broncos",
      "homeName": "Steelers",
      "tags": [
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 16,
      "kickoff": "2026-12-25T10:00:00-08:00",
      "date": "2026-12-25",
      "label": "Fri Dec 25",
      "time": "10:00 AM",
      "away": "GBP",
      "home": "CHI",
      "awayName": "Packers",
      "homeName": "Bears",
      "tags": [
        "christmas",
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 16,
      "kickoff": "2026-12-25T13:30:00-08:00",
      "date": "2026-12-25",
      "label": "Fri Dec 25",
      "time": "1:30 PM",
      "away": "BUF",
      "home": "DEN",
      "awayName": "Bills",
      "homeName": "Broncos",
      "tags": [
        "christmas",
        "friday"
      ],
      "affectsWaivers": false
    },
    {
      "week": 16,
      "kickoff": "2026-12-25T17:15:00-08:00",
      "date": "2026-12-25",
      "label": "Fri Dec 25",
      "time": "5:15 PM",
      "away": "LAR",
      "home": "SEA",
      "awayName": "Rams",
      "homeName": "Seahawks",
      "tags": [
        "christmas",
        "friday"
      ],
      "affectsWaivers": false
    }
  ],
};
