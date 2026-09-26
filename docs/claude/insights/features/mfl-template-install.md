# MFL template install guide (`/instructions`) and the header/footer HPMs

Built 2026-09-25. The 2017 guide at `mfl.football/instructions.html` ("Project
hawk") rebuilt on the shared host at `v2.mfl.football/instructions`, around the
header and footer Home Page Messages first cleaned up for Archie's (MFL 10105).

| Layer | Files |
|---|---|
| Page | `src/pages/instructions.astro` (MflAppLayout, SSR) |
| Snippets | `src/data/mfl-template/{header,footer,homepage}.html`, imported `?raw` |
| Archie's copy (not shown on the page) | `src/data/mfl-template/examples/archies-{header,footer}.html` |
| Icon source | `public/assets/icons/sprite.svg` (also what the header fetches at runtime) |

Edit the snippet files, never the page — the page renders whatever they hold.

---

## 2026-09-25 — The header's jQuery is load-bearing for MFL itself

**Context:** Review of Archie's header/footer HPMs. The footer script was the
only visible jQuery user, so it was rewritten in plain JS and the header's
`jquery-1.12.4.js` line was removed.

**What happened:** MFL's left menu (`#vsubmenu`) reappeared on every page.

**Why:** MFL does **not** load jQuery on league pages. Its own inline page
scripts, emitted AFTER the header HPM, call
`$("head").append("<style>…#vsubmenu{display:none}</style>")` to hide the left
menu, `$('#first_btn').popup(…)` for popups, and `jQuery.ajax` for custom
homepage tabs. They were relying on the league's header to supply `$`. With it
gone they throw and the menu stays visible.

**Rule:** a league header HPM must keep jQuery, and it must stay in the HEADER
(it has to load before MFL's inline scripts further down the page). Verify with
a live fetch of `https://<host>/<year>/home/<id>` and grep for `\$(` /
`jQuery(` in MFL's own inline scripts — never assume MFL provides it.

## 2026-09-25 — A `display:none` sprite breaks symbols that use clip paths

The inline icon sprite was hidden with `style="display:none"`. Symbols that
reference a `<clipPath>` by `url(#…)` (the Premier League crest) don't render
from inside a `display:none` SVG in Chrome/Firefox. Hide the sprite with
`position:absolute;width:0;height:0;overflow:hidden` instead. The runtime
loader in `header.html` strips the sprite's own `display: none` for the same
reason, since the wrapper div already hides it.

## 2026-09-25 — Fetching the sprite instead of inlining 187 KB

The inline sprite made the header ~187 KB — too big to paste reliably. The
header now fetches `https://v2.mfl.football/assets/icons/sprite.svg` (served
with `access-control-allow-origin: *`) and injects it. `<use>` references
resolve once the symbols arrive. Trade-off: icons appear a moment after load
and depend on v2.mfl.football being up (text labels and links still work).

## 2026-09-25 — `pkill -f` / `pgrep -f` on "astro dev" kills your own shell

In the sandbox, `pgrep -f "astro dev" | xargs kill` matched the Bash tool's own
command line (which contains the string) and killed it — exit 144, nothing after
it ran, including a `git commit`. Stop a dev server by PID captured at start,
or match a pattern that can't appear in the command itself.
