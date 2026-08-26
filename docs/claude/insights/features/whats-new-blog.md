# What's New Blog Redesign

## 2026-02-22 - SSR Required for Cookie-Based "New" Badges

**Context:** Implementing "new since last visit" indicators on the What's New listing page.

**Insight:** The listing page must use `prerender = false` (SSR) to read the `whats_new_last_visit` cookie server-side via `Astro.cookies`. Detail pages remain static (`prerender = true`) since they don't need cookie data. This avoids FOUC where badges would flash on hydration.

**Evidence:** `src/pages/theleague/whats-new/index.astro` line 20: `export const prerender = false`

**Recommendation:** Any page that needs cookie-based personalization before first paint must be SSR. Use `enrichEntries(sorted, lastVisitDate)` with `null` for first-visit baseline (marks all `isNew: false` to avoid badge noise).

---

## 2026-02-22 - Astro Route Coexistence: index.astro + [id].astro

**Context:** Adding individual detail pages alongside the existing listing page.

**Insight:** To have both `/theleague/whats-new` (listing) and `/theleague/whats-new/[id]` (detail), the listing must be moved from `whats-new.astro` to `whats-new/index.astro`. Both files coexist in the same directory.

**Evidence:** `src/pages/theleague/whats-new/index.astro` (SSR listing) + `src/pages/theleague/whats-new/[id].astro` (static detail)

**Recommendation:** When adding sub-routes to an existing page, always move the parent to a directory with `index.astro`.

---

## 2026-02-22 - Global a:hover Overrides Card text-decoration

**Context:** Cards are `<a>` tags wrapping title, summary, and "Read more" text. On hover, all text got underlined.

**Insight:** A global `a:hover { text-decoration: underline }` rule in the site's base styles overrides the card's `text-decoration: none`. The class selector `.wn-card:hover` has higher specificity than `a:hover`, but depending on stylesheet load order it may not win. Using `!important` on `a.wn-card:hover` guarantees the override.

**Evidence:** `src/pages/theleague/whats-new/index.astro` — `a.wn-card:hover { text-decoration: none !important }`

**Recommendation:** When using `<a>` tags as card containers, always add `text-decoration: none !important` on hover to combat global link styles. Only the "Read more" span changes color via `.wn-card:hover .wn-card__read-more`.

---

## 2026-02-22 - WCAG Contrast for Category Colors and Decorative Borders

**Context:** Initial category colors and sidebar borders failed WCAG 2.1 contrast checks.

**Insight:** Category pill badge colors need 4.5:1 contrast ratio against white text (AA normal text). Darkened values that pass: purple `#6d28d9` (7.10:1), green `#166534` (7.13:1), blue `#1d4ed8` (6.70:1). Timeline sidebar border is decorative but was changed from `#e2e8f0` to `#9ca3af` for visibility. Inactive sidebar labels changed from `#6b7280` to `#4b5563` (7.56:1).

**Evidence:** Category tokens in both `index.astro` and `[id].astro`: `--cat-new-page: #6d28d9`, `--cat-new-feature: #166534`, `--cat-enhancement: #1d4ed8`

**Recommendation:** Always verify category/badge colors against white text at 4.5:1 minimum. Use `color-mix()` for gradient backgrounds that reference category colors.

---

## 2026-02-22 - Nav Active State for Sub-Pages

**Context:** Detail pages at `/theleague/whats-new/[id]` didn't highlight the "What's New" nav link.

**Insight:** `isLinkActive()` in `nav-utils.ts` only did exact match. Added prefix matching: if `normalizedLink !== '/'` and `normalizedCurrent.startsWith(normalizedLink + '/')`, return true.

**Evidence:** `src/utils/nav-utils.ts` ~line 370

**Recommendation:** This pattern works for any page with sub-routes. The `/` guard prevents the homepage from matching everything.

---

## 2026-07-02 - League Scoping Must Fail Closed (and Tests Are the Real Enforcement)

**Context:** An AFL-only announcement (afl-trophy-wall) headlined The League's homepage hero because its entry had no `leagues` tag and `entryAppliesToLeague()` defaulted missing tags to "visible everywhere." A second entry was tagged with the invalid slug `afl-fantasy` and was silently invisible on BOTH sites — same root cause, opposite symptom.

**Insight:** For a scoping field, a fail-open default turns the easiest authoring mistake (omission) into the maximum blast radius (cross-league leak). Flipping to fail-closed means a mistake can only ever hide content, never leak it — and a build-blocking data test catches the hidden entry before it ships. Also: making `leagues` required on the `WhatsNewEntry` TypeScript interface is documentation only — nothing in CI typechecks the JSON cast (`entries as WhatsNewEntry[]`), and vitest strips types without checking them. The vitest data-validation suite (`tests/whats-new-data.test.ts`) is the actual enforcement layer; don't mistake the type for a guard.

**Evidence:** `src/types/whats-new.ts#entryAppliesToLeague` (returns `false` for missing/empty `leagues`), `tests/whats-new-data.test.ts` "league scoping" describe block, `scripts/weekly-changelog-rollup.mjs` (per-league rollups, exits 1 on untagged staging changes).

**Recommendation:** Any new audience/scope field on data-file-driven content (visibility, leagues, tiers) should (1) fail closed in the display helper, (2) be validated by a build-blocking test on the data file itself, and (3) be validated at every automated writer of that file (cron scripts). Validating only at render time is too late; validating only in docs is not validation.

---

## 2026-07-05 - Hero CTAs Default to the Entry's Article, Not the Listing

**Context:** Feature-hero CTAs with no `link` fell back to the What's New
listing page — and one entry linked to `/theleague` itself, a circular CTA on
the homepage hero. Brandon's rule: a hero CTA links to the article about the
feature, or a page the feature lives on — never the generic listing.

