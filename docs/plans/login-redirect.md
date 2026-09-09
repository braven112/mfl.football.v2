# Sign-in return paths — plan

**Status:** stages 1-4 SHIPPED (the core). Stages 5-9 not started.
**Branch:** `claude/login-redirect-feature-v2049a`

## Goal

Anywhere the site says "you need to be signed in", the visitor lands on their
league's sign-in page, signs in, and is returned **to the page they were trying
to reach** — in TheLeague, the AFL, Best Ball, and any league added later
without touching this code again.

Partial support for this already exists. It is inconsistent, it is copy-pasted
three times, and six gates drop the return path entirely. This plan makes it one
mechanism.

---

## Decisions (confirmed with Brandon, Sep 2026)

| Question | Decision |
|---|---|
| Scope | All four surfaces: page gates, "Log in" links/buttons, the PWA installed-app gate, and expired-session API 401s |
| Param name | Standardize every **emitter** on `?next=`; login pages keep **reading** `?redirect=` forever for links already in the wild |
| Admin gates | Split the two cases: signed **out** → sign-in with return path; signed **in but not authorized** → a real 403 page ("You didn't ask Roger first") |
| Cross-league | Honor the return path as long as it is inside the league just signed into |
| 401 recovery | Reuse the existing `SignInModal` + `requestSignIn()` + sessionStorage-park pattern, generalized |
| Context message | Sign-in page says *why*, derived from the return path via `page-directory.json` |
| Roger 403 copy | The joke stays the HEADLINE; the real reason sits underneath it |

---

## Current state — what is actually broken

### 1. Three param names, two mechanisms

| League | Gates emit | Login page reads |
|---|---|---|
| TheLeague | `?redirect=` | `redirect` \|\| `next` |
| AFL | `?next=` — except `throwback-settings.astro:27`, which emits `?redirect=` | `next` \|\| `redirect` |
| Best Ball | `?next=` | **`next` only** |

The AFL's odd one out works purely by luck (its login page happens to accept
both). Best Ball is the live hazard: a `?redirect=` link to `/best-ball-1/login`
is **silently dropped** and the owner lands on the league home.

Worse, the two leagues resolve the redirect by *different mechanisms*.
`afl-fantasy/login.astro:52` and `best-ball-1/login.astro:36` pass
`redirectUrl={safeNext}` as a prop to `LoginForm`. TheLeague's login page
**never passes the prop at all** — it computes `safeRedirect` and uses it only
for the already-signed-in short-circuit (`theleague/login.astro:31`), then
relies on `LoginForm`'s client-side sniffing of `window.location.search`
(`LoginForm.astro:160-161`) to do the real work. Two code paths, one of which
is invisible unless you read the component.

### 2. Six gates carry no return path at all

- `theleague/draft/mock/[sessionId].astro:25`
- `theleague/draft/mock/[sessionId]/results.astro:14`
- `afl-fantasy/draft/mock/[sessionId].astro:29`
- `afl-fantasy/draft/mock/[sessionId]/results.astro:19`
- `best-ball-1/login.astro:22` (already-signed-in short-circuit ignores `next`)
- plus every "Log in" link below

A mock-draft deep link is exactly the case where the return path matters most —
the session id is not guessable, so losing it strands the owner.

### 3. "Log in" links and buttons that go nowhere useful

- `nav/NavFooter.astro:66` — the footer sign-in link, on every page
- `theleague/hp-sections/HpTeamSnapshot.astro:121`
- `theleague/hp-sections/HpUnsignedFaCard.astro:237`
- `afl/hp-sections/AflTeamSnapshot.astro:265` — hardcodes `/afl-fantasy/login`
- `shared/draft-mock/DraftMockLobby.astro:177`
- `shared/preferences/PreferencesPage.astro:180`
- `shared/SchefterWhisperBack.tsx:69` — uses `?redirect=`, and builds the URL
  by string concatenation rather than through the path helper

