# Schefter Admin Dashboard Insights

Domain knowledge for `/theleague/admin/schefter` — the commissioner-only ops
dashboard that monitors the rumor mill, GroupMe ingestion, and trade-offer
detection.

---

## 2026-04-30 - Pill State From Transient Queue Is Misleading For Old Items

**Context:** The original GroupMe stream tagged each cached message as
"picked up" if its id appeared in the live `pendingTips` queue, otherwise
"ignored". Tips have a 24h TTL and are removed from the queue once
consumed by a rumor cycle, so any message older than ~24h showed "ignored"
forever — including messages that had successfully been turned into a
published post.

**Insight:** When a dashboard derives a status pill from a transient
storage layer (queue, cache, ZSET with TTL), it can only show the
*current* state, not the historical outcome. Status indicators that need
to remain accurate over time must cross-reference against an authoritative
durable record.

**Evidence:** `src/pages/theleague/admin/schefter.astro` originally built a
`groupmeTipIds` Set from `data.redis.pendingTips` and used set membership
as the only signal. After the restructure, the page builds
`postedGmIdToPostId` server-side from `feed.posts[].tipIds` (the durable
record) AND keeps the pending-queue Set for live status — yielding four
states: `posted`, `pending`, `expired`, `no-match`.

**Recommendation:** Any future admin pill that says "this thing happened"
should derive from a durable record, not from a queue or cache. If the
durable record requires server-side computation (looping `feed.posts[]`
to build a Map), do it once in the API route and ship the lookup table
down — don't make the client iterate the full feed.

---

## 2026-04-30 - Channel Inference From Feed Posts (No New Schema)

**Context:** The dashboard needed a "Channel Mix" hero showing post share
by source (web tip / GroupMe / trade-offer detection / wire). We did not
want to add a `channel` field to every post in `schefter-feed.json` —
that would require a migration script and changes to every post-writing
code path.

