# Root Splash Page (index.astro) Insights

Learnings from the 2026-07 root landing-page redesign (league split hero + cross-league What's New).

## 2026-07-04 - Cross-league What's New must compose the choke point, not re-read the JSON

**Context:** The splash page shows the latest 6 entries merged from both leagues.

**Insight:** `getWhatsNewEntriesForLeague()` (src/utils/whats-new-entries.ts) is the deliberate single choke point for league scoping — a cross-league feed should call it per league and merge, never import whats-new.json directly. Both-league entries appear in BOTH league slices, so the merge must dedupe by `entry.id`. Admin-only entries also need filtering (`visibility === 'admin'`) since the listing pages gate them upstream.

**Evidence:** `src/utils/whats-new-cross-league.ts` — `mergeAndRankEntries()` (pure, fixture-testable) wrapped by `getLatestWhatsNewAcrossLeagues()`. Tests: `tests/whats-new-cross-league.test.ts`.

**Recommendation:** Any future cross-league surface (combined feeds, notifications) should reuse `mergeAndRankEntries` or follow the same compose-and-dedupe pattern. Card detail links: single-league → that league's `/whats-new/{id}`; both-league → default to theleague's copy.

## 2026-07-04 - League logos: dark variants exist and read better than CSS invert on dark panels

**Context:** Hero panels use dark league-color gradients; the initial build white-knocked-out the light logos with `filter: brightness(0) invert(1)`.

**Insight:** Dedicated on-dark logo variants exist (`public/assets/logos/theleague-logo-dark.svg`, `afl-logo-dark.svg`, originally from the dark-mode branch claude/stoic-gauss-85d450). They keep brand accents (emerald banner, red AFL star) that a blanket invert destroys. The invert filter is still the right tool for low-opacity watermarks where a flat white silhouette is desired.

**Evidence:** `src/pages/index.astro` — `.lockup-logo` uses `logoDark` with no filter; `.watermark` uses the light SVG + invert at 0.14 opacity.

**Recommendation:** For any logo placed on a dark surface, prefer the `-dark.svg` variant over CSS filters. The dark-mode branch's swap mechanism (dual `<img>` + `.theme-img--light/--dark` classes in `src/styles/theme-image.css`) is only needed when the SAME slot must flip between themes — a permanently-dark surface can just use the dark asset directly.

## 2026-07-04 - Equal-height cards in a grid of <li> wrappers need flex on the li, not height:100%

**Context:** What's New cards rendered with ragged bottoms that read as "overlapping" on desktop.

**Insight:** With `ul.grid > li > a.card`, `height: 100%` on the card does NOT reliably stretch — the `<li>` grid item stretches to the row, but the percentage height on the anchor doesn't resolve against it. `li { display: flex }` + `card { flex: 1 }` stretches correctly. Also, `repeat(auto-fill, minmax(280px, 1fr))` at a 1232px container yields 4 cramped columns; explicit `repeat(3, 1fr)` with 2/1-column breakpoints reads far better for editorial cards.

**Evidence:** `src/pages/index.astro` `.wn-grid li { display:flex }`, `.wn-card { flex:1 }`; verified all cards in a row have pixel-identical heights via getBoundingClientRect.

**Recommendation:** Default to explicit column counts for content cards; reserve auto-fill for uniform tiles. Stretch via flex on the wrapper, not percentage heights.

## 2026-07-04 - Layout.astro `splash` prop hides site chrome

**Context:** The root page should be a standalone splash with no header/footer.

**Insight:** `src/layouts/Layout.astro` (the generic non-league layout, used only by index + templates + css-customization) now takes an optional `splash` boolean that suppresses `<Header/>` and `<Footer/>`. Other pages are unaffected.

**Recommendation:** Reuse `splash` for any future chrome-less page on the generic layout instead of forking the layout.
