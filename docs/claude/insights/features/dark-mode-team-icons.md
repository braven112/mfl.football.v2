# Dark-Mode Team Icons

Insights for the per-team dark-mode icon variant system
(`src/utils/team-icon-dark-css.ts`, `src/components/TeamIconDarkStyles.astro`,
`iconDark` field in the league configs).

---

## 2026-07-03 - One generated stylesheet beats touching 20 call sites

**Context:** Teams needed a different icon in dark mode (launch set: nine
teams — Dangsters, Maverick, Dead Cap Walking, Ninjas, Music City, Fire Ready
Aim, Bring The Pain, Wabbits, Computer Jocks), falling back to the regular
icon when no dark variant exists.

**Architecture decision:** Team icons render as plain `<img>` tags in ~20 call
sites spanning three paradigms — Astro components (standings tables,
TeamIconNav, snapshots), React components (trade builder, playoff hero), and
client-side HTML string builders (projected-free-agents, PlayerDetailsModal).
There is NO shared team-icon component. Instead of retrofitting one into every
call site, the swap is a single generated stylesheet:

- `buildTeamIconDarkCss(teams, { franchiseIconDir })` emits, per team with
  `iconDark`, `html.dark img[src="<exact icon src>"] { content: url("<dark>") }`.
- `TeamIconDarkStyles.astro` (included once in `TheLeagueLayout` head) runs it
  over BOTH league configs — exact-src selectors can't collide across leagues,
  so no league branching.
- Teams without `iconDark` get no rule → byte-identical rendering in both
  themes. Old browsers without `content` on `<img>` (pre-2023 Firefox) keep
  the light icon — graceful.

**Why CSS, not a server-side src pick:** with `theme_pref=auto` the server
cannot know the resolved theme; keying on `html.dark` means the swap always
follows the class the pre-paint `ThemeScript` resolves. (The league logo in
`Header.astro` still does an SSR pick off the cookie — known-wrong for 'auto',
owned by the dark-mode branch.)

**Gotcha — franchise-id icon aliases:** `/assets/theleague/icons/0002.png`
etc. are byte-identical copies of the named icons, and some code builds icon
paths from the franchise id directly (`PlayerDetailsModal` builds
`/assets/theleague/icons/{fi}.png`; the standings page renders BOTH named and
numbered srcs on one page). The generator therefore emits a second alias rule
per team via `franchiseIconDir`. If you add a dark icon, you do NOT need a
dark copy of the numbered file — both rules point at the same dark asset.

**Asset conventions:** icons are 100×100 PNG in `public/assets/theleague/icons/`,
dark variant named `{name}_dark.png` next to the light one. GroupMe avatar
variants (400×400) live in `public/assets/theleague/group-me/{name}_dark.png`.

**Tests:** `tests/team-icon-dark-styles.test.ts` locks the generator contract
and validates every `iconDark` in either config points at a real file under
`public/` next to a real light icon.

---

## 2026-07-09 - AFL's absolute-URL icon fields break `iconDark` unless you go relative

**Context:** Adding `iconDark` for an AFL team (Vitside Mafia, several
others) whose `icon`/`banner` in `afl.config.json` are hardcoded absolute
URLs to production (`https://mflfootballv2.vercel.app/assets/afl/icons/...`)
— an existing quirk unrelated to dark mode, present on many AFL entries.

