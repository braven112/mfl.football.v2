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


---

## Three era crests are free-standing marks, not banner cuts (September 2026)

`trevors_team_2003_icon.png` (Texas Tech's Double T) and
`limp_ditkas_2006_icon.png` (the Bears' dark-mode mark) are **not** cut from
their banners. They are ESPN's own team logos, mirrored from
`a.espncdn.com/i/teamlogos/ncaa/500/2641.png` and
`.../nfl/500-dark/CHI.png` — the same source `scripts/fetch-nfl-dark-logos.mjs`
already mirrors from, and in both cases the identical mark the era's banner
carries, only transparent and at full resolution instead of punched out of a
950x158 strip.

Two things about them are deliberate and easy to undo by accident:

- **They are trimmed, then fitted to 96 of the 100 px box.** An ESPN mark
  arrives 500x500 with a wide transparent margin, so a plain resize renders it
  visibly smaller than the full-bleed banner cuts beside it. Trim the margin
  first; the 4px of remaining padding is breathing room, not slack.
- **Neither carries an `iconStroke`.** The rim exists to give a banner CUT an
  edge it does not have. These marks bring their own outline — the Bears' is
  literally a white keyline — and a ring around a transparent PNG is a circle
  floating in empty space with the art loose inside it. Limp Ditkas had one
  and lost it in the same change.
- **Both carry `iconFreeform`, which un-clips the crest slot.** Every crest
  slot on the site is `border-radius: 50%` + `object-fit: cover`, correct for
  the 100+ crests that ARE a circle of banner and wrong for a mark on
  transparency: the Bears' ears sit at a radius of ~54 in a box whose circle
  stops at 50, so the round slot bit them off. `buildEraCrestShapeCss`
  (`era-crest-stroke-css.ts`) emits `border-radius: 0; object-fit: contain`
  keyed on the src, riding the same composition as the rims.

  The `!important` on those two declarations is load-bearing. Astro compiles a
  component's scoped `.tbw-card__icon` to `.tbw-card__icon[data-astro-cid-…]`
  — specificity (0,2,0) — which outranks a global sheet's `img[src="…"]` at
  (0,1,1), so no selector reachable from `TeamIconDarkStyles` wins on
  specificity alone. Verified in the browser, not assumed: the flagged crest
  computes to `border-radius: 0px / object-fit: contain` while the two beside
  it stay `50% / cover`.

  The other way out — shrinking the mark until its bounding box fits the
  inscribed circle (70.7% of the box) — is worse, because it renders visibly
  smaller than the banner cuts beside it, which is the sizing problem this art
  was brought in to fix.

The AFL's ATF badge (`atf_2003_icon.png`, worn by both the 2003 and 2004
eras) is the third, and it is `iconFreeform` for a starker reason: at 1.92:1
a round slot would leave it as three letters with the badge sliced off both
ends. It is cropped to the GOLD rounded-rect by scanning for the badge's own
gold rather than by `sharp.trim()` — the navy outside the badge and the navy
inside it are the same colour, so a colour trim stops at the wrong edge.

Smokane's elephant (`smokane_2003_icon.png`, the 2003-2005 era) is the fourth
and the one that needed the third treatment. It arrived already transparent —
what read as a black background in the preview was empty alpha over a dark
backdrop, so it is trimmed on ALPHA, not on colour; trimming on colour would
have kept the whole canvas.

### The three era-crest treatments do not overlap

| Field | What it draws | When | Why |
|---|---|---|---|
| `iconStroke` | a ring on the element BOX, in the era's colour | both themes | a circle punched out of a banner has no edge of its own |
| `iconFreeform` | nothing — removes the round slot | both themes | the mark's shape is not a circle |
| `iconStrokeDark` | the ART's silhouette, in white | dark only | the mark is fine on the light card and sinks into the dark one |

Smokane's elephant needs the last two and must not have the first: it is a
shaped mark (so no round slot) that is mid-green on a near-black card (so an
outline), and a box ring around it would be a rectangle enclosing loose art.
`buildEraCrestDarkStrokeCss` delegates to `crest-dark-stroke-css.ts` rather
than restating the four-stacked-`drop-shadow` trick — that is also why it is
a `filter` and not the `box-shadow` `iconStroke` uses: only `drop-shadow`
follows an image's alpha, and on a transparent PNG a box ring is a white
square around the logo.

`tests/era-crest-stroke.test.ts` pins each treatment's opt-in as exact, that
`iconStrokeDark` is gated on `html.dark` while `iconStroke` deliberately is
not, and that no crest carries both.

Both read correctly on the light card and the dark one, which is why the
Bears' *dark* variant was the right pick rather than the standard mark: its
white keyline disappears on the light card and the orange bear carries it,
while on the dark card the keyline is what separates the mark from the ground.

The palettes are untouched — `scripts/derive-era-palettes.mjs` samples the
BANNER, never the crest, so swapping crest art cannot move an era's colors.

---

## Reworking era art: what an era edit touches (September 2026)

A pass over the AFL's 117 eras — recutting crests, splitting two eras, moving
three off the wrong asset — turned up four traps that have nothing to do with
the art itself.

### Editing `afl.config.json` eras leaves the derived chain stale

`data/<league>/derived/franchise-history.json` carries a COPY of every era's
`icon` and `banner` path, and `season-ledger.json`, `owner-tenures.json` and
`division-strength.json` copy it again. The AFL franchise and owner pages
(`src/pages/afl-fantasy/franchises/[id].astro`, `owners/[slug].astro`) read
those files directly, NOT the config.

Nothing regenerates them on build — `scripts/prebuild.mjs` does not run the
compute scripts, and the only automated caller is
`.github/workflows/fetch-owner-names.yml`. So a config-only era edit ships a
site where the throwback pages show the new art and the franchise pages show
the old, with the old year spans beside it. After changing eras, run in this
order (the later two read the first's output):

```bash
node scripts/compute-franchise-history.mjs --league=afl
node scripts/compute-owner-tenures.mjs
node scripts/compute-division-strength.mjs
```

Grep the derived tree for a renamed asset to confirm it propagated; a count of
0 means the chain did not rerun.

### An era's crest can be a LIVE franchise's icon

Four AFL eras pointed their crest at `/assets/afl/icons/*.png` — `chat.png`,
`computer_jocks.png`, `micks.png` — files that are ALSO the current icon of
franchises 0021, 0005 and 0013. Rewriting one in place to fix an era's framing
silently changes that club's present-day mark everywhere it renders.

Before editing any era asset, check whether a `teams[].icon` claims the same
path. If it does, write a new file under `history/` and repoint the era.
Patch the era line by INDENT — `"icon": "/assets/afl/icons/chat.png",` appears
twice, at indent 6 for the team and indent 10 for the era.

### The banner's top edge is three layers, not one

Filling a crest's transparent band by walking down each column to the first
opaque pixel produces a black line, because these 300x50 MFL banners stack
transparent rows, then a SEMI-transparent black rule (alpha ~147, which an
`alpha >= 200` test skips rather than replaces), then a dark bevel, and only
then the field. Shifty Joe landed on the bevel at `103,31,31` instead of the
field at `190,39,39`. Take the fill from the first true field row, found by
inspection, not from "first opaque".

The same walk is wrong at the left and right of a rounded plate: there the
topmost opaque pixel of a column IS the plate's dark border, so the extend
paints black down both sides. The A-Team's fix was to abandon the plate —
key the wordmark by luminance, unmix it against the field it sat on, and lay
it on a flat square of the era's own colour.

### Measure the mark in the crest, not in the banner

Sampling a mark's bounding box in the source banner catches its glow, outline
and drop shadow asymmetrically. The Nukes' radiation symbol measured as
centred in the banner and sat 9px right of centre in the rendered 100px crest.
Measure in the crest against 49.5 and convert back: `Δbanner = Δcrest × S/100`.

### Recovering an unknown crop window

Most crests were generated by a script whose parameters are gone. To find them,
template-match the crest against its banner with a summed-area table so each
sample is the MEAN over its footprint — point sampling fails because a crest is
a heavy downscale, and it reported rms 20-40 for correct matches. Sample only
inside the inscribed circle so a baked circular alpha does not skew the fit.
Box-filtered, a genuine match lands under ~15 and a wrong one over ~30, which
is a clean enough split to drive a bulk fix (it found 60 crests carrying the
banner's own border).

An rms that stays high at every offset means the crest is not a crop of the
configured banner at all. That is how two mismatches surfaced: The Street
2005-2007 had been cut from the OTHER Street era's banner, and Minnesota Road
Kill from a source not in the repo.

### A mark wedged between letters needs a flood fill, not a crop

The Blitzkrieg bolt sits between the "L" and the "T"; the Zephyr hurricane
between the "R" and the tagline. No rectangle holds one without a neighbour.
Seed a flood fill inside the mark and let the field colour bound it — a 3px
gap of field is enough — then composite the result onto a canvas rebuilt from
the banner's own per-row field colour.

Per-row sampling is right for a gradient (Blitzkrieg's blue) and wrong for a
flat ground (Zephyr's dark), where rows crossing the wordmark drag the median
and band the result; use a plain gradient there.

### A transparent cutout is not automatically the better answer

Isolating a mark onto transparency reads beautifully on the dark card and can
be unusable on the light one. Zephyr's hurricane is roughly half WHITE rings:
cut out, it renders on a light page as three disconnected purple blobs. Keep a
field behind any mark whose silhouette is substantially white, and reserve the
cutout for marks that carry their own dark outline.

### The per-year `logo` URL is the art archaeology index

`data/<league>/mfl-feeds/<year>/league.json` holds each franchise's `logo` and
`icon` URL for that season, so a club's whole art history is a loop over the
years. Two things the URLs tell you at a glance:

- `images/team_banners/…` and `team_banners/<year>_team_banners/…` are real
  strip banners; `images/franchise_history_banner/…` and `images/team_pages/…`
  are full team PAGES — tall composites carrying a small strip banner, a player
  card and a stats box. A page is not a banner, but the strip inside it usually
  is, and so is the club logo nobody ever used elsewhere (Drunk Indians' chief
  drawing a bow sat in one for sixteen seasons).
- A URL that never changes across a name's whole run means there IS no earlier
  art. Titsburgh Feelers served one file 2013-2024, byte-identical to the one
  in the repo, so there is nothing to make a second era from.

Fetch through `https://mfl.football/afl-fantasy.com/<path>` with a browser
User-Agent; the rehost answers 406 to curl's default. Team pages carry white
overlay text across the art — inpaint it from the median of its clean
neighbours rather than cropping around it, which costs more of the mark than
the text does.

### The conference badge still poisons hand-set palettes

`scripts/derive-era-palettes.mjs` masks the AL/NL badge, but eras whose colours
were set before that lived on. Dan Marino's Tan Isotoners carried
`colorSecondary: #466286` — a blue sampled off the NL badge in the corner of a
banner that is brown and tan and nothing else. When a palette contains a colour
you cannot point to in the art, check the badge first.

---

## An era wearing a LIVE franchise's crest is invisible to every guard (September 2026)

Four eras were rendering a mark their era never wore, and each had been sitting
there since the art was first configured: AFL `0016` 2017-18 (Dicks out for
Harambe) and TheLeague `0006` 2019-24 (The Music City Mafia) both pointed their
era `icon` at a *currently live* franchise icon, while the AFL's Mariachi Ninjas
2012-18 and Midwestside Connection 2010-24 were cropped inside their own badge
rings.

### `isSameAsCurrent` cannot catch it, and it is the only automatic check there is

`getEligibleThrowbackEras` filters an era out when it is identical to the
current identity — but `isSameAsCurrent` is
`entry.name === team.name && entry.icon === team.icon && entry.banner === team.banner`,
compared against **the era's own franchise**. Both escape routes were open:

- **Different franchise.** AFL `0016` is *Swiftie 4 Life* today. Its Harambe era
  pointed at `/assets/afl/icons/harambe.png` — franchise `0008`'s live icon.
  Nothing compares an era to *another* club's current art, so this class of
  mistake is 100% invisible to the resolver. `AFL_THROWBACK_ASSET_CONFLICTS` is
  hand-maintained precisely because there is no computed check behind it.
- **One word of difference.** TheLeague `0006` *is* Music City Mafia, and the era
  pointed at its own live icon — but the era is named "**The** Music City Mafia",
  so the `&&` short-circuits and the era stayed eligible while wearing the crest
  the club adopted in 2025.

The lesson generalises past throwback: **the eligibility filter is an
all-three-fields equality, so any one field differing makes the other two
unchecked.** Do not read "not filtered as same-as-current" as "the art was
verified".

**Auditing for it is one script**, and worth running after any era edit. Flag
every `history[].icon` that is also some `teams[].icon` — but exclude the benign
case first, or the report is mostly noise: a club whose art never changed points
its own era at its own live icon quite correctly, and `isSameAsCurrent` filters
that era out anyway.

```bash
node -e "const c=require('./src/data/theleague.config.json');   // or afl.config.json
const live=new Map(c.teams.map(t=>[t.icon,t]));
for(const t of c.teams) for(const h of t.history||[]) { const o=live.get(h.icon); if(!o) continue;
  const benign = o.franchiseId===t.franchiseId && h.name===t.name && h.banner===t.banner;
  console.log(benign?'ok  ':'FLAG', t.franchiseId, h.yearStart, h.name, '->', h.icon,
    o.franchiseId===t.franchiseId?'(own live art)':'(f'+o.franchiseId+\" '\"+o.name+\"' live art)\"); }"
```

Run as of this pass the AFL is clean and TheLeague reports four, three of them
`ok`. The fourth is worth knowing about as a *shape*: franchise `0016`'s
2014-2024 era is named "Running **D**own **T**he Dream" against a club named
"Running down the Dream" — a pure case difference, so `entry.name === team.name`
is false, the era is not filtered, and it is selectable in the Throwback Week
picker while carrying the club's current name, icon and banner. Picking it
changes nothing on the scoreboard. Not wrong art, but a no-op era offered as a
choice, and the same `&&` short-circuit that let Music City wear the wrong crest.

Repointing an era does **not** move its eligibility: Harambe 2017 stays in
`AFL_THROWBACK_ASSET_CONFLICTS` (that entry is about the *identity* being live on
`0008`, not about the file), and Music City's default stays 2007 because
`pickDefaultThrowbackEra` picks on run length — 12 seasons vs 6 — not on art.

### A source that is ALREADY a circular badge is a fourth crest case

The three treatments above (`iconStroke`, `iconFreeform`, `iconStrokeDark`) all
answer "this art is not a circle". A source that arrives *as* a finished round
badge needs none of them, and adding one is actively wrong — `iconStroke` draws a
second ring outside the badge's own.

What it does need is the crop going the other way. These badges arrived 200x200
with the ring centred on (100,100) at r≈96.5; the crop is **190 square from
(5,5)**, deliberately *inside* the ring, so the ring bleeds past the round slot's
edge. Crop *outside* it — leaving even 2px of the source's ground — and the slot
renders a white or black halo arc, invisible on the matching card and obvious on
the other one. Then a circular alpha at r=50 on the 100px result, so the corners
are transparent anywhere the slot is not round.

Check the result on a light **and** a near-black ground before committing. Both
badges that read as "black background" were fine; the one that would not have
been is a badge whose outer ring is dark on a dark card, where the ring inside it
is what carries the edge.

### `sync-afl-assets.mjs` dirties the tree with files you must NOT commit

Running it to register a new history asset also writes **72 franchise-ID aliases**
(`icons/0001.png`, `banners/…`, `group-me/…`). TheLeague commits its 16
equivalents; **the AFL commits none, on purpose.** The resolver built by `makeIconResolver`
(`src/utils/owner-tenures.mjs`) probes `/assets/<navSlug>/icons/<franchiseId>.png`
with an existence check and documents that the AFL is expected to miss and fall
through to the placeholder. Committing those aliases silently flips that fallback
for all 24 AFL franchises. Stage explicit paths, then delete them.

The registry is also **stale by default** — nothing in CI or prebuild runs the
sync, so a regeneration sweeps in whatever drifted since the last manual run.
The Sept 2026 pass left nine entries pointing at files it had deleted; the next
`sync:afl` fixes them and shows up as ~390 lines you did not write. Look at the
deletions before assuming the diff is noise.
