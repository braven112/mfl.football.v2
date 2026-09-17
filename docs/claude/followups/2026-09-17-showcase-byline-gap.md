# /showcase cannot render the article card's byline

**Filed:** 2026-09-17, from `/live` step 5c on the article-hero PR.
**Status:** open. Small, cosmetic, not urgent.

## What's wrong

The homepage news card carries an author byline in its footer — avatar plus
name, resolved from the post's own `authorId`. `/showcase`'s `news` gallery
card does not show it, so the gallery under-describes the live card.

## Why it wasn't just fixed

The byline markup lives in `LeagueCompositeHero.astro` (`.lch__byline*`), but
`ShowcasePage.astro` renders `CompositeHero` **directly** — it reproduces the
shell from gallery data rather than going through any adopter. So showing a
byline there means either:

1. copying the byline markup + CSS into `ShowcasePage.astro` — a second copy of
   exactly the thing `LeagueCompositeHero` exists to prevent, and the class of
   fork `tests/page-fork-ratchet.test.ts` was written about; or
2. moving the byline down into `CompositeHero` as a first-class optional prop,
   so every adopter can pass one and the showcase renders it like any other
   field.

(2) is the right shape and is why this is a follow-up rather than a line in
that PR: `CompositeHero` is the shell behind **seven** composites, and widening
its prop surface deserves its own diff and its own review rather than riding
along with a news-card change.

## When to do it

Next time `CompositeHero`'s props are being touched anyway, or if a second
adopter wants a byline (a recap card crediting its author would be the likely
one). Until then the gallery card carries a comment saying what it omits.

## Not in scope

The card's COPY is already fixed — it describes the article state, not the old
"Around the AFL." card. This is only about the missing byline row.
