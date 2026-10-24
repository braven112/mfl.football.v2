/**
 * A Matchup Preview snapshot for the matchup-preview stories: TheLeague, Week 7
 * of 2026, built by buildMatchupVisuals from the real feeds and frozen here so
 * a story never depends on data that moves. Four games cover every card state:
 * a plain series, the Game of the Week, a disputed series (no record shown)
 * and a first meeting.
 */
import type { MatchupVisuals } from "../../src/types/schefter";

export const matchupVisuals: MatchupVisuals = {
  "year": 2026,
  "week": 7,
  "gameOfWeek": 1,
  "matchups": [
    {
      "a": {
        "franchiseId": "0007",
        "wins": 5,
        "losses": 4,
        "ties": 0,
        "streak": "L2",
        "form": [
          "L",
          "W",
          "L",
          "W",
          "W",
          "W",
          "W",
          "L",
          "L"
        ],
        "weekly": [
          125.1,
          94.7,
          129.3,
          96.9,
          86.5,
          89
        ],
        "ppg": 103.6,
        "allPlay": {
          "wins": 50,
          "losses": 40,
          "ties": 0
        },
        "luck": 0
      },
      "b": {
        "franchiseId": "0001",
        "wins": 8,
        "losses": 1,
        "ties": 0,
        "streak": "W8",
        "form": [
          "L",
          "W",
          "W",
          "W",
          "W",
          "W",
          "W",
          "W",
          "W"
        ],
        "weekly": [
          99.1,
          90.9,
          114.6,
          100.3,
          147.6,
          95.3
        ],
        "ppg": 108,
        "allPlay": {
          "wins": 55,
          "losses": 35,
          "ties": 0
        },
        "luck": 2.5
      },
      "series": {
        "disputed": false,
        "games": 15,
        "aWins": 5,
        "bWins": 10,
        "ties": 0,
        "since": 2010,
        "streak": {
          "franchiseId": "0007",
          "count": 1
        },
        "playoffGames": 0,
        "playoffWins": 0,
        "playoffLosses": 0,
        "biggest": {
          "year": 2011,
          "week": 12,
          "winnerId": "0007",
          "score": 167.12,
          "opp": 88.63
        },
        "closest": {
          "year": 2015,
          "week": 12,
          "winnerId": "0001",
          "score": 120.85,
          "opp": 120.6
        }
      }
    },
    {
      "a": {
        "franchiseId": "0009",
        "wins": 7,
        "losses": 2,
        "ties": 0,
        "streak": "W4",
        "form": [
          "W",
          "L",
          "W",
          "W",
          "L",
          "W",
          "W",
          "W",
          "W"
        ],
        "weekly": [
          129.5,
          99.4,
          104.4,
          108.1,
          122.7,
          108
        ],
        "ppg": 112,
        "allPlay": {
          "wins": 59,
          "losses": 31,
          "ties": 0
        },
        "luck": 1.1
      },
      "b": {
        "franchiseId": "0012",
        "wins": 8,
        "losses": 1,
        "ties": 0,
        "streak": "W4",
        "form": [
          "W",
          "W",
          "W",
          "W",
          "L",
          "W",
          "W",
          "W",
          "W"
        ],
        "weekly": [
          137.6,
          146.4,
          105,
          129,
          139.3,
          126.9
        ],
        "ppg": 130.7,
        "allPlay": {
          "wins": 75,
          "losses": 15,
          "ties": 0
        },
        "luck": 0.5
      },
      "series": {
        "disputed": false,
        "games": 16,
        "aWins": 12,
        "bWins": 4,
        "ties": 0,
        "since": 2012,
        "streak": {
          "franchiseId": "0009",
          "count": 2
        },
        "playoffGames": 1,
        "playoffWins": 1,
        "playoffLosses": 0,
        "lastPlayoff": {
          "year": 2019,
          "week": 16,
          "winnerId": "0009",
          "score": 124.04,
          "opp": 79.68
        },
        "biggest": {
          "year": 2020,
          "week": 12,
          "winnerId": "0009",
          "score": 191.28,
          "opp": 83.65
        },
        "closest": {
          "year": 2023,
          "week": 2,
          "winnerId": "0012",
          "score": 88.26,
          "opp": 85.43
        },
        "meetings": [
          {
            "year": 2012,
            "week": 11,
            "score": 106.28,
            "opp": 80.58,
            "playoff": false
          },
          {
            "year": 2013,
            "week": 11,
            "score": 147.93,
            "opp": 159.64,
            "playoff": false
          },
          {
            "year": 2013,
            "week": 16,
            "score": 127.53,
            "opp": 79.64,
            "playoff": false
          },
          {
            "year": 2014,
            "week": 10,
            "score": 143.57,
            "opp": 123.75,
            "playoff": false
          },
          {
            "year": 2014,
            "week": 14,
            "score": 124.24,
            "opp": 111.33,
            "playoff": false
          },
          {
            "year": 2015,
            "week": 11,
            "score": 141.6,
            "opp": 87.28,
            "playoff": false
          },
          {
            "year": 2016,
            "week": 8,
            "score": 153.39,
            "opp": 81.23,
            "playoff": false
          },
          {
            "year": 2017,
            "week": 12,
            "score": 54.06,
            "opp": 107.11,
            "playoff": false
          },
          {
            "year": 2018,
            "week": 9,
            "score": 127.39,
            "opp": 94.44,
            "playoff": false
          },
          {
            "year": 2019,
            "week": 16,
            "score": 124.04,
            "opp": 79.68,
            "playoff": true
          },
          {
            "year": 2020,
            "week": 12,
            "score": 191.28,
            "opp": 83.65,
            "playoff": false
          },
          {
            "year": 2021,
            "week": 4,
            "score": 144.57,
            "opp": 96.7,
            "playoff": false
          },
          {
            "year": 2022,
            "week": 2,
            "score": 114.54,
            "opp": 138.88,
            "playoff": false
          },
          {
            "year": 2023,
            "week": 2,
            "score": 85.43,
            "opp": 88.26,
            "playoff": false
          },
          {
            "year": 2024,
            "week": 2,
            "score": 122.74,
            "opp": 89.42,
            "playoff": false
          },
          {
            "year": 2025,
            "week": 2,
            "score": 112.84,
            "opp": 101.02,
            "playoff": false
          }
        ]
      }
    },
    {
      "a": {
        "franchiseId": "0016",
        "wins": 7,
        "losses": 2,
        "ties": 0,
        "streak": "W1",
        "form": [
          "W",
          "W",
          "W",
          "W",
          "W",
          "W",
          "L",
          "L",
          "W"
        ],
        "weekly": [
          164.4,
          144,
          157.3,
          92.6,
          142,
          101.4
        ],
        "ppg": 133.6,
        "allPlay": {
          "wins": 75,
          "losses": 15,
          "ties": 0
        },
        "luck": -0.5
      },
      "b": {
        "franchiseId": "0010",
        "wins": 4,
        "losses": 5,
        "ties": 0,
        "streak": "W3",
        "form": [
          "L",
          "L",
          "L",
          "W",
          "L",
          "L",
          "W",
          "W",
          "W"
        ],
        "weekly": [
          101.1,
          53.3,
          83,
          156.3,
          110,
          130.2
        ],
        "ppg": 105.7,
        "allPlay": {
          "wins": 49,
          "losses": 41,
          "ties": 0
        },
        "luck": -0.9
      },
      "series": {
        "disputed": true,
        "games": 12
      }
    },
    {
      "a": {
        "franchiseId": "0008",
        "wins": 2,
        "losses": 7,
        "ties": 0,
        "streak": "L4",
        "form": [
          "L",
          "L",
          "W",
          "L",
          "W",
          "L",
          "L",
          "L",
          "L"
        ],
        "weekly": [
          91.7,
          118.2,
          118.9,
          63,
          109.2,
          80.3
        ],
        "ppg": 96.9,
        "allPlay": {
          "wins": 36,
          "losses": 54,
          "ties": 0
        },
        "luck": -1.6
      },
      "b": {
        "franchiseId": "0004",
        "wins": 1,
        "losses": 8,
        "ties": 0,
        "streak": "L8",
        "form": [
          "W",
          "L",
          "L",
          "L",
          "L",
          "L",
          "L",
          "L",
          "L"
        ],
        "weekly": [
          103,
          43.5,
          57.4,
          89.8,
          44.7,
          78.8
        ],
        "ppg": 69.5,
        "allPlay": {
          "wins": 14,
          "losses": 76,
          "ties": 0
        },
        "luck": -0.4
      },
      "series": null
    }
  ]
};

