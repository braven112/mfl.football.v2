# MFL API Insights

Domain knowledge about MyFantasyLeague API integration.

---

## 2026-01-18 - MFL Login Redirects Do Not Include User Identity

**Context:** Researching team verification flow for nav redesign

**Insight:** MFL's web login redirect mechanism (`/login?L={leagueId}&URL={returnUrl}`) does NOT pass any user identity back to the return URL. After login:
- User is redirected to the specified URL
- MFL sets `MFL_USER_ID` cookie in user's browser
- But external sites cannot read that cookie (different domain)
- No franchise_id, user_id, or session token is appended to the return URL

**Evidence:**
- Researched via mfl-api-expert agent
- Confirmed by existing pattern in `src/utils/mfl-login.ts:162-207`
- MFL login URL format: `https://www{XX}.myfantasyleague.com/{YEAR}/login?L={LEAGUE_ID}&URL={ENCODED_RETURN_URL}`

**Recommendation:** Two approaches for team identification:
1. **Credential-based:** Host login form, POST to MFL API, call `myleagues` API to get franchise_id
2. **Custom MFL page:** Embed script on MFL custom page that detects logged-in user's franchise_id and adds `?myteam={id}` to links back to our site

---

## 2026-01-18 - The `myleagues` API Returns Franchise ID

**Context:** Need to identify which team a user owns after authentication

**Insight:** The `myleagues` API endpoint returns all leagues a user belongs to, including their franchise_id in each league.

**Evidence:**
```
Endpoint: https://api.myfantasyleague.com/{YEAR}/myleagues
Auth: USERNAME + PASSWORD parameters (or MFL_USER_ID cookie)

Response:
{
  "myleagues": {
    "league": [
      {
        "id": "13522",
        "name": "TheLeague",
        "franchise_id": "0003",
        "franchise_name": "Team Name"
      }
    ]
  }
}
```

**Recommendation:** Use this API after credential validation to map user to franchise_id. See implementation in `src/utils/mfl-login.ts`.

---

## 2026-01-18 - MFL Custom Pages Can Run JavaScript

**Context:** TheLeague uses custom MFL pages with scripts

**Insight:** MFL allows custom pages (via MODULE parameter) that can contain JavaScript. These scripts can access MFL's DOM and detect the logged-in user's franchise.

**Evidence:**
- Custom page URL: `https://www49.myfantasyleague.com/2025/home/13522?MODULE=MESSAGE20`
- Existing scripts add `?myteam={franchiseId}` to links pointing back to mfl.football

**Recommendation:** This is a viable approach for team verification without requiring users to enter credentials on our site.

---

## 2026-02-12 - No Dedicated Franchise History API Exists

**Context:** Researching how to display historical team names when viewing past seasons

**Insight:** MFL has NO dedicated API endpoint for franchise history, name changes, or ownership transfers. There is no single endpoint that tracks franchise identity changes over time.

**What DOES work:** The `league` export endpoint is year-specific. Querying it for different years returns the franchise names **as they were in that year**. This is the only way to retrieve historical team names.

**How to get historical franchise names:**
1. The `league` endpoint's `history.league` array provides URLs to all historical league years
2. Each historical year may have a **different league ID** (pre-2016 years used different IDs)
3. Query `TYPE=league&L={LEAGUE_ID}&JSON=1` for each historical year to get that year's franchise names
4. Franchise IDs (0001-0016) remain stable across years even when league IDs change

**Key findings from TheLeague (13522):**

| Franchise ID | 2007 (L=76273) | 2015 (L=28077) | 2020 (L=13522) | 2024 (L=13522) | 2025 (L=13522) |
|---|---|---|---|---|---|
| 0004 | Las Vegas Elite | Las Vegas Elite | Heavy Chevy | Heavy Chevy | Dead Cap Walking |
| 0002 | Sabertooths | Da Dangsters | Da Dangsters | Da Dangsters | Da Dangsters |
| 0005 | The Executioners | The Executioners | The Mariachi Ninjas | The Mariachi Ninjas | The Mariachi Ninjas |
| 0010 | Witch City Warlocks | Midwestside Connection | Computer Jocks | Computer Jocks | Computer Jocks |
| 0016 | Silver Bullets | Running Down The Dream | Running Down The Dream | Running Down The Dream | Running Down The Dream |

