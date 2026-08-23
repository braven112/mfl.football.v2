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

## 2026-08-18 - An overlay that maps a FIELD WHITELIST silently misses new consumers

**Context:** Owner report — Week 4 on Set Lineup showed legacy names and legacy
colors over the MODERN franchise logo. Reproduced by loading
`/theleague/lineup?week=4`: the chip read "BOYZ II MEN" while the watermark
was still `/assets/theleague/group-me/vitside-mafia.png`.

**Insight:** `getThrowbackFranchiseBrand` overlays a hand-listed set of fields
(`name`, `icon`, `banner`, era colors) onto the current brand. The lineup
faceoff watermark reads `groupMe` — a field NOT in that list — so it kept the
current value while everything around it threw back. The `icon` the overlay
does swap reaches nothing on that page. Nobody noticed for a month because the
surface was added after the overlay: **a whitelist overlay fails silently and
plausibly for any consumer that reads a field it doesn't map**, and the failure
looks like "this one asset didn't get updated" rather than like a bug in the
overlay. The worst-case victim is a franchise whose throwback keeps its NAME
(Pacific Pigskins → Pacific Pigskins, 2013 art) — there the crest is the ONLY
tell, so that panel showed no throwback at all.

**Recommendation:** when adding a throwback-aware surface, check which brand
FIELD it renders, not just that it calls the chokepoint. Prefer spreading and
then overriding (as this does) over listing fields — and when you must list,
add the new field the moment a consumer reads it.

**Resolution:** `groupMe: identity.groupMe ?? identity.icon ?? brand.groupMe`.
The fallback order matters — exactly ONE history entry in the config carries
its own `groupMe` (Heavy Chevy 2020), while all 42 carry an `icon`, and those
are square (100×100), which is the shape `.foc__watermark`'s
`aspect-ratio: 1; object-fit: contain` box wants. `groupMeDark` is cleared for
the same reason the `*Dark` colors are (see the era-colors note above): it
belongs to the CURRENT brand and no era has a dark variant.

**Evidence:** `tests/throwback-identity.test.ts` — asserts the swap against the
real config (verified to FAIL with the fix removed, so it isn't vacuous) plus a
sweep proving every franchise's resolved throwback crest is a committed file. A
404 watermark would be a worse bug than the one being fixed, and era art paths
are hand-maintained.

## 2026-08-22 - `THROWBACK_WEEKS` Moved to the Registry, Which Broke a Regex Scraper

**Context:** The Schedule Release lock script reserves a marquee slot for the
Throwback Week game. It is plain node and cannot import
`throwback-config.ts`, so the week list had to be reachable without a
TypeScript loader.

**Insight:** The list is a per-league constant, so it moved to the league
registry (`throwbackWeeks` in `src/config/leagues-data.mjs`), read through
`src/data/theleague/throwback-weeks.mjs`; `throwback-config.ts` now re-exports
both `THROWBACK_WEEKS` and `isThrowbackWeek` from there and keeps only the era
defaults and asset conflicts. What that broke was invisible:
`scripts/compute-league-events.mjs` was *scraping* the number out of the TS
source with `parseThrowbackWeeks(...)` — a regex for
`export const THROWBACK_WEEKS: number[] = [4]` — because it, too, could not
import the file. Once the declaration became a re-export the regex matched
nothing, and the scrape **fails soft** onto `DEFAULT_THROWBACK_WEEKS`, a
hand-mirrored `[4]`. Nothing would have thrown; the Throwback Week calendar
event would simply have stopped tracking the config, and stayed correct only as
long as nobody changed the week.

**Evidence:** Caught by `tests/throwback-week-reminder.test.ts` ("parses the
real throwback-config.ts (guards against drift)") — the one test that read the
actual file rather than a synthetic string. `compute-league-events.mjs` now
imports the list, and the test asserts it does not go back to scraping.

**Recommendation:** Before moving a constant out of a file, grep for readers
that parse the file as TEXT, not just ones that import it. A scraper with a
default is worse than one without: it survives the change and lies. Where a
node script needs a TypeScript constant, the fix is to move the constant
somewhere node can import — the parse only ever existed as a workaround.

## 2026-08-23 - A THIRD consumer, and the whitelist-overlay trap's other half

**Context:** The player modal band (see
`docs/claude/insights/features/player-composites.md`, 2026-08-23) became the
fourth throwback-aware surface. It is painted client-side, so it cannot call a
chokepoint at render time.

**Insight:** The chokepoint rule still holds — you just move it. The band's
brand map (`src/utils/franchise-band-brand.ts`) calls
`getThrowbackFranchiseBrand` on the SERVER, once per page, and ships the
resolved result as a JSON island. The client never learns what week it is.
That is the pattern for any future client-rendered throwback surface: serialize
the chokepoint's OUTPUT, don't re-derive the era.

**The trap has a second half nobody had hit yet.** The 2026-08-18 note above
covers a consumer reading a field the overlay does not map. The opposite also
bites: `resolveThrowbackIdentity` falls back to the CURRENT identity when a
franchise has **no eligible era**, and `getThrowbackFranchiseBrand` returns
that as a perfectly ordinary `icon` — indistinguishable, at the call site, from
a real era crest. A consumer that treats `icon` as "the throwback crest" then
silently takes the franchise's current LIGHT art. For the band that was wrong
twice over: the light src re-arms the global `html.dark` crest swap (so the
crest would change with the theme on a surface that doesn't), and the era
branch clears the measured stroke that light art still needs.

Every franchise has an eligible era today, so a sweep over the real config
passes either way — the guard is only non-vacuous against a synthetic case,
which is why `resolveEraCrest` is split out and exported. **One
`THROWBACK_ASSET_CONFLICTS` entry is all it takes to arm this**, on the one week
a year anyone would see it.

**Recommendation:** treat `getThrowbackFranchiseBrand`'s return as "the brand to
render", never as "the era". If you need to know whether a franchise actually
threw back, compare against its current value (`era.icon !== team.icon`) or
reach for `resolveThrowbackIdentity`'s `isHistorical` — the brand helper
deliberately does not expose it.

**Evidence:** `tests/franchise-band-brand.test.ts` — the `resolveEraCrest` unit
(verified to FAIL when the guard is removed) plus a real-config sweep asserting
no franchise renders its own light crest during a throwback week.