`sunday-ticket/SundayTicketPage.astro:361,368` is the one that already does it
right — `?next=` with an encoded pathname. It becomes the reference shape.

### 4. The PWA gate sends AFL owners to TheLeague

`TheLeagueLayout.astro:376-386`, the installed-app auth gate:

```js
var loginPath = path.startsWith('/theleague') ? '/theleague/login' : '/login';
```

`/login` 301s to `/theleague/login` (`pages/login.astro:2`). So an AFL or Best
Ball owner whose session expires in the installed app is bounced to **the wrong
league's sign-in**, signs in, and is scoped to the wrong league. It also can't
see the apex-host case at all (see Risk 1). This is a league-literal violation
of the kind `tests/league-literal-guard.test.ts` exists to stop; it survives
because the literals are inside an `is:inline` script string.

### 5. Admin gates bounce silently

`admin/index.astro:17`, `admin/schedule-builder.astro:25`,
`admin/cutdown-report.astro:51`, `admin/schefter.astro:27`,
`admin/accounting.astro:33`, `contracts/franchise-tags.astro:11`,
`schedule-release.astro:26`, and the AFL twins of the last two.

Every one collapses "signed out" and "not an admin" into the same
`Astro.redirect('/theleague')`. A commissioner who follows an admin link with an
expired session is dumped on the homepage with no explanation and no way back.

### 6. `LoginForm`'s `document.referrer` fallback

`LoginForm.astro:163-169`: with no param, it falls back to
`sessionStorage.loginRedirectUrl || document.referrer`, and writes whatever it
finds back into sessionStorage.

The final redirect **is** sanitised (`LoginForm.astro:225-236` strips
cross-origin, protocol-relative and scheme-only values, defaulting to
`/theleague`), so this is not an open redirect. But it has two real bugs:

- **Cross-league leak.** The sanitiser only checks "same-origin path", not
  "path in *this* league". A stale `loginRedirectUrl` of `/theleague/lineup`
  parked from an earlier visit will happily be used after an **AFL** sign-in.
- **Wrong-league default.** The fallback is the literal `'/theleague'`, so a
  failed sanitise on the AFL login page lands the owner in TheLeague.

---

## Design

### One module: `src/utils/login-redirect.ts`

Everything above is three copies of the same twelve lines. This replaces them.

```ts
/** Build the sign-in URL for a gate. The ONLY way to construct one. */
export function loginUrlFor(opts: {
  league: League;            // from the registry — never a slug literal
  returnTo: string;          // usually Astro.url.pathname + Astro.url.search
  hideLeaguePrefix: boolean; // Astro.locals.hideLeaguePrefix
}): string;

/** Validate a return path against the league being signed into. */
export function safeReturnPath(
  requested: string | null | undefined,
  league: League,
): string | null;

/** The league home, used whenever safeReturnPath returns null. */
export function loginFallbackPath(league: League): string;
```

