# Throwback Week Insights

Feature: every NFL Week 4 (`THROWBACK_WEEKS` in `src/data/theleague/throwback-config.ts`),
the weekly surfaces (live scoring, matchups, submit lineup) swap every team to a
legacy identity — name, icon, banner, AND colors. Built July 2026 on PR #428.

## 2026-07-13 - Architecture: two chokepoints, one resolver

**Context:** Throwback identity had to reach three surfaces (live scoring, matchups, lineup) plus previews, without touching each renderer.

**Insight:** Everything flows through exactly two overlay points, both calling `resolveThrowbackIdentity` (owner override → commissioner default → earliest eligible → current):
1. `applyThrowbackOverrides` (`src/utils/live-scoring-data.ts`) — mutates the `configTeams` array BEFORE `buildTeamsMap()`, so scoreboard, matchup pairings, hero, and the demo/sample path all pick it up for free.
2. `getThrowbackFranchiseBrand` (`src/utils/franchise-brand.ts`) — the lineup page's brand.

Eligibility (`getEligibleThrowbackEras`) = `history[]` minus `THROWBACK_ASSET_CONFLICTS` minus entries identical to current (name+icon+banner). Colors do NOT affect the identity check. Stored picks of ineligible eras self-heal: the resolver ignores unknown `yearStart`s and falls to the default chain — commissioner exclusions never require KV cleanup.

**Recommendation:** Add new throwback-aware surfaces by consuming one of the two chokepoints; never resolve eras inline in a page.

## 2026-07-13 - Era colors: clear the *Dark variants when overlaying

**Context:** Eras carry `colorPrimary`/`colorSecondary` (optional, on `FranchiseHistoryEntry`), sampled from the era's own art.

**Insight:** When overlaying an era palette onto a `ConfigTeam`, `colorPrimaryDark`/`colorSecondaryDark` MUST be cleared (`undefined`) — they belong to the CURRENT brand, and leaving them makes dark mode render current colors over a legacy identity. Downstream already falls back to the light colors when the Dark variants are absent, so clearing is safe. Same principle in `getThrowbackFranchiseBrand`: clear `colorTertiary`/`colorQuaternary`.

**Evidence:** `applyThrowbackOverrides` and `getThrowbackFranchiseBrand`, locked by `tests/throwback-identity.test.ts` ("era colors ride the throwback overlay").

## 2026-07-13 - Preview params: previewEra (owner) and previewFranchise (admin)

**Insight:** `/theleague/live-scoring?week=4&demo=1` is the evergreen staged throwback scoreboard (week param forces the throwback gate; demo forces the sample replay). `&previewEra={yearStart}` applies an era to the signed-in viewer's own franchise only, validated against their eligible eras server-side, never persisted; `&previewFranchise={id}` (commissioner-only, `isCommissionerOrAdmin`) redirects the preview to any franchise — view-only, the save bar drops its button because the preference API is deliberately owner-scoped with no commissioner override.

## 2026-07-13 - Historical art archaeology: option07.json is the treasure map

**Context:** Most legacy art URLs (`theleague.us/images/team_banners/…`, `dynastytheleague.com/…`) are dead; recovery went through the Wayback Machine.

**Insight:** `data/theleague/mfl-feeds/{year}/option07.json` is NOT JSON — it's saved HTML of MFL's per-year icon/banner setup page, listing the exact art file URL for every team that year. Grep it to learn what filenames existed and when they changed (e.g. `executioners.png` vs `executioners1.png` = a mid-era redesign; DMOC's icon was `dark_magicians_of_chaos_ico.png` — `_ico`, not `_icon`). Cross-check `league.json` per year for name-change years. MFL's own `fflnetdynamic{year}/13522_franchise_icon{id}` pattern has NO files for this league — art was always custom-URL, so MFL hosted no copies. Some "lost" TheLeague art survives in `public/assets/afl/history/` (shared owners uploaded variants to the AFL league) — but beware league-specific variants (the AFL Da Dangsters banner carries an "NL" conference mark; the TheLeague version differs).

Old MFL "icons" are 300×50 strips (mini-banners) at exactly the 6:1 ratio of the site's 950×158 banners — some recovered `*_icon.png` files ARE the missing banners, just small (LBer-DeCleaters, Devil Dogs).

## 2026-07-13 - Era palette derivation is automatable but needs commissioner review

**Insight:** Palettes were derived by sampling era art (hue-bucketed, saturation-filtered, icon pixels double-weighted, dark-neutral fallback for monochrome art) — good enough for ~90% of eras, but character-heavy art skews toward flesh/wood tones (Executioners sampled brick-brown off a red banner). Ship auto-derived values, then present swatches next to the art for human correction; corrections landed as one-line hex edits.

## 2026-07-13 - Editing theleague.config.json programmatically

**Insight:** Never `JSON.parse` → mutate → `JSON.stringify(…, null, 2)` this file — it reformats single-line arrays (`loaderQuips`) onto multiple lines and produces a 90-line diff for a 2-line change. Insert/edit lines surgically (the era color insertion used a line-walker keyed on 8/10-space indentation). `git checkout` the file and redo surgically if a rewrite sneaks in.

## 2026-07-13 - What's New extended-rotation campaigns (heroRotationDays)

**Insight:** `WhatsNewEntry.heroRotationDays` (e.g. 14) does three things at once in `hero-resolver.ts`: extends the 7-day fresh window, makes the entry beat routine fresh entries for the daily pick, and keeps it in a 50/50 coin flip against the urgent Cut Watch tier that locks out ordinary features. Per-visitor targeting is NOT in the resolver — the homepage filters the entry out of the `entries` array it passes in (signed-out visitors and picked owners never see the promo). The KV read for targeting is gated on `isEntryInHeroWindow`, so the cost disappears when the campaign expires.
