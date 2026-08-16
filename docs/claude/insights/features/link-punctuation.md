# Link punctuation (`src/utils/link-punctuation.mjs`)

Chat clients autolink the sentence's trailing period into the URL, so
`Review your plan at https://www.theleague.us/rosters.` ships an href ending
in `.` and 404s. Fixed 2026-08-16 from both ends — outgoing sanitizer on
every bot-post primitive, inbound 302 in `src/middleware.ts`. The what and
why live in CLAUDE.md; this file is the stuff that only shows up while
building it.

## A send-path fix beats a template guard when the text is LLM-written

The instinct in this repo is a guard test that greps templates (that is how
`league-literal-guard` and `design-token-guard` work). It is the wrong tool
here: most GroupMe text is composed at runtime, and Schefter's LLM-written
bodies routinely end a sentence on a link. A static scan can only see the
templates, which were already clean — the bug would have kept shipping from
model output. Put the normalization on the single send choke point instead.

**But do not then grep the choke point to prove it is wired.** That was the
first instinct here and it is worthless: `expect(read(file)).toContain(
'stripLinkAdjacentPunctuation')` is satisfied by the `import` line, so
`postAsBot` could go back to posting raw `text` with the suite fully green.
Review caught it by mutation-testing, not by reading. Spy on `fetch` and
assert the bytes that actually get POSTed.

The generalized lesson, which cost two review rounds to learn: a grep proves
a *token exists in a file*, never that a code path runs. It fails silently in
both directions — satisfied by imports and comments, and blind to a branch
neutered with `if (false)`. Any invariant worth a comment is worth executing:
extract the decision into a pure function, or alias the virtual module (see
the middleware section below) and call the real thing.

Corollary for picking the choke point: `scripts/lib/groupme.mjs#postToGroupMe`
already funnels all nine node lanes, so one edit covered Roger, the rumor
mill, lineup checks, weekly articles, pecking order and the rest. Two other
primitives POST to `/v3/bots/post` independently (`speculation-groupme.mjs`,
`groupme-client.ts#postAsBot`) — grep for `bots/post`, not for the shared
helper, or you will miss them.

## The inbound redirect is path-only because one query param is free-form

The obvious "finish the job" move is to trim the query too. Don't:
`/api/suggestions/gif-search?q=` carries user-typed search text, so trimming
would silently turn a search for `cat.` into `cat` on every request, plus an
extra round trip. Enumerate what actually reads free-form text from a GET
query before widening a normalization like this —
`grep -roE "searchParams\.get\(['\"][a-zA-Z_]+['\"]\)" src/pages` gives the
full list in one shot, and `q` was the only free-form one.

The accepted cost: a link ending in a query value
(`/schefter/tip?target=0001.`) is not rescued. Verified live — the period
stays inside the param and rides through the login redirect.

## Local dev cannot exercise the interesting half of a middleware redirect

Three separate reasons a localhost dev server will lie to you here:

- **Vite normalizes `//` before middleware runs.** A request for
  `//evil.com.` reaches `context.url.pathname` as `/evil.com.`, so the
  protocol-relative open-redirect guard never fires locally and the observed
  `Location` is a harmless same-origin `/evil.com`. The guard still belongs
  in the code — Vercel's edge may not normalize identically — but you cannot
  prove it works by curling dev.
- **`curl` rewrites the path too.** It collapses `//` unless you pass
  `--path-as-is`. Without that flag you are testing a different request than
  you think you are.
- **`Host:` header overrides get a 403** from Vite's `allowedHosts`, so
  apex-host behavior (the league rewrite composing with anything else in
  middleware) is not testable on localhost dev at all.

WHATWG parsing is a related trap when reasoning about guards:
`new URL('//evil.com.', base).pathname` is `'/'`, not `'//evil.com.'` —
the `//` is parsed as an authority. Unit-test the helper with raw strings
rather than round-tripping through `new URL`, or the case you care about
evaporates before the assertion.

## Middleware redirects sit in the `status: 404` fallback blast radius

The 2026-07-21 deployment insight is about page-level `Astro.redirect()`, but
a redirect returned from middleware *before* `next()` is the same shape — a
3xx with an empty body, which is exactly the response that has nothing to
fall back on when Vercel's route-level `status` overrides it. (This one ships
a hand-built `Response` rather than `context.redirect()`, so it can carry
`Cache-Control: no-store`; Astro's own `redirect()` is literally
`new Response(null, { status, headers: { Location } })`, so the two are
equivalent apart from that header — and equally exposed here.)
`src/pages/[...path].astro` is what saves it. Verified for this change:
after `pnpm build`, `.vercel/output/config.json` route 206
(`^(?:/(.*?))?/?$`, no forced status) precedes route 207
(`^/.*$`, `status: 404`), so an unmatched path like `/theleague/rosters.`
keeps its real 302. Re-run that check after any routing change — a silent
demotion to 404 turns the redirect into the dead page it was meant to fix.

## Don't put literal control characters in a source file

A test asserting the control-character guard was written with a real NUL byte
pasted into the string instead of the `\u0000` escape. The test still passed,
which is the trap — but `git` classified `tests/link-punctuation.test.ts` as
binary (`Bin 0 -> 7640 bytes` in `--stat`, no diffs, no review possible).
Always write the escape sequence. `file <path>` reporting `data` instead of
`JavaScript source`, or a `Bin` entry in `git diff --stat`, is the tell.

## Testing Astro middleware: alias the virtual module

`src/middleware.ts` imports `defineMiddleware` from `astro:middleware`, a
virtual module vitest cannot resolve — which is why the wiring was grep-only
for two rounds. The fix is three lines: `tests/stubs/astro-middleware.ts`
exporting an identity function, plus an alias in `vitest.config.ts`. The stub
is faithful rather than a simplification — the real `defineMiddleware` is a
typing helper that returns its handler unchanged (verified against
astro@7.1.3). With it, a test imports `onRequest`, hands it a plain object
context (`{ request: { method }, url, locals }`) and a `vi.fn()` for `next`,
and asserts the real `Response`: status, `Location`, `Cache-Control`, and
that `next` was not called.

Reach for this any time middleware behavior needs a test. It also makes the
negative cases assertable — that a POST falls through, that a clean path
calls `next()` exactly once — which is where the grep version was blindest.