`safeReturnPath` rejects, in order: empty; not starting with `/`; starting with
`//` (protocol-relative); containing `://` or a `\` ; and finally any path not
inside this league's own prefix **or** its clean apex equivalent. The last check
is what makes the cross-league answer correct and kills bug 6.

Because the league comes from the registry, **a fourth league gets all of this
for free** — which is the CLAUDE.md registry rule, and what
`tests/rankings-scope.test.ts` already does for rankings buckets.

### Emitters

Every gate becomes one line:

```astro
if (!user) return Astro.redirect(loginUrlFor({ league, returnTo, hideLeaguePrefix }));
```

### Login pages

All three read through `safeReturnPath`, and — the fix for defect 1 — all three
pass `redirectUrl` to `LoginForm` explicitly. TheLeague stops depending on the
client-side sniff. The sniff stays as a fallback for the modal case, but with
the league-aware validator instead of the `'/theleague'` literal.

### The 403 page — "You didn't ask Roger first"

New shared component + thin route wrapper per league (the
`division-strength.astro` shape mandated by CLAUDE.md, so
`tests/page-fork-ratchet.test.ts` stays happy).

- Roger's portrait: `public/assets/schefter/roger-avatar.webp` (already shipped,
  already used by the Schefter feed)
- Copy in the league's editorial voice, headline **"You didn't ask Roger first."**
- Real **403** status, not a redirect — so the URL stays put and is shareable
  back to the commissioner
- CTAs: *Ask Roger* → the rules-chat page, and *Back to <league>*
- Reuses the 404's league resolution (`404.astro:12-17`) so it lands the right
  league on the right apex host
- Theme tokens only — a `var(--x)` with no definition renders its fallback in
  both themes, per `docs/claude/rules/theming-and-assets.md`

Gates split into:

```astro
if (!user) return Astro.redirect(loginUrlFor({...}));      // signed out
if (!isCommissionerOrAdmin(user)) return forbidden(Astro); // signed in, not admin
```

### Context message on the sign-in page

`page-directory.json` already carries a `title` for every page keyed by `path`.
The login page looks the return path up and prints **"Sign in to reach Set
Lineup"**. No per-gate wiring, nothing new to remember, and it degrades to the
bare form when the path is not in the directory (mock-draft session ids, etc.).

### 401 recovery

`requestSignIn()` + `SignInModal` + the sessionStorage park already implement
this end-to-end for waiver claims (`src/utils/claim-resume.ts`). The work is
**generalizing the park**, not building a mechanism:

- One `resumeAfterSignIn(key, payload)` / `consumeAfterSignIn(key)` pair,
  with `claim-resume.ts` reimplemented on top of it so there is one
  implementation, not two (same objection as `buildAttributor`)
- A shared `handle401(res)` helper for client fetches. Today six call sites each
  invent their own string (`watch-list-client.ts:117,184`,
  `groupme-client.ts:114`, `OwnersPollLive.tsx:69`,
  `contracts/manage.astro:527`, `SchefterWhisperBack.tsx:54`)
- Server side: the three routes that answer
  `'Authentication required. Please sign in.'` get a machine-readable
  `code: 'auth_required'` so the client isn't matching on prose

---

## Work breakdown

| # | Stage | Touches |
|---|---|---|
| 1 | ✅ `login-redirect.ts` + its unit tests | 1 new file, 1 new test (51 cases) |
| 2 | ✅ All 15 page gates on `loginUrlForRequest`; every emitter now writes `?next=` | 15 files |
| 3 | ✅ All three login pages read via `resolveLoginDestination`, all pass `redirectUrl` | 3 files |
| 4 | ✅ `LoginForm`: referrer/sessionStorage chain removed, league-aware fallback | 1 file |
| 5 | "Log in" links and buttons carry `?next=` | 7 files |
| 6 | PWA gate becomes registry-driven | `TheLeagueLayout.astro` |
| 7 | Roger 403 page + split the admin gates | 1 component, ~6 wrappers, ~9 gates |
| 8 | Generalized resume + `handle401` | ~8 files |
| 9 | Guard tests, page-directory entries, What's New | tests + data |

Stages 1-4 are the core and shipped together. Verified against a running dev
server: all 15 gates 302 with the right `?next=`, all three login pages render
the destination into the form, query strings survive, cross-league and
`//evil.com` return paths fall back to the CORRECT league home.

**Two things stage 2 did NOT cover, deliberately** — they are stage 5 (links
and buttons), and both still work because `?redirect=` stays readable:

- `src/utils/player-actions.ts:145` builds its login URL by string
  concatenation and emits `?redirect=`.
- `afl-fantasy/trade-builder.astro:294` and `afl-fantasy/rosters.astro:1271`
  hardcode `?next=` links rather than going through the helper.

The stage-9 emitter guard cannot land until those three move over.

## Guard tests

Prose rules in this repo rot; the ones with tests don't. Proposed:

