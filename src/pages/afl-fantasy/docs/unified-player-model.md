# Unified Player Model — Implementation To‑Do List

This document breaks the unified player model into clear steps you can integrate into your Codex project. It includes required tasks, data structures, ingestion steps, and API details for MFL, Sleeper, FantasyLife, and NFLverse.

---

# ✅ Overview

The unified player model will merge **four free data sources** into one canonical player object:

* **MFL** — league roster context
* **Sleeper** — images, ADP, metadata
* **FantasyLife** — injuries, depth charts, news
* **NFLverse** — snap counts, usage, efficiency

This model becomes the foundation for:

* Free agents dashboard
* Trade block
* Contract efficiency
* Your private premium features later (DLF/FBG)

---

# 🧱 PHASE 1 — Create Core Identity + External ID Model

### **Tasks**

* [ ] Create internal `uid` for every player
* [ ] Add identity fields (name, team, age, position)
* [ ] Add external ID mapping block
* [ ] Store height/weight/experience when available
* [ ] Create `players` table in DB

### **Data You Store**

* Player internal UID
* MFL player ID
* Sleeper player ID
* NFL GSIS ID
* ESPN/Yahoo IDs (optional)

### **Notes**

MFL does *not* provide height, weight, or age → Sleeper becomes your primary source.

---

# 🧱 PHASE 2 — Implement MFL League Context Ingestion

### **Tasks**

* [ ] Call MFL players & rosters API
* [ ] Map MFL player IDs to internal UIDs
* [ ] Store roster ownership (franchise_id)
* [ ] Insert contract data from your existing salary DB

### **API Endpoints You Need**

```
GET https://api.myfantasyleague.com/{year}/export?TYPE=players&JSON=1
GET https://api.myfantasyleague.com/{year}/export?TYPE=rosters&L={leagueId}&JSON=1
```

### **What You Extract**

* Player ID
* Name
* Position
* NFL Team
* Roster ownership
* Status (IR/Taxi if available)

---

# 🧱 PHASE 3 — Implement Sleeper Data Ingestion

### **Tasks**

* [ ] Fetch full Sleeper players JSON
* [ ] Build mapping between MFL names and Sleeper players
* [ ] Extract Sleeper IDs, ADP, metadata, and image URLs
* [ ] Save raw JSON into your DB (`sleeper_json` column is fine)

### **API Endpoint You Need**

```
GET https://api.sleeper.app/v1/players/nfl
```

### **What You Extract**

* `sleeper_id`
* `full_name`
* `team`
* `age`, `height`, `weight`, `experience`
* `photo_url`
* `bye_week`
* ADP fields if present
* Injury status

Sleeper → Primary source for player images and age.

---

# 🧱 PHASE 4 — Implement FantasyLife Ingestion (Injuries + Depth Charts + News)

### **Tasks**

* [ ] Fetch depth charts
* [ ] Fetch injury reports
* [ ] Fetch news feed
* [ ] Link players using name + team matching

### **API Endpoints** (FantasyLife is free & public)

```
Depth Charts:
GET https://api.fantasylife.com/v1/depth-charts

Injury Reports:
GET https://api.fantasylife.com/v1/practice-reports

News:
GET https://api.fantasylife.com/v1/news
```

### **What You Extract**

* daily injury status (`Q`, `O`, `D`, etc.)
* practice participation (DNP/LP/FP)
* depth chart role (RB1, WR2, slot, etc.)
* breaking news alerts

FantasyLife → Your primary source for **injury + role context**.

---

# 🧱 PHASE 5 — Implement NFLverse Ingestion (Snap Counts + Usage)

### **Tasks**

* [ ] Download weekly snap count CSVs
* [ ] Parse routes/targets/carries if available
* [ ] Store efficiency metrics (EPA, SR%)
* [ ] Link to players via name/team or GSIS ID

### **Data Source**

NFLverse uses GitHub for public data:

```
https://github.com/nflverse/nflverse-data/releases
```

### **What You Extract**

* offensive snap share
* special teams snap share
* routes run
* targets
* air yards
* EPA per play
* success rate

NFLverse → Your primary source for **usage + efficiency**.

---

# 🧱 PHASE 6 — Build the Unified Player Object

### **Tasks**

* [ ] Merge identity + external IDs
* [ ] Attach MFL context (roster, salary, years left)
* [ ] Attach Sleeper metadata
* [ ] Attach FantasyLife data
* [ ] Attach NFLverse usage data
* [ ] Add computed fields (optional)

### **Recommended Object Structure**

```
UnifiedPlayer
├── identity
├── externalIds
├── mfl
├── sleeper
├── fantasyLife
├── nflverse
└── computed
```

This object powers *every other feature* in Codex.

---

# 🧱 PHASE 7 — Database Schema (Recommended)

### `players` table

* identity fields
* external IDs
* sleeper_json
* fantasylife_json
* nflverse_json

### `player_mfl_context`

* league_id
* franchise_id
* salary
* contract_years
* dead cap
* flags (IR, Taxi)

### Optional tables

* `player_usage_weekly`
* `player_news`

---

# 🧱 PHASE 8 — Data Merge Strategy

### Source Precedence Rules

* Name/team → prefer MFL, fallback Sleeper
* Age/metadata → prefer Sleeper
* Depth/injury → prefer FantasyLife
* Usage/efficiency → from NFLverse only

### Matching strategy

* Exact name + team match first
* Fallback: fuzzy name matching
* Store matches so future updates don’t repeat work

---

# 🧱 PHASE 9 — Validation Tools

### Implement a developer-only admin screen:

* show each player and their source match quality
* flags for missing Sleeper or NFLverse data
* manual override mapping if necessary

---

# 🧱 PHASE 10 — Future Expansion (Premium Sources)

Add a new block later:

```
premium: {
  dlf: {...},
  footballguys: {...}
}
```

This integrates cleanly once your CSV uploader is ready.

---

# 🚀 NEXT STEPS

If you want, I can generate:

* the actual **TypeScript interfaces** as a `.ts` file
* a **database migration script** for Postgres/Prisma
* a **data ingestion workflow diagram**
* code for the **MFL + Sleeper sync jobs**
* a README you can drop into `/docs` of Codex
