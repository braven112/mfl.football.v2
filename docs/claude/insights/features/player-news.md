# Player News (ESPN athlete-scoped news in the player modals)

Built 2026-08-19. Surfaces each player's recent ESPN stories inside
`PlayerDetailsModal` (all six pages that mount it, both leagues) via
`/api/player-news` → `src/utils/player-news.ts`.

---

## 2026-08-19 - ESPN's `athletes/{id}/news` Is Reachable and Permanently Empty — the News Lives on the Overview Endpoint

**Context:** The obvious endpoint for athlete-scoped news, and the one the
community reference (github.com/pseudo-r/Public-ESPN-API) documents, is
`site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/{id}/news`.

**Insight:** It answers HTTP 200 with `{"articles": []}` for **every** athlete —
verified live against Mahomes (3139477), Kelce (2979843) and Budda Baker
(3127287). It is not blocked, not rate-limited, not misparsed. It is empty.

The articles are on the **Web API athlete overview** instead:

```
https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/overview
```

whose top-level keys are `statistics,news,nextGame,gameLog,rotowire,awards,
fantasy`. The `news` key holds the list. That inner shape is undocumented even
in the community reference, which is why `extractOverviewArticles` accepts the
list directly OR under `articles`/`items`/`article`/`feed`/`headlines` rather
than betting on one.

`fetchAthleteNews` therefore runs a two-source ladder: news endpoint first (kept
because it is the semantically correct one and may start carrying data), falling
through to the overview. `result.source` records which one answered — if the
first endpoint ever wakes up, that field is how you'll notice.

**Also in that payload:** a `rotowire` key, unexplored. If the overview `news`
ever dries up the way source 1 did, look there before adding a paid provider.

---

## 2026-08-19 - A Pure Parser Cannot Express "I Didn't Understand This" — Check the Envelope Before Parsing

**Context:** `parseEspnAthleteNews(payload)` returns `PlayerNewsItem[]`. It
returns `[]` for a genuinely empty `articles` array AND for an envelope it does
not recognize. Both then mapped to `status: 'empty'`.

**Insight:** That single conflation would have shipped "No recent ESPN stories
for this player" on all 384 rostered players, forever, looking completely
normal — the exact failure the `empty` / `error` split exists to prevent (same
shape as the lineup `resolveLineupFillState` post-mortem in CLAUDE.md). It also
masked the real finding above for two deploy cycles: everything looked like a
league-wide news drought.

The fix is not in the parser — a function returning an array has nowhere to put
"unrecognized". It needs a separate predicate the caller checks *before*
parsing:

```ts
if (!hasArticlesEnvelope(payload)) return fail('upstream-shape');
```

**Generalizable rule:** any time a pure normalizer returns a collection, ask
what it returns for malformed input. If that is the same value it returns for
legitimately-empty input, the caller cannot tell a read failure from an absence,
and some UI downstream will state the absence as fact. Pair the normalizer with
an envelope check, and log the payload's top-level keys on mismatch — that log
line is what identified the overview's real shape.

---

## 2026-08-19 - Resolve the ESPN ID Server-Side From the MFL ID, Never From `playerData.espnId`

**Context:** `resolveEspnId()` (`src/constants/roster-constants.ts:90`) returns
the feed's `espn_id` when present and otherwise falls back to
`espn-college-ids.json` — a **college** athlete id, for 92 incoming rookies.

**Insight:** College and NFL athlete ids are both plain 4-7 digit numbers, so a
college id passed to an NFL athlete endpoint does not fail — it silently
addresses a **different athlete**. Showing another player's news is worse than
showing none. `players.astro:531` and `player-map.ts:113` both feed that mixed
id into the modal payload today.

`/api/player-news` therefore accepts `mflId` and resolves it through
`getPlayer()/getGlobalPlayerMap()`, reading only the new `PlayerIdentity.
nflEspnId` field (raw `espn_id`, null when absent). Two things fell out of that
which were not the original motivation:

- **No page had to change.** Every `data-player-modal` call site already carries
  `id`. Threading a second id through six pages was the original plan and was
  entirely avoidable.
- **The three cards that never populated `espnId`**
  (`FreeAgentNeedsCard`, `FranchiseOptions`, `VeteranExtensionCandidates`) get
  news anyway. Their missing `espnId` is still a live bug for the *hero band*,
  which renders gradient-only there — unfixed, worth a separate pass.

`getGlobalPlayerMap()` sounds like the all-years-megafile antipattern CLAUDE.md
forbids and is not: it reads one precomputed 386 KB union artifact, and it is
only reached on a current-year miss.

---

## 2026-08-19 - Team News Is Not a Degraded Version of Player News; It Is a Different, Useless Thing

**Context:** `scripts/fetch-player-news.mjs` (now deleted) pulled
`nfl/news?team={espnTeamId}` and was never wired to anything. Its one committed
artifact made the reason obvious.

**Insight:** Measured, so it never has to be re-litigated:

| | distinct headlines |
|---|---|
| `news?team=` — 87 articles across 29 teams | **28 (32%)** |
| athlete-scoped — 60 articles across 20 players | **53 (88%)** |

