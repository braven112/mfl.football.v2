# League History Knowledge Base

Curated season-by-season record of TheLeague (MFL 13522) from 2007 to present.
This data powers the `schefter` agent's historical context, milestone detection, and lore references.

## File

`data/theleague/league-history.json`

## Top-Level Structure

| Field | Type | Description |
|-------|------|-------------|
| `meta` | object | File metadata, schema version, last updated date |
| `seasons[]` | array | One entry per completed season, newest-first preferred |

---

## Season Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `year` | number | yes | The fantasy season year (e.g., 2024) |
| `summary` | string | yes | One-sentence narrative. Schefter-quotable as a lede or historical reference. |
| `champion` | object | yes | Championship result |
| `playoffs` | object | yes | All playoff participants and results |
| `toiletBowl` | object | recommended | Last-place result (earns 1.17 pick) |
| `regularSeason` | object | yes | Records, high/low scores, biggest upset |
| `awards[]` | array | yes | Named awards — open-ended, any award type |
| `notableTrades[]` | array | recommended | Major trades worth historical reference |
| `notableEvents[]` | array | recommended | Rule changes, milestones, roster moves, drama |
| `lore[]` | string[] | recommended | Running jokes, GroupMe canon, owner moments |

---

## `champion` Object

| Field | Type | Notes |
|-------|------|-------|
| `franchiseId` | string | Must match `src/data/theleague.config.json` (e.g., `"0009"`) |
| `teamName` | string | Period-correct name for human readability in the file |
| `owner` | string | Owner's name |
| `record` | string | Regular season record (W-L-T format, e.g., `"14-4-0"`) |
| `playoffSeed` | number | Seeding entering the playoffs |
| `championshipScore` | number | Winner's score in the championship game |
| `opponentScore` | number | Loser's score in the championship game |
| `opponentFranchiseId` | string | Runner-up's franchiseId |
| `firstChampionship` | boolean | `true` if this franchise has never won a title before |
| `note` | string | Optional milestone note Schefter can quote directly |

---

## `playoffs.participants[]`

Each entry has `franchiseId`, `seed`, and `result`.

Valid `result` values:

| Value | Description |
|-------|-------------|
| `champion` | Won the title |
| `runner-up` | Lost the championship game |
| `third` | Third-place finish |
| `fourth` | Fourth-place finish |
| `first-round-exit` | Lost in the first playoff round |
| `play-in-winner` | Won the play-in game to advance |
| `play-in-loser` | Lost the play-in game |

---

## `awards[]`

Open-ended array. Any `award` string is valid — no schema changes needed to add new categories.

**Common award names used across seasons:**

| Award | franchiseId points to |
|-------|-----------------------|
| `Champion` | Title winner |
| `Runner-Up` | Championship game loser |
| `Third Place` | Third-place finisher |
| `Toilet Bowl` | Last-place team (earns 1.17 pick) |
| `Most Points` | Highest regular season PF total |
| `Least Points` | Lowest regular season PF total |
| `Best Record` | Best regular season W-L |
| `Worst Record` | Worst regular season W-L |
| `Highest Single Week` | Highest score in a single week |
| `Lowest Single Week` | Lowest score in a single week |
| `Biggest Upset` | franchiseId = the upset *winner* |
| `Most Improved` | Free-form community award |
| `Comeback Story` | Free-form community award |

Add any additional community awards as-is — the agent handles them gracefully.

---

## `notableEvents[].type`

Suggested values (not enforced — any string is valid):

| Type | Use for |
|------|---------|
| `milestone` | Records broken, franchise firsts achieved |
| `rule-change` | Constitution amendments voted in |
| `roster-move` | Historically significant waivers, dead cap events |
| `drama` | Commissioner vetoes, GroupMe incidents, controversies |
| `ownership-change` | New owner taking over a franchise |
| `record` | League records set or broken |

---

## `franchiseId` Reference

All values must match `src/data/theleague.config.json`. Use that config's `history[]` arrays to resolve period-correct team names when writing historical copy.

| ID | Current Name | Notable Prior Names |
|----|-------------|---------------------|
| 0001 | Pacific Pigskins | *(no prior names)* |
| 0002 | Da Dangsters | Degenerates (2012–2014) |
| 0003 | Maverick | Poker in the Rear (2012–2013, 2015), Generals (2014) |
| 0004 | Dead Cap Walking | Heavy Chevy (2020–2024), Drunk Indians (2019), The Art of War (2018), Las Vegas Elite (2012–2017) |
| 0005 | The Mariachi Ninjas | The Executioners (2012–2015) |
| 0006 | Music City Mafia | LBer-DeCleaters (2012–2018) |
| 0007 | Fire Ready Aim | *(no prior names)* |
| 0008 | Bring The Pain | *(no prior names)* |
| 0009 | Wascawy Wabbits | *(no prior names)* |
| 0010 | Computer Jocks | Midwestside Connection (2012–2015) |
| 0011 | Midwestside Connection | Under Siege (2016–2018), Amish Rakefighters (2012–2015) |
| 0012 | Vitside Mafia | *(no prior names)* |
| 0013 | Gridiron Geeks | Sabertooths (2012–2013) |
| 0014 | Cowboy Up | Devil Dogs (2012–2017) |
| 0015 | Dark Magicians of Chaos | *(no prior names)* |
| 0016 | Running down the Dream | Treasure Coast Swamp Bandits (2012–2013) |