**Insight:** Channel can be inferred from existing fields with a small
helper:
- `transactionSubType === 'rumor_mill'` AND any `tipId` starts with `gm_`
  → GroupMe (the listener's tip-id prefix is the durable signal)
- `transactionSubType === 'rumor_mill'` AND no `gm_` tipIds → Web (anon
  tipster form)
- `transactionSubType === 'TRADE_PENDING'` → trade-offer detection
- Anything else (`type === 'external'`, completed `TRADE`, articles)
  → Wire / external

**Evidence:** `src/pages/api/admin/schefter-stats.ts` `inferChannel()`
helper (lines ~120-130). Returns one of four `ChannelKey` values with no
fallthrough, which guarantees `total === sum(per-channel counts)`.

**Recommendation:** Before adding new fields to a JSON record, check
whether the desired classification is already encoded across the existing
fields. Inferring at read time (with a typed helper) avoids the migration
hassle and keeps the schema lean. Also: export the helper's union type
(`ChannelKey`) so client code can narrow against it.

---

## 2026-04-30 - Demote Card Headings When Cards Live Inside Cluster Sections

**Context:** This admin page was a flat grid of ~14 cards, each with
`<h2>` titles. The restructure introduced three cluster sections, each
with its own `<h2>` title. With both cluster titles AND card titles at
`<h2>`, screen-reader heading navigation collapsed: an AT user couldn't
tell that "Posts in Feed" was a child of "Activity & Stats" — they read
as siblings.

**Insight:** Heading hierarchy matters even on admin/diagnostic pages.
When wrapping existing card grids in cluster sections, demote the card
titles to `<h3>` so the outline stays nested. Also remember to demote
descendants of those cards (env subsections went `<h3>` → `<h4>`, and
their inner labels `<h3>` → `<h5>`).

**Evidence:** `src/pages/theleague/admin/schefter.astro` — 14 card
headings demoted to `<h3>`, 2 env section headings to `<h4>`, 3 env
subtitle headings to `<h5>`. The hero `<h2>` ("Channel Mix") was kept
at `<h2>` because it sits at sibling-level with cluster titles, not
inside a cluster.

**Recommendation:** When refactoring a flat card grid into clustered
sections, do a heading-level pass as the LAST step — once the section
boundaries are settled. Use `grep -n '<h2\|<h3\|<h4'` to verify the
final hierarchy. Don't forget JS-rendered `<h3>` strings inside dynamic
HTML (the env panel's "Variables" / "Secrets" / "Latest workflow runs"
subtitles).

---

## 2026-04-30 - SSR Loading Placeholder Prevents Empty-Bar Flash

**Context:** The new Channel Mix bar is populated by client JS after the
page's first `/api/admin/schefter-stats` fetch resolves. On a slow
connection (or first-paint), the bar rendered as an empty 28px gray
rectangle for 100-500ms before the segments injected.

**Insight:** For client-rendered chart-style elements, seed the SSR HTML
with a single 100% "Loading…" segment that uses the same DOM/CSS
structure the client will overwrite. The transition from "Loading…" →
real data is much less jarring than empty → real.

**Evidence:** `src/pages/theleague/admin/schefter.astro` lines ~55-66 —
both `data-chx-bar` divs ship with a child:
```html
<span class="ops-chx__seg ops-chx--empty" style="--w:100%;" aria-hidden="true">
  <span class="ops-chx__seg-label">Loading…</span>
</span>
```
The client's `renderChannelMix()` replaces `bar.innerHTML` on first run,
so the placeholder gets cleanly replaced.

**Recommendation:** Apply the same pattern to any other client-populated
chart on this codebase (e.g. salary-history Chart.js page, future Schefter
trend dashboards). The placeholder needs to share enough structure with
the real render that it doesn't cause layout shift.

---

## 2026-04-30 - Astro `<details>` For Diagnostic Demotion

**Context:** The dashboard had two prominent env-var sections (Vercel
runtime + GitHub Actions) at the top — useful when something's broken,
but pure noise the rest of the time. We wanted to move them to the
bottom and collapse by default without losing the data.

**Insight:** Native `<details>` + `<summary>` is the simplest collapsible.
It's:
- Keyboard-accessible by default (Tab focuses, Enter/Space toggles)
- ARIA-correct without any added attributes
- Renders DOM children regardless of open state, so existing JS that
  populates `#ops-vercel-env-list` etc still works whether the panel
  is open or closed

The custom chevron is `aria-hidden="true"` and rotated via CSS — wrap
the rotation in `@media (prefers-reduced-motion: reduce)` to disable.

**Evidence:** `src/pages/theleague/admin/schefter.astro` lines 287-310
and CSS `.ops-diag*` rules. The summary uses `list-style: none` +
`::-webkit-details-marker { display: none }` to remove the default
disclosure triangle without breaking semantics.

**Recommendation:** For any "useful but rarely-needed" diagnostic UI on
admin pages, default to `<details>` over a custom toggle. Don't add
`aria-expanded` — the element manages it natively.

---

## 2026-04-30 - Deferred Follow-Ups (Not Done This PR)

**1. GitHub API calls fire every 60s regardless of `<details>` state.**
   `readGitHubStats()` in `schefter-stats.ts` makes 11 concurrent GitHub
   REST calls per request. The auto-refresh polls every 60s, so even
   when the diagnostics panel is closed (the common case), we burn PAT
   rate limit. Fix: add `?github=1` query param, gate the GitHub fan-out
   behind it, fire a separate fetch from a `details#ops-diag` `toggle`
   listener on the client. Out of scope for this PR; admin page only.

**2. Deep-link landing race on `/theleague/news`.**
   The "posted" pill links to `/theleague/news#post-{id}`. `SchefterFeed`
   paginates with `initialLimit={25}` (CSS show/hide, not lazy DOM).
   For posts beyond position 25, the anchor exists in the DOM but is
   `display: none` — browser navigation lands at the page top instead.
   Fix: in `news.astro` frontmatter, when `Astro.url.hash` matches
   `#post-{id}`, pass the full post count as `initialLimit` so the
   target anchor is visible on load. Out of scope for this PR; touches
   the news page pagination logic.

**3. `gm_` prefix repeated in three places.**
   Server: `inferChannel()` and `postedGmIdToPostId` builder. Client:
   `pendingGmIds` Set construction. All use `id.startsWith('gm_')` /
   `id.slice(3)`. If the prefix ever changes, three places to update.
   Mitigation: add a shared constant. Low priority; the prefix has
   been stable since the listener was written.

---

## Architectural Notes

- **The dashboard does NOT use the editorial design standard.** It
  intentionally stays on the `ops-*` utility token system (inline hex
  in the `.ops-pill--*` family, no left-border editorial section
  titles). When making changes, do not pivot to the editorial pattern —
  that's reserved for member-facing pages.
- **The page is `prerender = false`** because it needs auth. All data
  fetches happen client-side from `/api/admin/schefter-stats`.
- **No React islands.** All rendering is via inline `<script>` DOM
  manipulation. Don't introduce React for this page; the existing
  pattern is intentional and zero-bundle.
- **The page polls every 60s.** Any new data source added to the
  response should be cheap to compute on the server — both because of
  rate-limit pressure and because the API runs in a Vercel serverless
  function with cold-start cost.
