---
slug: dark-variant-audit
status: open
severity: low
opened: 2026-09-22
hotfix_pr:
hotfix_sha:
followup_issue:
followup_pr:
followup_session: session_014ASW3hHwARo4VGt6CN45en
---

# Follow-up: five `colorPrimaryDark` / `colorSecondaryDark` values worth a look

Found while trying (and failing) to write a guard for the four-colour palette
PR #1189. The data findings are real; the guard is not shippable, and why it is
not is the more useful half of this brief.

## What a dark variant actually is

`darkClaim` (`src/utils/live/model.ts`) swaps `colorPrimaryDark` /
`colorSecondaryDark` in for their light counterparts on every live-scoring
surface. The convention — visible across the sixteen TheLeague clubs — is NOT
"the same colour, lighter". Several clubs deliberately **lead with a different
one of their own four colours** on a dark card: Dead Cap Walking goes navy →
green, Cowboy Up swaps navy ↔ red, the Ninjas' green secondary becomes their
red quaternary. That is art direction, not drift.

So the invariant is roughly "a dark variant is one of the franchise's own
colours, or a lift of one" — and **that cannot be measured with ΔE**, which is
the trap. A dark variant is *supposed* to differ in lightness, and CIE76 reads
lightness, so every legitimate lift scores as far away. Fire Ready Aim's
`#f08f92` is 34 ΔE from the nearest slot purely for being lighter than the red
it came from.

Two metrics were tried and both over-fired:

- **Same-family (ΔE base vs dark > 50)** → 8 clubs, almost all deliberate swaps.
- **Membership (ΔE dark vs nearest slot > 30)** → 5 clubs, confounded by
  lightness as above.

A workable check probably compares HUE and CHROMA while ignoring lightness
entirely, and skips near-black bases (which have no lighter self to show). That
was more than PR #1189 should carry.

## The five worth a human look

Measured as ΔE from the nearest of the franchise's own four colours:

| Club | Field | Value | Nearest own colour | ΔE |
|---|---|---|---|---|
| Dark Magicians (TL 0015) | `colorPrimaryDark` | `#9b30ff` | `#b296e2` | 72.9 |
| Dark Magicians (TL 0015) | `colorSecondaryDark` | `#4a44c4` | `#8a78be` | 40.7 |
| Da Dangsters (TL 0002) | `colorSecondaryDark` | `#c9a24a` — gold | `#8b8f93` | 53.8 |
| Maverick (TL 0003) | `colorSecondaryDark` | `#c0392b` — red | `#b5884a` | 45.4 |

**Vitside — FIXED in #1189** (Brandon: "change Vitside pink to the maroon
colour instead"). `colorPrimaryDark` held `#e05aa8`, a pink appearing nowhere
in the club's palette or in its crest (a black-and-red dragon), while
`franchise-band-brand.ts` already carried a comment reading *"the pink it was
using is a chart hue only"* — the band had been fixed and the underlying value
left alone, the same shape as the Gridiron Geeks override that PR removed. It
is now `#7c221f`, the largest non-white cluster in the crest at 4.0%.

Two things that fix surfaced and are NOT fixed:

- **The same club rendered differently per league.** TheLeague painted Vitside
  `#e05aa8` on the live board and the AFL painted it `#aa322b`, because
  TheLeague carries dark variants for this franchise and the AFL carries none
  (no AFL club does). `BAND_ART_DIRECTION`'s own comment says this call "has to
  be made in both, or the same team wears two different bands depending on
  which roster you opened it from" — that reasoning applies to `darkClaim` just
  as much as to bands. With the maroon in TheLeague only, the two still differ:
  TL resolves `#7c221f` / ink `#b78584`, the AFL `#aa322b` / ink `#c87a75`.
  Closing it means giving AFL 0009 the same two dark variants, which would be
  the first in that config — a league-level decision, not a bug fix.
- **`colorSecondaryDark` diverges for the same reason** (TL `#d14338`, AFL
  falls through to `#aa322b`).

A dark FILL does not need to clear a luminance floor, which is worth knowing
before judging one: `resolveMatchupColorVars` uses the raw value as the fill
(cleared for ΔE against the card) and floors the INK separately through
`ensureContrastOn`. Every maroon candidate from `#74211e` up produced an ink
between 5.4:1 and 6.0:1. The instinct to reject `#74211e` for measuring 1.52:1
against the card was wrong.

Da Dangsters' gold and Maverick's red are each a hue with no slot to justify
it. The Magicians' two are the most likely to be deliberate (a vivid
magic-purple on a dark card), and their base colours changed in #1189, so they
want re-checking rather than assuming.

## What PR #1189 already fixed in this class

Four values that were derived from a colour the same pass replaced:

- Running down the Dream `colorSecondaryDark` — a lift of the tan that became
  cloud grey. Deleted; `#9bacb3` clears 6.88:1 unaided.
- Fire Ready Aim `colorSecondaryDark` — re-derived from the new red.
- Chatmaster `colorQuaternary` — a 0.70 scale of the muddy gold that became
  `#ffce31`; re-derived to `#b39022` at the same ratio.
- Gridiron Geeks `colorSecondaryDark` — a lift of the muted orange that became
  `#f68428`. Deleted; the new orange clears 6.34:1 unaided.

The last two were caught only by **screenshotting the rendered Brand Book**,
not by any check. That is worth repeating as a method: the page prints every
colour a franchise owns side by side, so a stale one is visible in a way it
never is in a diff.
