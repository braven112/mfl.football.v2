# Schefter Rumor Mill (multi-league tips system)

The load-bearing architecture rules live in CLAUDE.md ("Schefter multi-league").
This file holds the finer operational learnings.

## 2026-09-08 - Two beats one second apart: a count of ROWS standing in for a count of STORIES

**Context:** the same owner, same day, a second report. Two GroupMe posts about
the same trade offer — not 7.5 hours apart this time but **one second**, out of
a single scanner run: `sf_rumor_1788881332066_eb183012` and `…_e83e63a4`, both
carrying `tipIds: ["to_1080"]`, one CTA pointing at the Trade Builder and the
other at the tip page, which is what made them read as two separate scoops.

**The bug was a plural noun that was never checked.** The busy-morning
catch-up splits a trade bucket of 2+ tips into two beats to clear an overnight
backlog. `primaryBucket.tips.length >= 2` was standing in for "two offers", and
`slice(0,1)` / `slice(1,2)` for "one each" — but `scanTradeOffers` enqueues a
row per dice roll and requeues unposted rows for seven days, so the queue can
hold one offer twice under one `to_<offerId>` id. **The generalizable shape:
wherever a count of ROWS is read as a count of SUBJECTS, the dedupe is part of
the feature, not hygiene.** Here the two halves lived in different functions
several thousand lines apart, so nothing forced them to be read together —
exactly the failure mode of the previous entry, in a different currency.

**The published feed had been saying so for days, in a field nobody diffs.**
`tipIds` is stored per post: `to_1076, to_1078, to_1081, to_1003, to_1081` on
Sep 7, and `to_1081` three times in one Sep 6 post. Duplicate ids inside a
single batch is a one-line check against shipped data, and it predates the
visible symptom by two days. When a feed persists its own provenance, the
cheapest audit of a "he repeats himself" report is `uniq` over that field
before reading any code.

**The existing cooldown could not have caught it, by construction.** The 7-day
per-offer repost anchor is stamped on DELIVERY — deliberately, so a post nobody
read cannot lock an offer out. Both beats delivered in the same cycle, so it
never got a chance to fire. **A cooldown expressed in days cannot police a
repeat measured in seconds:** any "don't repeat yourself" rule needs to hold
WITHIN a cycle as well as across them, and those are two different mechanisms.

