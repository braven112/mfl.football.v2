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
