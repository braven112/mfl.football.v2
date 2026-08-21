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
