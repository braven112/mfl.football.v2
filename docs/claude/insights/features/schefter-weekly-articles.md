# Schefter Weekly Articles (scripts/schefter-weekly-articles.mjs)

Insights for the article pipeline: runner → article-type module → feed append → optional GroupMe promo.

## 2026-07-26 - Cut Watch Carries Two Framings That the LLM Will Weld Together Unless the Mechanic Is Stated

**Context:** The 7/26 cut-watch article shipped a false league rule: "When you don't pick, the system picks the weakest combined-value players first." The real deadline auto-cut (august-cut-selection-core.mjs) is marked-players-first, then newest waiver/FA/auction pickup first — trades treated as long-held, value plays no role.

**Insight:** Root cause was category confusion, not a hallucinated fact: the fact sheet intentionally leads with value-ranked cut CANDIDATES (editorial advice), and the only mechanic hint ("auto-chosen at the deadline") gave the model an actor with no rule — so it welded the advisory ranking to the mechanism, in a single sentence with no cut verb (a cut-verb regex misses it). The fix is supply-side + guard-side: the fact sheet now states the mechanic in its own block AND computes each over-limit team's actual auto-cut order with the same `selectAutoCuts` the deadline job runs (empty marked list — plans stay private per decision #10; skipped for owners whose filed plan covers the overage). The guard is a per-sentence ACTION+VALUE+MECHANISM lexicon detector (`scripts/lib/cut-watch-graders.mjs`) with a narrow negated-value escape, run over every shipped cut-watch post in `tests/cut-watch-auto-cut-rule.test.ts` and over live generations in `pnpm eval:cutwatch`. Both directions matter: the suite also asserts the value-ranked advisory list SURVIVES — a "fix" that stops recommending entirely breaks the feature.

**Evidence:** `sf_2026_cut_watch_0726` (corrected in-place in the feed); `scripts/article-types/cut-watch.mjs`; `tests/fixtures/cut-watch-fixture.ts` (value/recency inverted so the two lists share zero names); the real-data fact sheet showing the system's actual first cuts for Midwestside are Justin Herbert and Amon-Ra St. Brown (March auction wins = newest pickups) while unranked dead weight survives.

## 2026-07-21 - GroupMe Promos Are OPT-IN Per Article Type — No Export, No Ping (Feed Still Publishes)

**Context:** The daily cut-watch article published to the site feed for days but never reached GroupMe. Nothing errored; owners just never got pinged.

**Insight:** The runner's step 11 only sends a GroupMe promo when the article-type module exports `buildGroupMePromo(post, enrichment, { league })` — the feed write is unconditional, the chat ping is not. A new article type ships silently site-only by default, which reads like a bug to users ("the post made it to the website but not GroupMe"). Promo contract: return one teaser stat + absolute link (never a summary); a falsy return skips the ping; the runner only calls it when the feed write actually happened this run (re-runs never re-buzz). Absolute links need the league's apex from the registry (`LEAGUES[league].domains[0]`) — `post.link` is site-relative.

**Recommendation:** When adding an article type, decide the GroupMe question explicitly: export `buildGroupMePromo` (see `schedule-strength.mjs` or `cut-watch.mjs` for the pattern) or leave a comment saying site-only is intentional. Pin the export's existence in a test — `tests/cut-watch-groupme-promo.test.ts` does exactly this because the missing-export failure mode is silent. Two league-threading rules that reviews keep catching: (1) every module hook the runner calls with `{ league }` (`buildPost`, `buildFactSheet`, `buildGroupMePromo`) must actually consume it — a hook that hardcodes `'theleague'` while its siblings are league-aware produces cross-domain links under `--league afl-fantasy`; (2) absolute URLs use `leagueOrigin(LEAGUES[league])`, never `domains[0]` — session cookies are host-only and the bare apex opens logged-out.

**Evidence:** `scripts/schefter-weekly-articles.mjs` step 11; July 2026 cut-watch bug (post `sf_2026_cut_watch_0720` reached the feed, never GroupMe).

## 2026-07-21 - Cut-Watch Fact-Sheet Builders Take Test Seams via `opts` — Use Them Instead of Live Reads

**Context:** Cut-watch's fact sheet now pulls from three sources beyond the MFL feed files: autocut Redis keys (`autocut:{fid}` cutdown plans), and the two ADP feeds (combined-value blend). Unit tests must not hit Redis or depend on committed feed contents.

**Insight:** `buildFactSheet(data, week, year, projectRoot, opts)` accepts `opts.cutdownPlans` (Map<fid, markedCount> | null) and `opts.adp` ({ redraft, dynasty } Maps | null) as injection seams — `undefined` means "do the live read," explicit `null` means "source unavailable" (exercises the fallback paths: no plan lines, salary-ordered candidates). `buildGroupMePromo` similarly takes `opts.now` for deterministic countdown math. Two invariants worth protecting: (1) autocut plan intel is COUNTS ONLY — marked player ids never enter the fact sheet, so the LLM cannot leak an owner's actual cut list (august-cuts privacy decision #10); (2) the combined-value formula is `dynastyWeight = (contractYears − 1) / 4` clamped to 1–5yr — 1yr = pure redraft ADP, 5yr = pure dynasty, unranked-in-both sorts most-cuttable via a finite sentinel (not Infinity — two Infinities make the sort comparator NaN).

**Evidence:** `scripts/article-types/cut-watch.mjs` (`blendedCutValue`, `loadCutdownPlans`, `loadAdpMaps`), `tests/cut-watch-groupme-promo.test.ts`.