---

## Example Season Entry

```json
{
  "year": 2024,
  "summary": "The Wabbits went back-to-back, becoming just the third franchise in league history to win consecutive titles.",
  "champion": {
    "franchiseId": "0009",
    "teamName": "Wascawy Wabbits",
    "owner": "Owner Name",
    "record": "14-4-0",
    "playoffSeed": 1,
    "championshipScore": 142.7,
    "opponentScore": 118.3,
    "opponentFranchiseId": "0012",
    "firstChampionship": false,
    "note": "Second consecutive title. First back-to-back since the Dark Magicians in 2018-2019."
  },
  "playoffs": {
    "participants": [
      { "franchiseId": "0009", "seed": 1, "result": "champion" },
      { "franchiseId": "0012", "seed": 2, "result": "runner-up" },
      { "franchiseId": "0006", "seed": 3, "result": "third" },
      { "franchiseId": "0001", "seed": 7, "result": "first-round-exit" }
    ],
    "playIn": {
      "winner": "0007",
      "loser": "0011",
      "note": "Fire Ready Aim won the play-in on a Monday night comeback."
    }
  },
  "toiletBowl": {
    "winner": "0010",
    "note": "Computer Jocks finish last for the second time in three years. Earns the 1.17 pick."
  },
  "regularSeason": {
    "bestRecord": { "franchiseId": "0009", "record": "14-4-0", "pf": 2140.71 },
    "worstRecord": { "franchiseId": "0010", "record": "4-14-0", "pf": 1402.3 },
    "mostPointsScored": { "franchiseId": "0009", "pf": 2140.71 },
    "leastPointsScored": { "franchiseId": "0010", "pf": 1402.3 },
    "highestSingleWeek": { "franchiseId": "0007", "week": 11, "score": 180.27 },
    "lowestSingleWeek": { "franchiseId": "0010", "week": 3, "score": 37.78 },
    "biggestUpset": {
      "winner": "0016",
      "loser": "0009",
      "week": 8,
      "winnerScore": 103.1,
      "loserScore": 100.2,
      "note": "The Dream knocked off the 1-seed by 3 points in a Week 8 shocker."
    }
  },
  "awards": [
    { "award": "Champion", "franchiseId": "0009", "detail": "Back-to-back. Third franchise to repeat." },
    { "award": "Toilet Bowl", "franchiseId": "0010", "detail": "Last place. Earns 1.17 pick." },
    { "award": "Most Points", "franchiseId": "0009", "detail": "2140.71 — second-highest total in league history." },
    { "award": "Worst Record", "franchiseId": "0010", "detail": "4-14. It wasn't close." },
    { "award": "Biggest Upset", "franchiseId": "0016", "detail": "Running down the Dream beat the 1-seed in Week 8." }
  ],
  "notableTrades": [
    {
      "week": 9,
      "franchiseId1": "0001",
      "franchiseId2": "0015",
      "description": "Pigskins sent Ja'Marr Chase and a 2025 1st to the Dark Magicians for CeeDee Lamb and two 2025 2nds.",
      "playersMoved": ["Chase (0001→0015)", "Lamb (0015→0001)"],
      "grade": "A for Pigskins, C for Dark Magicians",
      "context": "The most controversial trade of the season. GroupMe went dark for 48 hours."
    }
  ],
  "notableEvents": [
    {
      "type": "rule-change",
      "description": "League voted 14-2 to add the play-in game.",
      "context": "Triggered by the 2023 controversy where the 8th seed nearly made playoffs on a tiebreaker."
    },
    {
      "type": "milestone",
      "franchiseId": "0009",
      "description": "Wabbits became the third franchise to win back-to-back titles."
    }
  ],
  "lore": [
    "The GroupMe consensus was that Wabbits 'weren't even that good' — they won anyway.",
    "Computer Jocks owner texted 'This is the year' in the preseason auction thread. It was not the year."
  ]
}
```

---

## Maintaining the File

### Adding a completed season
1. Add a new entry to `seasons[]` (newest-first preferred)
2. Update `meta.lastUpdated`
3. Populate `champion`, `playoffs`, `regularSeason`, and `awards[]` at minimum
4. Add `notableTrades[]` for any trades the league still talks about
5. Add `lore[]` entries for anything that became GroupMe canon

### Data sparsity for 2007–2011
Raw MFL feeds for these years are incomplete. The `league-history.json` is the **authoritative record** for this era — populate from memory, old GroupMe logs, or the theleague.us history page. If a field is an estimate, note it in that season's `summary` or a relevant `note` field.

### In-progress seasons
This file covers **completed seasons only**. Do not add an in-progress year entry — live data comes from `data/theleague/mfl-feeds/{year}/`.

### Updating mid-season history
If you discover a correction to a prior year (e.g., a misremembered champion score), update the entry directly and bump `meta.lastUpdated`.