**Historical league ID mapping (from `history.league` array):**
- 2007: 76273 (www42), 2008: 28463 (www43), 2009: 42989 (www47), 2010: 34479 (www48)
- 2011: 33798 (www49), 2012: 48815 (www45), 2013: 34526 (www46), 2014: 35233 (www47)
- 2015: 28077 (www49), 2016-2025: 13522 (www49)

**Project advantage:** The project already caches `league.json` for every year from 2011-2025 in `data/theleague/mfl-feeds/{YEAR}/league.json`. Each cached file contains the franchise names as they were that year. No additional API calls are needed for cached years.

**Recommendation for displaying historical team names:**
1. When viewing a past season, load `league.json` from that year's cached data
2. Extract franchise names from `franchises.franchise` array
3. Use the year-specific name in the UI (e.g., show "Heavy Chevy" for 2024 data, "Dead Cap Walking" for 2025+)
4. The `theleague.config.json` file may need year-aware name overrides, OR the code should dynamically load names from the year-specific league.json

**Caveats:**
- Franchise names can change mid-season on MFL (owner just edits it), so the cached data reflects the name at time of last sync
- Pre-2016 years have different league IDs; the `history.league` array in the current year's league data maps years to their correct league IDs and hosts
- The `api.myfantasyleague.com` base URL works for 2016+ (league ID 13522) but earlier years need their specific host and league ID

---

## 2026-02-13 - MFL Rosters API Inconsistency During Pre-Rollover Window

**Context:** Investigating why dropped players still appear on franchise 0001's roster in the 2025 API

**Insight:** During the pre-rollover window (after the season ends but before the Feb 14 league year rollover), the MFL `rosters` endpoint can return STALE data for recent drops, even though the `transactions` and `freeAgents` endpoints correctly reflect the changes.

**Evidence:**
- Saquon Barkley (13604) and Justin Jefferson (14836) were dropped by franchise 0001 on 2026-02-13 05:21-05:22 UTC
- The `transactions` API correctly shows these as `FREE_AGENT` transactions with format `|{player_id},` (pipe prefix = drop-only, no add)
- The `freeAgents` API correctly lists both players as free agents with `status: "locked"`
- The `rosters` API (even when queried 18+ hours after the drops) STILL returns these players on franchise 0001's roster
- Older drops from January 2026 and earlier ARE correctly removed from the rosters endpoint
- This appears to be an MFL API caching/propagation delay specific to the pre-rollover period

**Transaction format notes:**
- `|{player_id},` = drop only (no add)
- `{add_id}|{drop_id},` = add/drop swap
- `{add_id}|,` = add only (no drop)

**Key finding:** The `rosters` endpoint should NOT be treated as the sole source of truth for current roster state during the offseason window. Cross-reference with `transactions` and `freeAgents` for accurate data.

**Verification URLs:**
```
# Rosters (may be stale):
https://api.myfantasyleague.com/2025/export?TYPE=rosters&L=13522&FRANCHISE=0001&JSON=1

# Transactions (accurate):
https://api.myfantasyleague.com/2025/export?TYPE=transactions&L=13522&TRANS_TYPE=FREE_AGENT&FRANCHISE=0001&JSON=1

# Free agents (accurate):
https://api.myfantasyleague.com/2025/export?TYPE=freeAgents&L=13522&JSON=1
```

**Impact on sync:** The `fetch-mfl-feeds.mjs` script fetches `rosters` once daily and caches it. During the pre-rollover window, this cached data will include dropped players that MFL hasn't yet removed from the rosters endpoint.

**Recommendation:** For accurate roster display during the offseason:
1. After fetching rosters, also fetch recent transactions (`TRANS_TYPE=FREE_AGENT`)
2. Filter out any players that appear in drop-only transactions (`|{id},` format)
3. OR wait until after Feb 14 rollover when the new 2026 league is created and rosters are clean

**Additional finding:** The 2026 league (ID 13522) does NOT exist yet as of Feb 13, 2026. Querying `TYPE=league&L=13522&JSON=1` for year 2026 returns `"Invalid league ID 13522"`. This confirms the Feb 14 rollover hasn't happened yet.

**Follow-up confirmation (2026-02-14 04:54 UTC):** Re-verified this issue 31+ hours after the drops occurred. The `rosters` API (both live and cached) STILL returns Barkley and Jefferson on franchise 0001. The `transactions` API correctly shows the drops at timestamps 2026-02-12T21:21-21:22 UTC (formatted as `|13604,` and `|14836,`). The `freeAgents` API correctly lists both as free agents with `status: "locked"`. The cached `transactions.json` (fetched 2026-02-13T23:15 UTC) also contains these drop records. This confirms the staleness persists until the Feb 14 league rollover, not just for hours but potentially for days.

