# The Brand Book's franchise half

> Companion to `nfl-mark-assignments.md`, which works the same problem for the
> 32 NFL clubs. This file covers the 40 league franchises and the decisions
> that are NOT shared between the two halves.

## What it replaced, and why

`/<league>/assets` was a flat searchable grid of every file in the league with
a copy-URL button on each. It answered "where is the PNG" and nothing else — not
which of a franchise's five cuts a dark card draws, not what its colours are
for, not why two of them look almost identical. Owners used it as the team
branding destination because it was the only one.

The Brand Book answers the question the Asset Library could not, for the 40
clubs that field a team today. The library itself did not go away — it moved to
`/<league>/brand/files`, because 38 former TheLeague franchises, 109 former AFL
ones and the championship / league / conference / division art have no brand
page of their own, and finding one file by name across all of that is the thing
that view is genuinely good at.

`/<league>/assets` now 302s to the book. Not 301: a permanent redirect is cached
by the browser indefinitely and cannot be taken back without minting a new URL,
and this is a product decision that may yet be revisited.

## One book, two subjects

`/<league>/brand` leads with the league's own clubs and keeps the 32 NFL clubs
below. They share a page because they answer the same question — which cut does
each ground draw — and two destinations both called "brand", a click apart in
the nav, is worse than one page with two sections.

`/<league>/brand/<segment>` resolves a **franchise first, a club code second**.
That order is safe only while the namespaces are disjoint, and nothing about
either guarantees it: a franchise renamed to something that slugs to a club code
would silently take over that club's page, with no error anywhere.
`tests/brand-book-routes.test.ts` fails the build on a collision in either
direction — including the alias pass, since an `abbrev` is also three letters.

**The shared host gets the NFL half alone.** `mfl.football/brand` claims no
league identity (`resolveSharedHostHiddenLeague` 404s `/theleague/*` there), and
NFL club marks belong to no league, so they render fine. A franchise mark
belongs to exactly one — and five franchises field a team in both leagues
(Computer Jocks, Da Dangsters, Midwestside, the Mariachi Ninjas, Vitside), so
their slugs collide and a league-less `/brand/<slug>` could not say which one it
meant. That is the reason, not tidiness.

## The three grounds, transposed

A mark sits on a white cell, a dark card, or the team's own colour, and the
third is not a variant of the first two. `franchise-marks.ts#bandSlot` applies
the **same luminance threshold** `nfl-marks.ts` does, so the two halves of one
page cannot disagree about what "dark enough" means. It reads the franchise's
BRAND primary — which is the rule `franchise-band-brand.ts` has been applying to
crests on deep-ink surfaces all along.

| Ground | Draws | Why |
|---|---|---|
| light | `icon` | Standings rows, nav crest, matchup cards |
| dark | `iconDark` → `icon` + measured ring | Theme-first, the `resolveDarkSurfaceCrest` order narrowed to the icon pair — this ground is a 100px CARD, not the 300px watermark |
| band | whichever slot the primary's luminance picks | Dark in both themes for almost every club: five TheLeague franchises and three AFL ones wear `#181818` |

## Three things that are load-bearing

**It indexes the config; it does not become a second catalog.** The league
config is already the single source of truth for `icon`, `iconDark`, the GroupMe
pair, `banner`, the colour quartet and the `history[]` eras. `franchise-marks.ts`
has the same relationship to it that `franchise-brand.ts` does. The NFL half
needs a catalog because its artwork is fetched; this half does not.

**It anchors on the BRAND primary, never the chart hue.** `color` is picked to
stay distinct beside fifteen other lines on a graph. A surface that mistook it
for brand identity opened Vitside Mafia — a black-and-red franchise — in pink.
The page shows `color` as a swatch and says in as many words what it is not for.

**The comparison surfaces opt OUT of the global dark swap.** `buildTeamIconDarkCss`
emits `html.dark img[src="<light>"] { content: url(<dark cut>) }` for every
franchise shipping an `iconDark`. Everywhere else that is the whole point; on a
page whose subject is the side-by-side comparison it renders one mark twice for
a dark-mode reader. The opt-out is scoped to the elements that DECLARE a ground,
never the page — a page-wide one would freeze everything else onto light artwork
against a dark card, which is the exact bug the swap exists to prevent. The
measured ring is applied INLINE, where it outranks the global rule, so a crest
can never wear two.

## Slugs

Derived from the **full name**, not `nameShort`. The NFL tile beside it can put
the nickname alone on the big line because a nickname identifies a club; a
franchise's short name often does not — "Pain", "Fire" and "Midwest" are all
real ones, and A Bruin Pegs Me shortens to `pegs-me`. Short names, abbrevs and
aliases all still resolve through `franchiseIdFromSlug`'s alias pass, so no
link an owner might guess is dead.

Never the franchise id: both leagues have an 0001.

## Deliberately not done

- **`ClubBrandPage` was not refactored onto the shared stylesheet.** It was
  in flight as #1180 while this was built, and a CSS conflict on a moving file
  buys nothing. `src/styles/brand-book.css` holds the shell the index and the
  franchise page share; folding the club page in is a follow-up once #1180
  lands, and is the better end state.
- **No `/guides` page.** The pages explain themselves in situ, which is the
  point of showing the real components rather than describing them. If owners
  start asking which file to paste into MFL despite the usage table, that is
  the signal.
