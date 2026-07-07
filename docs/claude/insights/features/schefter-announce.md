# Schefter Announcement Seeder Insights

Domain knowledge for `scripts/schefter-announce.mjs` + `.github/workflows/schefter-announce.yml`
+ the admin compose card (`/theleague/admin/schefter`) + endpoint
(`src/pages/api/admin/schefter-announce.ts`) — the manual path for posting a
one-off, hand-authored Schefter announcement (e.g. "the site now has dark
mode") to the league feed and GroupMe.

---

## 2026-07-07 - Admin "send from the site" Must Dispatch The Workflow, Not Write The Feed

**Context:** Wanted the commish to send announcements from the logged-in admin
page instead of GitHub Actions.

**Insight:** A Vercel-runtime route CANNOT make a visible feed post directly:
`schefter-feed.json` is a **build-time artifact** (`news.astro` uses a static
`import` even though it's `prerender = false`), so a post only appears after the
committed JSON changes and Vercel redeploys. And `GROUPME_SCHEFTER_BOT_ID` is an
Actions-only secret — not in the web runtime. So the admin endpoint **dispatches
`schefter-announce.yml` via `workflow_dispatch`** (feed commit + GroupMe happen
in the Action), exactly the bridge `src/pages/api/cron/roster-sync.ts` uses with
`GH_PAT` (needs `actions:write`). A Redis-write-at-request-time design would
split-brain (GroupMe instant, feed invisible until a separate cron commits) and
still need a new consumer — strictly worse.

**Pattern:**
- Gate every admin route with `getAuthUser` + `isCommissionerOrAdmin` (403 JSON /
  page redirect) — `src/utils/auth.ts:69`.
- Keep pure compose logic in `src/utils/schefter-announce-core.mjs` so the
  endpoint's `preview` action renders byte-identical output to what the workflow
  ships. `.mjs` in `src/utils` is importable by BOTH the node CLI script and the
  TS route (same trick as `leagues-data.mjs`).
- The `send` action requires `GH_PAT` in the Vercel env; without it the endpoint
  returns a clear 500 rather than silently no-op'ing.

---

## 2026-07-07 - Schefter Has No Native "Announcement" Lane — Seeding Is Manual

**Context:** Needed Schefter to announce a site feature (dark mode + new
player images). This is neither a transaction, a trade rumor, nor a data-driven
article, so it maps onto none of his automated lanes.

**Insight:** All three Schefter generators are automated and unsuitable for a
custom announcement:
- **Transaction scanner** (`schefter-scan.mjs`) — MFL-transaction-driven only.
- **Rumor mill** (`schefter-rumor-scan.mjs`) — drains `schefter:tips:queue`, but
  runs every tip through anonymization + LLM synthesis + bucket/daily-cap gates,
  so your exact copy would be mangled; also requires an authed franchise and is
  rate-limited. Not a viable announcement channel.
- **Article generator** (`schefter-weekly-articles.mjs`) — writes the feed but
  **never touches GroupMe**, and every article type is season-guarded + AI-built
  with no free-form option.

There is no admin compose/inject endpoint either — `/theleague/admin/schefter`
is read-only and `/api/admin/schefter-stats` is GET-only. So a one-off
announcement must be seeded deliberately.

**Evidence:** `SchefterPostType` (`src/types/schefter.ts:168-179`) has no
`announcement` member (comment: "MVP ships 'transaction' only"). The feed
(`src/data/theleague/schefter-feed.json`) contains ~960 `external`, ~137
`transaction`, a handful of `ask-roger`, and exactly 1 `article` — zero
site/feature/meta posts historically.

**Recommendation:** Use `scripts/schefter-announce.mjs`. It classifies the post
as `type: 'article'` + `category: 'articles'` (the least-wrong bucket — renders
under Articles, not as a fake transaction) with `franchiseIds: []`.

---

## 2026-07-07 - Feed Write And GroupMe Delivery Are Separate Primitives

**Insight:** There is no single "write feed + send GroupMe" helper. The two
primitives the announcer composes:
- **Feed:** `appendToFeed(feedPath, post)` in
  `scripts/article-utils/feed-writer.mjs` — prepends newest-first, dedups by
  `post.id`, returns `false` if the id already exists.
- **GroupMe:** `POST https://api.groupme.com/v3/bots/post` with
  `{ bot_id, text }`. Bot id is **per league**: `GROUPME_SCHEFTER_BOT_ID`
  (theleague) / `GROUPME_AFL_SCHEFTER_BOT_ID` (afl). **Roger's bot is never a
  fallback** — if the Schefter bot id is unset, skip GroupMe. GroupMe returns
  202 on success.

Two safety patterns baked into the seeder, worth reusing:
1. **Idempotent id** — post id is `sf_announce_${slug}` from a required
   kebab-case `--slug`, so an accidental re-run is a feed no-op.
2. **No double-ping** — GroupMe only fires when `appendToFeed` returned `true`
   (post newly written this run), so a re-run can't re-buzz the chat.

**Evidence:** Feed paths differ per league and are load-bearing (do NOT
normalize): TheLeague feed is `src/data/theleague/schefter-feed.json`, AFL is
`data/afl-fantasy/schefter-feed.json` — mirrored from the canonical map in
`schefter-scan.mjs:74-99`.

---

## 2026-07-07 - Dispatch-Only Workflows Need To Live On The Default Branch

**Insight:** `schefter-announce.yml` is `workflow_dispatch`-only (no cron). The
GitHub "Run workflow" button only appears once the workflow file is on the
**default branch** (`main`) — a dispatch-only workflow sitting on a feature
branch is not runnable from the Actions UI. So the seeder is unusable until its
PR merges. Default `dry_run: true` so the first click previews (writes/sends
nothing) before a live run.
