## Playoff Brackets Implementation Notes

**Data sources**
- Playoff brackets API: `https://www49.myfantasyleague.com/2025/api_info?STATE=test&CCAT=export&TYPE=playoffBrackets&L=13522`
- Live scoring/scores API: use MFL live scoring/schedule endpoints (to show live/final scores).
- Use the existing team assets map (icons/banners/names) already used in draft/rosters.

**Brackets to support**
- Championship bracket (7 teams) — most prominent.
  - Seeds 8 vs 9 play-in feeds into losers bracket of championship.
  - Loser of 8/9 goes to toilet consolation (eligible for pick 2.18).
  - Single elimination.
- Consolation/toilet brackets as returned by API; championship always rendered first/top.

**Seeding / records**
- Use the same seeding list as the playoff standings page (top 7 seeds and their rules).
- Records shown should match playoff standings page data. No ties to worry about.

**Layout & UI**
- Championship bracket visually emphasized.
- Show team icon + team name (icons 3rem × 3rem).
- Show team records alongside names.
- Single elimination lines/lanes.
- Mobile: horizontal scroll for rounds (best practice; stack rounds in a horizontal scroll area).
- Year dropdown like standings, default to newest year; allow historical seasons.
- Live games: show live score; final games: show final score (API may already provide finals).

**Questions resolved**
1) Brackets: all supported, with championship as primary.  
2) API: use playoffBrackets export (URL above) + live scoring.  
3) Assets: reuse existing icons/logos map.  
4) Year selector: like standings, default newest.  
5) Mobile: horizontal scroll.  
6) Seeding: same as playoff standings (top 7 + seeds 8/9 play-in).  
7) Loser flows handled by API per week.  
8) Ordering: championship first.

