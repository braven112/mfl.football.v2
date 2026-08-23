# Schefter Weekly Articles (scripts/schefter-weekly-articles.mjs)

Insights for the article pipeline: runner → article-type module → feed append → optional GroupMe promo.

## 2026-08-23 - How the Runner CALLS a Hook Is the Switch That Makes It Mandatory

**Context:** Every article type had to start declaring where its column links (`relatedLinks`), after the 2026 schedule-release column ran eight paragraphs about a schedule and never linked to the schedule release page — and a `grep '<a '` over the whole published feed (396 posts, every type, both leagues) returned ZERO. No article type had ever emitted a link and nothing would have told us.

**Insight:** `tests/article-type-interface.test.ts` does not hardcode the required-export list — it derives it by reading `schefter-weekly-articles.mjs` and collecting every `mod.X` the runner calls, then SUBTRACTING the ones wrapped in `typeof mod.X === 'function'`. So the call site is the enforcement lever, and it cuts both ways: adding an unguarded `mod.foo()` makes every existing type fail until it implements foo (which is exactly how a new mandatory hook gets rolled out), and wrapping an existing call in a typeof guard silently demotes it to opt-in — the same mechanism that makes `buildGroupMePromo` optional (see the 2026-07-21 entry, which documents this lever from the other side). Because the demotion is invisible in a diff that only touches the runner, `tests/schefter-links.test.ts` now asserts the `relatedLinks` call stays unguarded. When a hook must be mandatory, call it unconditionally AND pin the unguardedness; a comment saying "required" enforces nothing.

**Recommendation:** Three-layer shape for anything the LLM is asked to produce and must not omit: DECLARE (a per-type export the runner calls unconditionally), ASK (put the requirement in the fact sheet as copy-this-verbatim text, never a description — a model told to "link to the standings" builds a plausible URL, and `/theleague/schedule` 404s exactly as hard as gibberish), ENFORCE (post-process the built post before the feed write — repair what you can, strip what you can't, inject what's missing). Don't rely on the prompt alone; `applyArticleLinks` was written on the assumption the model would ignore the directive some fraction of the time, and replaying the real August output through it confirmed that assumption.

**Evidence:** `scripts/lib/schefter-links.mjs`, `scripts/schefter-weekly-articles.mjs` steps 8/10, `tests/article-type-interface.test.ts` (`requiredExports()` / `optionalExports()`), `tests/schefter-links.test.ts`.

## 2026-08-23 - A Route-Existence Check Against src/pages/ Is Vacuously True Until You Exclude the Root Catch-All

**Context:** Guarding that no Schefter post links to a page that doesn't exist meant resolving hrefs against `src/pages/`. The first version passed everything, including `/theleague/nope`.

**Insight:** `src/pages/[...path].astro` is the shared-host router that maps unprefixed paths onto a league; a resolver that treats any `[...rest].astro` as "this segment matches" therefore matches EVERY path at depth 0, and the guard silently becomes a no-op that still reports green. Rest params must be honored in nested directories (`power-rankings/[...rest].astro` is a real page) but skipped at the pages root. The same resolver also has to honor single dynamic segments or it reports false failures: every Schefter article permalink is `/theleague/news/<id>`, served by `news/[id].astro`, so a literal-file-only check calls all four published articles broken — and a guard that cries wolf on real links is one nobody keeps. `tests/helpers/astro-routes.ts#astroRouteExists` handles both, plus stripping `?query` before resolving.

**Recommendation:** Any new "does this link resolve" test should import `astroRouteExists` rather than re-deriving it, and should be mutation-tested once (break a link on purpose, confirm the test fails) — a route checker that returns true for everything is indistinguishable from a passing suite.

**Evidence:** `tests/helpers/astro-routes.ts`, `src/pages/[...path].astro`, `tests/root-catch-all.test.ts`.

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
