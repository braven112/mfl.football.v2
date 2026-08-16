# Schefter Rumor Mill (multi-league tips system)

The load-bearing architecture rules live in CLAUDE.md ("Schefter multi-league").
This file holds the finer operational learnings.

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