**Gotcha:** `buildTeamIconDarkCss` selects on the exact `icon` string
(`img[src="<icon>"]`), so the selector still matches correctly with an
absolute `icon`. But if you set `iconDark` to match that same absolute-URL
style, the generated `content: url(...)` also points at production — so on
any branch/preview/dev environment the swapped-in dark image 404s against
the *live* site (which doesn't have the new file yet), and the icon
silently keeps rendering the light version. It looks identical to "the
config entry didn't take."

**Fix:** always set `iconDark` (and `groupMeDark`) to a **relative** path
(`/assets/afl/icons/{name}_dark.png`), even when the corresponding `icon`
field is absolute. The selector match doesn't care that `icon` and `iconDark`
use different URL styles, and a relative dark path resolves against
whatever origin is actually loaded — dev, preview, or prod — so it works
immediately without waiting for a production deploy.

**Also added:** `groupMeDark` field (mirrors `groupMe`) on `TeamConfig`,
`FranchiseHistoryEntry` (`src/utils/team-names.ts`), and `FranchiseBrand`
(`src/utils/franchise-brand.ts`). No CSS-swap consumer exists yet — the
GroupMe crest watermark (`brand.groupMe` in `lineup.astro`,
`RecapCompositeHero.astro`, etc.) still always renders the light version
regardless of theme. Populating the field is prep work only.

---

## 2026-07-07 - Same swap extended to external ESPN NFL + college logos

**Context:** NFL team logos (Raiders, Steelers, Jets, etc.) and NCAA college
logos have dark outlines that vanish on dark backgrounds. ESPN publishes a
dark-optimized cut of every logo at the same CDN path with `500-dark` swapped
for `500` (`.../teamlogos/nfl/500-dark/{CODE}.png`,
`.../teamlogos/ncaa/500-dark/{id}.png`).

**Reused the exact team-icon pattern** — `html.dark img[src="<light>"] { content:
url("<dark>") }`, one generated stylesheet, zero call-site changes:
- `src/utils/nfl-logo-dark-css.ts` + `NflLogoDarkStyles.astro` — 32 teams × 2
  srcs (ESPN `500` PNG from `getNFLTeamLogo`, and the local
  `/assets/nfl-logos/{CODE}.svg` from `getNflLogoUrl`), both → ESPN `500-dark`.
- `src/utils/college-logo-dark-css.ts` + `CollegeLogoDarkStyles.astro` — reads
  the `logo`/`logoDark` pair already in `src/data/college-logos.json`, deduped
  by light src (name-spelling variants share one ESPN logo → ~236 distinct).

**Scope decision — global vs per-page:** NFL logos appear in heroes across the
whole site → `NflLogoDarkStyles` goes in `TheLeagueLayout` head like the team
icons (~8.6 KB). College logos appear on only 3 pages (players + both rosters)
and the rule set is ~35 KB → `CollegeLogoDarkStyles` is rendered in those
pages' bodies instead (a `<style>` applies document-wide wherever it sits, so
page-scoping costs no coverage). Rule of thumb: global only if the asset
renders sitewide; otherwise page-scope to avoid inlining a big block everywhere.

**Works for client-built markup too:** the players table injects college
`<img>` via template strings client-side; the attribute selector still matches,
because it's a global stylesheet, not tied to SSR output.

**Gotcha (not the swap — the dev server):** verifying this cost ~1hr because a
stale Astro cache made new components render empty and new routes 404. Clearing
`node_modules/.vite` is NOT enough — you must also clear `.astro/` and
`node_modules/.astro/` (`rm -rf` is permission-denied here; use
`find <dir> -mindepth 1 -delete`). The `preview_start`-managed server kept
serving a stale build regardless; a directly-launched `pnpm exec astro dev
--port <uniq>` + `curl` was the only reliable verification. See the
`dev-stale-css-gotchas` memory.

**Tests:** `tests/nfl-logo-dark-css.test.ts`, `tests/college-logo-dark-css.test.ts`.

**Branch prereq gotcha (2026-07-07 dark-mode branch):** the committed
`claude/stoic-gauss-85d450` Header imports `utils/theme-preference` and
`components/ThemeToggle.astro`, which were UNCOMMITTED in that worktree — the
branch alone didn't build. That branch carries copies of `theme-preference.ts`,
`ThemeToggle.astro`, and `ThemeScript.astro` (plus the `class:list` dark wiring
in `TheLeagueLayout`) so the theme system is coherent; expect these to
reconcile trivially when the dark-mode branch lands.

---

## 2026-08-08 - `content: url()` has no error fallback — self-host the dark cut

**Context:** the AFL players page rendered a column of broken-image icons in
dark mode on a flaky mobile connection. The rows' `<img src="/assets/nfl-logos/
{CODE}.svg">` are tiny same-origin files, but the dark swap replaced every one
of them with `content: url(https://a.espncdn.com/.../500-dark/{CODE}.png)` —
and when a `content` image fails to load, the browser shows the broken-image
icon; it does NOT fall back to the light logo still sitting in the src
attribute, and no `error` event fires on the img (so JS onerror fallbacks —
which is why the ESPN headshots on the same page degraded gracefully while the
logos didn't — can't catch it either). Net effect: the swap silently turned a
reliable local asset into a hard cross-origin dependency per logo.

