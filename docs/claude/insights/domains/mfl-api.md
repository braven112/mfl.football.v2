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

---

## 2026-03-13 - Node.js Undici Strips Cookie Headers on Cross-Origin Redirects

**Context:** All trade submissions (submit, respond, pending) were failing silently because MFL's `api.myfantasyleague.com` 302-redirects to `www49.myfantasyleague.com`, and Node.js undici strips the Cookie header on cross-origin redirects.

**Insight:** Node.js's built-in `fetch()` (powered by undici) automatically strips sensitive headers — including `Cookie`, `Authorization`, and `Proxy-Authorization` — when following redirects to a different origin. Since `api.myfantasyleague.com` and `www49.myfantasyleague.com` are different origins, the `MFL_USER_ID` cookie was silently dropped on every authenticated request that went through the redirect.

**Evidence:**
```javascript
// Cookie is present on first request to api.myfantasyleague.com
// After 302 redirect to www49.myfantasyleague.com, Cookie header is GONE
// MFL returns "API requires a logged in user" error
```

**Additional finding:** MFL's redirect behavior differs by endpoint and method:

| Endpoint | Method | Redirects? | Notes |
|----------|--------|------------|-------|
| `/export` | GET | Yes — 302 to www49 | Cookie stripped on redirect |
| `/import` | GET | Yes — 302 to www49 | Cookie stripped on redirect |
| `/import` | POST | **No redirect** | Processed directly at api.mfl |

**Fix:** Created `src/utils/mfl-fetch.ts` which uses `redirect: 'manual'` and follows redirects manually, re-attaching the Cookie header on each hop. All trade API routes now use this utility.

