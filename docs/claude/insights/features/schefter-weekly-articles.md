# Schefter Weekly Articles (scripts/schefter-weekly-articles.mjs)

Insights for the article pipeline: runner → article-type module → feed append → optional GroupMe promo.

## 2026-07-21 - GroupMe Promos Are OPT-IN Per Article Type — No Export, No Ping (Feed Still Publishes)

**Context:** The daily cut-watch article published to the site feed for days but never reached GroupMe. Nothing errored; owners just never got pinged.

**Insight:** The runner's step 11 only sends a GroupMe promo when the article-type module exports `buildGroupMePromo(post, enrichment, { league })` — the feed write is unconditional, the chat ping is not. A new article type ships silently site-only by default, which reads like a bug to users ("the post made it to the website but not GroupMe"). Promo contract: return one teaser stat + absolute link (never a summary); a falsy return skips the ping; the runner only calls it when the feed write actually happened this run (re-runs never re-buzz). Absolute links need the league's apex from the registry (`LEAGUES[league].domains[0]`) — `post.link` is site-relative.

**Recommendation:** When adding an article type, decide the GroupMe question explicitly: export `buildGroupMePromo` (see `schedule-strength.mjs` or `cut-watch.mjs` for the pattern) or leave a comment saying site-only is intentional. Pin the export's existence in a test — `tests/cut-watch-groupme-promo.test.ts` does exactly this because the missing-export failure mode is silent.

**Evidence:** `scripts/schefter-weekly-articles.mjs` step 11; July 2026 cut-watch bug (post `sf_2026_cut_watch_0720` reached the feed, never GroupMe).

## 2026-07-21 - Cut-Watch Fact-Sheet Builders Take Test Seams via `opts` — Use Them Instead of Live Reads

**Context:** Cut-watch's fact sheet now pulls from three sources beyond the MFL feed files: autocut Redis keys (`autocut:{fid}` cutdown plans), and the two ADP feeds (combined-value blend). Unit tests must not hit Redis or depend on committed feed contents.

**Insight:** `buildFactSheet(data, week, year, projectRoot, opts)` accepts `opts.cutdownPlans` (Map<fid, markedCount> | null) and `opts.adp` ({ redraft, dynasty } Maps | null) as injection seams — `undefined` means "do the live read," explicit `null` means "source unavailable" (exercises the fallback paths: no plan lines, salary-ordered candidates). `buildGroupMePromo` similarly takes `opts.now` for deterministic countdown math. Two invariants worth protecting: (1) autocut plan intel is COUNTS ONLY — marked player ids never enter the fact sheet, so the LLM cannot leak an owner's actual cut list (august-cuts privacy decision #10); (2) the combined-value formula is `dynastyWeight = (contractYears − 1) / 4` clamped to 1–5yr — 1yr = pure redraft ADP, 5yr = pure dynasty, unranked-in-both sorts most-cuttable via a finite sentinel (not Infinity — two Infinities make the sort comparator NaN).

**Evidence:** `scripts/article-types/cut-watch.mjs` (`blendedCutValue`, `loadCutdownPlans`, `loadAdpMaps`), `tests/cut-watch-groupme-promo.test.ts`.