**Insight:** Both `featureToHero()` implementations (`hero-resolver.ts` for
The League, `afl-hero-resolver.ts` for AFL — they are separate copies, fix
both) now default a missing `link` to the entry's own article page
(`/{league}/whats-new/{id}`, label "Read the full story"). The component-level
fallback in `FeatureCompositeHero.astro` (`/theleague/whats-new`) is now dead
code for feature entries but kept as a safety net.

**Recommendation:** Resolver-level defaults beat per-entry data fixes — every
current and future untagged entry gets the right CTA. When touching hero link
behavior, remember there are TWO resolvers; grep for `featureToHero`.

---

## 2026-07-06 - Blind Screenshot Re-capture Silently Ships Sign-in Screens and Dev Empty States

**Context:** The dark-mode screenshot backfill re-captured every entry's light
screenshot too (the theme pair shoots both from one page load). Six entries
came back WORSE than what they replaced: auth-gated pages (submit-lineup,
tip-schefter-gets-louder, mock-draft) captured the sign-in redirect; analytics
pages (owner-activity, afl-owner-activity) captured the dev-server empty state
("Chart data will appear…"); afl-trophy-wall lost a hand-staged scroll to a
franchise trophy wall. None of these failed — the script saved a perfectly
valid webp of the wrong thing.

**Insight:** Capture "success" is not content correctness. Two cheap review
techniques caught all six before commit: (1) **duplicate hashes** — every
auth-gated page renders the identical sign-in screen, so `md5 -q *.webp | sort |
uniq -d` style grouping instantly exposes login-redirect captures; (2) **size
shrink vs the committed blob** — `git cat-file -s HEAD:<file>` vs new size;
anything shrinking >35% is worth eyeballing (empty states and lost staging
compress much smaller). Both are proxies; the fix list came from actually
viewing the flagged files.

**Evidence:** `scripts/capture-whats-new-screenshots.mjs#MANUAL_CAPTURE_ONLY`
(the permanent skip-list with per-entry reasons), backfill commit on the
feature-first-heroes branch.

**Recommendation:** After any bulk re-capture, run the dupe-hash and
size-delta checks before committing. New entries whose pages are auth-gated,
prod-data-dependent, staged (scrolled/clicked), or both-league-with-no-link
(auto-capture shoots the MFL landing page) belong on `MANUAL_CAPTURE_ONLY`
at authoring time, not after the first bad capture.

---

## 2026-08-26 - `set:html` Bodies Have No Link Resolver, So Nobody Ever Wrote a Link

**Context:** An owner noticed the Strength of Division launch article named the
standings, the franchise pages and the division page itself over six paragraphs
without one of them being clickable. `grep '<a ' src/data/whats-new.json`
returned ZERO across all 40 live entries — What's New had never linked to
anything in its history. Identical to the Schefter finding three days earlier
(`scripts/article-utils/article-links.mjs`), and the two are not a coincidence:
both feeds render prose through `set:html`.

**Insight:** The reason nobody wrote a link is that there was no *correct* way
to write one, and the failure mode of guessing was invisible at authoring time.
`description` blocks render via `set:html`, so whatever string sits in the JSON
IS the href — it never passes through `resolveLeaguePath()` / `resolveDirectoryHref()`
the way a normal `<a>` in a component does. That leaves two hrefs to choose
between and both are wrong:

- `/theleague/standings` — correct for TheLeague, sends every AFL reader of the
  same both-league entry onto the other league's site. One entry body is
  rendered once per league it is tagged for; there is no per-league copy.
- `/standings` — league-neutral and correct-looking, but 404s on the shared
  host, which has no root route.

The resolution has to happen at RENDER, not authoring: store league-neutral,
rewrite per reader. `rewriteDescriptionLinks` (`src/utils/whats-new-links.ts`)
runs each block through the same `r()` the CTA button already used, so
`/standings` becomes `/theleague/standings` or `/afl-fantasy/standings` and gets
stripped back to `/standings` on an apex host.

Three things that are load-bearing, not polish:

1. **Not every root-relative path is a page.** `public/` is mounted at the root
   and is not league-scoped — the vintage-art entry links a master banner at
   `/assets/theleague/history/psd/…jpg`, and prefixing it to
   `/theleague/assets/…` 404s a file that exists. `isLeagueScopedPath()` excludes
   `/assets/`, `/embed/`, `/api/` and anything with a file extension on its last
   segment. This was caught by the guard test on the FIRST run, not by review.
2. **Route existence has to be checked per tagged league, not once.**
   `/contracts` and `/salary` are TheLeague-only; `/keepers` and `/records` are
   AFL-only; Best Ball has almost no routes at all. A both-league article may
   NAME those pages but must not link them. Reused `tests/helpers/astro-routes.ts`
   (built for the Schefter guard) rather than validating against
   `page-directory.json` — the directory is a search index a page can legitimately
   be missing from, a route either exists or 404s, and a link is about the second.
3. **The "must have a link" rule needs an enforcement DATE, the correctness rules
   do not.** Dead-link and wrong-league checks run over the full 146-entry history
   including archives, because an archived article still renders at its permalink.
   Requiring links only from 2026-08-09 avoids back-writing prose into 106
   archived columns while still covering everything currently in the active file.

**Evidence:** `src/utils/whats-new-links.ts`,
`tests/whats-new-links.test.ts`, `WhatsNewDetailPage.astro` line ~153.
Backfill: 71 inline links across 25 qualifying entries.

**Recommendation:** Any feed that renders authored prose through `set:html` needs
this pair before its first article ships — a render-time href rewriter and a
guard test that the category which exists to send readers somewhere actually
does. An editorial rule with no test is a rule that has already been broken; both
times here the rule was written down and the count was still zero.
