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

## Hosted artwork

Two of the league's marks are served from this folder, so a module can point at
a stable URL instead of a third-party host:

| File | Size | URL |
|---|---|---|
| `archie-head.png` | 400 × 662 | `https://v2.mfl.football/mfl/10105/archie-head.png` |
| `archies-wordmark.png` | 450 × 200 | `https://v2.mfl.football/mfl/10105/archies-wordmark.png` |

Both are transparent PNGs, stored at the size they were supplied. Nothing in
the widget references them yet — they are here to be linked from MFL's own
modules, the way `module.html` currently links the POWER 99 image off
`dagrafixdesigns.com`.

### Header art (`headers/`)

Sixteen 598 × 210 transparent header panels (blue chevron frame), stored at the
size they were supplied:

| File | Subject | URL |
|---|---|---|
| `headers/49ers-receiver.png` | 49ers receiver | `https://v2.mfl.football/mfl/10105/headers/49ers-receiver.png` |
| `headers/49ers-quarterback.png` | 49ers quarterback | `https://v2.mfl.football/mfl/10105/headers/49ers-quarterback.png` |
| `headers/steelers-92.png` | Steelers #92 | `https://v2.mfl.football/mfl/10105/headers/steelers-92.png` |
| `headers/helmet-sketch.png` | Faded helmet sketch | `https://v2.mfl.football/mfl/10105/headers/helmet-sketch.png` |
| `headers/silhouette-pointing.png` | Silhouette, finger raised | `https://v2.mfl.football/mfl/10105/headers/silhouette-pointing.png` |
| `headers/silhouette-phone.png` | Silhouette, on the phone | `https://v2.mfl.football/mfl/10105/headers/silhouette-phone.png` |
| `headers/bears-34.png` | Bears #34 | `https://v2.mfl.football/mfl/10105/headers/bears-34.png` |
| `headers/chiefs-tight-end.png` | Chiefs tight end | `https://v2.mfl.football/mfl/10105/headers/chiefs-tight-end.png` |
| `headers/vikings-84.png` | Vikings #84 | `https://v2.mfl.football/mfl/10105/headers/vikings-84.png` |
| `headers/colts-quarterback.png` | Colts quarterback | `https://v2.mfl.football/mfl/10105/headers/colts-quarterback.png` |
| `headers/packers-92.png` | Packers #92 | `https://v2.mfl.football/mfl/10105/headers/packers-92.png` |
| `headers/dolphins-quarterback.png` | Dolphins quarterback | `https://v2.mfl.football/mfl/10105/headers/dolphins-quarterback.png` |
| `headers/dolphins-quarterback-throwing.png` | Dolphins quarterback, throwing | `https://v2.mfl.football/mfl/10105/headers/dolphins-quarterback-throwing.png` |
| `headers/patriots-12.png` | Patriots #12 | `https://v2.mfl.football/mfl/10105/headers/patriots-12.png` |
| `headers/lions-running-back.png` | Lions running back | `https://v2.mfl.football/mfl/10105/headers/lions-running-back.png` |
| `headers/patriots-white-jersey.png` | Patriots, white jersey | `https://v2.mfl.football/mfl/10105/headers/patriots-white-jersey.png` |

Like the marks above, nothing in the widget references these yet.

### Pennant banners (`banners/`)

| File | Size | URL |
|---|---|---|
| `banners/pennants-21-25.png` | 1600 × 1000 | `https://v2.mfl.football/mfl/10105/banners/pennants-21-25.png` |

A rafter of hanging pennants numbered 21–25 (Eagles, Mavericks, Mavericks,
Stingers, Dragons), transparent below the rafter.

### League documents (`docs/`)

| File | URL |
|---|---|
| `docs/2025-bylaws-affl.pdf` | `https://v2.mfl.football/mfl/10105/docs/2025-bylaws-affl.pdf` |
| `docs/abl-2026.pdf` | `https://v2.mfl.football/mfl/10105/docs/abl-2026.pdf` |

Stored as supplied. To publish a new year's bylaws, add a new file rather than
overwriting, so links to the old year keep working.

`public/` is served as-is with no build step, so replacing any file and
deploying is the whole update path; the URL does not change. Keep the names
stable for that reason — a rename breaks every module already pointing at it.