**Note on transactions API redirect:** The `transactions` endpoint with `FRANCHISE` filter parameter requires following HTTP 302 redirects. The `api.myfantasyleague.com` host redirects to `www49.myfantasyleague.com` for league 13522. Use `-L` flag with curl or ensure your HTTP client follows redirects.

---

## 2026-02-13 - Free Agent Status "locked" During Offseason

**Context:** Checking freeAgents endpoint during pre-rollover window

**Insight:** Players dropped during the offseason appear in the `freeAgents` endpoint with `status: "locked"`. This likely indicates they cannot be picked up until the new league year begins or waivers open.

**Evidence:**
```json
{
  "contractInfo": "",
  "contractYear": "1",
  "id": "13604",
  "salary": "425000.00",
  "status": "locked"
}
```

**Recommendation:** The `status: "locked"` field on free agents indicates roster moves are frozen. Display these players differently in the UI (e.g., grayed out or with a lock icon).

---

## 2026-02-24 - pointsAllowed API: Defense vs Position (DVP) Data

**Context:** Researching whether MFL has a defense-vs-position endpoint for matchup analysis

**Insight:** MFL does have a `pointsAllowed` export endpoint that returns fantasy points allowed by each NFL team broken out by position (QB, RB, WR, TE, PK, Def). This is the DVP data.

**Key findings:**
1. **Full-season totals only** — the `W` parameter is accepted but completely ignored. All requests return identical full-season cumulative data.
2. **League-specific** — requires `L` (league ID) because it calculates using your league's scoring rules (PPR, passing TD values, etc.)
3. **No authentication required** — this is a public endpoint
4. **MFL non-standard team codes** — returns codes like KCC, JAC, NEP, NOS, GBP, TBB, SFO, LVR instead of standard NFL codes. Use `normalizeTeamCode()`.
5. **Empty position quirk** — some teams have a position entry with `"name": ""` and `"points": "0"`. Filter these out.
6. **No per-week breakdown** — to compute weekly DVP, you must use `playerScores` per week cross-referenced with `nflSchedule` to determine opponents.
7. **Point values are strings** — always `parseFloat()` before math.

**Evidence:**
```
GET https://api.myfantasyleague.com/2025/export?TYPE=pointsAllowed&L=13522&JSON=1
# Redirects to www49, returns 32 NFL teams with 6 positions each
# W=1, W=5, W=10, W=YTD all return IDENTICAL numbers
```

**Recommendation:** For a DVP feature:
- Use `pointsAllowed` for season-long totals (easy, one API call)
- Divide by games played (17) for per-game averages
- For weekly matchup context, combine with `nflSchedule` to show "this week's opponent allows X pts to WR"
- For granular weekly DVP trends, you'd need to build it yourself from `playerScores` + `nflSchedule`

---

## 2026-02-26 - MFL Login Authentication: Critical Implementation Details

**Context:** Implementing user login flow (POST credentials → get cookie → resolve franchise_id)

**Insight:** Three critical findings for MFL authentication from server-side code:

1. **Login endpoint does NOT support `JSON=1`** — it returns an empty body with null content-type. You MUST use `XML=1`. The response is XML: `<status MFL_USER_ID="base64cookie"/>` for success, `<error>Invalid Password</error>` for failure.

2. **The standalone `/myleagues` endpoint returns HTML from server-side `fetch()`** — regardless of auth method (Cookie header, USERNAME/PASSWORD params, JSON=1, XML=1). It always returns the full HTML page. Do NOT use this endpoint from Node.js/serverless functions.

3. **Use `export?TYPE=myleagues&JSON=1` instead** — this follows the standard MFL export pattern, returns proper JSON, and accepts the `MFL_USER_ID` cookie via the `Cookie` header. Returns `{"leagues":{}}` when unauthenticated, and `{"leagues":{"league":[...]}}` with `franchise_id` when authenticated.

**Working auth flow:**
```
Step 1: POST /login with XML=1 → parse XML for MFL_USER_ID cookie
        (fall back to GET if POST returns empty — redirect converts POST→GET)
Step 2: GET /export?TYPE=myleagues&JSON=1 with Cookie: MFL_USER_ID=<cookie>
        → extract franchise_id from leagues array
```

