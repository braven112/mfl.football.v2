---
slug: faceoff-panel-light-primary
status: open
severity: low
opened: 2026-09-22
hotfix_pr:
hotfix_sha:
followup_issue:
followup_pr:
followup_session: session_014ASW3hHwARo4VGt6CN45en
---

# Follow-up: `FaceoffComposite` paints its panel from an unfloored `colorPrimary`

Found during the `/live` review of the four-colour palette PR (#1189). Filed
rather than fixed there because the fix changes rendered art for franchises
that PR did not touch — see **Why this was deferred**.

## What's wrong

`src/components/theleague/FaceoffComposite.astro#panelOf` builds each panel as

```ts
gradient: `linear-gradient(160deg, #0b0e12 0%, ${color} 150%)`
```

where `color` is the franchise's `colorPrimary`, taken raw. The panel is
deliberately dark in **both** themes and its ink is hardcoded white
(`.foc__player { color: #fff }`), and the player-name plate's own scrim is
`linear-gradient(transparent, rgba(6, 9, 13, 0.85))` — **fully transparent at
its top edge**, which is exactly where the bold 0.8125rem name sits.

So a franchise whose primary is light paints its own plate almost white and
then writes white on it. Every other franchise-colour surface in this repo
floors before it paints (`toBroadcastPair`, `solveBand`, `resolveAccent`,
`resolveMatchupColorVars`); this one does not.

Measured white-on-raw-primary contrast, and where each colour lands once
`ensureContrastOn(c, '#ffffff', 3)` is applied:

| League | Franchise | `colorPrimary` | white-on-raw | floored to |
|---|---|---|---|---|
| afl | Dicks out for Harambe | `#ffffff` | **1.00** | `#8c8c8c` |
| afl | Avenging Amish | `#e9e9e9` | 1.21 | `#8c8c8c` |
| afl | Midwestside Connection | `#ffcd00` | 1.50 | `#b39000` |
| theleague | Midwestside Connection | `#ffcd00` | 1.50 | `#b39000` |
| afl | Balls Deep | `#ddc08c` | 1.75 | `#a69069` |
| afl | Swiftie 4 Life | `#e8aea6` | 1.90 | `#ae837d` |
| afl | Chatmaster | `#cfad30` | 2.17 | `#a68a26` |

Six of those seven predate PR #1189. Harambe is the one that PR added, by
promoting white to primary — their crest's largest area, and the right call for
the brand. Because the far stop sits at **150%**, the panel never actually
reaches the stop colour; at the plate's top edge Harambe lands near `#959799`,
which puts the name at roughly **2.9:1** — under both the 4.5 body floor and
the 3.0 large-text floor. Amish is the next worst at about 3.2:1.

Callers affected: `LineupGameStrip` (both leagues' Set Lineup pages),
`MatchupPreviewHero`, `MatchupSplitHero`.

## Why this was deferred

Every available fix repaints franchises PR #1189 never touched:

- Flooring inside `panelOf` moves **seven** panels, six of them pre-existing.
- Giving `.foc__player`'s scrim a non-zero top stop darkens the plate on all
  forty.

Both are defensible and one of them is probably right — but neither is
"obviously equivalent", which is the bar `/live`'s quality pass sets for a
change applied silently inside someone else's PR. Widening a data PR into a
visual change across seven clubs' lineup pages is the call, not the cleanup.

## Proposed fix

Floor in `panelOf`, since that is where the repo's other colour surfaces do it
and it is a no-op for the thirty-three franchises that already read:

```ts
// The panel is near-black with WHITE ink in BOTH themes, and the plate's own
// scrim is transparent at its top edge — so the far stop has to carry white
// by itself. Anything that already does is returned unchanged.
const color = ensureContrastOn(side.color ?? getNflTeamColors(side.model.nflTeam).primary, '#ffffff', AA_LARGE_TEXT_RATIO);
```

Then pin it: a guard that walks both configs and asserts no franchise's panel
colour leaves white under 3:1 — the shape that would have caught all six of the
pre-existing ones.

Worth deciding at the same time whether a light-primary franchise should get
its **secondary** in the panel instead of a greyed primary. Harambe floored is
`#8c8c8c`, which is legible and anonymous; their `#418bbe` is neither.
