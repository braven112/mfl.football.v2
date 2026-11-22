# MFL.football

MFL.football builds league sites, AI writers and history pages on top of MyFantasyLeague (MFL). These are the words we use for the leagues, their rules, our characters and what we sell.

## Leagues

**League**:
One MFL league we serve, with one entry in the league registry. TheLeague and the AFL are the two original full leagues.
_Avoid_: Site, client (when you mean the league itself)

**Franchise**:
A team slot inside a league, identified by its MFL franchise id. It outlives any one owner.
_Avoid_: Team (when the id matters), club

**Owner**:
The person who runs a franchise for one or more seasons. Two or more people running one franchise together are co-owners.
_Avoid_: Manager, GM (except in "GM office")

**Dynasty league**:
A league where rosters carry over year to year under player contracts. TheLeague is the dynasty league.
_Avoid_: Contract league

**Keeper league**:
A league where each franchise keeps a fixed number of players and drafts the rest each year. The AFL is a keeper league with 7 keepers.

**Keeper**:
A player a franchise retains into the next season before the AFL draft.
_Avoid_: Protected player

**Best-ball league**:
A draft-only league with no lineups to set and no live MFL syncing. It sits outside the league tiers.

**Conference**:
One of the AFL's two halves (AL and NL), each with its own player pool, standings and draft.

**Premier League and D-League**:
The AFL's own promotion and relegation competition, shown as its custom standings tab.
_Avoid_: Tiers (tier is a business term only)

## Contracts (TheLeague)

**Constitution**:
A league's written rules. When MFL's settings and the Constitution disagree, we take dates from MFL and flag the conflict.
_Avoid_: Bylaws, rulebook

**Contract**:
A player's salary and the number of years left on it.

**Rookie contract**:
The 4-year contract a drafted rookie signs. First-round picks also carry a team option.

**Rookie extension**:
Two more years added to a rookie contract the franchise drafted. There is no per-team limit, only player eligibility.

**Team option**:
The fifth year on a first-round rookie contract, priced at the average of the top 10 salaries at the position. It cannot be combined with a rookie extension on the same player.
_Avoid_: 5th-year option (fine in passing, but "team option" is canonical)

**Veteran extension**:
Added years on a non-rookie contract. Each franchise gets one per season, and it can be filed any time.

**Franchise tag**:
A one-year contract placed on a player whose contract has expired, priced at the average of the top 3 salaries at the position or a 20% raise, whichever is greater. Tags are submitted Feb 1 to Feb 14 at 8:45 PM PT and written to MFL on Feb 15.
_Avoid_: Tag (alone, when another tag could be meant)

**Trade deadline**:
The last moment a trade can be accepted, taken from MFL. A commissioner may process an accepted trade after it.

## League years

**League year**:
The roster year, which rolls when MFL creates the new league (Feb 14 for TheLeague). Rosters, contracts and the salary cap follow it.

**Season year**:
The results year, which rolls at Labor Day. Standings, playoffs and draft order follow it.

## Characters

**Reporter**:
A league's AI beat reporter, who breaks transactions and writes the weekly columns. Each league can have its own voice.
_Avoid_: Bot, writer

**Claude Schefter**:
The reporter for TheLeague and the AFL.

**Max Insider**:
The default reporter for every league without its own voice.

**Vegas Vic**:
The character who sets the lines on every matchup.

**Doc Rivers**:
The character who covers injuries that matter to a league's rosters.

**Buck Archives**:
The historian who answers Ask the History questions.
_Avoid_: Rex Ordbook (retired name)

**Roger**:
The league's rules assistant: he answers questions from the Constitution and posts deadline reminders. He never uses forum posts or speculative history.
_Avoid_: Rules bot

## Features

**Ask the History**:
The question box where owners ask about their league's past and Buck answers with charts.

**League History**:
The set of history pages for a league: seasons, franchises, owners, rivalries and the Rafters.

**The Pecking Order**:
The reporter's weekly power rankings column with awards and a standings snapshot.
_Avoid_: Power rankings (as the feature's name)

**Rafters**:
The wall of pennants for titles a franchise has actually won, in its colors and the logo it won under.

**Pennant**:
A team-colored banner for one won title, hung in the Rafters.

**Championship badge**:
The league's official award mark for a title not yet won, shown on standings and the footer.
_Avoid_: Pennant (for the league-wide mark)

**Site Insights**:
The admin-only, site-wide analytics at /live/analytics.

**MFL Live**:
The live scoring board across every league an owner plays in, at mfl.football/live.

## Products

**Tier**:
What a league has bought, set once per league: history, ai or full. Tier is only ever a business term, never a league competition.
_Avoid_: Plan, package (for this setting)

**History tier**:
A league that gets League History and Ask the History only.

**AI tier**:
A league that gets the AI Beat Reporter, with history as an add-on and none of the site tools.

**Full custom site**:
A league with its own complete site: lineups, live scoring, trades, contracts and every tool. Priced by team count from $3,000 setup.
_Avoid_: Full management (in customer copy)

**AI Beat Reporter**:
The product that puts a reporter on a league's MFL pages.

**Seasonal theme**:
A custom league-wide art set, such as Halloween or Christmas marks, sold one time per theme.
