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