A single Madden ratings story appeared under **27 of the 29 teams**. The top
three "Falcons" stories were that Madden piece, a league-wide uniforms roundup,
and a Bucs clip. Under a "Latest News" header on a player card that is not a
weaker signal, it is a false one.

So team news is not a fallback for a player with no ESPN id — the honest states
are the article list or nothing. The one sanctioned substitution is **team DEF**,
which has no athlete id by construction (0/32 in the feed, permanently), and
which borrows its marquee defender from `def-spotlight-players.json` with the
substitution stated in the UI rather than implied.

---

## 2026-08-19 - Verifying Against a Live Preview: Two Traps

**Context:** Every `*.espn.com` host is 403 from the dev sandbox's egress proxy
(this changed mid-session when the proxy restarted — do not assume either way,
just try). So the only place ESPN behavior could be observed was the Vercel
preview deploy.

Two things cost real time:

1. **A "clean" result can be indistinguishable from "not deployed yet."** A
   monitor watching for `"reason"` or `"source"` in the response saw neither
   when the build WAS live and simply returned `status:"empty"` — so the timeout
   read as "not deployed" when it meant "deployed and empty". Verify the
   deployed commit via `mcp__Vercel__get_deployment` on the branch alias
   (`meta.githubCommitSha`) rather than inferring it from response content.

2. **`s-maxage=300` serves the CDN copy back to your own probes.** Runtime logs
   showed `cache=HIT` on nearly every curl. Append a throwaway query param when
   probing, or you will be reading a five-minute-old answer while debugging.

`mcp__Vercel__get_runtime_logs` with a `console.warn` of the payload's top-level
keys is what actually solved the shape question — a diagnostic log plus the logs
API beats guessing at an undocumented schema.

---

---

## 2026-08-22 - A Recency Window Exposed Two Ordering Bugs the Two-Source Ladder Was Hiding

**Context:** News is now aged out before it reaches the browser — 30 days while
the season is being played, 90 in the offseason
(`playerNewsWindowDays` / `filterRecentNews`). Adding a filter to a ladder that
already distinguished `empty` from `error` broke that distinction twice, in
ways that only showed up against the live endpoints.

**1. Where the filter runs inside `fetchAthleteNews` is load-bearing.**
It must run AFTER the `raw > 0 && items.length === 0` shape check, never before.
That check exists to catch an item-level rename (`headline` → something else)
and report it as a read failure. Filter first and a source that answered
perfectly — three readable stories, all older than the window — trips it, and a
quiet player renders as a retryable "Couldn't reach ESPN". Stale is `empty`;
`empty` is the honest word for it. Same rule inside `fetchOverviewNews`.

**2. Source 1's TRANSPORT failure must not veto a clean overview read.**
The terminal rule used to be `sourceOneFailure ?? overview.failure` — "if EITHER
source failed to read we say so". That was survivable while the overview's
articles always made it through. Once a window can empty them out, it made the
`empty` state UNREACHABLE for as long as source 1 was down: overview reads
cleanly → every article falls outside the window → 0 items → source 1's stale
403 becomes the answer → Retry button that can never change anything.

The fix splits the two kinds of source-1 failure, and the split is principled
rather than test-driven:

- `upstream-shape` still vetoes. ESPN answered and we did not understand it, so
  there may be articles we are failing to read. Calling that "no news" is a
  league-wide, CDN-cached lie — the exact thing the empty/error split exists for.
- `upstream-status` / `-timeout` / `-network` do NOT veto. Source 1 is the
  vestigial endpoint whose successful answer is always `articles: []`, so its
  clean read carries no information about whether news exists (already
  documented above) — and its unreachability carries exactly as little.

**How it was caught:** `site.api.espn.com` was 403 from the dev sandbox on
2026-08-22 while `site.web.api.espn.com` answered fine — so source 1 failed on
every request and the bug was 100% reproducible locally rather than being a
production-only edge case. The egress proxy blocking one ESPN host but not the
other is worth trying deliberately: it simulates a half-down ladder for free.

**Related:** the `windowDays` the server applied rides back in the response, and
the browser's empty note is built from THAT rather than from a client-side
season check (`playerNewsEmptyMessage`). Two copies of the Labor Day math
disagree at exactly the rollovers nobody is watching.

**Testing note:** every fetch test now passes an explicit `now`. A fixture
article's publish date is only "recent" relative to some clock, so left on the
wall clock these assertions silently flip from the parse path to the empty path
on a future calendar date. `/api/player-news` accepts `?testDate=` for the same
reason — a distinct URL, so it gets its own cache entry.


## Open / not done

- The three cards above still ship no `espnId`, so their hero bands render
  gradient-only. Pre-existing, unrelated to news, one line each.
- `PlayerDetailsModal` has no `role="dialog"`, no focus trap, no focus
  restoration. Deliberately NOT added here: `aria-modal` without a focus move is
  worse than neither (it tells AT to expose only the dialog subtree while focus
  sits behind the scrim). Four modals share this shell and want one helper.
- `PlayerNewsModal` still has no importer. It is now a thin shell over the shared
  layer rather than a second implementation, so it cannot drift — but it is
  reachable by nobody.