**Fix:** `scripts/fetch-nfl-dark-logos.mjs` (prebuild, parallel lane) mirrors
ESPN's 32 `500-dark` PNGs into `public/assets/nfl-logos/dark/` (gitignored)
and writes `src/data/nfl-dark-logos-manifest.json` listing what's actually on
disk. `resolveNflDarkLogoUrl` in `nfl-logo-dark-css.ts` emits the local path
for manifest-listed teams and the old ESPN URL otherwise — so a failed
prebuild fetch degrades to the previous remote behavior, never to a stylesheet
pointing at local files the build doesn't have. The committed manifest default
is `{ "codes": [] }` (dev/test keep remote behavior without running the fetch).

**Extended to the college-logo swap in the same branch:** the shared mirror
logic lives in `scripts/lib/dark-logo-mirror.mjs`;
`scripts/fetch-college-dark-logos.mjs` mirrors the ~236 distinct NCAA
`500-dark` cuts from `college-logos.json` into
`public/assets/college-logos/dark/{espnId}.png` with its own manifest
(`src/data/college-dark-logos-manifest.json`, keyed by ESPN NCAA id) and
`resolveCollegeDarkLogoUrl` fallback. Note the college LIGHT srcs are also
remote ESPN URLs (there are no local college SVGs), so light mode remains
CDN-dependent — self-hosting only the dark cut removes the *second* failure
point the swap added, which is what turned loaded pages into broken icons.
Mirroring the light cut too (and rewriting `logo` srcs everywhere they're
embedded, including derived data like `free-agents.json`) is the bigger
follow-up if full offline-CDN resilience is ever wanted.

**Two upstream-404 gotchas from the first real deploys:** (1) three NCAA ids
(2347 Louisiana-Lafayette, 556 Malone, 2770 Manitoba) have NO `500-dark` cut
on ESPN at all — their swap rules had always pointed at a permanent 404
(broken icon in dark mode on every connection). They're skipped via the
curated `KNOWN_MISSING_NCAA_DARK_IDS` in `college-logo-dark-css.ts` (light
logo in dark mode instead). (2) ESPN's CDN also serves *transient* 404s — PIT
404'd on one Vercel build minutes after fetching fine on the previous one —
so "permanently missing" must NEVER be inferred from one build's 404s (an
earlier iteration did exactly that and would have randomly dropped a real
team's dark swap for a whole deploy). Curate permanent 404s by hand; let
transient ones fall back to the remote ESPN URL via the manifest mechanism.

---

## 2026-08-15 - The swap is free at a new call site — but AFL's coverage gap sets the ceiling

**Context:** The three compact homepage standings cards were changed to render
the team crest INSTEAD of the team name, via a new shared `TeamIconCell.astro`.

**The good half — nothing to wire up.** Because the swap is a global stylesheet
keyed on the exact `icon` src, a brand-new component that renders a plain
`<img src={team.icon}>` inherits dark mode with zero additional code. No
`ThemeImage`, no `darkSrc` prop, no server-side theme pick (which would be wrong
under `theme_pref=auto` anyway). Confirmed in-browser rather than assumed, by
reading `getComputedStyle(img).content` on every crest in the rendered cards
under `html.dark` — a worthwhile check, since a mismatched src fails silently by
just rendering the light icon.

**The catch — coverage is wildly asymmetric between the leagues.** TheLeague has
`iconDark` on 11 of 16 teams; the AFL has it on **1 of 24** (Vitside Mafia). For
surfaces where the crest sits beside the team NAME that's cosmetic — a dim logo
next to readable text. On a crest-ONLY surface the crest is the sole identifier,
so a dark-dominant AFL logo (Badd Boys, e.g.) on the navy card is the difference
between "slightly muted" and "which team is that." The swap system was working
exactly as designed; the assets just don't exist.

