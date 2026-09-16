---
slug: recap-hero-model-offset
status: open
severity: cosmetic
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1114
hotfix_sha: ed83653
followup_issue: 1117
followup_pr:
followup_session:
---

# Follow-up: weekly recap hero cutout shift leaks into the tablet range

## What broke

Nothing was erroring. This shipped through `/hotfix` on the user's explicit
direction **after** I flagged at step 0 that it did not meet the bar — it is a
cosmetic framing change, not a production outage. Recorded here so the fast
lane's usage stays auditable: this one should have been `/live`.

The Tuesday-AM weekly recap hero's top-scorer cutout sat about half a face-width
left of where the composition wants it.

## What the hotfix did

One line in `src/components/theleague/season-heroes/RecapCompositeHero.astro:97`
— added `--cmh-model-right: calc(clamp(0.25rem, 2vw, 1.75rem) - 50px)` to the
hero's `styleVars`, subtracting the shift from the shared default in
`composite-hero.css` rather than replacing the clamp.

Verified on production at 1280px: computed `right` 25.6px → -24.4px.

## Deferred items

- [ ] **F1 — The -50px shift also applies across 641–767px, contrary to the shipped intent**
  - Source: Copilot, post-merge review comment on PR #1114
  - Where: `src/components/theleague/season-heroes/RecapCompositeHero.astro:97`;
    breakpoint at `src/styles/composite-hero.css:692`
  - What's wrong: I wrote the commit message, the PR body and my report claiming
    the override was desktop-only because "below 768px the cutout is a faded
    170px watermark". **The shell's mobile treatment starts at
    `@media (max-width: 640px)`, not 768px.** So from 641–767px the cutout keeps
    its full desktop treatment AND the new -50px shift.
  - Measured on production at 700px viewport: `--cmh-model-w` clamps to its
    275px floor, computed `right` is -36px, and **35px of the cutout (13%)
    overhangs the card's right edge** — the shoulder clips at the boundary. The
    face stays fully visible and it reads acceptably, which is why it was not
    worth a second same-day hotfix on a cosmetic issue.
  - Why deferred: the clean fix is to make the shift proportional to the cutout
    rather than a fixed 50px — `translateX(-12%)` on `.cmh__model` scales
    correctly (412px → ~49px, 275px → ~33px). But `.cmh__model` carries no
    `transform` today, so adding one means editing `composite-hero.css`, which
    ~10 other heroes share. That is a deliberate change to shared layout code
    and does not belong in a fast-path cosmetic diff.
  - Options for whoever picks this up, in preference order:
    1. Add a `--cmh-model-shift` var consumed as `translateX()` on `.cmh__model`
       in `composite-hero.css`, defaulting to `0` so no existing hero moves.
       Then this hero sets `-12%` and the tablet range scales down on its own.
    2. Scope the current override behind `@media (min-width: 768px)` in the
       component. Narrower, but leaves 641–767px with the pre-fix framing —
       a visible discontinuity at the 768px line.
    3. Accept it. 13% shoulder clip at 700px may simply be fine; get the user's
       eye on it before spending the shared-CSS change.

- [x] **Guard test — dropped, deliberately**
  - Source: deferred at implementation
  - Why dropped: the change encodes no rule. A test pinning a literal pixel
    offset is a change-detector that fails on the next intentional tweak. There
    is no invariant here to protect. Recorded rather than silently omitted, per
    `/hotfix` step 2.
  - **Note:** if F1 is fixed via option 1, that DOES introduce a rule worth
    pinning — "`--cmh-model-shift` defaults to 0 so adding the var moves no
    existing hero" is a real regression class across ~10 heroes. Write the guard
    then.

## Context to start cold

- **The 50px number is measured, not chosen.** On the real 1280px render the
  face reads ~88–100px temple-to-temple (~117px hairline to hairline), so half a
  face is ~50px. The user's request was literally "about the length of half his
  face." If you rescale the shift, preserve that intent rather than the literal
  50.
- **There is no AFL twin.** `scripts/sibling-drift.mjs` reports
  `afl-fantasy/season-heroes/RecapCompositeHero.astro` MISSING. The AFL's recap
  slot is an event-shaped hero (`afl-hero-resolver.ts:1182`), and
  `AflCompositeHero.astro` sets no `--cmh-model-right` at all. Nothing to mirror
  — but if you add `--cmh-model-shift` to the shared CSS, that DOES reach the
  AFL composites, so re-run the drift check.
- **Below 640px is genuinely unaffected** and should stay that way: the cutout
  drops to a faded 170px watermark on `--cmh-model-right-mobile`
  (`composite-hero.css:712`), where 50px would be a third of its width. The
  `.cmh--crop` opt-in variant at `:758` also reassigns `right: 0` outright.
- **No preview deployment was checked.** The push landed before the PR existed,
  so `scripts/vercel-ignore-build.mjs` canceled the preview build ("Canceled by
  Ignored Build Step"). Production verification covered it instead. If you open
  a follow-up PR, open it before or with the first push so you get a preview.
- **No changelog entry was staged.** A hero photo moving 50px is below the
  threshold of anything an owner reads as "new this week". If F1's fix ends up
  touching shared hero layout, reconsider — that has a wider blast radius.
- **The recap slot only renders Tuesdays before 2pm PT**
  (`src/utils/hero-resolver.ts:843`). To see this card at any other time, use
  `?testDate=2026-09-15T09:00`. That is how both the local and production checks
  were done.
