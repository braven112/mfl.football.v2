# League History: the free champions page

> Plan of record. Decisions made with Brandon on 2026-10-04. The business
> case lives in the League History Strategy doc (not in this public repo);
> this file covers what is built and why.

The free tier of League History: paste any MFL league's id and get a page with
every season's champion and runner-up, each franchise's trophy case, a
shareable champion card per season, and locked previews of what Full History
($149/year) adds.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Which platform first | **MFL only.** Sleeper next (its brackets name the winner outright), then Yahoo. ESPN stays upload-only (the pilot under `/history/import`). |
| 2 | Who can see it | **Admin-only until launch**: `LEAGUE_HISTORY_PUBLIC` in `src/utils/league-history/access.ts`, the same seat as `/live/analytics`. At launch: flip it, add a page-directory entry for `/history`, make league pages indexable. |
| 3 | When MFL can't tell who won | **Best guess, then an admin fix.** Undecidable seasons read "Not on record"; the admin can set or clear any season's champion. A commissioner claim flow comes later. |
| 4 | First version scope | Champions list, trophy case, champion card image, locked previews, the setup form. Not yet: download, the yearly chat post, claiming, private pages. |

## How a champion is decided

`src/utils/league-history/mfl-champions.ts`, pure and tested
(`tests/league-history-mfl.test.ts`, real MFL responses in
`tests/fixtures/league-history/`).

1. **The season chain.** An MFL league can change id between seasons
   (TheLeague had nine ids before 13522). The league export's
   `history.league[]` urls are the only reliable year → id + host map. Never
   query an old year with today's id: it returns a different league.
2. **The championship bracket.** Among brackets whose title or name says
   champion and nothing consolation-like, **bracket 1 wins**; otherwise the
   one that **finishes last**. Both rules came from a live check:
   - the AFL's 16-team "NIT Championship" finishes after the real title game;
   - the AFL's AL and NL "Championship" brackets feed its AFL Championship.
3. **The final.** The last round must hold one game with both teams and both
   scores, and the scores must differ. Otherwise the season is unknown.
4. **Nothing else is inferred.** A season with no playoff bracket on MFL is
   unknown. First in the standings is never assumed to be the champion:
   leagues crown champions in ways MFL does not record (Archie's runs its own
   playoff structure). The admin sets those seasons.

Checked live on 2026-10-04 against both hand-kept champion files: TheLeague
19/19 and the AFL 22/22 seasons, champion and runner-up. The AFL's 2003
reads unknown, matching its file's own gap note. Archie's league has no MFL
brackets, so every season reads unknown until set.

## The trophy case groups by name, never by owner

Titles are grouped by the team NAME each was won under (`tallyChampions`).
Nothing is merged across names or MFL team slots: a slot can change hands,
and a renamed team may or may not be the same owner, so the free page does
not guess. A team that renamed shows under each name. Linking names to people
is Full History's owners-and-eras work.

## Storage and the build

`src/utils/league-history/store.ts`. Redis only (the repo is public):

| Key | Holds |
|---|---|
| `league-history:mfl:<id>` | the league record: name, season chain, each season's result and franchises |
| `league-history:mfl:<id>:overrides` | admin fixes, year → champion/runner-up |
| `league-history:lock:mfl:<id>` | 30 s build lock |
| `league-history:index` | every league built, by time |

A build is **steps**: a 20-season league is ~60 MFL requests, too many for one
serverless call. `POST /api/league-history/mfl/build` reads 3 seasons a call
and the page calls it until `done`.
- A finished season is never fetched again.
- An undecided season in the latest two years is re-checked at most every
  six hours.
- A throttled MFL answer (429, 5xx, a non-JSON 200) stores nothing and says
  retry. It is never recorded as "no champion".

Requests go only to MFL's own hosts, built from a validated numeric id, so
nothing a visitor types reaches a url.

## Surfaces

| Route | What |
|---|---|
| `/history` | setup form + leagues built |
| `/history/mfl/<id>` | the league's page; builds it if unknown |
| `POST /api/league-history/mfl/build` | one build step (rate-limited per address) |
| `POST /api/league-history/mfl/override` | admin fix (`canFixLeagueHistory`) |
| `/api/og/league-history/mfl/<id>/<year>.png` | champion card |

All are gated. `tests/league-history-access.test.ts` fails if a surface stops
asking.

## Open before launch

- The product name (the card's footer says only "League History").
- MFL's answer on commercial use of its API.
- Link previews: chat apps fetch the card without a session, so cards unfurl
  only once the pages are public.
- Rate limits fail OPEN when Redis is down (`checkRateLimit`). The build
  itself needs Redis and stops, so the exposure is small. Revisit before
  public launch.
