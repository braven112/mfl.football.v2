# Schefter — multi-league rules, redaction, tipster context

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Schefter multi-league (tips + rumor mill run for BOTH leagues)

The tips → rumor-mill system is multi-tenant since July 2026. Load-bearing
rules — breaking any of these cross-contaminates the leagues:

- **Redis keys** go through `scripts/lib/schefter-keys.mjs#schefterKey(
  navSlug, suffix)` — TheLeague keeps its legacy unprefixed keys
  byte-identical, every other league gets `schefter:<navSlug>:*`.
  `tests/schefter-keys.test.ts` freezes the legacy strings and forbids raw
  `'schefter:'` literals outside the helper. Id-keyed namespaces
  (reactions/replies/threads/impressions/tipster_hash_for_tip) are global
  by design via `globalSchefterKey`.
- **API routes**: authed routes resolve the league from the session JWT
  (`src/utils/schefter-league.ts#resolveSchefterLeague`); public routes take
  `?league=<slug|navSlug>` defaulting to TheLeague. Never import a league's
  config/feed directly in a schefter route — use the helpers.
- **Season years** for tipster counters use each league's own rollover
  clock (`schefterSeasonYear`) — AFL rolls June 1, TheLeague Feb 14.
- **Scanner**: `schefter-rumor-scan.mjs --league <slug>`, one league per
  invocation, sequential workflow steps (parallel would race the feed
  commit). Per-league enablement = registry `features.schefterTips`; the
  `SCHEFTER_RUMOR_MILL_ENABLED` env var is only the global kill switch.
  The trade-offer lane and GroupMe mention ingestion are TheLeague-only
  (`scripts/lib/schefter-leagues.mjs` toggles) — AFL needs its own design
  for duplicate players before that lane can open.
- **Lore/persona** is per-league under `data/schefter/<navSlug>/`
  (personality, league-lore, running-bits, post-history, topic-recurrence).
  No legacy-path fallback on purpose — a missing file fails loudly rather
  than silently reading the other league's voice.
- **Pages** are thin per-league wrappers over shared components
  (`src/components/schefter/{TipPage,StyleBookPage,RumorThread,
  AdminDashboard}.astro`) — build tip-page improvements in the component
  once and both leagues inherit them.
- **Topics** come from `src/config/schefter-topics.mjs` — single source of
  truth for ids, labels, placeholders, per-league availability (AFL has no
  `motive`; hotseat is "Relegation watch" there), and scanner naming
  policies (tampering = explicit-pick-only + mandatory hedge; hotseat =
  never-name + scope floor + 14d per-team cooldown). Legacy `commish`
  normalizes to `frontoffice`. Adding a topic requires a scanner
  TOPIC_NOUNS entry — the scanner asserts coverage at startup.
- **Admin** is league-scoped end to end: `adminFranchiseIds` in
  nav-config.json is a per-league map, `isCommissionerOrAdmin` checks the
  session's own league, and both admin pages gate on
  `isAuthorizedForLeague`. AFL franchise 0001 must never pass TheLeague's
  admin gate (different teams, same id).

### Franchise-name redaction — a team answers to every name it ever had

`redactFranchiseNamesInText` in `schefter-rumor-scan.mjs` is the mechanical
backstop for every "Schefter may not name that team" rule — the prompt asks
the LLM not to, this makes it unable to. It scrubs franchise mentions out of
the tipster's raw `text` before the text reaches the prompt, so the token
harvest it runs on is load-bearing, not bookkeeping:

- **Harvest `history[]` (all four name fields per entry) AND `aliases[]`, not
  just the four current name fields.** A retired name identifies a franchise as
  well as the current one and *better* in the AFL, where the last-place
  punitive rebrands are recent and memorable. That gap shipped "Hearing Balls
  Deep and a former Cock Gobbler front office…" (Aug 2026) — a second team
  named in a post allowed to name exactly one, because "Cock Gobbler" is The
  Show's 2025 rebrand and lived only in `history[]`. Both configs are deep
  here: ~250 retired name forms and ~90 aliases across the two leagues.
  `loadTeams` has to carry both fields through or the harvest can't see them.
