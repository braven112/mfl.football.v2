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
| Vitside Mafia (TL 0012) | `colorPrimaryDark` | `#e05aa8` — **pink** | `#b64f49` | 45.3 |
| Dark Magicians (TL 0015) | `colorPrimaryDark` | `#9b30ff` | `#b296e2` | 72.9 |
| Dark Magicians (TL 0015) | `colorSecondaryDark` | `#4a44c4` | `#8a78be` | 40.7 |
| Da Dangsters (TL 0002) | `colorSecondaryDark` | `#c9a24a` — gold | `#8b8f93` | 53.8 |
| Maverick (TL 0003) | `colorSecondaryDark` | `#c0392b` — red | `#b5884a` | 45.4 |

**Vitside is the one that looks like a real bug.** `franchise-band-brand.ts`
already carries a comment reading *"the pink it was using is a chart hue only"*
— the band was fixed to stop using it, but `colorPrimaryDark` still holds a
pink that appears nowhere in the club's palette or crest (a black-and-red
dragon). Same class as the Gridiron Geeks case that PR #1189 fixed: a
workaround was applied to one consumer and the underlying value left alone.

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