**Recommendation:** NEVER use raw `fetch()` with `redirect: 'follow'` (the default) when making authenticated requests to `api.myfantasyleague.com`. Always use `mflFetch()` from `src/utils/mfl-fetch.ts`. This also applies to `src/utils/mfl-matchup-api.ts:updateTradeBait()` which may have the same bug (uses POST with `redirect: 'follow'` — currently works because POST to `/import` doesn't redirect, but is fragile).

**Key files:**
- `src/utils/mfl-fetch.ts` — the redirect-safe fetch utility
- `src/pages/api/trades/submit.ts` — uses mflFetch
- `src/pages/api/trades/respond.ts` — uses mflFetch
- `src/pages/api/trades/pending.ts` — uses mflFetch

---

## 2026-03-13 - Commissioner Can Impersonate Franchise Owners via FRANCHISE_ID Parameter

**Context:** Researching how to let commissioners submit trade proposals through the trade builder when their session has `franchiseId: "0000"`

**Insight:** MFL's API has a documented commissioner impersonation mechanism for write (import) endpoints. From the official MFL API docs:

> "Requests that do not require commissioner access, when requested by a user who has commissioner access will be performed on the commissioner's franchise. Some requests (not all) can also be performed on behalf of another franchise by passing the FRANCHISE_ID parameter. If the commissioner does not have a franchise and no franchise id is given, it will return an error."

This is the root cause of the error "Can not specify a FRANCHISE_ID (0001) other than the owner's ()". The empty `()` confirms the commissioner account has no franchise of its own (`franchiseId: "0000"` in our session), and MFL is rejecting the attempt because it sees a mismatch.

**Resolution:** Pass `FRANCHISE_ID` as a parameter in the POST body (not the cookie). When the authenticated user is a commissioner and a `FRANCHISE_ID` is supplied, MFL performs the action on behalf of that franchise.

**Endpoints that support FRANCHISE_ID for commissioner impersonation (confirmed from MFL API details page):**
- `tradeProposal` — "Commissioner can impersonate owner using FRANCHISE_ID parameter"
- `tradeResponse` — "indicate on which franchise behalf to do the request"
- `lineup` — submit starting rosters for another team
- `fcfsWaiver` — execute immediate add/drop for another team
- `waiverRequest` — file waiver claims for another team
- `blindBidWaiverRequest` — submit FAAB bids for another team
- `ir` — manage IR activations for another team
- `taxi_squad` — handle taxi squad moves for another team
- `messageBoard` — post messages on behalf of another team
- `poolPicks` — submit pool picks for another team
- `survivorPoolPick` — make survivor picks for another team

**What does NOT work:** The `APIKEY` authorization method cannot be used for commissioner-access endpoints — it only works for owner-level endpoints. Commissioner impersonation requires cookie-based auth (`MFL_USER_ID` + `MFL_IS_COMMISH`).

**Critical distinction — two scenarios:**

1. **Commissioner logging in as owner:** A user who is BOTH commissioner AND franchise owner can log in normally. Their `myleagues` response will return their actual `franchise_id` (not `0000`). They do NOT need to use `FRANCHISE_ID` impersonation at all — their `MFL_USER_ID` cookie already identifies them as an owner.

2. **Pure commissioner (no franchise):** A user who is ONLY a commissioner (no franchise in the league) will get `franchiseId: "0000"` from `myleagues`. They MUST use `FRANCHISE_ID` impersonation to act on behalf of any franchise.

**The actual bug in `submit.ts`:** The code at line 57 currently does:
```typescript
if (franchiseId && franchiseId !== '0000') {
  params.set('FRANCHISE_ID', franchiseId);
}
```
This looks correct — it sends `FRANCHISE_ID` when the client provides a non-`0000` franchise ID. The issue is likely that the commissioner's `MFL_USER_ID` cookie is being sent without the `MFL_IS_COMMISH` cookie. MFL needs BOTH cookies to grant commissioner privileges that allow the `FRANCHISE_ID` override.

**The missing piece:** When a commissioner logs in via our login flow (`mfl-login.ts`), we only capture `MFL_USER_ID`. We do NOT capture `MFL_IS_COMMISH`. Without `MFL_IS_COMMISH`, MFL treats the user as a regular owner, but since the account has no franchise (`"owner's ()"`), it rejects any `FRANCHISE_ID` that doesn't match.

**Two possible solutions:**

**Option A — Capture `MFL_IS_COMMISH` during login (preferred for true commissioner accounts)**
- After Step 1 login, read the `Set-Cookie` response headers for `MFL_IS_COMMISH`
- Store it in the session JWT alongside `MFL_USER_ID`
- Forward BOTH cookies in write operations: `Cookie: MFL_USER_ID=${userId}; MFL_IS_COMMISH=${commishCookie}`

**Option B — Commissioner logs in as owner (preferred for dual-role users)**
- If the commissioner IS also a franchise owner, the `myleagues` API returns their real `franchise_id`
- Their `MFL_USER_ID` cookie alone is sufficient for owner-level write operations (no `FRANCHISE_ID` needed, no `MFL_IS_COMMISH` needed)
- This is the simpler path — just ensure `franchise_id` from `myleagues` is correctly stored (not overridden with `0000`)

**Investigating Option B failure mode:** The `mfl-login.ts` code searches `myleagues` for the `franchise_id`. For a commissioner-who-is-also-an-owner, this should return the correct franchise ID. If it's returning `0000`, that means either:
- The `myleagues` API returns the commissioner's franchise_id as `0000` when they are a pure commissioner
- OR the franchise_id field is being normalized to `0000` somewhere

**Recommendation for trade builder:** Implement Option B first (it's free for dual-role users). For the minority case of pure commissioners with no franchise, implement Option A (capture `MFL_IS_COMMISH`).

**Evidence:**
- MFL API docs at `https://www49.myfantasyleague.com/2025/api_info?L=13522` — commissioner impersonation section
- MFL API details at `https://www49.myfantasyleague.com/2025/api_info?STATE=details&L=13522` — per-endpoint FRANCHISE_ID documentation
- Error message from live API: "Can not specify a FRANCHISE_ID (0001) other than the owner's ()"

---

## 2026-03-28 - Lineup Import (setStarters) API: Complete Specification

**Context:** Researching the lineup submission API for a lineup management feature (TheLeague, L=13522).

**Insight:** MFL has a `lineup` import endpoint that is the correct write path for setting a franchise's weekly starters. Here is the full confirmed specification:

### Write Endpoint
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=lineup
(Handles redirect to www49 automatically via mflFetch)
```

**Parameters (POST body, application/x-www-form-urlencoded):**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `TYPE` | Yes | Must be `lineup` |
| `L` | Yes | League ID (e.g., `13522`) |
| `W` | Yes | Week number (integer, e.g., `14`) |
| `STARTERS` | Yes | Comma-separated list of MFL player IDs (see format below) |
| `COMMENTS` | No | Short message saved with the lineup submission |
| `TIEBREAKERS` | No | Tiebreaker player IDs (only for leagues using tiebreaker rules) |
| `BACKUPS` | No | Deprecated — no longer supported |
| `FRANCHISE_ID` | No | Commissioner-only: act on behalf of another franchise |

**Authentication:** Owner (requires `MFL_USER_ID` cookie). Use `mflFetch()` from `src/utils/mfl-fetch.ts` — do NOT use raw `fetch()` because `api.myfantasyleague.com` 302-redirects to `www49` and Node.js undici strips the Cookie header on cross-origin redirects.

**STARTERS format:** Comma-separated MFL player IDs. There is NO position slot designation — MFL figures out which slot each player fills based on their position and league roster settings. Example: `"13592,13604,15255,14836,14974,13674,17104,11936,0532,"` (trailing comma is present in MFL's own data but probably not required on submit).

**Defense player IDs:** Team defenses use a 4-digit numeric ID with a leading zero, e.g., `0532` for the Texans. These are returned by `TYPE=players` with `position: "Def"`. They are NOT regular player IDs — the format is always `0{NNN}`.

**TheLeague starter count:** Exactly 9 starters required (`starters.count: "9"`). Positions: 1 QB, 1-4 RB, 1-4 WR, 1-4 TE, 1 PK, 1 Def (flexible RB/WR/TE slots fill the remaining spots to reach 9).

### Read Endpoint (GET current lineup)
There is no dedicated `myLineup` or `startingLineups` export. To read the current/submitted lineup use one of:

1. **`weeklyResults`** (best for submitted lineups): `TYPE=weeklyResults&W={week}`
   - Response: franchise objects with `starters` (comma-separated IDs), `nonstarters`, `optimal`, and a `player` array where each player has `{ id, score, status: "starter"|"nonstarter", shouldStart: "0"|"1" }`
   - Only available AFTER the week has been processed/played

2. **`rosters`** with `W={week}` parameter: `TYPE=rosters&W={week}`
   - Returns all rostered players but NO starter/bench distinction — the roster response only has `status: "ROSTER"|"INJURED_RESERVE"|"TAXI_SQUAD"`, not whether they're starting
   - Use this to know what players are available to slot

3. **MFL web options O=06**: `https://www49.myfantasyleague.com/{YEAR}/options?L=13522&O=06`
   - Viewing page shows submitted lineups for all franchises with timestamps

**Key finding: No GET-before-SET needed.** The `lineup` import completely overwrites whatever was previously set. You just submit the full list of 9 starter IDs.

### FLEX Logic
MFL handles FLEX automatically. TheLeague's starters config says:
- QB: exactly 1
- RB: 1-4 (min 1, max 4)
- WR: 1-4 (min 1, max 4)
- TE: 1-4 (min 1, max 4)
- PK: exactly 1
- Def: exactly 1

As long as you submit 9 player IDs where each position constraint is satisfied, MFL assigns the slots. You do NOT pass slot names like "FLEX" — just player IDs in any order.

### Response Format
MFL API documentation does not explicitly document the success/failure response format for `lineup`. Based on the pattern from other write endpoints:
- **Success:** `<status>OK</status>` (XML) or HTTP 200 with status body
- **Error:** `<error>...</error>` wrapper with description
- Always HTTP 200 even for errors — must check body content for `<error>` tag

### Future Weeks
The `W` parameter accepts any week number. MFL does not document explicit restrictions on setting lineups for future weeks. In practice, lineups lock when the first game of a given week's slate kicks off (NFL game time).

### Commissioner Impersonation
Supported via `FRANCHISE_ID` parameter in the POST body. Requires both `MFL_USER_ID` AND `MFL_IS_COMMISH` cookies for commissioner-level auth (same pattern as other commissioner write operations).

**Evidence:**
- MFL API details page: `https://www49.myfantasyleague.com/2025/api_info?STATE=details&L=13522`
- Live `weeklyResults` W=1, W=14, W=17 responses confirm `starters` field format (comma-separated IDs with trailing comma)
- Defense player IDs confirmed via `TYPE=players` lookup (e.g., `0532`=Texans, `0520`=Commanders, `0504`=Patriots)
- TheLeague starter count confirmed from `data/theleague/mfl-feeds/2025/league.json` starters object
- Write pattern confirmed from `trades/submit.ts`, `move-to-ir.ts`, `tradeBait` import

**Related files:**
- `src/utils/mfl-fetch.ts` — use for all authenticated writes
- `src/pages/api/move-to-ir.ts` — canonical simple write pattern
- `src/pages/api/trades/submit.ts` — canonical mflFetch write pattern

---

## 2026-03-19 - Auction Timing: What MFL Provides vs What It Doesn't

**Context:** Researching how to determine auction end time and bid-level timestamps for league 13522's 2026 auction (March 15-21, 2026)

### What Timing Data IS Available

**On `auctionResults` (completed auctions only):**
Each completed auction object has exactly two timing fields:
```json
{
  "player": "13674",
  "franchise": "0001",
  "winningBid": "2500000",
  "timeStarted": "1742479347",
  "lastBidTime": "1742479419"
}
```
- `timeStarted` — Unix timestamp (seconds) when the auction for this player started
- `lastBidTime` — Unix timestamp of the final/winning bid
- Both are Unix epoch seconds; multiply by 1000 for JS `Date` constructor
- `lastBidTime === timeStarted` means the player sold at the opening bid (no competing bids)
- These fields only appear in `auctionResults`, NOT in `transactions`

**On `transactions` (live auction events):**
Each `AUCTION_INIT`, `AUCTION_BID`, and `AUCTION_WON` transaction has exactly four fields:
```json
{
  "type": "AUCTION_BID",
  "franchise": "0005",
  "transaction": "14073|1550000|",
  "timestamp": "1773967270"
}
```
- `timestamp` — Unix epoch seconds when this specific bid/event occurred
- This IS the "when was the last bid placed" field for live auctions
- The `TRANS_TYPE` parameter filters by type: `?TRANS_TYPE=AUCTION_BID`, `?TRANS_TYPE=AUCTION_INIT`, `?TRANS_TYPE=AUCTION_WON`

### How to Determine "Last Bid Time" for an Active Player

Since `auctionResults` only shows completed auctions, for an **active** (in-progress) player auction:
1. Filter `transactions` for `AUCTION_BID` events matching the player ID
2. The transaction with the highest `timestamp` value is the most recent bid
3. That `timestamp` IS the "last bid time" for countdown purposes

**Derivation approach:**
```typescript
// Get last bid time for player 14823
const bidsForPlayer = transactions
  .filter(t => t.type === 'AUCTION_BID' && t.transaction.startsWith('14823|'))
  .sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
const lastBidTimestamp = bidsForPlayer[0]?.timestamp; // Unix seconds
const lastBidMs = parseInt(lastBidTimestamp) * 1000;  // JS Date
```

### What MFL Does NOT Provide

**No auction-wide end time:** The API has no field indicating when the overall auction week ends (e.g., "auction closes Friday at midnight"). This must come from league rules or manual configuration.

**No per-player countdown/expiry:** The `AUCTION_BID` and `AUCTION_INIT` transactions have no `expires` or `deadline` field. The only timing-related field is the transaction's own `timestamp`. Compare this with `TRADE` transactions, which DO have an `expires` field — auctions do not.

**No bid timer on active auctions:** Unlike the league settings' `draftLimitHours` field for drafts, there is no `auctionBidTimer` or equivalent field. The auction "24-hour bid clock" (if the league uses one) is not exposed via API.

**No current player on block:** The API has no "currently active player" field. You must infer it from the most recent `AUCTION_INIT` that hasn't been followed by `AUCTION_WON` for the same player.

**`calendar` endpoint is auth-gated:** `TYPE=calendar` returns "API requires logged in user" for league 13522. Any auction scheduling events stored there are inaccessible without authentication.

### League Settings Fields (from `TYPE=league`)

These auction-related fields exist but none are timing fields:
- `auction_kind`: "email" — meaning auction nominations/bids happen via email
- `auctionStartAmount`: "45000000" — total cap ($45M)
- `minBid` / `bbidMinimum`: "425000" — floor bid
- `bidIncrement` / `bbidIncrement`: "25000" — minimum raise
- `bbidTiebreaker`: "SORT" — tiebreaker rule
- `bbidConditional`: "Yes" — conditional bids allowed

**Key implication:** `auction_kind: "email"` explains why there's no real-time bid timer. This is an email-based auction (owners email bids), not a live web interface. MFL processes those emails and records them as `AUCTION_BID` transactions, but the timing of the auction closure is determined by the commissioner's rules, not the API.

### Inferring Auction Status From Transaction Data

Since there's no explicit "auction active" flag, use this heuristic:
```typescript
// Is there an active auction?
const recentWindow = Date.now() - (7 * 24 * 60 * 60 * 1000); // last 7 days
const hasRecentAuctionActivity = transactions.some(
  t => ['AUCTION_INIT', 'AUCTION_BID', 'AUCTION_WON'].includes(t.type)
  && parseInt(t.timestamp) * 1000 > recentWindow
);

// Is the auction still going? (no AUCTION_WON for the most recent AUCTION_INIT player)
const latestInit = transactions.find(t => t.type === 'AUCTION_INIT');
const latestInitPlayerId = latestInit?.transaction.split('|')[0];
const hasWon = transactions.some(
  t => t.type === 'AUCTION_WON' && t.transaction.startsWith(`${latestInitPlayerId}|`)
);
const isAuctionActive = latestInit && !hasWon;
```

### Evidence (Live Verification 2026-03-19)

Verified against live league 13522 during active 2026 auction (March 15-21):
- `auctionResults`: Returns `{ "auctionUnit": { "unit": "LEAGUE" } }` with NO auction objects during active auction (0 completed auctions yet)
- `transactions`: 80+ `AUCTION_INIT` transactions, many `AUCTION_BID` transactions, 0 `AUCTION_WON` transactions — confirms auction is mid-stream
- First AUCTION_INIT timestamp: `1773955259` → Thu Mar 19 2026 (UTC)
- Recent AUCTION_BID timestamp: `1773967270` → same day, confirms real-time updates
- TRADE transactions DO have `expires` field; AUCTION transactions do NOT

**URLs used:**
```
https://www49.myfantasyleague.com/2026/export?TYPE=transactions&L=13522&TRANS_TYPE=AUCTION_INIT&JSON=1
https://www49.myfantasyleague.com/2026/export?TYPE=transactions&L=13522&TRANS_TYPE=AUCTION_BID&JSON=1
https://www49.myfantasyleague.com/2026/export?TYPE=transactions&L=13522&TRANS_TYPE=AUCTION_WON&JSON=1
https://www49.myfantasyleague.com/2026/export?TYPE=auctionResults&L=13522&JSON=1
https://www49.myfantasyleague.com/2026/export?TYPE=league&L=13522&JSON=1
```

---

## 2026-04-22 - `pendingTrades` Requires Authentication; Completed Trades in `transactions`

**Context:** Querying pending trade proposals for TheLeague (13522, 2026) to report current trade activity.

**Insight:** The `pendingTrades` export endpoint requires owner-level authentication (`MFL_USER_ID` cookie). Without credentials it returns HTTP 403 — not a JSON error body, just a 403. This differs from some other endpoints that return a JSON error message when unauthenticated.

**Workaround for read-only trade inspection:** Completed (accepted) trades appear in the `transactions` export as `type: "TRADE"` entries. This IS accessible without auth via the cached `transactions.json`. However, it only shows trades that have already been processed — not proposals still pending a response.

**TRADE transaction field notes (confirmed from 2026 TheLeague data):**
- `franchise` = the originating franchise (who sent the proposal)
- `franchise2` = the receiving franchise (who got the offer)
- `franchise1_gave_up` = comma-separated assets given by `franchise` (trailing comma present)
- `franchise2_gave_up` = comma-separated assets given by `franchise2` (trailing comma present)
- `timestamp` = Unix seconds when the trade was ACCEPTED/PROCESSED (not when it was proposed)
- `expires` = Unix seconds of the original proposal's expiration deadline (still present even on completed trades)
- `by_commish: "1"` = trade was initiated or processed by the commissioner

**Draft pick decoding in transaction data:**
- `DP_2_10` = current-year pick, round 3, pick 11 (both indices are zero-based: add 1 to each)
- `FP_{franchiseId}_{year}_{round}` = future-year pick (round is 1-based here, no offset needed)

**2026 TheLeague trade activity (as of April 22 cache):**
- Only 1 completed trade in 2026: Bring the Pain (0008) traded their 2026 Round 3/Pick 11 to Computer Jocks (0010) for Isiah Pacheco (RB, DET). Processed 2026-03-11, commissioner-initiated.
- No pending trades could be confirmed without auth, but the `transactions` cache (fetched 2026-04-22T04:57Z, most recent activity 2026-03-28) shows no additional trade activity.

**Additional finding (confirmed 2026-04-22):** The live `transactions` endpoint for 2026 also returns HTTP 403 when queried without auth from a server context (both `api.myfantasyleague.com` and `www49.myfantasyleague.com`). This is notable because the 2025 transactions endpoint was accessible unauthenticated. The 2026 league may have stricter access controls, OR the server environment's IP is blocked. The cached `transactions.json` (fetched by the daily `fetch-mfl-feeds.mjs` script with auth) remains the reliable source for completed trade history.

**Recommendation:** To programmatically check pending trades without requiring user login, consider polling the project's own `/api/trades/pending` route (which handles auth server-side) from a server context where session cookies are available. For commissioner-level visibility of ALL pending trades across all franchises, use `FRANCHISE_ID=0000` parameter on the `pendingTrades` export.

---

## 2026-04-22 - Commissioner Lockout Setting: Field Name and API Interaction

**Context:** Researching whether MFL's "commissioner lockout" feature gates the `pendingTrades` API endpoint, and what the league setting field is named.

**The field name is `lockout`** — confirmed present in the `league` export across multiple years and both leagues (TheLeague and AFL Fantasy):

```json
"lockout": "Yes"   // commissioner lockout enabled
"lockout": "No"    // commissioner lockout disabled
```

TheLeague 2026 (`data/theleague/mfl-feeds/2026/league.json`) has `"lockout": "Yes"` at line 119.

**Does the lockout restrict `pendingTrades&FRANCHISE_ID=0000`?**

**MFL docs are not directly accessible** (api_info pages return 403 from this server environment). However, based on codebase evidence and MFL's design intent:

- The lockout setting is documented in MFL as preventing the commissioner from viewing other teams' pending trades/transactions in the **MFL web UI**. This protects franchise owners' trade negotiation privacy from the commissioner.
- **Best guess (high confidence): Yes, the API also respects the lockout.** MFL's lockout is a server-side access control, not just a UI toggle. If MFL enforces it only in the UI but not the API, the entire feature would be trivially bypassable — which would defeat its purpose. MFL's design philosophy is to gate authenticated commissioner reads at the server level.
- A commissioner calling `pendingTrades&FRANCHISE_ID=0000` when `lockout: "Yes"` is likely to receive either an error or only trades involving the commissioner's own franchise — NOT all league-wide pending trades.

**There is no definitive API documentation confirming the exact behavior.** The `pendingTrades` entry in `docs/features/mfl-api.md` documents the `FRANCHISE_ID` parameter but does not mention lockout interactions. This should be tested empirically with a commissioner-authenticated session against a lockout-enabled league.

**Summary table:**

| League setting field | Values | Source confirmed |
|---|---|---|
| `lockout` | `"Yes"` / `"No"` | Multiple cached `league.json` files across both leagues |

**Related data files for reference:**
- `data/theleague/mfl-feeds/2026/league.json` — `lockout: "Yes"`
- `data/afl-fantasy/mfl-feeds/2025/league.json` — `lockout: "Yes"`
- `data/afl-fantasy/mfl-feeds/2012/league.json` — `lockout: "No"` (earliest "No" example)

---

## 2026-05-04 - IR and Taxi Squad Write Endpoints: Authoritative Specification from Transaction Evidence

> **⚠️ SUPERSEDED — see 2026-05-07 entry below.** The parameter-name inference in this insight was WRONG. The transaction log uses past-tense field names (`activated`/`deactivated`/`promoted`/`demoted`) describing what happened; the import endpoint uses verb-form parameter names (`ACTIVATE`/`DEACTIVATE`/`PROMOTE`/`DEMOTE`) describing what to do. They are not the same. Sending the past-tense names produces a silent `<status>OK</status>` response with no actual state change — the symptom that wasted #166 / #171 / #173 / #174 / multiple iterations on #175. Kept here as a record of the failure mode.

**Context:** Researching the correct owner-level write endpoints for IR moves and taxi squad moves for TheLeague (L=13522, 2026). The MFL api_info pages return 403 from this server environment. Authoritative data was extracted from the cached `transactions.json` files (2025: 1152 transactions, 2026: 759 transactions).

### Evidence Source

The `transactions` export uses the SAME field names as the corresponding import endpoint parameters. MFL's API design is consistent: the import parameters are named to match what appears in the transaction log. This is confirmed by comparison across multiple known endpoints (e.g., `tradeProposal` → TRADE transaction uses `franchise`, `franchise2`, `franchise1_gave_up`/`franchise2_gave_up`; `lineup` → `starters` field).

### IR Transactions: Confirmed Field Names

From 90 IR transactions in the 2025 data (0 had `by_commish: "1"` — ALL were owner-initiated):

```json
{"type": "IR", "franchise": "0001", "activated": "14800,", "deactivated": "", "timestamp": "..."}
{"type": "IR", "franchise": "0009", "deactivated": "13113,", "activated": "", "timestamp": "..."}
{"type": "IR", "franchise": "0010", "activated": "16269,", "deactivated": "16175,", "timestamp": "..."}
```

**Transaction field semantics:**
- `activated` = players MOVED TO IR (activated onto the IR list) — comma-separated with trailing comma
- `deactivated` = players REMOVED FROM IR (returned to active roster) — comma-separated with trailing comma
- `franchise` = the owning franchise (4-digit string)
- No `by_commish` field — all IR moves in 2025 were done by owners, not commissioner

**CRITICAL IMPLICATION:** The transaction terminology (`activated`/`deactivated`) maps directly to the import parameter names. This means the `import?TYPE=ir` endpoint almost certainly uses `ACTIVATED` and `DEACTIVATED` parameters (not `PLAYER` singular, not `MOVE=ACTIVATE/DEACTIVATE`).

### IR Endpoint: Inferred Write Specification

The `import?TYPE=ir` endpoint is the **canonical** owner-level IR endpoint, NOT `freeagency?TYPE=moveToIR`. Evidence:

1. The MFL api_info (confirmed from the agents README at line 88) lists both:
   - Commissioner-impersonable endpoints include `ir` (documented in the 2026-03-13 insight above)
   - The `freeagency` endpoint is a separate legacy path

2. The transaction type is `IR`, matching `TYPE=ir` — not `TYPE=moveToIR` or `TYPE=freeagency`

3. The `freeagency?TYPE=moveToIR` path appears to be a LEGACY endpoint. The current implementation in `mfl-matchup-api.ts:544` uses this legacy form and appears to be functionally incorrect for the modern MFL API.

**Likely correct import endpoint:**
```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=ir&L={LEAGUE_ID}
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={userCookie}

ACTIVATED={player_id_1},{player_id_2}&DEACTIVATED={player_id_3}&FRANCHISE_ID={franchise_id}
```

**Parameters (inferred from transaction data):**
- `ACTIVATED` — comma-separated player IDs to place ON the IR (move from active roster to IR)
- `DEACTIVATED` — comma-separated player IDs to return FROM IR to active roster
- Either or both can be populated in a single call (swap supported)
- `FRANCHISE_ID` — required for commissioner impersonation; behavior for owner mode TBD (may or may not be required when owner calls with their own cookie)

**Confidence: Medium** — The field name mapping from transactions is strong evidence, but the exact parameter names for the write endpoint have not been verified by a live API call or documentation access.

**The existing `freeagency?TYPE=moveToIR` implementation:**

```typescript
// src/utils/mfl-matchup-api.ts:544 (current implementation)
const url = `${this.baseUrl}/${this.config.year}/freeagency`;
params: { TYPE: 'moveToIR', L: ..., PLAYER: playerId, FRANCHISE: franchiseId }
```

This uses:
- Path: `/freeagency` (not `/import?TYPE=ir`)
- `PLAYER` singular (not `PLAYERS` or `ACTIVATED`)
- `FRANCHISE` (not `FRANCHISE_ID`)

This may still work if MFL kept the legacy endpoint functional, but it is NOT the canonical documented import endpoint. The `src/pages/api/move-to-ir.ts` uses this via `mflClient.movePlayerToIR()` which also uses raw `fetch()` with `redirect: 'follow'` — this is a double problem: wrong endpoint AND missing redirect safety.

### TAXI Transactions: Confirmed Field Names

From 113 TAXI transactions in the 2025 data (107 were owner-initiated, only 6 had `by_commish: "1"`):

```json
{"type": "TAXI", "franchise": "0001", "promoted": "17096,", "demoted": "", "timestamp": "..."}
{"type": "TAXI", "franchise": "0008", "promoted": "17037,", "demoted": "17076,", "timestamp": "..."}
{"type": "TAXI", "franchise": "0011", "promoted": "", "demoted": "17036,", "timestamp": "..."}
```

**Transaction field semantics:**
- `promoted` = players MOVED TO TAXI SQUAD (promoted from free agent/active to taxi) — comma-separated with trailing comma
- `demoted` = players REMOVED FROM TAXI SQUAD (demoted from taxi to active or released) — comma-separated with trailing comma
- `franchise` = the owning franchise (4-digit string)
- Most taxi moves (107/113 = 94.7%) did NOT have `by_commish: "1"` — owners DO this themselves

**CRITICAL IMPLICATION:** The import endpoint almost certainly uses `PROMOTED` and `DEMOTED` parameters.

### Taxi Squad Endpoint: Inferred Write Specification

```
POST https://api.myfantasyleague.com/{YEAR}/import?TYPE=taxi_squad&L={LEAGUE_ID}
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={userCookie}

PROMOTED={player_id_1},{player_id_2}&DEMOTED={player_id_3}&FRANCHISE_ID={franchise_id}
```

**Parameters (inferred from transaction data):**
- `PROMOTED` — comma-separated player IDs to place ON the taxi squad
- `DEMOTED` — comma-separated player IDs to remove FROM the taxi squad
- Either or both can be populated (swap-style operations confirmed in transactions)
- `FRANCHISE_ID` — optional for owner mode; required for commissioner impersonation

**Owner mode authentication:** The 107 owner-initiated taxi moves confirm that owner-level auth (`MFL_USER_ID` cookie alone, no `MFL_IS_COMMISH`) IS sufficient for taxi squad moves on the owner's own roster.

### Eligibility Rules (From League Config and Transaction Evidence)

**Taxi squad size:** TheLeague has `taxiSquad: "3"` — maximum 3 players on taxi at any time.

**Rookie-only restriction:** Examining all taxi squad players in 2025 and 2026:
- All 2025 taxi players: IDs 17033, 17064, 17074, 17031, 17076, 17108, 17056, 17036, 17243
- All 2026 taxi players: IDs 17462, 17501, 17499
- The IDs 17xxx are all 2024/2025/2026 rookies — the range is consistent with recent draft classes
- There is no counter-example of a veteran (ID < 15000) on taxi squad in the entire dataset

**Conclusion:** In TheLeague, taxi squad IS restricted to rookies in practice. This is likely enforced by MFL based on the `draftPlayerPool: "Rookie"` league setting, though no explicit `taxiSquadEligibility` field is exposed in the league API.

**`contractInfo: "TO"` field:** The 2026 taxi players all have `contractInfo: "TO"`. This appears to mean "Taxi Option" — a special contract status for taxi squad players. The 2025 taxi players have `contractInfo: ""` (empty). This field change between 2025 and 2026 likely reflects a league rule change for how taxi contracts are recorded.

**Player must be on active roster first:** Transaction evidence shows all `promoted` moves are players transitioning from roster status to taxi status, not from free agent. The player must be on the franchise's active roster before being taxied.

### Implications for Existing Implementation

The current `movePlayerToIR()` in `mfl-matchup-api.ts:544` has three issues:
1. Uses `/freeagency` path instead of `/import?TYPE=ir`
2. Uses `PLAYER` singular instead of `ACTIVATED`/`DEACTIVATED`
3. Uses raw `fetch()` with default redirect behavior (will silently drop Cookie on redirect)

Recommend migrating to `/import?TYPE=ir` with `ACTIVATED`/`DEACTIVATED` params via `mflFetch()`.

**Evidence files:**
- `data/theleague/mfl-feeds/2025/transactions.json` — 90 IR + 113 TAXI transactions analyzed
- `data/theleague/mfl-feeds/2026/transactions.json` — TAXI transactions confirmed same structure
- `data/theleague/mfl-feeds/2026/rosters.json` — TAXI_SQUAD status players with `contractInfo: "TO"`
- `data/theleague/mfl-feeds/2026/league.json` — `taxiSquad: "3"`, `draftPlayerPool: "Rookie"`

---

## 2026-05-04 - getRosters() Was Stripping Cookies on api→www49 Redirect

**Context:** Building owner-mode roster-move endpoints (`/api/move-to-ir`, `/api/move-to-practice`) that preflight by calling `mflClient.getRosters()` to verify the player belongs to the user's roster before submitting the write.

**Insight:** `MFLMatchupApiClient.getRosters()` in `src/utils/mfl-matchup-api.ts` used the internal `makeRequest()` helper (raw `fetch()` with `redirect: 'follow'`). Node's undici strips sensitive headers — including `Cookie` — on cross-origin redirects, and `api.myfantasyleague.com` always 302-redirects authenticated GETs to `www49.myfantasyleague.com`. The `MFL_USER_ID` cookie was silently dropped on the redirect, so the response came back as if unauthenticated.

If MFL ever auth-gates the rosters export (the 2026 transactions endpoint is already auth-gated — see 2026-04-22 entry), `getRosters()` would silently return `{}`, and every roster-membership preflight check on top of it would yield a spurious "You can only move players from your own roster" 403.

This is the exact same redirect-strip bug previously fixed for trade endpoints and `move-to-ir` write calls. `getRosters()` was missed because reads "looked fine" — until they didn't.

**Evidence:** `src/utils/mfl-matchup-api.ts:237` (before fix). Five callers across the codebase relied on it: `move-to-ir.ts`, `move-to-practice.ts`, `trade-bait.ts`, `trades/submit.ts`, `cut-player.ts`. All were affected.

**Recommendation:** Any MFL fetch carrying an auth cookie must go through `mflFetch()` from `src/utils/mfl-fetch.ts` — even for reads. Default-on rule: if you're attaching `Cookie: MFL_USER_ID=...`, you're using `mflFetch`. If you're hitting a public endpoint with no cookie, raw `fetch()` is fine. The fix path: when `mflUserId` is configured, route through `mflFetch`; otherwise fall back to the unauthenticated `makeRequest` for non-auth callers.

---

## 2026-05-04 - MFL `players` Export Single-Object Quirk on Single-ID Queries

**Context:** Server-side rookie-status gate in `/api/move-to-practice` queries `TYPE=players&PLAYERS={id}&DETAILS=1` for one player at a time.

**Insight:** When the `PLAYERS` filter narrows the response to exactly one player, MFL returns `players.player` as a SINGLE OBJECT — not a one-element array. This is the same single-vs-array shape quirk documented for `myleagues` and other filtered exports. Code that does `data.players.player.find(...)` will throw because `.find` doesn't exist on a plain object.

**Evidence:** `src/pages/api/move-to-practice.ts:fetchPlayerStatus` normalizes with `Array.isArray(raw) ? raw : [raw]` before `.find`.

**Recommendation:** Always normalize. Standard pattern across the codebase:
```ts
const raw = data?.players?.player;
const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
```
The triple-step (`Array.isArray ? : (raw ? [raw] : [])`) handles all three shapes: array, single object, and missing. Reuse this pattern wherever you read filtered MFL exports.

---

## 2026-05-07 - IR and Taxi Squad Write Endpoints: Verified Specification from Live api_info

**Context:** Final fix for the persistent silent-failure bug on `POST /api/move-to-ir` and `POST /api/move-to-practice` chased through PRs #166, #171, #173, #174 and several iterations on #175. The on-page debug panel added in #175 captured MFL returning `<status>OK</status>` 200 for every variant of `import?TYPE=ir` / `import?TYPE=taxi_squad` we tried — never an error, never persistence. The `/freeagency?TYPE=moveToIR` "legacy" path documented elsewhere in this codebase 404'd at every host.

**Insight:** **The MFL api_info spec page lists DIFFERENT parameter names than the transaction log fields.** The 2026-05-04 entry above inferred parameter names from the transaction log; that inference was wrong. The actual spec, copied verbatim from MFL's API Test Form on 2026-05-07 by an authenticated user (the page returns 403 from this server, so it can only be read from a logged-in browser):

### IR — `import?TYPE=ir`

> **ir** — Import an IR (activate/deactivate) move. Access restricted to league owners. Commissioner can impersonate owner using FRANCHISE_ID parameter.
>
> | Param | Description |
> |---|---|
> | `L` | League Id (required) |
> | `ACTIVATE` | Comma-separated list of player ids to activate (move from Injured Reserve to Active Roster). |
> | `DEACTIVATE` | Comma-separated list of player ids to deactivate (move from Active Roster to Injured Reserve). |
> | `DROP` | Comma-separated list of player ids to drop from the roster. Applies to all players regardless of roster status. |
> | `FRANCHISE_ID` | When called by the Commissioner, you must pass this parameter to indicate on which franchise behalf to do the request. |

### Taxi — `import?TYPE=taxi_squad`

> **taxi_squad** — Import a Taxi Squad (promote/demote) move. Access restricted to league owners. Commissioner can impersonate owner using FRANCHISE_ID parameter.
>
> | Param | Description |
> |---|---|
> | `L` | League Id (required) |
> | `PROMOTE` | Comma-separated list of player ids to promote (move from Taxi Squad to Active Roster). |
> | `DEMOTE` | Comma-separated list of player ids to demote (move from Active Roster to Taxi Squad). |
> | `DROP` | Comma-separated list of player ids to drop from the roster. Applies to all players regardless of roster status. |
> | `FRANCHISE_ID` | When called by the Commissioner, you must pass this parameter to indicate on which franchise behalf to do the request. |

**Critical clarifications**

- **Verb form, not past tense.** It is `ACTIVATE` / `DEACTIVATE` / `PROMOTE` / `DEMOTE` — not `ACTIVATED` / `DEACTIVATED` / `PROMOTED` / `DEMOTED`. The trailing `D` was the bug. MFL's import endpoint silently no-ops requests with unrecognized parameter names while still returning `<status>OK</status>` (it processed `TYPE` and `L` but had no recorded action to perform).
- **Direction semantics are inverted from how the transaction log reads.** `PROMOTE` means *move FROM Taxi TO Active* — i.e. promote off the practice squad up to the active roster. The transaction log's `promoted` field records the opposite: a player who got *placed onto* the taxi squad. Same flip for IR. Code that calls these has to map UI direction to the right verb carefully:

  | UI direction | IR (TYPE=ir) | Taxi (TYPE=taxi_squad) |
  |---|---|---|
  | "to" (move to IR / move to practice) | `DEACTIVATE` | `DEMOTE` |
  | "from" (off IR / promote to active) | `ACTIVATE` | `PROMOTE` |

- **Owner mode does NOT pass `FRANCHISE_ID`.** Per the spec, FRANCHISE_ID is *only* required when the commissioner is impersonating an owner. Owner-mode auth (`MFL_USER_ID` cookie alone) implies the franchise. Sending FRANCHISE_ID in a non-impersonating owner request is the same class of issue that broke the cron auto-taxi under league lockout (see "Commissioner Can Impersonate Franchise Owners via FRANCHISE_ID Parameter", 2026-03-13 entry).
- **The legacy `/freeagency?TYPE=moveToIR` path does not exist** at either `api.myfantasyleague.com` or `www49.myfantasyleague.com` for this league/year. It returned 404 on every test against `/2026/freeagency`. The references to it in `.claude/agents/qa-principal-engineer.md` and `.claude/agents/qa-api-debugger.md` (and `docs/features/mfl-api.md`) are wrong; they should be removed or updated to point at the canonical `import?TYPE=ir`. The 2026-05-04 inference above incorrectly classified `freeagency` as legacy-but-functional; in reality the canonical `import?TYPE=ir` works once the parameter names are right.

**Working request shape (owner mode)**

```http
POST https://api.myfantasyleague.com/{YEAR}/import
Content-Type: application/x-www-form-urlencoded
Cookie: MFL_USER_ID={userCookie}

TYPE=ir&L={leagueId}&DEACTIVATE={playerId}    # move TO IR
TYPE=ir&L={leagueId}&ACTIVATE={playerId}      # move OFF IR

TYPE=taxi_squad&L={leagueId}&DEMOTE={playerId}    # move TO taxi
TYPE=taxi_squad&L={leagueId}&PROMOTE={playerId}   # move OFF taxi
```

`mflFetch` handles the `api.* → www49` 302 redirect and re-attaches the cookie. Single-direction body (only the active param, no empty companion) — this matches the `cut-player.ts` working pattern.

**Process lesson:** Inference from observed transaction-log field names is *not* the same as a verified API spec, even when the names look matched. The 2026-05-04 entry above stated "Confidence: Medium — The field name mapping from transactions is strong evidence". That confidence was misplaced — every single one of those parameter inferences was wrong by one letter. Rule going forward: **don't ship inferred parameter names to a write endpoint without a live verification.** If the spec page returns 403 from this environment, ask the user to copy the relevant section from their authenticated browser before guessing.

**Evidence:** `src/utils/mfl-matchup-api.ts:597-690` after the fix; PR #175. The on-page debug panel from #175 captured both the silent-`OK` symptom (with wrong params) and the post-fix request shape — see `src/pages/theleague/rosters.astro` for that surface (intended to be ripped out in a follow-up once the fix is verified end-to-end).

---

## 2026-05-10 - Historical Champion Extraction: playoffBracket vs weeklyResults, and the Pre-2020 Cutoff

**Context:** Researching how to backfill AFL Fantasy (L=19621) champion data from 2003 to present via API rather than manual data entry.

**Finding 1: The only two viable endpoints for historical champion data are:**

1. `TYPE=playoffBracket&BRACKET_ID=1` — returns the championship game with `franchise_id` + `points` for each team in the final round. The winner is the franchise with the higher `points`. Bracket ID `1` is always the league championship bracket. This is the **preferred source** when it works.
2. `TYPE=weeklyResults&W={championship_week}` — returns all matchups for a given week including playoff games tagged with `isPlayoff=1`. The championship game can be identified by filtering for the bracket 1 championship week (readable from `TYPE=playoffBrackets` metadata: `startWeek + startWeekGames - 1`). This is a **fallback** for years where the bracket endpoint returns seed-only data.

**Finding 2: MFL does NOT have a `leagueHistory` or `championshipHistory` endpoint.** The `history.league` array inside `TYPE=league` returns URLs (host+year+leagueId) for every historical season, but does not include champion data.

**Finding 3: Pre-2020 playoffBracket returns seeds only — no franchise_ids or points.** For seasons 2019 and older, `TYPE=playoffBracket&BRACKET_ID=1` returns bracket structure (seeds, `winner_of_game` references) but no `franchise_id` or `points` fields. Confirmed by inspecting TheLeague's backfilled 2019 and 2020 data:
- 2020+: `{ "franchise_id": "0006", "points": "141.37" }` in each game slot
- 2019 and older: `{ "seed": "2" }` only — no franchise_ids

For pre-2020 years, `TYPE=weeklyResults&W={champ_week}` with `isPlayoff=1` matchup filtering is the correct path to identify the championship game participants and winner.

**Finding 4: The response shape for `playoffBracket` (BRACKET_ID=1) for a completed season (2020+):**
```json
{
  "playoffBracket": {
    "bracket_id": "1",
    "playoffRound": {
      "week": "17",
      "playoffGame": {
        "home": { "franchise_id": "0022", "points": "175.54", "seed": "1", "winner_of_game": "3", "bracket": "3" },
        "away": { "franchise_id": "0005", "points": "111.08", "seed": "2", "winner_of_game": "3", "bracket": "2" },
        "game_id": "1"
      }
    }
  }
}
```
Champion = franchise with higher `points`. Multi-round brackets have `playoffRound` as an array; single-game finals have it as an object.

**Finding 5: AFL Fantasy has a different host AND different league ID for every season 2003-2015, then settles on www44/L=19621 from 2016 onward.** The complete mapping is in `data/afl-fantasy/mfl-feeds/2024/league.json` under `league.history.league[]`. Each entry has `year` and `url` (extractable: `https://{host}/{year}/home/{leagueId}`):

| Year | Host | League ID |
|------|------|-----------|
| 2003 | www45 | 55011 |
| 2004 | www47 | 23644 |
| 2005 | www42 | 29232 |
| 2006 | www45 | 49793 |
| 2007 | www43 | 47555 |
| 2008 | www44 | 13233 |
| 2009 | www47 | 21465 |
| 2010 | www46 | 30033 |
| 2011 | www49 | 36377 |
| 2012 | www45 | 26792 |
| 2013 | www45 | 48338 |
| 2014 | www45 | 40840 |
| 2015 | www44 | 14236 |
| 2016-2025 | www44 | 19621 |

**CAUTION:** The cached 2011 AFL data (`data/afl-fantasy/mfl-feeds/2011/`) was fetched with league ID `48815` (incorrect — that's a TheLeague year ID). The correct 2011 AFL league ID is `36377` on `www49`. A re-fetch with the correct ID is needed.

**Finding 6: Authentication — historical bracket and weeklyResults reads are public (no auth required).** These are `TYPE=export` read-only endpoints. No cookie or API key needed for past seasons.

**Finding 7: The existing `scripts/compute-franchise-history.mjs` `getChampionshipResult()` function already handles both cases** — it reads `brackets['1'].playoffBracket`, finds the last `playoffRound`, takes `franchise_id` + `points` from the final game, and falls back to null if `franchise_id` is missing. AFL backfill can reuse this logic.

**Recommended backfill strategy for AFL champions 2003-2025:**
1. Use `data/afl-fantasy/mfl-feeds/2024/league.json` → `history.league[]` to build the host+year+leagueId map.
2. For each year 2016-2025: `https://www44.myfantasyleague.com/{year}/export?TYPE=playoffBracket&L=19621&BRACKET_ID=1&JSON=1`
3. For years 2003-2015: same endpoint pattern using the correct host and league ID per the table above.
4. If `franchise_id` is absent in the response (pre-2020 era), fall back to `TYPE=weeklyResults&W={champ_week}` and filter for `isPlayoff=1` matchups. Championship week = `startWeek + startWeekGames - 1` from `TYPE=playoffBrackets` metadata.
5. For the oldest years (2003-2010), MFL's playoff bracket endpoint may not exist at all on archived hosts — in that case weeklyResults is the primary source, or manual curation is required.
6. The resulting data should be stored as `data/afl-fantasy/championship-history.json` mirroring TheLeague's `data/theleague/championship-history.json` shape: `{ championships: [{ year, champion, runnerUp, championName, runnerUpName }] }`.

**Evidence:**
- AFL 2024 playoff-brackets.json: `data/afl-fantasy/mfl-feeds/2024/playoff-brackets.json` (bracket 1, week 17 game: 0022 defeats 0005)
- TheLeague 2019 playoff-brackets.json: seeds only, no franchise_ids (pre-2020 cutoff confirmed)
- TheLeague 2020 playoff-brackets.json: franchise_ids + points present (2020+ works)
- History mapping: `data/afl-fantasy/mfl-feeds/2024/league.json` → `league.history.league[]`
- AFL champion extraction logic: `scripts/compute-franchise-history.mjs:181-227` (`getChampionshipResult()`)

