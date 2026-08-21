# League URLs — leagueUrl(), and GroupMe's punctuation autolinking

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

### Absolute URLs — always `leagueUrl()`, never origin + path

Internal routes are stored PREFIXED (`/theleague/calendar`) because that's the
real Astro route and the only form that resolves on the shared host. A league's
own apex domain serves the BARE path (middleware rewrite), and vercel.json 301s
the prefixed form back to it. So concatenating an origin with a prefixed path —
`` `${leagueOrigin(reg)}${post.link}` `` — ships owner-facing links that read
`theleague.us/theleague/calendar` and burn a redirect hop. That was live in
Roger's reminders, Schefter's Trade Builder CTAs, both article GroupMe promos,
the August-cut touches, and the AFL announcement deep link (fixed Aug 2026).

`leagueUrl(league, path)` in the registry is THE builder, and it is total in
both directions so callers don't have to know which kind of league they hold:
on a league's own apex domain the prefix is redundant and gets STRIPPED; on the
shared host (path-only leagues like best-ball, which have no apex domain) it is
required and gets ADDED via `ensureLeaguePrefix`. Pass either form, get a URL
that resolves. It never touches a CROSS-league prefix (`/afl-fantasy/*` in a
TheLeague post must keep its prefix), and it pins the canonical cookie-safe
`www.` host from `leagueOrigin` — that host rule and the prefix rule travel
together, since a file that hand-built one usually hand-built the other
(`schefter-leagues.mjs` and `ANNOUNCE_TARGETS` each had both).

The Schefter league table exposes it
per-league as `league.url(path)`; `scripts/schefter-rumor-scan.mjs` wraps it in
`publicUrl()` so a `SCHEFTER_PUBLIC_BASE_URL` override (preview deploys,
mfl.football) still keeps the prefix — stripping is only correct on the apex.
`tests/league-url-prefix.test.ts` runs the real builders and fails on any
doubled prefix.

Note the feed's `post.link` must ALWAYS keep the prefix — it's the internal
route, it gets persisted, and the Schefter cards render it raw, so an
unprefixed path bakes a permanent 404 on mfl.football. Only the absolute
(GroupMe / deep-link) form gets stripped. The rumor scanner's tip CTA had this
backwards until Aug 2026 (`TIP_PAGE_PATH = '/schefter/tip'`).

### GroupMe autolinks the punctuation after a URL

A chat message that ends a sentence right after a link — `Review your plan at
https://www.theleague.us/rosters.` — ships a link whose href includes the
period, and it 404s for every owner who taps it. Roger's roster-cutdown touch
did exactly that (owner report, 2026-08-16). Bare hosts autolink too, so
`…log in at www.theleague.us.` breaks the same way.

`src/utils/link-punctuation.mjs` fixes it from BOTH ends, and both halves are
load-bearing:

- **Outgoing** — `stripLinkAdjacentPunctuation` trims the `.,;:!` run glued
  to the end of a URL, inside all three bot-post primitives:
  `scripts/lib/groupme.mjs` (the choke point for all nine node lanes),
  `scripts/lib/speculation-groupme.mjs`, and
  `src/utils/groupme-client.ts#postAsBot`. It is deliberately on the SEND
  path, not a template guard test — a large share of GroupMe text is composed
  at runtime and Schefter's LLM-written bodies routinely end a sentence on a
  link, so nothing static can catch those.
- **Inbound** — `resolvePunctuationRedirect` powers a 302 in
  `src/middleware.ts`, because the outgoing fix cannot reach a message
  already sent: those links are still in the chat and still dead. It also
  covers iMessage/Slack/email, which autolink the same way. No URL we serve
  ends in punctuation, so trimming can only turn a 404 into the right page.

Three things the regex has to get right, each one a bug that was in it:
`?` is NOT in the punctuation set (a URL autolinked as `…/rosters?` still
resolves, so stripping it only costs a question mark the sentence needed);
the URL may not END on `"'()[]<>`, or `(see <url>), then act` loses its comma
to a link that never included it; and the trailing run must not be followed
by a URL-continuation character, or `…/x.y` collapses to `…/xy`. It is for
CHAT PROSE only — on JSON or config text it will corrupt a quoted value, so
don't reuse it on a data file.

Three things about the inbound redirect that are guards, not style:

- **GET/HEAD only.** A 3xx on a POST/PATCH makes clients re-issue as GET and
  drop the body — a write would look fine and land nowhere.
- **It refuses protocol-relative paths.** `//evil.com.` trims to
  `//evil.com`, and that in a `Location` header walks the user off our
  origin. The helper returns `null` for any path whose second character is
  `/` or `\`, and for control characters. That guard is why this is a
  function rather than an inline `.replace()`.
- **302 + `Cache-Control: no-store`.** A 301 is cached indefinitely by
  browsers, and this normalization is defensive rather than canonical. Note
  the status code alone is NOT what makes it revocable — Cloudflare fronts
  the apex domains and has stamped its own max-age on responses regardless
  of status before (the NFL-logo saga), which is why the middleware builds
  the `Response` by hand with `no-store` instead of calling
  `context.redirect()`.

It runs before the league-host rewrite (so the trimmed path resolves
normally) and redirects rather than rewrites (so the URL bar stops showing a
broken, re-shareable link).

**Test the behavior, not the source text.** This one bit twice, in the same
PR, and both rounds are worth knowing about. First: `middleware.ts` was
checked with `toContain('302')` and friends, and every grep still passed when
the method gate was deleted, the status flipped to 308, and the query string
was dropped — the doc comment alone satisfied them. Same on the outgoing
side, where `toContain('stripLinkAdjacentPunctuation')` was satisfied by the
import line, so `postAsBot` could post raw text and stay green. Second: after
moving the *decision* into a pure `resolvePunctuationRedirect` and testing it
hard, the *wiring* was still grep-only — neutering the redirect branch and
dropping the `Location` header both left the suite green.

`astro:middleware` is now aliased to `tests/stubs/astro-middleware.ts` in
`vitest.config.ts` (the real `defineMiddleware` is a typing helper that
returns its handler unchanged, so the stub is faithful), which lets the test
import `onRequest` and assert the actual `Response` — status, `Location`,
`Cache-Control`, and that `next()` is not called. Reach for that alias rather
than a grep the next time middleware behavior needs a test.

**The sanitizer's call sites are pinned.** It corrupts structured text — a
separator between two quoted URLs gets eaten (`…x.xml"},{"u"…` → `}{`,
invalid JSON) — so `tests/link-punctuation.test.ts` fails the build if
`stripLinkAdjacentPunctuation` is called from anywhere outside the three
GroupMe send primitives. Same pattern as the league-literal and
design-token guards: the comment asks, the test enforces.

**Known limitation, deliberate: the redirect is PATH-only.** A stray
character that lands in the query (`/schefter/tip?target=0001.`) is not
rescued. Do not "finish the job" by trimming the query too —
`/api/suggestions/gif-search?q=` carries free-form user text, and trimming
would silently turn a search for `cat.` into a search for `cat` on every
request. The outgoing half is what keeps us from emitting those links, and
the one deep link we build with a query (`/news?post=<id>`) ends in a
`#post-<id>` fragment that browsers never send, so it absorbs the character.

Detecting "is this base URL my own apex host" must go through
`buildHostToSlugMap()`, never a string compare against the canonical origin —
`https://theleague.us`, `https://WWW.THELEAGUE.US`, `http://...` and
`...:443` are all the same host and must all strip.

