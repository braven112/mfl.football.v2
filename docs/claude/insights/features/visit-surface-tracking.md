# Visit surfaces — installed PWA vs browser tab, on Owner Activity

Built 2026-09-06. The layout's visit beacon now reports HOW a visit arrived —
the site installed to a home screen, or an ordinary browser tab — plus a coarse
platform bucket, and `/activity` renders the split for both leagues.

| Layer | Files |
|---|---|
| Vocabulary (allowlists, field encoding, summary math) | `src/utils/visit-surface.ts` |
| Storage + readers | `src/utils/owner-activity.ts` (`recordVisit`, `recordAnonymousSurface`, `getSurfaceSection`) |
| Endpoint | `src/pages/api/track-visit.ts` |
| Detection | `src/layouts/TheLeagueLayout.astro` (visit tracker script) |
| UI | `src/components/theleague/OwnerActivityReport.astro`, both `activity.astro` routes |
| Guard | `tests/visit-surface.test.ts` |

Redis keys, all unexpiring hashes of `<surface>:<platform>` → count:
`surface:{leagueId}` (everyone), `surface:{leagueId}:anon` (the logged-out
SUBSET, not the complement), `surface:{leagueId}:f:{franchiseId}`, and
`surface-last:{leagueId}` (franchiseId → last surface field).

---

## 2026-09-06 — "Which visitors use the app?" is a question only the CLIENT can answer

**Context:** The obvious first move was to look for a server-side signal — a
header, a query param on the manifest's `start_url`, anything in the request.

**Insight:** There isn't one. An installed PWA and a browser tab on the same
site send byte-identical requests: same origin, same cookies, same user agent,
no `Sec-Fetch-*` difference. Anything measuring this has to run in the page and
report it. Three detection gotchas, each of which silently under-counts installs
rather than erroring:

- **`display-mode: standalone` alone is not enough.** A manifest can ask for
  `fullscreen` or `minimal-ui`, and an installed app in either of those modes
  answers `false` to the standalone query — so a later manifest edit would
  quietly reclassify every install as "browser". Match all three.
- **iOS Safari still needs `navigator.standalone`.** The non-standard boolean is
  the only signal for a home-screen app there.
- **iPadOS reports itself as `Macintosh`.** Without a
  `navigator.maxTouchPoints > 1` check, every iPad lands in the desktop bucket.

The measurement rides the beacon that already existed
(`/api/track-visit`, debounced to one per minute per tab via `sessionStorage`),
so it costs no extra request. Detection lives in that bundled script, NOT in the
`is:inline` PWA auth-gate script above it — the two now both test for standalone
mode and are deliberately separate: the gate must run before paint, the beacon
must run on `astro:page-load`.

---

## 2026-09-06 — A public counter endpoint's real risk is hash CARDINALITY, not volume

**Context:** Counting logged-out visitors means an endpoint that writes to Redis
with no session. The instinct is to reach for a rate limit and call it done.

**Insight:** The rate limit (per IP, fails open, `src/utils/rate-limit.ts`) caps
how OFTEN an anonymous caller writes; it does nothing about WHAT they write. The
value that reaches Redis here is a hash FIELD, and an unvalidated field name is
an unbounded key: one arbitrary string per request grows the hash forever, and
nothing ever errors. So the surface and platform are parsed against closed
allowlists and rejected on any miss, which caps the hash at 2 × 4 = 8 possible
fields for all time. `tests/visit-surface.test.ts` pins the allowlists for that
reason and not for tidiness.

Two smaller shapes worth copying:

- **Validate the pair, not the halves.** A surface with no platform yields a
  field the summary math cannot split back apart, so `parseVisitContext` returns
  null unless BOTH parse, and the visit degrades to page-only tracking.
- **Check the segment count when decoding.** `'pwa:ios:extra'.split(':')`
  destructures to a perfectly valid pair if you only read the first two
  elements — the first version of `parseSurfaceField` accepted it, and the guard
  test caught it before it shipped.

---

## 2026-09-06 — With no session, `?league=` is the ONLY league signal an API route has — and there is no safe fallback

**Context:** `docs/claude/insights/domains/mfl-api.md` (2026-07-14) already says
an API route takes its league from the session JWT because `/api/...` paths
carry no league segment. That rule assumes a session exists. This endpoint's
whole point is the requests where one doesn't.

**Insight:** For the logged-out path the client must send the league and the
server must validate it against the registry (`getLeagueBySlug`, else `navSlug`)
— the param can then only ever name one of the handful of leagues that publicly
exist, and the resulting counter is anonymous anyway, so it is a safe input.
What is NOT safe is falling back to the URL when the param is missing:
`getLeagueByPath('/api/track-visit')` returns the DEFAULT league rather than
null, so the "harmless" fallback files every AFL logged-out visit under
TheLeague — a wrong answer that looks like data. Drop the count instead.

For the signed-in path the league still comes from the session and the param is
ignored entirely, which keeps the existing rule intact.

---

## 2026-09-06 — Anon as a SUBSET of the total, not its complement

**Context:** Wanting three numbers (everyone / signed in / signed out) from an
endpoint where the signed-in path already writes several keys.

**Insight:** Storing the anon subset alongside the league-wide total costs one
extra `HINCRBY` on the anonymous path and NOTHING on the signed-in path, which
is the hot one; signed-in traffic is then `all − anon` (`subtractSurfaces`,
clamped at zero because the two hashes are written by separate requests and can
race). Storing signed-in and anon separately instead would have added a write to
every authenticated visit to derive the same three numbers.

Both write paths go through Lua so the multi-key write is ONE Upstash command —
Upstash bills `EVAL` as a single command regardless of how many `redis.call`
lines it contains. Guarding the optional surface writes INSIDE the script
(`if ARGV[5] ~= '' then`) keeps the KEYS list a fixed length whether or not the
client reported a surface, which is what lets one script serve both cases.