- **Redact the RESULT, never inside the scope classifier.** `resolveTipScope`
  returns from a dozen branches; a scrub at its tail only protects whichever
  paths fall through, and `league-wide` and `commish` returned raw text for
  months for exactly that reason. `redactSafePayload` runs on whatever the
  classifier hands back, so a new branch is safe by default. It also covers
  **every** free-text field, not just `text` —
  `threadFollowup.parentHeadlineSnippet` is lifted from a published post that
  may legitimately have named a franchise and pinned onto a tip that's fully
  anonymous, and it reaches the prompt through the same `JSON.stringify`.
- **Match with `(?<!\w) … (?!\w)`, never `\b … \b`.** A word boundary can't
  exist after a token ending in punctuation, so `\bBe Rough!\b` matches
  nothing — eight real AFL names (`The Blunt Bros.`, `Lucky Buck$`,
  `Be Rough!`, …) survived redaction verbatim. And run ONE alternation pass,
  not a `replace()` per token: sequential passes re-scan their own output, so
  normalizing "Smokane" → "Smokane FC" then matching "Smokane" again yields
  "Smokane FC FC". Guard tests must not rebuild the same regex to detect
  leaks — ours did, and was blind to precisely the bug it guarded.
- **`keepFranchise` is one display name but a franchise owns many.** Resolve
  it to the franchise and normalize that team's other forms (alias, retired
  name) to the canonical name; redact everything else. Comparing the one
  string fuzzes the kept team's own nicknames and lets Schefter print
  last-season's punishment name for a team he's allowed to name.