**Which duplicate you keep is a real decision, and "a row" is the wrong unit to
decide it in.** The first cut kept the earliest row wholesale, reasoning that
`submittedAt` anchors the framing, the age-boost and the 7-day expiry, so a
re-rolled offer keeping the newest would refresh its own clock forever (the
2026-09-07 entry's failure, now with a plausible timestamp). All true — and it
threw away the CLOSURE tip, because `redactTradeOffer` stamps `to_<offerId>` on
every tip it mints for an offer, the "this one got done" callback included. A
stale live row swallowed it, and `OFFER_CLOSED_KEY` is written at enqueue
rather than on publication, so the closure was not merely delayed but lost.
**The lesson is that "which row wins" was two questions wearing one answer:**
the payload wants the newest (closure, changed ask, current age and exposure),
the timestamp wants the oldest (so expiry still bites), and the strike ledger
wants the max of both — otherwise a fresh copy launders a tip out of
hold-and-strike. Merge the fields; do not elect a row.

**Two rows is not a test of a merge; three is.** The corrected version compared
each new row against the ACCUMULATED one — whose timestamp is by definition the
oldest — so the moment a third row arrived it won on a timestamp the payload
never had, and the closure was dropped exactly as before. Every two-row test
passed. **The arity at which a fold breaks is almost never two**, and a
review that re-ran the shipped function on three rows is what found it.

**The exemption you need is usually the thing you defined the rule against.**
Merging a fresh closure onto a stale live row hands it that row's remaining
age and strike budget, and since dedupe runs at the queue read with the expiry
filter immediately behind it, a closure minted seconds ago dies as `expired` in
the same pass. The oldest-timestamp rule was written to stop a re-rolled copy
of the SAME story refreshing its clock — a closure is a different story wearing
the same id, so it keeps its own. Worth asking of any dedupe: does every row
sharing this key tell the same story?

**And then the exemption itself wants scoping.** Written as "a closure keeps
its own clock", it also exempted a closure from folding with ANOTHER closure —
reachable, because the `sadd` that stops re-detection is warn-only and the tip
ships regardless. Each duplicate then relaundered the clock and the strike
ledger, so a suppressed closure would never age out at all: strictly worse than
the seven days it had before any dedupe existed. The rule that survives is
narrower than either draft — **budget is inherited only from rows telling the
same story** — and the shape generalizes: an exemption defined against a class
("not from a live row") is safer than one defined by a property of the
exempt thing ("closures are exempt"), because the second one silently covers
the same-class case nobody pictured.

**A tie-break is a policy, and ours was accidentally "whoever is newest".**
Three rounds of review went into which duplicate wins and every one of them
argued about timestamps, because the rows looked like copies. They are not: a
closure and a live beat share an id and tell different stories, and the story
that is TERMINAL has to win regardless of the clock — otherwise a live row
enqueued after a closure destroys it, which is reachable the moment the
transactions read that detects acceptance fails, since that read is warn-only.
The rule that finally held is class first, timestamp second. **When two records
share a key, ask what each one MEANS before deciding which is fresher.**

**And the thing that made two posts read as two scoops was a parallel array.**
`[primaryBucket, secondaryBucket]`, indexed by beat number, with
`secondaryBucket` hard-coded to `null` for a trade primary — so the second
trade beat resolved its call-to-action from `undefined` and shipped the generic
"Got a tip?" link beside beat 1's Trade Builder one. The owner's screenshot
shows exactly that, and it is the detail that made one story told twice look
like two separate scoops. The CTA resolver only ever needed the beat's own
tips; the parallel array was carrying a correlation the beats already had.
**A lookup indexed by position into a structure built for a different purpose
is a bug waiting for its second caller** — here, the busy-morning split.

**A merge that writes onto its input makes the function answer differently the
second time.** Folding the merged `submittedAt` onto the kept row leaves both
duplicates sharing a timestamp, and the newest-wins comparison then resolves
that tie by arrival order — so a second pass over the same array keeps the
other row. Only one call site exists and it runs once per run, so nothing was
broken; the test that reversed the argument order was what noticed. **A pure
function is not a style preference when the function's own output is one of its
inputs' fields.**

**And the cadence boundary was measuring the wrong thing.** The mill's quiet
1/day cap keyed on `isLeagueSeasonOpen` — kickoff, Labor Day + 3. The league
actually wakes at its DRAFTS, eleven days earlier (the AFL's NL email draft is
the Sunday eight days before Labor Day). The anchor is the AFL's calendar and
the window takes no slug, so TheLeague — whose own Cut to 22 is the third
Sunday in August — stays loud through its own deadlines; a known gap, written
down rather than smoothed over. So the loudest possible cadence — 3/day plus the busy-morning double
— was running through draft-and-cuts week, which is why this fired at 8:28am on
Sep 8 and not in October. Renamed to `isLeagueAwake`: **a boundary named after
one of its endpoints invites the reader to assume the other one.** Both ends of
the window still measure from kickoff, so moving the start cannot drag
championship Monday back with it.

## 2026-09-08 - A per-RUN probability is meaningless until you count the runs

**Context:** the fix for the 2026-09-07 entry below. Owner report: two rumors
in one day about the same trade offer, 7.5 hours apart. Every gate had passed.

**The constant said 5%; the behavior was 92%.** `OFFER_POST_PROBABILITY` was a
per-RUN figure and `scanTradeOffers` runs on the rumor scanner's `*/15` cron
with no throttle — ~50 rolls a day per live offer, compounding to ~92% within
24 hours. Effectively every offer leaked, almost immediately.

**The diagnostic move, worth reusing: never read a probability constant without
locating its roll cadence in the same breath.** The two live in different files
here — the number in `scripts/lib/redact-trade-offer.mjs`, the cadence in
`.github/workflows/schefter-rumor-scan.yml` — so nothing forced them to be read
together, and a cron that tightened under an existing constant silently
re-tuned it. Three prior bumps (0.0075 → 0.025 → 0.05) each chased "proposals
age out before posting" and each made the real problem worse, because the
symptom they were reading was never about the base rate.

Two artifacts had the answer written down and were still not enough:

- The code comment said "at ~8 scans a day", stale by a factor of six. **A
  cadence figure in a comment is a snapshot, not a fact** — it cannot track the
  cron file. `AdminDashboard.astro` did better by importing the constant and
  rendering the cumulative curve live, and it was still wrong, because its
  `ROLLS_PER_DAY = 50` was a hand-maintained literal next to the imported
  value. Importing one half of a calculation does not protect the other half.
- `schefter:trade_offers:rolls` existed precisely to show "how many chances
  each offer had to leak" and nobody had read it. The instrument was there;
  the habit of consulting it was not.

**The fix that makes the constant honest is a throttle, not a smaller number.**
Rolling each offer once per PT day (`trade_offers:last_roll_date`) turns the
base into a per-day probability that means what it reads like. Shrinking 0.05
to ~0.0006 to land the same cumulative curve would have preserved the trap for
the next person.

**Order matters between a cooldown and a roll.** The 7-day repost cooldown is
checked BEFORE the daily roll. Reversed, a cooling-down offer burns its one
roll for the day and `trade_offers:rolls` stops meaning what its name says —
the same instrument-corrupting mistake, one layer down.

**And when you add a cooldown, audit every accelerator pointing the other
way.** `OFFER_EXPOSURE_BOOST_FACTOR` doubled the odds for an offer that had
already posted. Harmless-looking beside a ladder that wanted to advance; the
exact wrong dial once "already reported" became a reason to go quiet. A new
gate can invert the meaning of an old multiplier without touching it.

## 2026-09-07 - A self-reported feed makes ABSENCE unusable, and repetition read as breadth

**Context:** "Schefter seems to report on every trade rumor — is that
accurate?" Auditing the trade-offer lane turned up three things that were not
visible from the code, and one measurement that contradicts a comment in it.

**1. The lane looked broad and was actually repetitive.** Six live proposals,
all 26–56 days old, being re-reported up to seven times each because
`buildExposure` had exactly one dimension: signal N named the hash-chosen team
and `N-1` of its players. To diagnose this class, compare
`schefter:trade_offers:exposure` (posts per offer) against the DISTINCT offer
count — a high ratio is the signature. Do not compare exposure to the feed's
post count and conclude the numbers disagree: **exposure increments on ENQUEUE,
not on publish**, and the queue then produces one post from a batch of five, so
roughly half of the passes never become their own post.

**2. Owner-reported intake has no per-row TTL, so resolved proposals never
leave.** `reportOwnerTrades` refreshes the whole `owner_reports` hash's expiry
on every write, so an individual proposal stays in it until the entire hash
expires — long after MFL resolved it. That is where the 26-to-56-day-old
"live" proposals came from: dead deals drawing fresh dice rolls off a stale
row. The row's own `expires` is the only reliable death signal, and nothing
was reading it.

**3. Therefore a DISAPPEARANCE from this lane means nothing.** When a feed is
fed by owners loading a page, a record leaving view is equally consistent with
"the thing ended" and "that owner stopped looking" — and per (2), the thing
ending does not even reliably remove the row. Any beat of the form "talks have
gone cold" built on absence would eventually land on a live negotiation. The
generalizable rule: **on a self-reported source, only presence carries
information.** We ship the two endings MFL states outright (`expires` passed;
a matching TRADE in the transactions feed) and deliberately have no
`withdrawn`.

**4. Measured cadence, correcting a comment in
`redact-trade-offer.mjs#offerPostProbability`.** That docblock reasons about
"30–50 rolls/day" against a nominal 96 from the `*/15` cron. The workflow
actually ran **20 times in 2.5 days (~8/day)** over Sep 5–7 — GitHub throttles
scheduled runs hard on a busy repo, and the runs sit 2–5 hours apart, not 15
minutes. Quiet hours are not the cause: `scanTradeOffers` runs before the
posting gate, so the dice roll on every scan. Any future tuning of
`OFFER_POST_PROBABILITY` should start from ~8 rolls/day, not 30–50 — at
p=0.05 that is ~34%/day to first post, not the ~79%/24h the comment implies.

**5. A private signal can be REUSED without being published.** An expired
proposal is the strongest evidence the site holds about who will move whom.
Announcing that it died spends it on one line; routing it into the speculation
matcher's inputs (`scripts/lib/speculation-seeds.mjs`) lets it shape posts for
30 days without ever naming the real deal. Two rules make that safe, and both
generalize to any "use private data to inform public output" design: only the
side that SPOKE is signal (the proposer offered their own players; the
recipient merely got asked), and the pair that actually talked is excluded
from the output space so the derived content cannot coincide with the source.

## 2026-09-05 - "Is it on for the AFL?" is three questions, not one

**Context:** The trade-block lane (owner lists players on MFL's trade bait →
Schefter posts it) was TheLeague-only. Switching it on for the AFL looked like
flipping `tradeBait: false` to `true` in `scripts/lib/schefter-leagues.mjs`.

**Insight:** A per-league feature toggle answers "does the lane RUN", not
"does it run CORRECTLY for this league". Two more things were TheLeague-shaped
underneath the flag, and neither had a symptom while the flag was off:

1. **The queue keys were captured at module load as
   `schefterKey('theleague', …)`.** Every other league-scoped key in the two
   scanners is built from the league being scanned; these two predated the
   `--league` refactor and never got re-scoped because nothing ever exercised
   them with a second league. Flipping the flag alone would have pushed AFL
   listings into TheLeague's queue, which TheLeague's rumor-scan step drains
   and posts to TheLeague's GroupMe — an AFL franchise named in the wrong
   league's chat.
2. **Seeding was per franchise, and MFL's `tradeBait` export omits
   franchises with nothing listed.** So a franchise absent from the state
   was re-seeded silently the first time it listed anything. TheLeague's
   persisted state holds 5 of 16 franchises — the other 11 have never
   listed, and the first time any of them did, the post would have been
   swallowed. The AFL launches with NOBODY on the block, so under that rule
   it would never have posted at all. Seed is now a league-level event
   (`leagueSeeded`, keyed on the state key EXISTING on the feed, not on it
   having entries) and a missing franchise diffs against an empty block.
3. **The export itself is owner-gated for a private league, and the failure
   is an EMPTY 200, not an error.** Caught by the PR review, not by me, and
   it was already written down (`insights/domains/mfl-api.md`, 2026-07-15):
   TheLeague is public so its bare fetch works; the AFL is private so its
   bare fetch reads as "nobody listed" forever. The lane would have shipped
   green and silent. The fetch now carries `MFL_APIKEY` (league-scoped, so
   the secret must be the AFL's key), throws on MFL's HTTP-200 error body,
   and holds state when a league with committed listings suddenly reads as
   empty — because diffing that as "everyone cleared" would re-post every
   listing as new once the feed recovered.

The second one is the interesting failure: it was a latent bug in the league
the feature was built for, invisible because the feature visibly worked for
the five franchises that happened to be listed on launch day. The third is
the humbling one: "the first run for the second league" also means "the
first run against the second league's PRIVACY settings", and the repo had
already learned that once.

**Recommendation:** Before flipping a league toggle, grep the lane for the
default league's navSlug as a LITERAL (not through the league object), re-read
every "first run" / "seed" branch asking what the second league's first run
actually looks like — an empty state is a different first run from a full one
— and curl the export for the NEW league bare before trusting that an empty
answer means empty.

## 2026-07-19 - Source-Guard Tests Are the Refactor Tax

**Context:** League-scoping the Redis keyspace and adding the `--league` flag
touched ~40 key literals and several function signatures.

**Insight:** This repo enforces invariants with grep-based "source guard"
tests (`expect(src).toMatch(...)` against scanner/API source). Any mechanical
refactor of guarded code fails a handful of them — the correct response is to
update each guard to assert the NEW shape (e.g. `schefterKey(NAV_SLUG,
'rumor:posts_today')` instead of the raw literal), never to delete the guard.
About a dozen guards were retargeted this way across
`tests/schefter-*.test.ts`; each retarget preserved the original invariant at
the new spelling. `tests/schefter-keys.test.ts` is the master guard: frozen
byte-identical legacy TheLeague key strings + a repo-wide ban on raw
`'schefter:'` literals outside the helper.

**Recommendation:** Before refactoring scanner/API internals, grep `tests/`
for the identifier you're renaming; plan the guard updates as part of the
change, not as post-hoc failures.

## 2026-07-19 - whats-new-data.test.ts Has Three Non-Obvious Launch Rules

**Insight:** Beyond the documented screenshot requirement, the suite enforces:
(1) every `image` needs a `-dark` twin file in `public/assets/whats-new/`;
(2) an entry visible in multiple leagues must use a league-NEUTRAL link
(`/schefter/tip`, no league prefix) or omit the link — cross-league links
fail the build; (3) `title`/`summary` must not name a league the entry isn't
exclusive to (the "AFL feature in TheLeague's hero" guard) — even flavor text
like "TheLeague's secret weapon comes to the AFL" fails an AFL-only entry.

## 2026-07-19 - Misc Operational Gotchas

- **GitHub workflow YAML:** don't use YAML anchors (`&x`/`*x`) in workflow
  files — parser support in Actions is unreliable; duplicate the env block.
- **`src/utils/redis-client.ts` is a hand-maintained type surface** over the
  Upstash client (cast, not derived). New Redis commands (this branch added
  `lrem`, `decr`, `zrem`) must be added to the `RedisClient` type or every
  call site is a TS error.
- **Undo endpoint safety model** (`DELETE /api/schefter/tip/[id]`): ownership
  = queued tip's `hashedOwnerId` must equal the caller's session hash; wrong
  owner returns the same `{gone:true}` shape as "already drained" so a probing
  client can't confirm foreign tip ids. The 60s window is safe against the
  scanner because the marinate gate is ≥1h.
- **Per-league in-process caches:** any API route module cache (cooker-status,
  style-book, schefter-lore `_cache`) must be a Map keyed by navSlug — a
  scalar cache silently serves league A's data to league B.

## 2026-07-19 - Every Daily Slot Must Be Delivery-Gated (Two Incidents Now)

**Context:** AFL launch day: the first post-quiet-hours cycle generated a
beat, the quality gate suppressed it (3/10), and the scanner still burned
`posts_today`, the 1/day gossip cap, and the morning-greeting slot. Every
later cycle held the queued tips with "gossip budget spent" — the rumor
mill was silent all day. The 4h spacing anchor had the SAME bug months
earlier (a suppressed ~7am beat blanked a morning).

**Insight:** The scanner stamps several once-per-day Redis slots
(posts_today, gossip cap, spacing anchor, mailbag-done, morning greeting,
Roger riff). Any slot stamped before knowing whether the beat survived the
quality gate will eventually starve the pipeline, because the gate runs
LAST. All of them now live behind the delivered guard
(`allowedPosts.length > 0`, beat-0 stamps on `allowedIndexSet.has(0)`) —
the BUDGET-ON-DELIVERY sentinel + `tests/schefter-gossip-budget.test.ts`
lock this in. If you add a new once-per-day stamp, put it inside the guard.
Attempt-rate stays bounded by MAX_SUPPRESSED_STRIKES (3/tip), MAX_HELD_MS
(48h), and quiet hours — do not reintroduce an attempt-based counter.

**Insight:** The gate threshold is context-aware since this fix: quiet feed
(no rumor post in 7d / ever) or fresh subject (bucket fingerprint absent
from the recurrence ledger's current ISO week) drops the bar from 6 to
`RELAXED_QUALITY_THRESHOLD` (3). The recurrence ledger is the correct
"have we posted about this" source precisely because it's stamped only on
delivery. Scores 1-2 always suppress.

## 2026-08-15 - An early `return` past the trailing sanitizer is invisible in review

**Context:** A post named a second franchise, which the trade playbook forbids.
Root-causing it turned up a second, wider leak that had been live far longer.

**Insight:** `anonymizeTips` is ~300 lines of scope-resolution branches, most
of which `return safe` the moment they've classified a tip. The franchise-name
redaction runs at the **bottom** of the function. Every branch that returns
above it therefore ships the tipster's raw text straight to the prompt — and
`league-wide` and `commish` did exactly that, for months, with current
franchise names intact. Those are the two scopes whose entire purpose is "this
isn't pinned to anybody."

This reads as correct in review because the sanitizer *is* there and *is*
called; nothing at the return sites hints that they're skipping it. The
`namingPolicy === 'never'` branch happened to carry its own redaction call,
which made the pattern look deliberate rather than accidental.

**The general shape:** a sanitizer placed at a function's exit is only as good
as the function's control flow is linear. In a long classifier with many early
returns, "sanitize on the way out" is not a policy — it's a coincidence that
holds for whichever paths happen to fall through.

**Trap for the fix, too:** the sanitizer's **input set** is the actual privacy
boundary, not its regex. This one harvested only the four current name fields
off each team, so ~250 retired names and ~90 aliases across the two configs
were invisible to it — a punitive rebrand identifies a team better than its
current name does. Over-matching is the safe direction here: a stray hit fuzzes
a word to `[a team]`, a miss leaks an identity.

> **Superseded in part — see 2026-08-15 "A redaction placeholder is a semantic
> insertion" below.** The direction is still right, but "a stray hit fuzzes a
> word" is not what a stray hit does, and the cost of over-matching was being
> undercounted on the strength of that phrase.

**Recommendation:** When adding a scope branch to `anonymizeTips`, redact
explicitly in that branch rather than trusting the tail. When adding a name
field to a league config, ask whether the redactor's harvest reads it.
`tests/schefter-franchise-name-redaction.test.ts` runs the real configs
through the anonymizer and fails on any surviving alias or retired name, which
catches the config half but not a new early return — that stays a review
concern.

## 2026-08-15 - The system prompt is a second, unredactable leak channel

**Context:** Follow-on to the entry above. Every fix there operates on the
per-tip payload. The prompt those payloads are pasted into was never in scope.

**Insight:** `redactFranchiseNamesInText` cannot reach the system prompt. The
prompt is assembled once, in source, and sent on **every** call — including the
anonymous-scope posts (`division`, `league-wide`, `hotseat`) whose entire point
is that no franchise may be named. So a real team name written into a rule's
few-shot examples is handed to the model on exactly the calls that forbid it,
and no amount of payload hygiene touches it.

Three separate rules had one. Rule 30's was caught when it was written (a
current↔former pairing, the sharpest form). Rule 4b's was not: `[Geeks]` —
0013's own alias — appeared **thirteen times** in the explicit-pick voice
examples, so the highest-frequency real name in the prompt was the one nobody
flagged. Rules 15/16 addressed a GroupMe author as "Dead Cap", which is 0004's
`nameShort` wearing a chat handle's clothes.

**Why the bracket convention hid it:** `[Geeks]` *looks* like a slot to fill,
which reads as obviously-a-placeholder to a human skimming the rule. It is
still a real franchise name in the token stream.

**The guard-scoping lesson, which generalizes past this feature:** the original
test sliced from `'30. FORMER-NAME CALLBACK'` to the block's end and asserted no
real name appeared *there*. It passed for months while twelve `[Geeks]` sat
~170 lines above the slice. A guard scoped to the rule that motivated it
certifies that rule and quietly implies the file. Scope the guard to the
**blast radius** — here, the whole always-sent block — not to the bug.

**The block was not the only region, either.** A first pass at this guard
scanned HARD RULES and stopped there — and `buildTradeOfferPlaybook()`, which
is concatenated onto the very same `system` string whenever a batch holds a
trade offer, had named "Pacific Pigskins" and "Midwestside Connection" in four
worked examples the whole time. Scoping a guard to *a* region repeats the
original mistake one level up. The unit that matters is **every string the
model is ever shown**, so the test now iterates a `regions` map and any new
prompt chunk gets added to it.

**Two matching details that decide whether the guard is worth having:**

- **Match on token boundaries, not substrings.** A raw `includes` reports
  "CHAT" (AFL 0021's abbrev) inside "CHATTER" and "FRA" inside "FRANCHISE".
  Those false positives are what force the length floor up to 4 — which then
  blinds the guard to every short abbreviation (`GG`, `BTP`, `DCW`). Switching
  to the redactor's own `(?<!\w)…(?!\w)` pair drops the false positives to
  zero at a floor of 2, so the guard covers 328 forms instead of 299. Use the
  lookarounds rather than `\b` for the reason CLAUDE.md gives: a word boundary
  cannot exist after a name ending in punctuation, so `\bBe Rough!\b` matches
  nothing.
- **Case handling should NOT be copied from the redactor.** Production matches
  `gi` everywhere, which is right for a redactor (over-matching a tip is safe)
  and wrong for a guard: at a floor of 2 the token list holds `DEAD`, `CHAT`,
  `GRID`, `Pain`, `Fire`, `Heavy`, so an `i` flag flags ordinary prompt prose
  and the guard becomes unrunnable. But pure case-sensitivity misses a
  lowercase `"pacific pigskins"`. Split on **distinctiveness** instead —
  multi-word or >= 8 chars matches case-insensitively, short abbreviations must
  match exactly. 194 of 328 forms qualify, still zero false positives. This is
  the one place the guard deliberately diverges from the production matcher;
  say so in a comment, because "reuse the production matcher" is the obvious
  and wrong review suggestion.
- **Assert both slice indices, not just that the slice is non-empty.** The two
  failure directions are asymmetric and neither raises. A renamed START anchor
  gives `indexOf === -1`, and `slice(-1, end)` collapses to nothing — green
  test, empty region. A renamed END anchor gives `slice(start, -1)`, which
  *expands* to nearly the whole file. Check `start >= 0` and `end > start` by
  hand; a `toContain` sanity assertion on the region's own text is a good
  second belt.

**Recommendation:** Never write a real franchise name, alias, retired name, or
owner's personal name into prompt example text; invent one
(`Griffins`, `Sandlot`, `Harbor City Kraken`) and say in the rule that it is
invented. `tests/schefter-former-name-callback.test.ts` now scans every prompt
region against 328 name forms harvested exactly the way
`collectFranchiseNameTokens` harvests them, floor included — the redactor's
input set IS the privacy boundary, so the guard's must never be narrower.
Two gaps it still cannot close: **owner personal names** (the configs carry
none — the only list is a comment map in `src/utils/groupme-storage.ts`, so
"Jomar" was caught by review, not CI), and the **per-league lore files**
appended to the same prompt, which name owners and franchises by design. When
adding a rule, assume the guard will not save you from either.

**Postscript — the redactor had the same blind spot in production.** Chasing
the test's harvest turned up that `collectFranchiseNameTokens` read
`team.aliases` but not the `aliases` on each `history[]` entry. Exactly one
franchise is affected and it is the worst possible one: 0004's "Heavy Chevy"
retired carrying `aliases: ["Heavy", "Chevy"]`, so a tip that said "Chevy"
reached the prompt un-fuzzed. Same lesson as the entry above — the harvest is
the privacy boundary — one level deeper into the config schema than anyone
looked the first time. Fixed by iterating `[team, ...history]` for aliases the
way the name fields already were.
## 2026-08-15 - A redaction placeholder is a semantic insertion, not a neutral garble

**Context:** Hardening the franchise-name redactor (entry above) left it
matching every name form at a 2-character floor, case-insensitively. Auditing
the false-positive side turned out to matter far more than expected.

**Insight:** The rule everyone reasoned from — "over-matching is safe, a stray
hit just fuzzes a word" — quietly mis-prices the trade. `[a team]` is not a
redaction mark, it is a **claim**: it asserts that a franchise reference existed
at that position. And HARD RULES 2/3 then explicitly order the LLM to make the
tip's content survive the fuzz. So the model does what it was told — it goes
looking for the team that isn't there and writes one into the story.

A leak names the *wrong* team. Over-matching **fabricates one** on a tip nobody
scoped to a franchise at all. Those are not the same failure, and the second one
is not obviously the cheaper of the two.

The volume was the surprise. ~40 of 328 name forms across the two configs are
ordinary words, and each one was shredding real prose:

```
"Deal is dead."            → "Deal is [a team]."           (DEAD,    0004 abbrev)
"a heavy favorite"         → "a [a team] favorite"         (Heavy,   0004 retired nameShort)
"Owner put out feelers"    → "put out [a team]"            (Feelers, AFL 0017 alias)
"headed to the Saints"     → "the [a team]"                (Saints,  AFL 0020 — an NFL club)
"Swift is being shopped"   → "[a team] is being shopped"   (Swift,   AFL 0016 — an NFL player)
```

The last two are the ones that should have been caught sooner: the harvest
collides with **NFL team names and player surnames**, which is the exact
vocabulary a fantasy tip is made of. 18 of 18 probe sentences came back mangled.

**Three things that generalize past this bug:**

1. **A guard's matching rules do not transfer to production, in either
   direction.** `tests/schefter-former-name-callback.test.ts` splits on
   distinctiveness (case-insensitive for long/multi-word, case-exact for short
   abbreviations) and documents that copying the production matcher would be
   wrong. The *reverse* import is equally wrong and less obvious: the guard
   scans our own prompt prose, which we capitalize properly, while the redactor
   scans owner-typed tips, which are casually lowercase. The same rule is safe
   in one and a leak in the other.
2. **Every relaxation wider than "lowercase" leaked, and it took three tries
   to believe it.** This is the part worth remembering, because each attempt
   looked principled right up until it was measured:
   - *Relax a capital that is merely sentence-initial.* Rationale: a capital
     there is grammar, not a proper noun. Reality: it also destroys the only
     signal available, and sentence-start is exactly where a tipster names a
     team as the subject. Five AFL franchises leaked outright ("Saints are
     shopping a tight end.", "Feelers wants a quarterback."). Reverted.
   - *Relax any ambiguous token when lowercase.* Reality: `saints`, `balls`,
     `feelers`, `herd`, `chat`, `swift`, `fire`, `pain` are names people
     actually use, so "hearing saints is shopping" reached the prompt intact.
     Caught by an outside reviewer, not by me. Narrowed.
   - *Match on a literal space.* "Dead Cap" missed `dead-cap` entirely, the
     token fell apart into `dead`, and the relaxation waved the fragment
     through — so the FULL franchise name survived, a worse leak than the
     single-word case the relaxation existed to allow. Same reviewer.

   The pattern: a relaxation's blast radius is never the case you designed it
   for. **Measure it by sweeping every token in the real configs through every
   casing and separator variant** — that sweep is three lines and it found all
   three of these; reasoning about it found none of them.
3. **Split "is it a word?" from "is it a name people use?"** — one is human
   judgment, the other is derivable, and fusing them into a single curated
   list is what let live nicknames in. `AMBIGUOUS_NAME_TOKENS` answers the
   first; `computeRelaxableTokens` answers the second by relaxing a form only
   when every appearance across both leagues is an MFL `abbrev` or a retired
   `history[]` entry. The derived half self-maintains — rename a team to
   "Fire" and `fire` leaves the set with no list to remember to edit — which
   matters in a league whose punitive-rename culture churns names yearly.
4. **Relaxing a token is only safe if the franchise keeps a form that still
   catches a real mention.** `dream` can never redact on its own (it is stored
   lowercase) but "The Dream" covers the real phrasing. Test that invariant
   against the RELAXABLE set, not the curated one — a blocked token protects
   its franchise fine, and counting it as a hole gives a false alarm.

**Evidence:** `AMBIGUOUS_NAME_TOKENS` / `computeRelaxableTokens` /
`readsAsOrdinaryProse` / `withFlexibleSeparators` / `canonicalizeNameKey` in
`scripts/schefter-rumor-scan.mjs`. Two constraints in
`redactFranchiseNamesInText` that are not obvious from reading it:

- The prose check must run **before** the keep-franchise branches, or an
  ordinary word that is one of the *kept* team's own forms gets normalized to
  that team's display name — "the deal is Dead Cap Walking", the same
  fabrication wearing a real name.
- Widening the matcher's separators forces every Set lookup through
  `canonicalizeNameKey`. Miss that and the matcher happily matches "dead-cap"
  while every key built from "dead cap" fails, quietly demoting the one team
  the post is ALLOWED to name down to "[a team]". A widening and its lookups
  are one change, not two.

**Also worth knowing:** the input redactor is the ONLY mechanical layer.
`sanitizeAiPost` screens meta-commentary, not franchise names — so there is no
output-side net, and false negatives stay genuinely expensive. That asymmetry is
real; it just isn't infinite.

**Recommendation:** Before widening any sanitizer that substitutes a
*meaningful* token, probe BOTH sides against the real configs, and probe them
by sweeping rather than by choosing examples — one tip per token, each in
several casing and separator variants. Position and punctuation are both
load-bearing, and a `tokens.join(' / ')` sweep expresses neither. Every leak
in this entry was found that way and none by reading the code.

And when a doc rule justifies a bias with an assertion about what the failure
mode *is* ("just fuzzes a word"), check the assertion before inheriting the
bias. The corollary bit here too: having corrected that rule, I then leaned on
the correction three times to justify relaxations that leaked. A re-priced
tradeoff is not a licence — it just moves the line, and the new line needs
measuring exactly as much as the old one did.