- `tests/login-redirect.test.ts` — the validator: cross-league paths rejected,
  `//evil.com` rejected, apex-clean paths accepted, every registry league has a
  working prefix (fails when league #4 is added without one)
- `tests/login-redirect-guard.test.ts` — a **scan** guard, the `/guard-test`
  shape: no file under `src/` may emit `?redirect=` in a login URL, and no
  `Astro.redirect('...login')` may be built by string concatenation. This is
  what stops gate #21 from reintroducing the split
- `tests/admin-gate-403.test.ts` — no admin gate answers a signed-out user and
  an unauthorized user the same way

Wire all three into `.claude/hooks/path-guard.json` under a new `auth` domain
pointing at a new `docs/claude/rules/auth-redirects.md`, so the next person
editing a gate gets the rules doc injected automatically.

## What shipping stages 1-4 turned up

Three things worth recording, because they will bite the later stages too:

1. **A four-line gate is a page-size regression.** Spelling the gate out as an
   object literal pushed `theleague/draft/mock/[sessionId].astro` from 73 to 81
   lines, crossing the 80-line fork threshold in
   `tests/page-fork-ratchet.test.ts` — the ratchet correctly reading "this page
   grew" as "this page is forking". Hence `loginUrlForRequest(Astro, league)`,
   which keeps every gate to ONE line. Net cost per page is now the import
   alone.
2. **`astro check` does not catch a missing import in `.astro` frontmatter
   reliably.** A dropped `getLeagueBySlug` import in
   `theleague/draft/mock/[sessionId].astro` passed the type baseline and 10,301
   unit tests, and only showed up as a **500** when the page was actually
   requested. Curl every touched route before believing a green suite.
3. **The type baseline is a real signal, not a formality.** It caught a missing
   import in `afl-fantasy/login.astro` as +1 (1741 → 1742). Fixed rather than
   absorbed; the baseline is unchanged at 1741.

## Risks / things to get right

1. **Apex hosts — handled, but NOT verified live.** `safeReturnPath` normalizes
   both shapes to the prefixed form and `loginUrlFor` re-applies the host's
   visibility, so the gate is correct whether `Astro.url.pathname` arrives
   prefixed or clean. Six unit tests pin that round-trip in both directions.
   What could NOT be exercised locally: Vite's dev server answers **403** to an
   unrecognized `Host:` header, so the real `theleague.us` path was never
   driven end-to-end. The middleware wiring that sets `hideLeaguePrefix` is
   untouched by this change, and `throwback-settings.astro` already depends on
   it the same way — but this is the one claim resting on tests rather than on
   a live request. Check it on the preview deployment's apex alias.
2. **`Astro.redirect()` only redirects from a page.** The 403 must be returned
   by each thin route wrapper, never from the shared component — CLAUDE.md's
   `/cr` note; the same mistake shipped a blank page once already.
3. **Cookies.** The login page writes no cookies from a component. `LoginForm`
   is imported, so nothing in this plan may add an `Astro.cookies.set()` to it.
4. **Sibling drift.** Stages 2, 5 and 7 all touch AFL/TheLeague twins. Run
   `scripts/sibling-drift.mjs` before the PR.
5. **What's New.** This is user-facing, so it needs an entry with a screenshot,
   league-neutral inline links, and `excludeFromHero` — it's an `enhancement`,
   so hero is off by default.
6. **The 403 page needs page-directory entries?** No — `visibility` has no
   "never" value and an error page should not be searchable. Confirm before
   skipping, since nothing enforces the omission either way.

## Open question for Brandon

Verified while writing this: both leagues have a Roger page
(`theleague/rules-chat.astro`, `afl-fantasy/rules-chat.astro`) and both have an
`admin/` directory. **Best Ball has neither** — no admin pages, no Roger — so
the 403 page is TheLeague + AFL only, and Best Ball needs nothing here.

That leaves one judgment call: the Roger 403 is a *joke about asking the
commissioner first*, and it fires on genuine permission denials. Is that the
right tone for, say, an owner who followed a stale admin link from a GroupMe
message — or should the copy stay playful but make the actual reason
("this page is commissioner-only") unmissable underneath the gag?
