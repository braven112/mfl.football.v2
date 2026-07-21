# What's New Screenshot Capture (manual staging for auth-gated / analytics pages)

Insights for capturing `public/assets/whats-new/*.webp` pairs with Playwright
when the target page can't render honestly from a blind `page.goto()` — auth
gates, prod-only analytics, or a specific scroll position. Complements
`scripts/capture-whats-new-screenshots.mjs` (the generic batch capturer).

---

## 2026-07-06 - Sandboxed sessions can't reach MFL, prod, or CDN hosts — mock them, don't skip them

**Context:** Recapturing screenshots for `submit-lineup` (real MFL roster data),
`owner-activity`/`afl-owner-activity` (Redis-backed analytics), and
`afl-trophy-wall` (franchise icon CDN) inside a network-policy-restricted
Claude Code session.

**Insight:** `api.myfantasyleague.com`, `theleague.us`, and `a.espncdn.com` are
all unreachable (proxy returns 403 CONNECT). Three different fixes, matched to
what's actually needed:

1. **MFL API (server-side `fetch` in `.astro` frontmatter)** — stand up a
   local HTTPS mock on port 443 serving the committed
   `data/theleague/mfl-feeds/<year>/*.json` snapshots, add a `/etc/hosts`
   entry (`127.0.0.1 api.myfantasyleague.com`), and trust its self-signed cert
   via `NODE_EXTRA_CA_CERTS` when launching `pnpm dev`. This renders real
   roster/projection/schedule data through the actual page code path — no
   page-code forking needed. A `fetch` shim (`NODE_OPTIONS=--import`) also
   works if you'd rather not touch `/etc/hosts` + TLS.
2. **Prod-only pages (analytics)** — don't try to reach prod; use the page's
   own `?mock=true` staging mode if it has one (both activity pages do). This
   is the intended local-dev path and needs zero infra.
