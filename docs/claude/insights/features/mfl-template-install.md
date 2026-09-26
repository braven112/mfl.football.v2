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

## 2026-09-26 — Cloudflare holds the sprite for a year; version the fetch URL

After `icon-newsletter-book` merged to main (#1226) and deployed, the bare
`https://v2.mfl.football/assets/icons/sprite.svg` still served the old sprite:
Cloudflare sits in front of Vercel and the file ships with
`s-maxage=31536000`, and its cached copy was ~25h old. Any other URL form
(`?v=2`, `?x=1`) was a fresh cache key and served the new symbol at once.

**Rule:** a header HPM fetches the sprite with a `?v=` query, and the number
is bumped whenever the sprite gains a symbol that header uses. Archie's header
does (`?v=2`). The shared `src/data/mfl-template/header.html` still fetches
the bare URL, so a new symbol never reaches a league on that template until
the Cloudflare copy is purged or the template is versioned too.

## 2026-09-26 — Archie's skin CSS is loaded from a preview build, not production

Archie's MFL appearance settings point at
`mflfootballv2-git-claude-upbe-…vercel.app/assets/css/dist/archies_main.css` —
a branch preview — because the skin had never reached main
(`v2.mfl.football/assets/css/dist/archies_main.css` was a 404). A skin change
merged anywhere else never reaches that URL. Once `archies_main.css` is on
main, repoint the league at the production URL so skin fixes ship with normal
deploys.

## 2026-09-26 — Sprite symbols for a one-league icon: draw, don't trace

The client's nav icons arrived as 60x120 PNG strips (rest over hover). Too
small to trace: the Archie's Corner book was redrawn by hand as a 64-unit
solid symbol, and the rest/hover look is CSS on the sprite glyphs
(`_archies.scss`: accent fill at rest; on hover black fill with stacked
`drop-shadow`s — two 1px for an edge, 6px + 18px for the glow). Stroke-based
outlines are not an option on sprite glyphs: each symbol has its own viewBox,
so one `stroke-width` renders a different weight on every icon.
