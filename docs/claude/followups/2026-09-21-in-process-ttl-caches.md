---
slug: in-process-ttl-caches
status: open
severity: P3
opened: 2026-09-21
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1182
hotfix_sha:
followup_issue:
followup_pr:
followup_session: session_01AieBcrFSFXEjNGzubGUZQX
---

# Follow-up: three hand-rolled in-process TTL caches, one shape

Raised by `/live` step 5c (quality) on PR #1182. Nothing is broken — this is a
reuse finding, deliberately NOT applied in that PR because the extraction has a
blast radius the PR's subject does not.

## The shape, repeated

Three caches in `src/utils/` now do the same thing with the same idiom: a
`Map` hung off `globalThis`, a full TTL, a shorter TTL for an empty answer, a
size cap that evicts the oldest entry, and an exported `clear*Cache()` that
exists only so a test asserting on WHICH url was fetched is not testing its own
ordering.

| Cache | Full TTL | Empty TTL | Cap |
|---|---|---|---|
| `broadcast-live-source.ts` franchise marks | 1 h | — (empty not cached) | 64 |
| `broadcast-live-source.ts` projections | 10 min | 60 s | — |
| `mfl-schedule-pairings.ts` week pairings | 1 h | 60 s | 64 |

The third is new in #1182 and was written by copying the first, which is how
the repo gets a fourth.

## Why it was not done in #1182

`broadcast-live-source.ts` is routed to 13 guard suites and is read by both
live boards. Rewriting its caching to sit on a shared helper is a change to a
live-scoring surface in a PR whose subject is a pairing fallback and an
identity rung — the kind of silent restructuring `/live` step 5c explicitly
says to file rather than fold in.

## What the work is

Extract one `ttlCache(name, { ttlMs, emptyTtlMs, cap })` helper (probably
`src/utils/ttl-cache.ts`), move the three call sites onto it, and keep each
site's own TTL constants and their comments — the VALUES are per-domain
decisions with reasons (a schedule does not move mid-week; a projection does
not move mid-game; an empty answer is short because these run on a poll path),
and collapsing them into one default would lose the reasoning that makes them
correct.

Two properties the helper has to keep, both load-bearing today:

- **Empty answers get their own, shorter TTL rather than no TTL.** "Never cache
  a failure" is the rule elsewhere in this repo, and on a POLL path it inverts:
  never caching an empty answer means re-asking MFL every 25 s forever, which
  is how a board gets itself throttled.
- **The cache is keyed off `globalThis`, not a module-level `const`.** A module
  instance is not guaranteed to be shared the way the cache assumes.

## Done when

- One helper, three call sites, each keeping its own named TTL constants.
- The existing guards still pass without being edited to suit the refactor.
- No fourth copy: a grep for `globalThis as {` in `src/utils/` finds the helper
  and nothing else caching this way.
