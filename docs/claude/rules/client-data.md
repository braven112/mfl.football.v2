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

---

# Retiring an inline script

`is:inline` and `define:vars` opt out of bundling, typing and imports at once:
no TypeScript, nothing for `astro check` to read, and no way to share a helper
with the component rendering beside them. **4,346 lines are still written that
way**, pinned per file in `tests/fixtures/inline-script-baseline.json` and
enforced by `tests/inline-script-ratchet.test.ts`. That set may only shrink.
Report: `node scripts/lib/inline-script-inventory.mjs`.

A plain `<script>` in an .astro file is **not** this problem — it is a bundled
TypeScript module the type baseline already covers. Roughly 19,500 lines are
that, and they are fine where they are.

## Where a block should go

| The DOM it drives | Destination |
|---|---|
| State a component owns; re-renders on interaction | **React island** (`.tsx` + a `client:` directive) |
| Server-rendered markup across a page; progressive enhancement | **Bundled `<script>` module** |
| Must run before paint, or before the router | **Stays `is:inline`** — add it to `sanctioned` with a reason |

Do not force the first row. Making an island own static server markup means
re-rendering it on the client for nothing;
`src/components/shared/assets/assets-page-behaviors.ts` is the worked example
of the second row, and `useSession` in `TradeBuilder.tsx` of the first.

## The trap: a module is evaluated ONCE per session

This is the bug you will ship if you move an inline block to a module without
thinking about it, and it is the same one recorded for the game strip in
`docs/claude/rules/lineups.md`:

- An **inline script** the ClientRouter has already run is **not re-run** on a
  return visit — so an inline block that wires up elements is already dead the
  second time an owner opens the page (unless it carries `data-astro-rerun`).
- A **module** is evaluated once per session, so module-scope init has the same
  problem, *and* the elements it bound to were replaced by the swap.

So wire per-element listeners inside an **`astro:page-load`** handler — it
fires on the first load as well, so there is no separate init path — and
register document-level delegation exactly once behind a **module-scope flag**
(not a `window.__thing` global; module scope is the reason to be a module).

The assets-page conversion fixed exactly this: its team filter went dead after
any soft navigation back to the page. Verified as a controlled A/B in a real
browser — old code 49 of 49 cards still showing after `goBack()`, new code
correctly filtered.

## Recipe

1. Move the block into a `.ts` module beside its component (or a `.tsx`
   island), typed. Delete the `window.*` globals — module scope replaces them.
2. Wire per-element listeners on `astro:page-load`; guard delegation with a
   module-scope flag.
3. Replace the block with a bundled `<script>` that imports it — a relative
   specifier from the **.astro file's own directory** (`./foo`, not a path
   rebuilt from `src/`).
4. Lower the file's number in `inline-script-baseline.json`, or delete the
   entry when it reaches zero. The ratchet fails until you do — that is the
   point.
5. Verify in a browser, including a **soft navigation away and back**. An
   HTML diff cannot see this class of bug.

**Biggest target:** `players.astro` is 1,753 + 913 lines and is also a forked
sibling pair (`tests/fixtures/page-fork-baseline.json`), so unforking it and
de-inlining it are the same piece of work — do them together, not twice.