3. **External image CDNs (ESPN headshots, prod-absolute asset URLs)** — route-
   intercept in Playwright (`page.route('**/*', ...)`) and fulfill with a
   neutral inline SVG silhouette for headshots. For URLs that are
   prod-absolute but point at *our own* assets (e.g.
   `https://mflfootballv2.vercel.app/assets/afl/icons/herd.png` baked into
   `afl.config.json`), proxy them back to the local dev server instead of
   faking them — `route.fetch({ url: BASE + path })` then
   `route.fulfill({ response })` with the real bytes, so franchise icons etc.
   render correctly instead of as silhouettes. (`context.request.get()` also
   works — it's a valid Playwright API for firing a request outside the
   page — but `route.fetch()` is the more idiomatic tool for "replay this
   route against a different URL" and needs no manual header plumbing.)

**Recommendation:** Before assuming a page "can't be captured here," check
whether it reads from committed JSON (mockable), has a `?mock=` mode
(free), or only needs its own-origin assets rewritten (proxyable). Only fall
back to a placeholder for genuinely external, non-deterministic content
(third-party headshots).

---

## 2026-07-06 - Auth-gated pages: temporary DEV-guarded session-mint route, not header hacks

**Context:** `submit-lineup`, `tip-schefter-gets-louder`, and `mock-draft` all
redirect anonymous requests to `/login`. CLAUDE.md's auth section explicitly
forbids the old `X-Auth-User`/`X-User-Context` header bypass (removed for being
an auth-bypass vector).

**Insight:** The sanctioned path is `createSessionToken()` +
`createSessionCookie()` from `src/utils/session.ts`, called from a route
that only exists for the duration of the capture:

```ts
// src/pages/api/dev-login.ts — TEMPORARY, delete before committing
export const GET: APIRoute = async ({ url }) => {
  if (!import.meta.env.DEV) return new Response('Not found', { status: 404 });
  const token = createSessionToken({ userId: 'dev-capture', username: 'DevCapture',
    franchiseId: url.searchParams.get('franchise') || '0001',
    leagueId: '13522', role: 'owner' });
  return new Response('{"ok":true}', { headers: { 'Set-Cookie': createSessionCookie(token, true) } });
};
```

Playwright hits this once per context (`page.goto('/api/dev-login')`) to pick
up the `Set-Cookie`, then navigates to the real page. Works because
`JWT_SECRET` is per-process in dev (random per boot per CLAUDE.md's "Local
env" section) — minting inside the same running dev server process is the
only way a signed token validates.

**Recommendation:** Never commit this route. Delete it as the last step
before `git add`, and grep the diff for `dev-login` before pushing to make
sure it didn't sneak in.

---

## 2026-07-06 - Playwright harness gotchas specific to this environment

**Context:** Building a reusable `capture.mjs` for light+dark pairs.

1. **`chromium.launch()` needs an explicit `executablePath`.** The
   preinstalled browser lives at `/opt/pw-browsers/chromium` (a symlink); the
   default Playwright install-path lookup doesn't find it in this sandbox.
   Always pass `{ executablePath: '/opt/pw-browsers/chromium' }`.
2. **Scripts run from a scratchpad dir need a `node_modules` symlink** (or run
   from the repo root) — a scratchpad-local `.mjs` importing `playwright`
   fails `ERR_MODULE_NOT_FOUND` otherwise. `ln -s <repo>/node_modules
   <scratchpad>/node_modules` is enough; no package.json needed.
3. **`waitUntil: 'networkidle'` hangs forever once you're intercepting and
   `route.abort()`-ing external requests** — an aborted request still counts
   against "idle" in some cases and the retry/backoff on some third-party
   scripts (e.g. `cdn.vercel-insights.com`) never quiesces. Use
   `waitUntil: 'load'` plus an explicit `page.waitForSelector(knownContentSelector)`
   instead of trusting networkidle when route interception is in play.
4. **Remove `astro-dev-toolbar` before screenshotting** — the dev-only
   floating toolbar shows up in captures otherwise:
   `page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove())`.
5. **Kill known toast/status elements by ID, not by walking up N
   `parentElement`s matching on text content.** The lineup page's autosave
   toast is `#lineup-status`; hiding it directly (`el.style.display='none'`)
   is robust. An earlier attempt walked up 3 ancestors from any element whose
   `textContent` matched `/lineup saved/i` — fragile, and it didn't actually
   match the real toast markup (`#lineup-toast`), so the toast kept
   appearing in every capture until switched to the direct ID.
6. **Vend Sans (Google font) 403s in this sandbox** (`fonts.google.com` /
   `fonts.gstatic.com` unreachable) and Astro's font pipeline logs a warning
   but degrades to a fallback — cosmetically different from prod. Fix: `npm
   pack @fontsource/vend-sans`, extract the woff2s, `woff2_decompress` to
   ttf, drop into `/usr/share/fonts/truetype/`, `fc-cache -f`. **Gotcha:** the
   fontsource TTF's internal family name is `Vend Sans Light`, not `Vend
   Sans` — CSS references `var(--font-vend-sans), 'Vend Sans', ...` so without
   a fontconfig alias (`<match><test name="family"><string>Vend
   Sans</string></test><edit name="family" mode="assign"
   binding="strong"><string>Vend Sans Light</string></edit></match>` in
   `/etc/fonts/local.conf`) the browser silently falls through to the
   fallback stack instead of erroring — easy to miss unless you `fc-match
   "Vend Sans"` and check it resolves to the installed file.

---

## 2026-07-06 - Batch script needs a manual-capture skip-list, or it clobbers staged work

**Context:** `scripts/capture-whats-new-screenshots.mjs` recaptures any entry
whose image is missing or older than `whats-new.json`'s mtime. Left alone, an
unrelated JSON edit would re-trigger a blind capture of these six
entries — landing a sign-in screen (auth-gated), an empty analytics chart (no
prod access locally), or the wrong scroll position (trophy wall), silently
overwriting the hand-staged versions.

**Recommendation:** Any entry whose honest capture requires more than
"navigate and screenshot" (auth, prod-only data, non-default scroll/hook)
belongs in a `MANUAL_CAPTURE_ONLY` set in the batch script, excluded from
default runs and only recaptured when named explicitly on the CLI. Document
*why* each entry is on the list right next to the set definition — the reason
(auth-gated vs prod-only vs staged-scroll) determines what a future recapture
needs to do differently from a normal run.

---

## 2026-07-08 - Cloud-session capture: pinned-browser mismatch, no `cwebp`, and self-referential shots

**Context:** Capturing the `homepage-whats-new-section` pair from a fresh cloud
clone (no `.env`, project pins a newer Playwright than the image ships).

**Insights, in the order they bit:**

1. **Browser build mismatch.** `chromium.launch()` failed looking for
   `chromium_headless_shell-1200` while `/opt/pw-browsers` only had `-1194`.
   Do NOT `npx playwright install` (the env blocks the download). Launch with
   `executablePath: '/opt/pw-browsers/chromium'` (a symlink to the full
   `chrome` binary) — matches the environment note and works headless.
2. **`cwebp` is absent** but `sharp` is a dependency. The committed batch
   script shells out to `cwebp` and silently leaves the `.webp` unwritten if
   it's missing (build then fails the on-disk image check). For a one-off,
   screenshot to PNG in Playwright and convert with
   `sharp(png).webp({ quality: 85 }).toFile(out)` — no `cwebp` needed.
3. **A one-off script must live inside the repo**, not the scratchpad — Node
   resolves `node_modules` by walking up from the script's dir, so a
   `/tmp/...` script can't import `playwright`/`sharp`. Write it to repo root,
   run, delete before committing.
4. **Self-referential entries need two capture passes.** The section's shot
   contains the entry's own What's New card, whose thumbnail is *this very
   image*. On the first pass the file doesn't exist yet, so that card renders
   its `imageAlt` as broken-image text. Re-run once after the file is written
   and the card shows a real (one-level-nested) thumbnail. Always eyeball the
   result — a broken-alt card is the tell you only ran it once.
5. **The batch script now honors `PLAYWRIGHT_CHROMIUM_PATH`** (added during
   the best-ball launch capture): set it to `/opt/pw-browsers/chromium` in
   cloud sessions and `capture-whats-new-screenshots.mjs` launches the
   pre-installed browser instead of dying on the revision mismatch. Insight
   #2 (cwebp absent → convert the kept PNGs with `sharp`) still applies —
   the script writes `.png` fallbacks and you finish the pair manually.
