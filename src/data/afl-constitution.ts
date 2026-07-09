/**
 * AFL Fantasy constitution text — used by Ask Roger (the AI rules chatbot).
 *
 * SOURCES OF TRUTH:
 *   - src/pages/afl-fantasy/docs/rules.html — official prose rendered to users
 *   - This file — plain text injected into the Haiku system prompt
 *   - docs/claude/afl-rules.md — developer reference (rules + platform notes)
 *
 * When the constitution changes, update rules.html AND this file together.
 * The .ts version may include factually-true clarifications not in the written
 * constitution (cross-conference trade ban, conferences draft separately) —
 * flag these clearly so future edits don't strip them.
 */

export const AFL_CONSTITUTION = `
LEAGUE INFORMATION
- The AFL (American Football League) is a 24-team keeper fantasy football league.
- Brandon Shields is the League Commissioner.
- Franchise fee is $100.00 per team ($1 PayPal fee per $25 of dues).
- All times/dates are Pacific (PST) unless otherwise noted.
- Two conferences: American League (AL, conference "00") and National League (NL, conference "01").
- Four divisions: AL North, AL South, NL East, NL West — 6 teams each.
- Side competition: Premier League vs D-League (promotion & relegation, all-play format).
- No salary cap. No contracts.

IMPORTANT DATES
- Deadline to notify Commissioner of intent to return: March 1
- Open recruitment period for new owners: March 1 – April 1
- League dues deadline: April 1
- Keeper selection deadline (7 keepers): July 15
- Trade deadline: Wednesday between Week 10 and 11
- Annual draft window: August 20 – August 25
- Last day to move players from IR to active roster: Super Bowl Sunday

DIVISION SETUP
- American League North: Smokane FC (0001), Drunk Indians (0002), Get off my Ditka (0004), Da Dangsters (0006), Fullybaked (0010), Suh girls one cup (0012)
- American League South: Team Minty Fresh (0003), Computer Jocks (0005), Avenging Amish (0007), Dicks out for Harambe (0008), Vitside Mafia (0009), Midwestside Connection (0011)
- National League East: The Mariachi Ninjas (0015), Titsburgh Feelers (0017), Badd Boys (0019), Balls Deep (0022), The Show (0023), No Soup For You (0024)
- National League West: Muck Juggling Micks (0013), Thundering Herd (0014), Swiftie 4 Life (0016), Jewpacabra (0018), The Boondock Saints (0020), Chatmaster (0021)
- Each team plays division opponents twice during the regular season.

TEAM ROSTERS
- Maximum 16 players on the active roster.
- Positions: QB, RB, WR, TE, PK, DEF (any combination).
- Additional IR players may be carried from July 15 until Super Bowl Sunday.

INJURED RESERVE
- No limit on IR spots.
- Only players listed Doubtful, Out, or on the official IR list are eligible.
- IR violations: team may not submit a lineup the following week.
- Exceptions at the Commissioner's discretion.

STARTING LINEUP (9 starters required)
- 1 QB
- 1 K (kicker)
- 1 DEF (team defense)
- RB: 1 to 4
- WR: 1 to 4
- TE: 1 to 4
- The RB/WR/TE positions share a combined flex pool: you must start at least 1 of each (so 3 minimum from RB/WR/TE combined) and may start up to 4 of any one position.
- Total: 9 starters
- If no lineup is submitted, the previous week's lineup is used.
- A valid lineup must exclude players on a bye or listed "Out" if a bench replacement exists.
- Lineups are due at "game time" of the player involved.

TRADES
- All trades go through the league website and require Commissioner approval.
- The Commissioner may approve or decline any trade and may require a non-refundable $50 deposit toward the following season.
- All approved trades are recorded and displayed in the league's transaction report.
- All trades must satisfy roster and/or draft pick limits before approval.
- Trade deadline: Wednesday between Week 10 and 11.
- Trading window: conclusion of Week 17 through the day before Week 11.
- Teams trading any draft pick must submit a non-refundable $50 deposit for the following season.
- Draft picks may be traded up to one year in advance.
- All teams must have 9 total draft picks from the start of the draft until the July 15 keeper deadline.
- Between July 15 and draft day, players may be traded for current-year picks, provided each team has 16 players and/or picks going into the draft.
- Unequal pick counts in a pick trade: the Commissioner may assign the lowest available pick to balance it.
- Cross-conference trades are NOT allowed.

FREE AGENTS (WAIVERS)
- Rolling waiver system ("Yahoo" style) for priority. NOT blind-bid / BBID.
- Initial waiver order = base draft order from the previous season.
- Waiver adds allowed Week 1 through Week 17.
- Requests accepted Sunday kickoff through Wednesday 9:00 PM; all claims process Wednesday 9:00 PM.
- Dropped players are locked until the next Sunday kickoff.
- First-Come First-Served (FCFS) allowed Wednesday 9:00 PM through Sunday kickoff, and from Draft Day until the regular season starts.
- Players dropped during FCFS are locked until the next Sunday kickoff.

KEEPERS
- Keep 7 players each year; cut down to the keeper limit by July 15.
- Missing the deadline: keeper limit is reduced to 6 AND you receive a compensatory pick at 9.13 (round 9, pick 13).
- Any combination of players may be kept — there is no restriction by position or draft round.

DRAFT
- Annual 9-round draft, NFL-style. Only non-keepers are eligible.
- The two conferences draft separately.
- Draft order (base): determined by final standings from Week 13 of the previous season (worst record picks first). Ties are broken by official standings tiebreaker rules.
- The conference champion is forced to the last pick (12th) in their conference.
- NIT bonus (Round 1 only): points are awarded based on base draft position, ranging from 12 points for the worst record down to 1 point for the conference champion. The top 5 NIT finishers leaguewide receive an additional +1.5 points. Round 1 is reordered by total points (most points = pick 1). If a tie remains, the team with the higher original draft position gets the higher pick.
- Rounds 2–9 follow the base reverse-standings order; the NIT bonus does NOT carry over to later rounds.
- Annual draft window: August 20–25.

SCHEDULE
- 17-game schedule per franchise.
- Each team plays division opponents twice, other conference opponents once, and one game vs the opposite-conference team that finished in the same position the prior year.
- Doubleheaders in Weeks 1, 2, 3, and 13.

SCORING
- Passing: 0.04 pts/yd (1 pt per 25 yds), Pass TD 6 pts, INT −2 pts, 2-pt pass 2 pts
- Rushing: 0.1 pts/yd (1 pt per 10 yds), Rush TD 6 pts, 2-pt rush 2 pts
- Receiving (TE-premium PPR): TE 1.5 pts/reception, WR 1.0 pts/reception, RB 1.0 pts/reception; 0.1 pts/receiving yard; Rec TD 6 pts
- Kicking: XP 1 pt; FG 0–30 yds = 3 pts; FG 31+ yds = 0.1 pts/yd (e.g. 50-yarder = 5.0 pts)
- Team Defense: Sack 1 pt, INT 2 pts, Fumble Recovery 2 pts, Safety 2 pts, Blocked kick 2 pts, Def TD 6 pts, Def 2-pt 2 pts
- Points allowed tiers: 0–6 pts → +10; 7–13 → +7; 14–20 → +4; 21–27 → +1; 28–34 → −1; 35+ → −4
- Misc: Fumble lost −2 pts, Return yards 0.03 pts/yd

SCORING ERRORS
- Notify the Commissioner by email on discovering a scoring error.
- All disputes due by Wednesday 9:00 PM; Commissioner reviews and notifies involved teams.
- Official stat provider: My Fantasy League (system of record).
- Confirmed errors that change a matchup outcome result in a league-wide notice and correction.

GAME TIEBREAKERS
- Regular season: a tie stays a tie.
- Playoffs (in order): 1) Highest scoring bench player; 2) Most points by starting kicker; 3) Better regular season W-L record; 4) Better regular season Power Rank; 5) Most total points scored; 6) Coin flip.

STANDINGS TIEBREAKERS (ties broken within divisions first)
- 2-Team and 3-Team Division Ties (in order): 1) Head-to-head W-L-T %; 2) Division W-L-T %; 3) Conference W-L-T %; 4) Power Rank; 5) Total points scored; 6) All-Play record; 7) Victory Points; 8) Most points allowed; 9) Coin flip.
- Wild Card Ties (different divisions, no H2H/division step): 1) Conference W-L-T %; 2) Power Rank; 3) Total points scored; 4) All-Play record; 5) Victory Points; 6) Most points allowed; 7) Coin flip.

PLAYOFF STRUCTURE
League Championships:
- Each conference sends 4 teams: 2 division winners (seeds 1–2) + 2 wild cards (seeds 3–4). Wild cards = 2 best remaining W-L records in the conference.
- Week 15: AL 1v4, AL 2v3, NL 1v4, NL 2v3
- Week 16: AL conference semifinal winners face off; NL conference semifinal winners face off.
- Week 17: AL Champion vs NL Champion — World Championship.

NIT Tournament:
- The remaining 16 teams play a consolation bracket.
- Seeded 1–16 by final regular-season Power Rank.
- Matchups follow a traditional bracket: #1 vs #16, #2 vs #15, and so on.

PREMIER LEAGUE / D-LEAGUE COMPETITION
- Runs Week 1 through Week 17, all-play format (every team plays every other team once per week, 23 games/week).
- Top 4 Premier League teams win prize money.
- Bottom 2 Premier League teams are relegated to the D-League.
- Top 2 D-League teams are promoted.
- Promotion/Relegation Playoff: Premier League 9th & 10th + D-League 3rd & 4th compete; top 2 by All-Play record earn/keep Premier League spots.
- Prize ties are split; promotion/relegation ties broken by Total Points Scored.

PAYOUTS
- League Dues: $2,400; Site Fees: −$180; Total Prize Money: $2,220
- League Championship: $300
- Conference Championship: $150 each
- Division Championship: $150 each
- Wild Card: $100 each
- Premier League Champion: $225
- Premier League 2nd: $150
- Premier League 3rd: $100
- Premier League 4th: $50
- D-League Champion: $50
- NIT Champion: $50
- (The League Champion is also a Conference Champion: $450 total)

REPLACEMENT OWNERS
- Owners must submit lineups weekly. Failing 2 consecutive weeks or 3 times in a season → asked to surrender the franchise.
- Replacement owners take over as-is (rosters, keepers, picks, financial obligations). No refunds.
- Commissioner maintains a waiting list. Ownership may not be sold or transferred without approval.
- A voluntarily-vacated team becomes league property until reassigned.
- 2+ simultaneous departures → a dispersal draft of the pooled players and picks.

RULE CHANGES
- Rule changes require a 75% vote (18 of 24 owners).
- Votes between July 15 and Week 17 require 100% to take effect immediately; 75–99% takes effect the following season.
- Votes ideally occur between the trade deadline and end of Week 17.
- Abstentions count as "Yes." Polls are final 5 days after opening.
- Anything not covered is resolved by the Commissioner.
`;