export const matchupTeams = [
  {
    "franchiseId": "0001",
    "name": "Pacific Pigskins",
    "nameMedium": "Pigskins",
    "nameShort": "Pigskins",
    "abbrev": "SKINS",
    "icon": "/assets/theleague/icons/pigskins.png"
  },
  {
    "franchiseId": "0004",
    "name": "Dead Cap Walking",
    "nameMedium": "Dead Cap",
    "nameShort": "Dead Cap",
    "abbrev": "DEAD",
    "icon": "/assets/theleague/icons/dead_cap_walking.png"
  },
  {
    "franchiseId": "0007",
    "name": "Fire Ready Aim",
    "nameMedium": "Fire Ready",
    "nameShort": "Fire",
    "abbrev": "FIRE",
    "icon": "/assets/theleague/icons/fire_ready_aim.png"
  },
  {
    "franchiseId": "0008",
    "name": "Bring The Pain",
    "nameMedium": "Bring The Pain",
    "nameShort": "Pain",
    "abbrev": "PAIN",
    "icon": "/assets/theleague/icons/bring_the_pain.png"
  },
  {
    "franchiseId": "0009",
    "name": "Wascawy Wabbits",
    "nameMedium": "Wascawy Wabbits",
    "nameShort": "Wabbits",
    "abbrev": "WABS",
    "icon": "/assets/theleague/icons/wabbits.png"
  },
  {
    "franchiseId": "0010",
    "name": "Computer Jocks",
    "nameMedium": "Computer Jocks",
    "nameShort": "CPU Jocks",
    "abbrev": "JOCKS",
    "icon": "/assets/theleague/icons/computer_jocks.png"
  },
  {
    "franchiseId": "0012",
    "name": "Vitside Mafia",
    "nameMedium": "Vitside",
    "nameShort": "Vitside",
    "abbrev": "VIT",
    "icon": "/assets/theleague/icons/vitside_mafia.png"
  },
  {
    "franchiseId": "0016",
    "name": "Running down the Dream",
    "nameMedium": "The Dream",
    "nameShort": "The Dream",
    "abbrev": "DREAM",
    "icon": "/assets/theleague/icons/the_dream.png"
  }
];
