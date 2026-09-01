# Client data — the shared query store

**Read this before adding a `fetch` to an island or a `<script>`.**

The app has one client data layer: `src/utils/query-store.ts`. It is not a
library and there is deliberately no dependency behind it. Its job is to make
"who is logged in?", "what is the score?", "what is on this roster?" one
request and one answer per page, no matter how many places on that page ask.

| Layer | File | Use it when |
|---|---|---|
| Store (plain TS, no React) | `src/utils/query-store.ts` | Defining a query; reading one from a `<script>` |
| React binding | `src/hooks/useSharedQuery.ts` | Reading a query from an island |
| Live-feed adapter | `src/utils/live-poll-store.ts` | A feed that must poll; `subscribe` there REQUIRES an interval |
| First real query | `src/utils/queries/session.ts` + `src/hooks/useSession.ts` | Anything that needs the signed-in user |

## Why not TanStack Query / SWR

Astro hydrates every island into **its own React root**. A provider-based
cache wants one provider above one tree; this app has up to ~45 trees on a
page and no common React ancestor, so a provider cache would be one cache per
island — the exact duplication it exists to prevent. What DOES cross the
boundary is a module: the bundler hoists a module several islands import into
one chunk, evaluated once per page. So the cache lives at module scope and
islands subscribe to it through `useSyncExternalStore`.

The second reason is that half this app's interactivity is not React at all
(~25k lines of inline `<script>`). `subscribe` and `ensure` have no React
import, so **a plain script and an island share one cache**. That is why
migrating an inline script to the store is progress even before the script
becomes a component.

## The rules

- **A failed request is not an empty result, and not a logged-out user.** This
  is the recurring bug class in this repo. The store keeps them apart by
  construction: a failed load flips `status` to `'error'` and **leaves `data`
  and `fetchedAt` alone**, so stale-but-usable stays usable. Never collapse
  `isError` into "no data" in a component — `isError && data` should render
  the data with a staleness marker, not an error screen.
  - Corollary for any endpoint that answers **200 in both directions** (like
    `/api/auth/me`, and most of MFL's API — see `docs/claude/rules/lineups.md`):
    the loader must `throw` on a non-200 or an unrecognized body, or the store
    caches a transport failure as a real answer.
- **`staleTime` defaults to `Infinity`.** Cached data is reused until it is
  invalidated, refreshed, or re-polled. Opt in to time-based revalidation per
  store; a cache that silently refetches is a request amplifier.
- **After a write, `invalidate()` — don't reload the page.** Keys with live
  subscribers reload in place and never blank first (dropping to idle flashes
  a spinner over data that is about to be replaced by a near-identical
  payload). Keys with no subscribers are evicted and reload on next use.
  Pass a matcher to scope it: `invalidate(k => k.startsWith('roster:'))`.
- **When a mutation's response IS the new state, `setData()` it.** A login
  response is more current than any follow-up GET.
- **Poll only what is genuinely live.** `useSharedQuery` without `intervalMs`
  loads once. Reach for `live-poll-store.ts` only for a real feed — its
  interval-required signature is the point.
- **Scope keys per league.** Two leagues both have a franchise `0001`, so a
  bare `roster:0001` is ambiguous the moment the second league writes to it.
  Build keys through `rankings-scope.ts` idioms and **re-read the scope per
  call, never capture it at module load** — with the ClientRouter one module
  instance survives a navigation between leagues. See the Rankings section of
  `CLAUDE.md`.

## Gotchas

- **`keyOf` must cover everything `load` reads.** An entry keyed by less than
  the request depends on will serve a payload describing something else. See
  `espnOverrideKey` in `useNflScoreboard` for the soft-navigation case that
  made this necessary.
- **The snapshot getter must be identity-stable.** `useSyncExternalStore`
  re-renders forever if it allocates. The store returns one frozen shared
  `IDLE` for every unloaded key and only allocates a state object when
  something changed; keep it that way.
- **`refresh()` never rejects, `ensure()` does.** `refresh` is for
  fire-and-forget (`void refresh(...)` can't raise an unhandled rejection);
  `ensure` is for `await` + `try/catch`. `ensure` still RESOLVES stale data
  when a refresh failed over a good payload — it only throws when there is
  genuinely nothing to hand back.
- **The store is a module singleton, so tests share it.** Call
  `invalidate()` in `beforeEach` (see `tests/session-query.test.ts`).

## Tests

- `tests/query-store.test.ts` — the added surface (one-shot reads, staleTime,
  `ensure`, invalidation, optimistic writes).
- `tests/live-poll-store.test.ts` — the original poller semantics, exercised
  through the adapter. **These were written before the store was extracted and
  pass unchanged**, which is what makes them the regression net for it. If a
  change to `query-store.ts` needs these edited, that change is altering live
  scoring — stop and reconsider.
- `tests/session-query.test.ts` — the failed-request-is-not-logged-out rule.

## Migrating a call site

1. Is there already a query for this data in `src/utils/queries/`? Use it.
2. If not, add one there: `createQueryStore(keyOf, load, { staleTime })`, with
   the loader throwing on anything that is not a well-formed success.
3. Island → `useSharedQuery` (or a purpose-built hook like `useSession`).
   Script → `ensure()`.
4. Delete the local `useState`/`useEffect`/`fetch` triple. Check what its
   `.catch` was doing — it is usually swallowing the error into the empty
   state, and that behavior should NOT be preserved.

**Known remaining duplicate:** `src/pages/theleague/rosters.astro`
(`hydrateTeamFromSession`) still reads `/api/auth/me` directly. It handles the
failure correctly, so it is not urgent; it is left for whenever that file's
inline script is broken up.