**Recommendation:** Before building any UI where a team crest REPLACES the team
name, check `iconDark` coverage for that league first —
`teams.filter(t => t.iconDark).length` against `teams.length`. If coverage is
thin, either populate the missing `iconDark` assets as part of the same change,
or keep the name alongside the crest for that league. Per the 2026-07-09 entry
above, set those new `iconDark` values as RELATIVE paths even though the AFL's
`icon` fields are absolute production URLs. Note also that no test enforces
coverage — `tests/team-icon-dark-styles.test.ts` validates that every declared
`iconDark` points at a real file, not that any given team declares one — so a
gap like this is invisible until you look at a dark-mode screenshot.

---

## 2026-08-15 - When there's no `iconDark` to swap to: measure, then stroke

**Context:** the crest-only standings cards (entry above) needed AFL crests to
survive a dark card, and 23 of 24 AFL teams have no `iconDark`. Hand-authoring
23 dark logos wasn't on the table; the crest still had to name the row.

**Measure first, don't eyeball.** `scripts/measure-crest-contrast.mjs`
(`pnpm measure:crest-contrast`, `--report` to print scores) decodes each crest
with `sharp` and scores it as the fraction of OPAQUE pixels clearing 3:1
against `--card-surface` (`#262626`). Under 0.5 — less than half the logo
legible — it goes in `src/data/crest-dark-stroke-manifest.json`. That caught 14
AFL and 4 TheLeague crests, from Badd Boys at 13% up to Running down the Dream
at 48%. The scores are a good sanity check on the whole system: the teams
TheLeague's humans chose to draw `iconDark` art for are almost exactly the ones
that score worst, which is the correlation you'd hope for.

**Stroke, don't plate.** `src/utils/crest-dark-stroke-css.ts` emits four
stacked cardinal `drop-shadow()`s, which is the only CSS that follows an
image's ALPHA silhouette. `outline`, `border`, and a background plate all draw
the crest's bounding BOX — on a transparent PNG that's a white square around
the logo, which is worse than the problem you started with. The shadows
compose (each applies to the previous result), so four is enough for a
continuous ~1px ring.

**A team must never get both.** The manifest excludes any team with an
`iconDark`, because a hand-drawn dark logo does not want a white ring around
it. `tests/crest-dark-stroke.test.ts` asserts that, re-measures the committed
assets to catch manifest drift, and checks each listed `icon` still matches its
config string exactly (the selector is an exact `src` match, so a drifted icon
path silently stops applying the stroke rather than erroring).

**Global, keyed on `src` alone — the initial scoping was wrong.** It first
shipped scoped to `img.team-icon-cell`, reasoning that a crest shown NEXT TO a
name doesn't need help because the name carries identity. Two problems, both
found by the commissioner on real pages: a near-black logo on a dark card is
still hard to make out even when labelled, and the same franchise then wore a
ring on the homepage and none on `/afl-fantasy/standings`, which reads as a
rendering bug rather than a treatment. Consistency beat the theory. Keying on
`src` like the dark swap is also what reaches all ~20 crest call sites —
Astro, React islands, and client-built HTML — with no markup changes.

**Recommendation:** re-run `pnpm measure:crest-contrast` after replacing any
crest asset or adding an `iconDark`; the test fails until the manifest is
regenerated. And prefer real `iconDark` art whenever someone is willing to draw
it — the stroke is a legibility floor, not a substitute for a logo designed for
dark mode.

**Per-team stroke color (`iconStrokeDark`, 2026-08-15).** White is the default
but not always right: Midwestside's crest is a gold ring on black, and a white
outline read as a foreign border bolted onto someone else's logo. `iconStrokeDark`
on the team config overrides the color (they use their own `#ffcd00`). Two
design points worth keeping:

- The override lives in the LEAGUE CONFIG, not the manifest. The manifest is
  generated output and must stay purely derived — putting a hand-picked color
  in it would be destroyed by the next `pnpm measure:crest-contrast` run.
  `TeamIconDarkStyles` joins the two by franchiseId at build time.
- An override color must itself clear 3:1 on the dark card, or the stroke
  can't separate the logo from the background — that's the whole job. The test
  enforces it.

**The config overrides the measurement in BOTH directions (2026-08-15).** An
earlier version of this note said the test rejects an `iconStrokeDark` on a team
that isn't in the stroke manifest, as dead config. That is only true of `false`
— a `false` on an unflagged crest has nothing to opt out of, so it reads as if
it were doing something when it isn't, and `tests/crest-dark-stroke.test.ts`
fails it. A **color** on an unflagged crest is the opposite: it opts that crest
IN, and `withStrokeColors` has a dedicated path for it.