- Over-matching is the safe direction — a miss leaks an identity — but it is
  **not free, and the old "a stray hit just fuzzes a word" framing was wrong**.
  `[a team]` is a SEMANTIC INSERTION: it asserts a franchise reference where
  none existed, and HARD RULES 2/3 then order the LLM to make the tip's content
  survive the fuzz, so the model invents a team's involvement out of "put out
  feelers". A leak names the wrong team; this fabricates one on a tip nobody
  scoped to a franchise. Because the harvest floor is two characters and
  matching is case-insensitive, ~40 real name forms are ordinary words, and
  every one of these was live (Aug 2026): "Deal is dead." → "Deal is [a team]."
  (`DEAD`), "a heavy favorite" (`Heavy`), "put out feelers" (AFL `Feelers`),
  "headed to the Saints" (AFL `Saints` — an NFL club), "Swift is being shopped"
  (AFL `Swift` — an NFL player).
  The relaxation is **two gates, and both must pass**, because two different
  questions are involved and only one is answerable by hand:
  - `AMBIGUOUS_NAME_TOKENS` (curated) — "is this an ordinary English word?"
    Judgment; not derivable. Team-flavored forms that merely happen to be
    words ("Mafia", "Generals", "Pigs") stay out.
  - `computeRelaxableTokens` (derived from the configs) — "is this a name
    people currently CALL the team?" A token relaxes only if EVERY appearance
    across both leagues is an MFL `abbrev` or a RETIRED `history[]` form. The
    moment any franchise wears it as a live `name`/`nameMedium`/`nameShort`/
    alias it is blocked everywhere. Currently 21 relax, 12 are blocked
    (`saints`, `balls`, `feelers`, `herd`, `chat`, `swift`, `fire`, `pain`,
    `indians`, `cowboy`, `dream`, `baked`). This half **self-maintains**:
    rename a team to "Fire" and `fire` drops out on its own.

  Then `readsAsOrdinaryProse` relaxes on **case alone** — lowercase passes,
  any capital redacts. Two relaxations were tried and reverted, both because
  they leaked real franchises: relaxing sentence-initial capitals (destroys
  the only signal there is, and that position is where a tipster names a team
  as the subject — five AFL franchises leaked), and relaxing every ambiguous
  token regardless of whether it is a live nickname ("hearing saints is
  shopping a tight end" reached the prompt intact). Don't re-litigate either
  without re-running the sweep.

  Two more things hold it together: multi-word tokens match with
  `withFlexibleSeparators`, because "dead-cap" otherwise misses "Dead Cap"
  entirely and falls apart into `dead`, letting the FULL name through — every
  Set lookup therefore goes through `canonicalizeNameKey` or the kept team's
  own hyphenated name gets demoted to `[a team]`. The separator set is
  space/hyphen/underscore/slash **plus a period only when not followed by
  whitespace**: a period is also a full stop, so widening it naively welds
  "The deal is dead. Cap space is tight." into one phantom team. And the prose check runs
  **before** the keep-franchise branches, or an ordinary word that is one of
  the kept team's own forms gets rewritten to that team's display name ("the
  deal is Dead Cap Walking"), the same fabrication wearing a real name.
  `tests/schefter-franchise-name-redaction.test.ts` runs the real configs
  through the anonymizer and fails on any surviving alias or retired name —
  one tip per token, each placed mid-sentence in its config casing, because a
  bare `tokens.join(' / ')` cannot express position and position is now
  load-bearing.

### Former-name callbacks — the bit is the pairing, and it expires

Schefter nodding to a name a franchise just retired ("Dead Cap Walking, the
former Heavy Chevy…") is a wanted bit, not a bug — but only under three
constraints, all enforced in `scripts/lib/schefter-former-name.mjs` +
HARD RULE 30 (commissioner, 2026-08-15):

- **The current name always rides along.** A bare old name is the failure
  mode — a reader who joined this season doesn't know who that is, and the
  joke needs both halves. The redactor normalizes any old name in the tip
  text to the canonical one, so `formerName` on the scope is the ONLY channel
  the old name reaches the prompt through. No payload, no callback.
- **Last season's name, and only last season's.** `pickFormerName` requires
  an explicit `lastSeason` and matches `yearEnd === lastSeason` — never "the
  most recent rename", which is a different question with the same answer
  most of the time and a wrong answer the rest. A franchise that rebranded in
  2017 has no callback available at all, even though that name is genuinely
  its most recent former one. The bit is a nod to something the league just
  lived through; two seasons back it's trivia.
- **It decays and then stops.** Eligible only for the season AFTER the
  rename: occasional in the offseason, ~2× as often in preseason (Aug 1 →
  Labor Day) and regular-season weeks 1–3, then **nothing** from week 4 on,
  permanently. `resolveCallbackPhase` owns the window; the dice roll per post
  so the bit stays a callback rather than a tic.
- **Naming-allowed scopes only.** The payload attaches to
  `franchise-multi-source`, `franchise-explicit-pick`, and `trade-bait` — the
  same three the IRON RULES let Schefter name. An old name identifies a team
  as well as the current one, so a callback on a fuzzed scope would be the
  redaction bug wearing a costume.

Applies to EVERY rename, not just the AFL's last-place punishments —
`punitive` is a voice flag (lean into the sentence lore) not a gate.
**Name collisions need an OWNERSHIP map, not a set of taken names.** A
franchise keeps its own retired name in `aliases` so people can still search
by it (the documented convention), so a flat "these names are in use" set
can't tell "another team has this" from "this team kept its own nickname" —
and it silently zeroed out AFL 0014's callback, the league's current punitive
rename, while two quieter renames worked fine.
Two `history[]` rows look like renames and aren't: **re-skins** that repeat
the current name under a new icon (nearly every TheLeague franchise has one —
"the Pigskins, formerly the Pigskins") and **names that moved between
franchises** ("Midwestside Connection" is 0010's old name and 0011's current
one, so the callback would point at a live team that isn't the subject).
`pickFormerName` excludes both.


## Every post must link — and must plug the site

Schefter has two jobs: report the league, and get owners USING the site. Until
Aug 2026 he did neither half of the second one — a `grep '<a '` over the whole
published feed (396 posts, every article type, both leagues) returned **zero**.
The article that made it visible was the 2026 schedule release: eight
paragraphs about a schedule, and not one link to the schedule release page the
column existed to announce.

`scripts/lib/schefter-links.mjs` is the whole mechanism. Three layers,
because the model is one of them and the model is not reliable:

1. **Declare.** Every article type exports
   `relatedLinks(enrichment, { league })`. The pipeline calls it
   **unconditionally**, which is the load-bearing part:
   `tests/article-type-interface.test.ts` derives its required-export list by
   reading `schefter-weekly-articles.mjs`, so a new article type that omits
   `relatedLinks` fails the suite. Wrapping that call in a
   `typeof mod.relatedLinks === 'function'` guard silently re-opens the hole —
   `tests/schefter-links.test.ts` asserts the call stays unguarded for exactly
   that reason.
2. **Ask.** `withLinkDirective` appends copy-this-verbatim anchors to the fact
   sheet. Never "link to the standings": a model asked to build a URL builds a
   *plausible* one, and `/theleague/schedule` 404s as hard as gibberish.
3. **Enforce.** `applyArticleLinks` runs on the built post before the feed
   write. It repairs alias spellings (`/schedule-release` → the prefixed form,
   absolute URLs → paths), **unwraps** any href not on the declared list, and
   injects the primary link if it is still missing. Publishing a linkless
   article is not a reachable state.

Load-bearing details:

- **Three tiers, three different instructions.** `primaryLink` is the article's
  subject and gets injected if dropped. Plain `articleLink` is subject-adjacent
  and merely encouraged. `featureLink` is a **site-feature plug** and is
  offered, never injected — a plug the model had to wedge in reads as an ad,
  and readers stop clicking a columnist who sounds like an ad. Aim for one plug
  per column; do not enforce one.
- **hrefs are root-relative and league-prefixed** (`/theleague/standings`).
  Article `content` is raw HTML through `set:html`, so it never gets the
  `resolveLeaguePath()` treatment a component's `<a>` gets — the string in the
  JSON *is* the href. Prefixed root-relative is the one form that resolves
  everywhere: directly on the shared host and on localhost/preview, via the
  `vercel.json` 301 on each apex domain. `leagueUrl` absolutes are for text
  that LEAVES the site (the GroupMe promo) — an absolute in the body bounces a
  preview-deploy reader to production.
- **`DESTINATIONS.leagues` is checked BOTH ways.** A listed league that lacks
  the page is a dead link; an **unlisted league that has the page** is a
  feature Schefter is silently not allowed to mention there — the failure mode
  that hides, because nothing breaks. The test enumerates `src/pages/<slug>/`
  and fails on either. It already caught one: `/activity` exists in both
  leagues but is owner-visit tracking in TheLeague and the transaction log in
  the AFL, which is why that entry carries a per-league `labels` override
  rather than one label promising the wrong page.
- **`articleLink` returns null for a page the league lacks; `primaryLink`
  throws.** The AFL has no salary cap, so cap-flavoured plugs drop out through
  `linkList` instead of forcing every `relatedLinks` into per-league branches.
  A missing PRIMARY is different — that league has no business running the
  article type at all, so it fails loudly.
- **Grade-card types are covered too.** `draft-grades` / `team-grades` put
  prose in `intro[]` plus `grades[].body`, not `content[]`. Sanitising only
  `content` would leave the grade cards as the one place a hallucinated href
  still ships.
- **Link styling lives in `src/styles/schefter-feed.css`, not a page `<style>`
  block.** `set:html` content carries no Astro scoped-style attribute, so a
  scoped rule cannot reach these anchors — and both leagues' news pages import
  the shared sheet, so one definition serves both.

`tests/schefter-links.test.ts` also checks the **shipped feeds**: every
`type: 'article'` post must contain an anchor and every href in one must
resolve to a real route. That is what catches a hand-edited feed, which no
amount of pipeline enforcement would.

### The short posts link too — and their links answer to redaction

Transactions, rumors and speculation are one or two sentences, so they use the
card-level `link` / `linkLabel` the Schefter cards already render rather than
an inline anchor. `scripts/lib/schefter-links.mjs` owns those as well
(`transactionCta`, `tradeBuilderPath`, `tipPagePath`); the guards live in
`tests/schefter-post-links.test.ts` and `tests/schefter-trade-cta.test.ts`.

- **A LINK NAMES A TEAM AS WELL AS A SENTENCE DOES.** `isTradeFlavoredTip`
  answers "is this about a trade?", which is a different question from "may
  this post identify the team?" — and only the second one governs the href.
  A web tip with `topic: 'trade'` whose scope falls through to `division`
  (single source, no consent signal, or over the per-tipster naming rate
  limit) arrives at `resolveCta` with its `franchiseHint` intact, so the body
  read "a team in the AL East" while the button under it pre-loaded that exact
  franchise. `franchiseDeepLinkAllowed` gates it on the same three scopes the
  IRON RULES let Schefter name, for the same reason former-name callbacks are
  gated. A `franchiseIdsInLink` sweep then re-checks the FINISHED post, so a
  CTA branch added later is safe by default — the `redactSafePayload` pattern
  applied to hrefs.
- **`franchiseIdsInLink` is param-aware, not shape-only.** `?target=` is a
  FRANCHISE on the tip page and a PLAYER on the AFL Trade Builder. A guard
  that called every four-digit value a franchise would flag player ids, and a
  guard everyone learns to ignore guards nothing. Unknown pages still get the
  shape sweep, so a deep link added elsewhere cannot slip past.
- **The two Trade Builders are different pages.** TheLeague's is a React
  island restoring `?a`/`?b` (plus `?ap`/`?bp`, a whole side each) client-side;
  the AFL's is server-rendered on `?from`/`?to` (plus `?player`/`?target`,
  exactly one each). The rumor mill hardcoded `?b=` for both — its comment
  cited "the same convention the rosters page uses", meaning *TheLeague's*
  rosters page — so every AFL trade CTA opened an EMPTY builder. Nothing
  404s, which is why it lasted: the link works, the deep link silently
  doesn't. `tradeBuilderPath` owns both spellings and the cardinality
  difference, and the test reads the params back out of each page.
- **`?target=` on a card is only a "desk dare" on the tip page.** Both post
  cards styled any `?target=` link with the megaphone icon and the directed
  treatment, which would mislabel an AFL trade deep link. `isDirectedCta`
  checks the path now.
- Transaction CTAs follow what the reader can DO: a **drop** goes to the free
  agent board (the player is claimable by whoever is reading), a **pickup**,
  **auction** or **trade** goes to the rosters. The scanner backfills a
  logged fallback for a transaction type whose generator forgets one — a
  floor, not the mechanism.

## Schefter tipster context (Phase 8 — bot intelligence)

The rumor-mill scanner weights bucket priority and surfaces voice cues
based on per-tipster signals. The whole flow lives in three files:

- **`scripts/lib/schefter-tipster-context.mjs`** — `buildTipsterContext`
  reads two Redis keys per queued web tipster and returns a
  `Map<hashedOwnerId, { isFirstTime, isProlific, tipsInQueue, beat }>`:
  - `schefter:tipster:rumors_total:{hash}` (STRING, lifetime post count)
  - `schefter:tipster:topic_counts:{hash}` (HASH, topic → lifetime count)
- **`scripts/lib/schefter-bucket-logic.mjs`** — `bucketPriorityScore`
  accepts the context as an optional third arg and adds a tipster delta
  (first-time voice +5, burst regular −3, prolific −1). Without the
  context, falls back to the pre-Phase-8 size+age math — both the
  scanner and the admin preview pass the context now.
- **`scripts/schefter-rumor-scan.mjs`** — `anonymizeTips` surfaces the
  voice flags on every web-tip scope: `firstTimeTipster`,
  `prolificTipster`, `tipsterBeat: { topic }`. HARD RULES 22 / 23 / 24
  drive the phrasing. Post-commit increments live in
  `schefter-tipster-counters.mjs` (`incrementTipsterCounters` plus
  `incrementTipsterTopicCounters`).

**Privacy contract — DO NOT WEAKEN.** The codename↔topic binding stays
server-side. That's option B from the design discussion in
`#enhance-bot-intelligence-tAh6t` — public codenames (Style Book bit)
are fine, but pairing a codename with a beat (e.g. "Burner Phone keeps
feeding me trade chatter") correlates over time and starts narrowing
source identity. HARD RULE 24 enforces "never name the codename"; the
`tipsterBeat` payload deliberately carries only the topic name, never
the codename or hash. The admin route keeps a server-only
`pendingTipsWithHashes` array for the priority preview math but strips
`hashedOwnerId` from everything that crosses the response boundary.


## Schefter quiet-day post (Phase 8 — feature 7)

When the scanner's normal lane finds no qualifying bucket AND the queue
meets one of three honest-quiet conditions (`queue-empty`,
`single-prolific-tipster`, `all-stale`), Schefter ships ONE candid
"slow news day" post instead of going silent. Lives entirely inside
`scripts/schefter-rumor-scan.mjs` (no separate module — the logic is
specific to the scanner flow):

- **Cooldown:** `schefter:rumor:quiet_day_last_date` (PT-date string),
  guarded by `QUIET_DAY_COOLDOWN_DAYS` (default 3).
- **Distribution:** writes the feed entry and consumes one of
  `MAX_POSTS_PER_DAY`, but **deliberately skips the GroupMe webhook** —
  a slow-news-day post buzzing every owner's phone is the opposite of
  slow. This invariant is locked by a sentinel comment that the
  regression test (`tests/schefter-quiet-day.test.ts`) greps for; do not
  delete the comment without also adding GroupMe-skip coverage another way.
- **Voice:** `generateQuietDayBody` uses its own tiny system prompt (not
  the main HARD-RULES block) with a 4-template fallback when
  `ANTHROPIC_API_KEY` is unset, so dry-runs still produce recognizable
  output.


## Schefter recurrence ledger v2 (Phase 8 — feature 10)

`data/schefter/<navSlug>/topic-recurrence.json` (per-league since the AFL launch) bumped to v2. Each fingerprint
entry now carries `tipsterHashes` (sorted-unique, capped at 64) in
addition to the existing `weeksSeen`. The bump powers cross-week memory
recall (HARD RULE 25): when a bucket reappears with at least one voice
that wasn't on its prior roster, `getMemoryRecall` returns a
counts-only payload (`weeksSinceFirstSeen`, `totalWeeksSeen`,
`distinctVoicesAcrossTime`) that the anonymizer attaches to each tip
in the bucket.

`loadLedger` migrates v1 files in place by backfilling empty
`tipsterHashes` arrays. The migration is transparent — no manual
intervention needed when a deployed branch first hits the v2 code.
Unknown future versions (>2) are discarded and replaced with an empty
ledger (safer than trusting a schema we don't understand).

**Privacy contract:** the ledger stores raw hashes for set-membership
checks (so we can detect "fresh voice"), but `getMemoryRecall`'s return
value contains only counts. The hashes never reach the LLM prompt or
the response payload. Don't change that without re-litigating the
correlation argument from option B above.
