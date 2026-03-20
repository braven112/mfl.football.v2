# Fantasy Expert Knowledge Base

Player intelligence system for TheLeague (MFL ID: 13522). This data powers the `fantasy-expert` agent.

## Directory Structure

```
data/fantasy-expert/
├── sources/                  # Raw imported data by type & date
│   ├── rsp/                  # Matt Waldman's Rookie Scouting Portfolio
│   │   ├── 2024-post-draft.json
│   │   ├── 2025-post-draft.json
│   │   └── {year}-{pre|post}-draft.json
│   ├── rankings/             # Dynasty/redraft rankings (FBG, etc.)
│   │   └── fbg-dynasty-{YYYY-MM}.json
│   └── projections/          # Weekly/seasonal projections
│       └── fbg-{YYYY}-week{N}.json
├── sleeper-watchlist/        # RSP-derived sleeper candidates
│   └── {year}-class.json     # Players where RSP >> market value
├── my-team/                  # Pigskins-specific analysis
│   └── strategy-notes.md     # Running strategic analysis
└── README.md                 # This file
```

## RSP Data Schema

RSP data is the foundation of the sleeper watchlist. Each rookie class has a **3-year shelf life** — after 3 NFL seasons, NFL production data replaces scouting projections.

| Draft Class | Shelf Life | Status |
|---|---|---|
| 2024 | Through 2026 season | Year 2 — monitor for breakouts |
| 2025 | Through 2027 season | Year 1 — stash candidates |
| 2026 | Through 2028 season | Pre-draft (awaiting RSP) |

### RSP Player Entry

```json
{
  "rank": 16,
  "position": "WR",
  "name": "Jalen Royals",
  "team": "KC",
  "tier": "B",
  "value": "Under 12",
  "types": ["U"],
  "preDraftRank": "WR5",
  "preDraftScore": 85.2,
  "notes": "Waldman commentary / strategic notes"
}
```

### Key Fields

- **rank**: RSP Post-Draft overall ranking
- **tier**: A (instant impact) → B (starter talent) → C (contributor) → D (stash) → E (waiver) → F (UDFA)
- **value**: Par (fair), Under X (bargain by X picks), Over X (overvalued by X picks), WW (waiver wire / undrafted)
- **types**: U (underrated), Z (sleeper), ↑ (high ceiling), ↕ (risk/reward), ↔ (limited), I (injury), F (UDFA bump)
- **preDraftScore**: Waldman's Depth of Talent Score (0-100) from the pre-draft RSP

### Sleeper Identification Criteria

A player qualifies as a sleeper watchlist candidate when ANY of:
1. Value is "Under 8" or greater (RSP ranks them 8+ picks above market)
2. Type includes "U" (Underrated — better than draft stock)
3. Type includes "Z" (Sleeper — lesser-known talent with skills)
4. Value is "WW" but RSP rank is in Tier C or above (rank ≤ 87)

### How RSP Data Is Used

The fantasy-expert agent cross-references RSP scouting with:
- **NFL depth charts** — Has the player's path to playing time cleared?
- **Injury reports** — Is the starter ahead of him hurt?
- **Transaction activity** — Did another team just cut the veteran?
- **TheLeague rosters** — Is the player available in our league?
- **Salary implications** — At $425K minimum bid, what's the cap impact?

## Dynasty Rankings Schema (Football Guys)

```json
{
  "source": "Football Guys",
  "type": "dynasty",
  "date": "2026-03-15",
  "players": [
    {
      "rank": 1,
      "name": "Ja'Marr Chase",
      "position": "WR",
      "team": "CIN",
      "dynastyValue": 9850,
      "salaryCapValue": 8500000
    }
  ]
}
```

## Adding New Data

### RSP (Annual — May and March)
1. Share PDF path with the fantasy-expert agent
2. Agent extracts player data, tiers, values, and notes
3. Writes to `sources/rsp/{year}-{pre|post}-draft.json`
4. Updates sleeper watchlist

### Dynasty Rankings (Monthly during offseason)
1. Export or copy-paste FBG dynasty rankings
2. Agent writes to `sources/rankings/fbg-dynasty-{YYYY-MM}.json`
3. Cross-references with RSP data to flag value gaps

### Your Observations (Anytime)
Tell the agent: "Cam Ward looked great in preseason, bump him up"
Agent logs it in the player's notes and adjusts confidence.

## TheLeague Scoring Adjustment

RSP assumes 1 PPR / 4pt passing TDs. TheLeague uses:
- TE: 1.0 PPR (matches RSP)
- WR: 0.5 PPR (RSP overvalues WR receptions)
- RB: 0.25 PPR (RSP significantly overvalues RB receptions)
- QB: 6pt passing TDs (RSP undervalues QBs)

The fantasy-expert agent applies these adjustments when translating RSP rankings to TheLeague context.