**Additional notes:**
- MFL's `api.myfantasyleague.com` host does NOT redirect for `/login` or `/export` — it serves directly
- The `Cookie` header works with the export endpoint from Vercel serverless functions
- `URLSearchParams` encodes spaces as `+` (form-style); `encodeURIComponent` uses `%20` — MFL may prefer `+`
- MFL returns a single object (not array) when user has only one league — always normalize

**Key files:** `src/utils/mfl-login.ts`, `src/pages/api/auth/login.ts`

---

## 2026-02-27 - myDraftList Has Both Read AND Write API Endpoints

**Context:** Researching whether MFL supports programmatic draft board management for custom rankings feature

**Insight:** MFL has a fully functional **import (write) endpoint** for `myDraftList` in addition to the export (read) endpoint. This enables programmatic draft board management.

**Export (Read):**
```
GET https://api.myfantasyleague.com/{YEAR}/export?TYPE=myDraftList&L={LEAGUE_ID}&JSON=1
Auth: Owner (MFL_USER_ID cookie or APIKEY)
Returns: Authenticated franchise's ordered draft board
```

**Import (Write):**
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=myDraftList&L={LEAGUE_ID}
Auth: Owner (MFL_USER_ID cookie)
Params: PLAYERS=id1,id2,id3,... (comma-separated player IDs, required)
Behavior: COMPLETELY OVERWRITES the previous draft list — no partial updates
```

**Key details:**
- The `PLAYERS` parameter order defines draft board ranking order
- POST is strongly recommended — large draft boards (200+ players) can exceed GET URL length limits
- Franchise is determined by auth cookie — no `FRANCHISE_ID` parameter
- No granular operations (move/insert/remove single player) — must send complete list each time
- The import endpoint description explicitly says "completely overwrite"

**Workflow for custom rankings feature:**
1. Export current `myDraftList` to get user's existing draft board
2. Display in UI for reordering (drag-and-drop, tier assignment, etc.)
3. On save, import the modified list back via `PLAYERS=id1,id2,id3,...`
4. Handle the destructive nature carefully — consider confirmation before overwriting

**Related endpoints:**
- `draftResults` (import) — commissioner-only, loads offline draft results (destructive: deletes all existing results)
- `live_draft` (misc) — real-time draft commands: DRAFT, PAUSE, RESUME, SKIP, UNDO

**Recommendation:** This opens the door for a "Custom Rankings" or "Draft Board Builder" feature that syncs back to MFL. The complete-overwrite behavior means we should always export first, merge changes, then import — never blindly import without knowing the current state.

---

## 2026-02-24 - MFL "Coach" Tab / Who Should I Start

**Context:** Investigating what backs the MFL "Coach" feature on their website

**Insight:** MFL has a `whoShouldIStart` API endpoint, but it requires authentication (returns auth error without MFL_USER_ID cookie or APIKEY). The MFL website's lineup advice features likely combine `pointsAllowed`, `projectedScores`, `schedule`, and `injuries` data to generate recommendations. There is no dedicated "coach" export endpoint — the Coach tab on MFL's website appears to be a UI feature that aggregates multiple API data sources.

---

## 2026-02-27 - myWatchList: The Best MFL Endpoint for Full-Player Custom Rankings

**Context:** Investigating all MFL endpoints that could store user-personalized player rankings beyond the rookie-only draft pool

**Insight:** MFL has TWO personalized player list endpoints — `myDraftList` and `myWatchList` — plus a read-only `playerRanks` endpoint. For a full-player custom rankings feature, **myWatchList is the strongest candidate** because it supports incremental ADD/REMOVE operations and has no documented player restrictions.

**Complete inventory of MFL personal player list endpoints:**

1. **`myWatchList`** (export + import)
   - Export: `GET /export?TYPE=myWatchList&L={ID}&JSON=1` (owner auth)
   - Import: `POST /import?TYPE=myWatchList&L={ID}` with `ADD=id1,id2` and/or `REMOVE=id3,id4` (owner auth)
   - **Non-destructive** — ADD and REMOVE are incremental, no overwrite
   - **No documented player restrictions** — not tied to draftPlayerPool
   - **Unordered** — appears to be a set, not an ordered list
   - MFL web UI: `options?L={ID}&O=178`
   - Purpose: Year-round player tracking (watch free agents, trade targets, etc.)

2. **`myDraftList`** (export + import)
   - Export: `GET /export?TYPE=myDraftList&L={ID}&JSON=1` (owner auth)
   - Import: `POST /import?TYPE=myDraftList&L={ID}` with `PLAYERS=id1,id2,id3` (owner auth)
   - **Destructive overwrite** — completely replaces previous list
   - **Ordered** — player ID order defines ranking
   - **Possibly restricted to draftPlayerPool** — TheLeague has draftPlayerPool="Rookie", which MAY limit this to rookie players only. Needs auth testing to confirm.
   - Purpose: Pre-draft board builder, shown in MFL's Live Draft Room

3. **`playerRanks`** (export only, read-only)
   - Export: `GET /export?TYPE=playerRanks&JSON=1` (public, no auth)
   - Optional: `POS` (position filter), `SOURCE` (default: "sharks")
   - Returns ALL players ranked by FantasySharks experts
   - **Not personalizable** — static external rankings
   - Fields: `rank`, `id`, `last_week`, `change`
   - Could serve as default/seed ordering for custom rankings UI

**Endpoints that do NOT exist on MFL (confirmed 2026-02-27):**
- No `playerBoard` or `bigBoard` endpoint
- No `favoritesList` endpoint
- No `customRankings` endpoint
- No `tierList` endpoint

**Recommendation for custom rankings feature:**
- Use `myWatchList` as the MFL-synced "flagged players" list (add/remove players the user cares about)
- Store the actual ranking ORDER client-side (cookies, localStorage) or server-side (our own DB/API) since myWatchList is unordered
- Use `playerRanks` as default seed data for initial player ordering
- Use `myDraftList` specifically for rookie draft board ordering (if it accepts all players, it's even better since it's already ordered)
- **Critical unknown:** Need to test with auth whether myDraftList accepts non-rookie player IDs when draftPlayerPool="Rookie"

**Evidence:**
- MFL API docs at `api_info?STATE=details` list both endpoints
- Unauthenticated calls to both return `"API requires logged in user"` error
- playerRanks returns proper JSON from `api.myfantasyleague.com` (confirmed response structure)
- No other personalized list endpoints found in the complete MFL API endpoint inventory

---

## 2026-03-13 - Commissioner Write Operations Require www49 Host AND Two Cookies

**Context:** Testing contract salary writes against test league 36189

**Insight:** MFL commissioner-level import/write operations have TWO critical requirements that differ from read operations:

1. **Host matters:** `api.myfantasyleague.com` rejects commissioner writes with "API requires commissioner access" even with valid cookies. Writes MUST target `www49.myfantasyleague.com` (the league's actual host) directly.

2. **Two cookies required:** Commissioner writes need BOTH:
   - `MFL_USER_ID` — authenticates the user
   - `MFL_IS_COMMISH` — grants commissioner privilege

   Read operations only need `MFL_USER_ID`.

**Evidence:**
```
# FAILS — api subdomain rejects commissioner imports
POST https://api.myfantasyleague.com/2026/import?TYPE=salaries&L=36189&APPEND=1
Cookie: MFL_USER_ID=xxx; MFL_IS_COMMISH=yyy
→ <error>API requires commissioner access for league id 36189</error>

# WORKS — www49 with both cookies
POST https://www49.myfantasyleague.com/2026/import?TYPE=salaries&L=36189&APPEND=1
Cookie: MFL_USER_ID=xxx; MFL_IS_COMMISH=yyy
→ <status>OK</status>
```

**Impact:** The contract writer (`src/utils/mfl-contract-writer.ts`) was using `api.myfantasyleague.com` as default host, which would fail for all commissioner writes. Fixed to use `www49` for writes and both cookies.

**Environment variables (names match the MFL cookie names):**
- `MFL_USER_ID` — the `MFL_USER_ID` cookie value
- `MFL_IS_COMMISH` — the `MFL_IS_COMMISH` cookie value
- `MFL_WRITE_HOST` — override write host (default: `https://www49.myfantasyleague.com`)
- `MFL_HOST` — override read host (default: `https://api.myfantasyleague.com`)

**Recommendation:** When obtaining commissioner credentials for any MFL league, always capture BOTH cookies from the browser. The `MFL_IS_COMMISH` cookie is set separately by MFL's commissioner login flow.