That path exists because the score counts legible PIXELS, which is the wrong
question at the silhouette's edge. A crest that is bright through the middle and
dark around its rim clears the threshold comfortably while the outline it
actually presents to the card dissolves into it — Jewpacabra at 68% is the
motivating case. So "not in the manifest" is not a verdict that a crest needs no
ring; it's the absence of one.

**But the opt-in has a second, non-legibility use, and it's worth naming so the
first one doesn't get overstated.** Suh girls, one cup measures **85%** legible
— comfortably readable on a dark card, no rim problem, nothing to rescue. It
carries `#ff769f` anyway, because hot pink is the team's color and the ring
reads as a signature there rather than a fix (commissioner, 2026-08-15). Check
the actual score with `pnpm measure:crest-contrast --report` before writing a
legibility rationale into a changelog or a commit message: at 85% that story is
simply false, and this note said it about Suh girls for exactly one commit
before the number was looked up. Either reason is a legitimate opt-in; they just
aren't the same reason.

The 3:1 contrast check applies either way — it runs over every config color,
opt-in or override, legibility-motivated or not.

`buildCrestDarkStrokeCss` groups selectors by color, so the default-white
crests still collapse into one rule and only overrides get their own.

**Same-origin crest srcs — fix it in the config AND the sync script (2026-08-15).**
The AFL configs stored every `icon`/`banner` as an absolute
`https://mflfootballv2.vercel.app/...` URL, so every page fetched its crests
cross-origin: a second DNS+TLS connection for assets already committed under
`public/`. On cellular they were still in flight after the card painted, which
on the crest-only standings cards rendered as blank team columns. All 48 asset
URLs are now same-origin paths.

The trap: `scripts/sync-afl-asset-urls.mjs` copies `icon`/`banner` straight
from MFL's league feed, and MFL stores the ABSOLUTE form (that's what we
upload to it). Normalizing only the config would be silently undone by the
next `pnpm sync:afl`, and the diff would look like a routine asset sync. The
script now normalizes on read AND before comparison, so a normalized config
doesn't read as "changed" every run.

`iconSrcVariants()` in `team-icon-dark-css.ts` still emits selectors for BOTH
forms. Belt and braces: any surface, feed, or historical entry still carrying
an absolute URL keeps its dark swap and stroke.

**Verification that actually catches this:** local runs had been intercepting
`mflfootballv2.vercel.app` and serving from `public/`, which is precisely the
round trip that was broken — the bug was invisible in every screenshot. Test
crest changes with NO route interception, and assert `crossOriginReqs === 0`
plus `naturalWidth > 0` per crest rather than eyeballing the render.

**Threshold calibration: the 0.35–0.50 band was 5-for-5 wrong (2026-08-15).**
The 0.5 cutoff was picked a priori as "less than half the logo is legible."
In review the commissioner opted out every crest that landed between 0.35 and
0.50 — Cowboy Up 0.353, Team Minty Fresh 0.368, Dark Magicians 0.370, Get off
my Ditka 0.389 — and disputed nothing below 0.35. A pixel-average is a decent
candidate-finder but a poor judge: it counts a crest's total dark area without
knowing that a bright focal element (a face, a shield, a bold interior) already
does the separating work a stroke would provide.

Two things follow. First, `iconStrokeDark: false` exists because the
measurement needs a human override, and that override is load-bearing, not a
nicety. Second, when a threshold accumulates opt-outs that all cluster in one
band, that's evidence the threshold is wrong, not that the exceptions are
special — prefer re-tuning it (~0.35 here) over growing a correction list,
since the list has to be maintained forever and reads as arbitrary to whoever
finds it next. Left at 0.5 for now at the commissioner's preference; the
opt-outs carry it.

**Real artwork always supersedes the stroke.** When Fullybaked (0.452) got a
hand-drawn `iconDark`, it left the manifest automatically — `measureAllCrests`
skips any team with a dark variant — so no opt-out was needed and none should
be added. The guard test asserts the two are mutually exclusive. The fix for a
flagged crest is, in order: draw the dark variant, else pick a franchise-colored
stroke, else opt out.
