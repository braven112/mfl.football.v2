# Archie's Fantasy Football League — MFL 10105

Custom playoff standings widget. Status: **specified, not yet built.**

| | |
|---|---|
| League | Archie's Fantasy Football League |
| MFL id | 10105 |
| Host | `www48.myfantasyleague.com` |
| Page being replaced | [`/2026/home/10105?MODULE=MESSAGE6`](https://www48.myfantasyleague.com/2026/home/10105?MODULE=MESSAGE6) |
| Structure | 99 franchises, 9 divisions of 11 |
| Table caption | MAD POWER 99 |

See `DECISIONS.md` for what has been agreed and what is still open. The two
blocking open items are how Victory Points are obtained, and what breaks a VP
tie.

## The existing page

Captured in `reference/` on 2026-09-20, before any change:

- `reference/existing-page.css` — the module's stylesheet
- `reference/existing-page.js` — the module's own script (MFL's site scripts stripped)

It is a hand-maintained table. Its embedded owner guide states the model
plainly: *"Edit records, points averages and winnings manually; no MFL data
import."* All 99 rows currently sit reset at `0-0 / 0 / 0 / N`.

**Columns:** RANKING · TEAM · RECORD · POINTS AVG · WINNINGS · DIVISION LEADERS

**Container:** `#madmen`, table `#wwwc`. Six cells per row, always.

**Status is carried on the sixth cell**, and the cell is swapped wholesale
rather than edited:

| Meaning | Markup |
|---|---|
| Normal | `<td class="wildcard-leader-display" data-wildcard="N" data-wildcard-note="">` |
| Wild card | same, `data-wildcard="Y"`, optional `data-wildcard-note="WC #1"` |
| Division leader | `<td class="division-leader-display">DIVISION NAME</td>` |

**Existing colour language** — a new tier must not reuse these:

| Class | Meaning | Colour |
|---|---|---|
| `.highlight-row` | top scorer | red text `#e60000` |
| `.division-row` | division leader | pink `rgba(255, 81, 159, 0.1)` |
| `.wildcard-row` | wild card | cyan `rgb(112, 217, 227, 0.15)` |
| `.winnings-row` | has winnings | green `rgba(61, 220, 132, 0.1)` |

Tokens: `--accent-th: #181818`, `--accent-line: #4b98e4`, `--section-gap: 100px`.
Background priority, per the page's own guide: red, then wild card, then
winnings, then division.

## What the widget changes

Ranking moves from POINTS AVG to Victory Points, and the table gains a third
qualifying tier:

| Seeds | Tier | Colour |
|---|---|---|
| 1–9 | Division leaders | existing pink |
| 10–18 | Division runners-up | **new, fourth colour needed** |
| 19–30 | Wild cards | existing cyan |
| 31–99 | The field | none |

Records, points and tier assignment stop being typed in and are read from MFL.
Winnings stay commissioner-entered — the league's MFL accounting ledger is
empty, so there is nothing to derive them from.

## Installing (once built)

Add one line to the MESSAGE6 module, below the table:

```html
<script src="https://v2.mfl.football/mfl/10105/standings.js" defer></script>
```

Nothing else in the module needs to change, and the script needs no key. It
reads league 10105 from the page's own URL, so it carries no league id of its
own.
