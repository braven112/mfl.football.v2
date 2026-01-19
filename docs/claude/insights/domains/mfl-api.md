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
