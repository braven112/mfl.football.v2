# Waiver Claims

Insights for the native claim builder — `src/pages/api/waiver-claim.ts`,
`src/utils/waiver-claim.ts`, `src/utils/waiver-window.ts`,
`src/components/shared/WaiverClaimModal.astro`, and the Claim/Bid column on both
Free Agents pages. Shipped in #677 (2026-09-01); every insight below is a bug
found in it the day after.

The MFL-side auth story (why `calendar.json` had never synced) is in
`domains/mfl-api.md`, 2026-09-02.

## 2026-09-02 - "MFL Answered" Is Not "MFL Stored It" — And The Read-Back Was Disabled In The Only Case It Mattered

**Context:** Brandon filed an AFL claim, the modal said "Submitted ✓", nothing
was on MFL. Reproduced with a session carrying a nonsense `MFL_USER_ID`: the
route returned `{"success":true,"message":"Round 1 submitted — 1 claim.",
"confirmed":[]}` and the modal closed.

**Insight:** the route had *both* halves of the right idea and neither worked.

1. The write was gated on `!res.ok || /<error/i.test(text)`. MFL refused the
   import with **HTTP 200 and an empty body** — no `<error>` to match, so it
   read as success. The general rule (require an affirmative
   `<status>OK</status>`) was already in `domains/mfl-api.md`; this route had
   simply never adopted it. `readMflImportResult`
   (`src/utils/mfl-import-result.ts`) is now the shared classifier.
2. There *was* a read-back — `export?TYPE=pendingWaivers` — written precisely
   because a 200 proves nothing. It was gated
   `stored.length > 0 && !stored.includes(id)`, so an **empty** result made
   `unconfirmed` empty and the round reported clean. A dropped write produces
   exactly an empty result, so the verification was inert in the one case it
   existed for. `confirmed: []` was in the response payload the whole time and
   nothing read it.

**The distinction that fixes it:** "could not verify" and "nothing is there" are
different answers and must not share a representation. `readPendingWaiverPlayerIds`
returns `null` for the former and `[]` for the latter; the route returns a
`verified` flag alongside `success`, and the modal shows a caveat instead of a
checkmark when `verified === false`. `success` now means only "MFL
acknowledged"; `verified` means "we read it back out".

**Deliberately loose:** that parser walks the `pendingWaivers` subtree collecting
id-shaped values rather than pinning a key path, because MFL's shape here is
undocumented and unverified against a live owner-authenticated payload. The bias
is one-directional on purpose — a loose match can only let a real failure go
unreported, while a too-narrow one tells an owner their good claim failed. Pin
the real shape when a genuine claim is available.

## 2026-09-02 - A Class Name Is Not A Style — The AFL's Claim Button Shipped As Raw Browser Chrome

**Context:** the AFL Claim button rendered `background: rgb(107,107,107)`,
`border: 2px outset white`, `border-radius: 0`, `font-family: Arial` — a beveled
grey system button in a dark table.

**Insight:** `afl-fantasy/players.astro` emitted `class="place-bid-link
claim-open"` while every rule for `.place-bid-link` lived inside
`theleague/players.astro`'s scoped `<style>`. Not a scoping bug — a **missing
copy**. This is the page-fork rule from CLAUDE.md applied to CSS, and it is
invisible in a diff that only touches the AFL page.

`tests/players-injected-styles.test.ts` had existed since #677 and passed
throughout, because it read only TheLeague's `<style>` block. **A guard that
checks one of a sibling pair certifies the half that was already right.** It now
runs `describe.each` over both pages plus the shared stylesheet.

The fix is `src/styles/fa-claim-button.css`, imported from both pages'
frontmatter (frontmatter, because rows are injected via `innerHTML` and carry no
scope attribute). Colour comes from `--league-accent`, which `tokens.css`
defines as `var(--color-primary)` for TheLeague — so extracting it was
byte-identical there — and overrides per league, with dark values in
`tokens-dark.css`. A shared component styled from a league-specific literal is
the same bug one layer down.

## 2026-09-02 - `p.rostered` Means "Held In EVERY Conference", Not "Held Here"

**Context:** with "Include rostered" on, the AFL page offered Claim buttons on
players already rostered in the viewer's own conference — claims the server
correctly 400s with "that player is not a free agent".

**Insight:** the row builder gated the button on `p.rostered` under a comment
asserting that flag was conference-scoped. It is not:
`afl-free-agents-live.ts` sets `rostered: confs.length === confCount`. The
conference-scoped predicate is the row's own `isRosteredForView()`, which exists
for exactly this reason and which every other cell in the row already used. In a
duplicate-player league, any availability question answered with `p.rostered` is
answering a different question — see `afl-free-agents.md` (2026-08-08).

## 2026-09-02 (later) - WAIVER_LOCK OPENS The Window. The Resolver Had It Backwards.

**Context:** the calendar synced, the page immediately said "first come, first
served", and Brandon said no — waivers are active, he had moved the processing
date so the AL could claim around the NL draft.

**Insight:** `WAIVER_LOCK` / `WAIVER_UNLOCK` name the state of the **free agent
pool**, not the state of the claim window, and `resolveWaiverWindow` read them
as the claim window. Locking the pool is precisely what OPENS waivers — nobody
can take a player outright any more, so a claim is the only way in. Unlocking it
is what ends them. Both constants were inverted:

```
OPEN_TYPES     was WAIVER_UNLOCK   →  is WAIVER_LOCK
PROCESS_TYPES  was …, WAIVER_LOCK  →  is …, WAIVER_UNLOCK
```

**How to settle this kind of question without guessing:** the transaction log
records what MFL actually DID, and the calendar records what it was told to do.
Line them up. From `data/afl-fantasy/mfl-feeds/2025/transactions.json`:

| 2026 calendar event | 2025 transaction it produced |
|---|---|
| `WAIVER_LOCK` Mon 6:00 PM ×17 | `LOCK_ALL_PLAYERS` — Mon 6:00 PM, weekly |
| `WAIVER_REVERSE` Wed 8:00 PM ×14 | `AUTO_PROCESS_WAIVERS` + the `WAIVER` awards — Wed 8:00 PM |

To the minute. And the pool being shut is visible independently: `FREE_AGENT`
adds collapse to 5-11 a season on Mon/Tue against 100+ on Wed-Sun.

**The structural tell, which needed no data at all:** under the old mapping both
LOCK and REVERSE closed the window, and the AFL's only `WAIVER_UNLOCK` all
season is one event on 2026-09-07. So from that date the resolver could never
have returned `waiver` again — a league with weekly waivers reading FCFS for
seventeen straight weeks. Any mapping that makes a recurring state unreachable
is wrong on its face.

**Why nothing caught it:** `tests/waiver-window.test.ts` asserted the inverted
model in its fixtures, so it was self-consistent and green. The one block that
would have failed — `the REAL synced calendar` — was SKIPPING for want of
calendar.json, and had been since it was written. A guard that skips is not a
guard, and the "reports whether the calendar has been synced yet" console.warn
was the only thing saying so.

**And its own assumptions were too strict** once it finally ran: it asserted
every in-season processing run is Wednesday evening. Real calendars carry
deliberate one-offs — a Monday run on Sep 7 2026 (Labor Day, set so the AL could
claim around the NL draft) and a Tuesday run on Dec 29 in the playoff weeks. It
now checks the recurring series for the weekday cadence and asserts the SHAPE
for every run: between a lock and its run you are on waivers, an hour after a
run you are not. Derived from real pairs, with no weekday or clock time written
down, so a commissioner moving a date does not turn a test red.

## The `unknown` fallback, and why it stopped protecting anything

`resolveWaiverWindow` returns `unknown` when it has no events, and both the modal
and the route then fall back to the QUEUED claim rather than an immediate add —
correct, since a bounced claim is recoverable and an unintended instant pickup is
not. But note the asymmetry that produced: for the whole period `calendar.json`
was unsynced, an FCFS-window pickup was filed as a `waiverRequest` into a round
nobody processes. The fallback is safe; it is not *harmless*, and "unknown" being
the permanent state is a bug in the feed, not a resting position.

**And it stops protecting you the moment the feed works.** An empty calendar
fails safe; a calendar read with an inverted mapping fails CONFIDENTLY, and it
took syncing the feed to expose that. Fixing the input to a piece of logic that
has never once run on real input is not the end of the job — it is the first
time the logic is on trial.

Note also that the SERVER re-derives the window live from MFL's calendar with the
owner's own cookie, so it can disagree with the page — deliberately, because the
page's copy is a build-time feed and the endpoint choice must not be trusted from
the client.

## 2026-09-03 - Every Way MFL Lets An Owner Touch A FILED Claim (And Why Reordering Is Delete-And-Refile)

Established by read-only probe against a real filed claim, plus one live write
test, rather than from the docs — which are wrong about the important part.

**The round is ONE record, not N.** `export?TYPE=pendingWaivers` returns:

```json
{ "pendingWaivers": { "waiverRequest": {
    "timestamp": "1788405970", "addsDrops": "15889_14059",
    "comments": "", "round": "1" } } }
```

`addsDrops` is a comma-separated ORDERED list of `add_drop` pairs. So priority
within a round is literally the order of that string, and MFL appends new claims
to the end.

**`import?TYPE=waiverRequest` + `REPLACE=1` is INERT for this league.** MFL
documents it as "replaces the current entries", which would make reordering one
atomic call. It is not. Tested live 2026-09-02 by replaying an existing claim's
own picks unchanged:

```
BEFORE  addsDrops "15889_14059"  timestamp 1788405970
POST    import?TYPE=waiverRequest … REPLACE=1  →  200, empty body
AFTER   addsDrops "15889_14059"  timestamp 1788405970   ← unchanged
```

Empty 200, and the TIMESTAMP DID NOT MOVE. That is the discriminator worth
stealing: for an endpoint that echoes nothing, replay a write that should be a
no-op and watch a field MFL controls. Same picks proves nothing; same timestamp
proves it never wrote.

This also retro-explains the original outage. The import endpoint was never
formed wrong — it does not write here at all.

**What the page actually offers**, from the claims table on `add_drop`:

| Control | Target | Effect |
|---|---|---|
| Edit | `options?L=…&O=255&F=<franchise>&ROUND=<n>` | POST `form_name=editwr`, `ROUND`, `drop_0..N`, `comment`, `SAVE=Save Waiver Request`. **Drop and comment only** — the add is fixed text and there is NO order field. |
| Copy To Round N | `add_drop?L=…&F=…&COPY_ROUND=<round>_<add>_<drop>_<toRound>` | Plain GET. |
| Delete | `add_drop?L=…&F=…&DELETE=<round>_<add>_<drop>` | Plain GET. |
| File a claim | POST `add_drop` + `FORCE_WAIVER=on` + `SUBMIT=Submit Request` | Appends to the END of the round. |

**So MFL exposes no reorder control at all.** Ordering is insertion order, and
the only way to change it is DELETE the claims and refile them in the wanted
sequence. Anything built on top of that must own the consequence: between the
delete and the refile the owner has no claim, so it needs to run server-side in
one request, verify against `pendingWaivers` afterwards, and attempt to restore
the original order if a refile fails. Deleting first and hoping is not
acceptable during a live window.

The cheap, safe subset — worth shipping before any reorder UI — is **edit the
drop** (one POST to `editwr`, no destructive step) and **delete a claim** (one
GET), both of which map to a single MFL primitive with no window of loss.

## 2026-09-03 - Scoped CSS And Injected Rows, For The Third Time — Use A Plain Stylesheet

**Context:** the Waiver Priority modal shipped its shell correctly styled and
its team list as unstyled 50px icons, from the same `<style>` block.

**This is a known trap, and that is the finding.** `frontend.md`'s curated head
already says scoped CSS dies on markup the component didn't emit, and the
archive already carries two dated cases of it (`set:html` icons, KeeperPlanner's
rebuilt slots). It was hit anyway, in a component sitting next to
`waiver-claims-panel.css` — a file that exists for precisely this reason.

**What is worth adding is the third remedy.** The documented fixes are
`:global()` re-anchoring (for injected children under a stable scoped parent)
and `<style is:global>` (when a script rebuilds whole subtrees). Neither is
right for a component whose list, rows AND trigger are all outside its own
template: `:global()` ends up on nearly every selector, which is a stylesheet
wearing a disguise. **Put the rules in a plain `src/styles/*.css` imported from
frontmatter** — global by construction, greppable, and what the panel next door
was already doing. Added to the frontend head.

Quick test for which remedy you need: count the selectors that would need
`:global()`. One or two, use it. Most of them, you wanted a stylesheet.

## 2026-09-03 - `Number('')` Is 0, And 0 Sorts To The Front Of The Waiver Order

**Context:** `readWaiverSortOrder` guarded its parse with
`Number.isFinite(Number(f.waiverSortOrder))`, which reads as careful and is not.

**Insight:** `Number('')` is `0`, and so is `Number(' ')` and `Number(null)` —
all finite, all passing the guard. A franchise MFL sent with an empty
`waiverSortOrder` therefore parsed as order **zero** and sorted ahead of the
team that actually holds first claim. The lie is worse than an omission: the
modal exists to tell an owner how many teams pick before they do, and this
silently inserts a phantom at the front of that count.

`tests/waiver-order-display.test.ts` pins it. The parse now requires a number,
or a string with something in it, before trusting the coercion — and the entry
is DROPPED rather than defaulted, because "we don't know this team's priority"
and "this team is first" must never share a representation. Same distinction as
the `null`-vs-`[]` one in the pendingWaivers reader above; it keeps coming up
because MFL's payloads are full of empty strings.

## 2026-09-03 - The Two Halves Of A Sign-In Resume Are Never On The Page Together

**Context:** clicking Bid while signed out now opens an on-site sign-in instead
of deep-linking to MFL. It parks the player id, reloads after login, and reopens
the claim form on that player. Both halves were written inside `SignInModal`,
where they read as one tidy feature. The resume never fired once.

**Insight:** `SignInModal` renders only when the visitor is signed **out**.
`WaiverClaimModal` renders only when they **can claim**. Those two conditions
are mutually exclusive by construction — which is the entire point of the
feature — so the code that reads the parked id was absent from precisely the
page load that had one to read. It failed silently in the worst way: the id sat
in `sessionStorage` unclaimed, ready to pop a modal on some unrelated later
visit.

The fix is `src/utils/claim-resume.ts`: `rememberPendingClaim` imported by the
signed-out component, `resumePendingClaim` by the signed-in one, one key in one
file. **When a flow spans a state change that re-renders the page, its two ends
belong in a module, not in whichever component owns the first half.** The read
is also read-and-clear in one step, so a click that never lands can't resurrect
the modal a week later.

Related, and the reason a reload is involved at all: whether an owner may claim
is decided in SSR frontmatter and the Claim column is not in the DOM for a
signed-out visitor, so closing the dialog on success would leave them staring at
the same page with no button. `LoginForm`'s `redirectUrl` carries the current
path, which makes it a reload rather than a bounce to a league home.

## 2026-09-03 - A Global Heading Rule Out-Specifies A Parent's `color`

**Context:** the priority modal's `<h3>` rendered near-black on the accent
band, while the `<p>` subtitle two lines below it — same parent, same inherited
`color: #fff` — was correctly white.

**Insight:** inheritance is the weakest source of a value. The parent's `color`
only reaches a child that has no rule of its own, and the global stylesheet sets
a colour on `h1`-`h6`; that rule beats inheritance outright, no specificity
contest required. The paragraph had no such rule, so it inherited and looked
fine, which is what made the header look like a one-off glitch rather than a
category of bug.

**Rule:** any heading placed on a coloured band needs its colour set
explicitly. Do not rely on the band's own `color` to carry it, and do not
conclude the band is fine because the non-heading text on it is.

## 2026-09-03 - The Token Guard Would Have Caught It In 40ms; I Used My Eyes Instead

**Context:** the modal's body text rendered near-black on dark navy, from
`color: var(--content-text, #111827)` — a token invented by analogy with the
real `--content-bg` and `--content-text-muted`. Found by opening dark mode and
squinting at it.

**Insight:** `tests/design-token-guard.test.ts` fails on any `var(--token)` in
`src/` that is defined nowhere in `src/`, which is exactly what this was. It
runs in milliseconds. It never saw the bug only because I fixed it by eye
before the next `pnpm test:unit` — so the guard's value here was zero, for no
reason other than ordering.

`--content-text` specifically has been hit before: `src/styles/my-rank-editor.css:49`
carries the comment *"--color-gray-900, not --content-text: the latter is not a
token here"*. Two independent authors invented the same plausible name.

**Workflow rule, not a CSS rule:** after writing any block of new CSS, run
`pnpm vitest run tests/design-token-guard.test.ts` before you open a browser.
It is instant and it answers "does this token exist" definitively, which
eyeballing a rendered page does not — the fallback renders, so a page with an
invented token looks *fine* in one of the two themes.

The guard's own doc header is honest about what it does NOT cover: a token
defined only in some other file's scoped block satisfies it repo-wide while
still rendering the fallback for you. That failure mode is row 2 of
`design-system.md`'s "Four ways a token fails" table and remains unguarded.

## 2026-09-03 - The Bid Button Dies After An In-Site Navigation (FIXED)

**Found while reviewing the waiver-priority PR, in code that PR did not touch.**

`WaiverClaimModal.astro` resolves `dlg`, `nameEl`, `band` and the rest at module
scope, then registers its delegated `.claim-open` handler over them. An Astro
component script is evaluated ONCE per document and ClientRouter swaps the DOM
without re-evaluating it — so after any in-site navigation back onto Free
Agents, every one of those references points at the previous page's detached
nodes. `dlg.showModal()` opens a dialog that is no longer in the document and
the Bid/Claim button appears to do nothing at all.

**Measured, not theorised.** Replacing `#waiver-claim-modal` with a fresh clone
and firing `astro:page-load` — exactly what ClientRouter does — then clicking
`.claim-open`: `liveDialogOpened: false`, player name still `—`. The same probe
against the fixed `WaiverPriorityModal` returns `open: true` with all 12 rows.

Reproduce it as a user: Free Agents → Rosters → back to Free Agents (in-site
links, no hard reload) → click Bid. Nothing happens until you reload.

**Why it was deferred out of that PR.** The repair is mechanical, but it wraps
~190 lines including the MFL submit flow, and a first attempt at it mid-review
corrupted the file. Restructuring a working submit path under a merge is how a
shipped feature breaks. It wanted its own change and its own verification.

**The fix, in its own change.** The shape came straight from
`WaiverClaimsPanel.astro`: the entire `if (cfg?.canClaim)` body moved inside an
`init()` registered on `astro:page-load`, and the delegated `.claim-open`
handler is held in a module-scoped `onDocumentClick` that is
`removeEventListener`ed before it is re-added. That last part is the whole
trick — remove-then-add yields exactly ONE listener *and* a closure over live
nodes, where a once-flag yields one listener over dead ones, which is the same
bug wearing a hat.

Three details that are load-bearing, not style:

- **The config blob is re-read inside `init()`, not next to the import.**
  `#waiver-claim-config` is swapped out like everything else, so a captured
  `cfg` is the previous page's rules, roster, balance and *year*. Verified by
  driving three simulated navigations with a deliberately different config each
  time: the bid minimum, increment, balance, roster size, round count and the
  `year` in the submitted POST body all tracked the current page's config.
- **`init()` is never called directly.** `astro:page-load` fires on the initial
  load too, so a direct call double-inits — and this component *appends* to the
  drop and round selects, so a double-init silently duplicates every option.
  (The first probe caught exactly this shape, as an artifact of cloning an
  already-initialised dialog rather than swapping in pristine server markup. If
  a probe's option counts grow, suspect the probe before the code.)
- **`resumePendingClaim()` moved onto `astro:page-load` too, and runs LAST.**
  Its first act is a *synchronous* click on the parked player's button, so the
  delegated handler has to be wired before it lands. It still sits outside the
  `canClaim` block, for the original reason: it is the only thing that clears
  the parked id. The comment explaining why it was pinned to module scope is
  gone — this bug was the entire reason.

**Measured after, the same way as before.** Three simulated ClientRouter swaps,
pristine markup each time: `open: true`, the player's name populated, option
counts exact, and `showModal` called exactly once per click (no stacking). The
submit path still POSTs the right payload to `/api/waiver-claim` and shows
"Submitted ✓". Against the pre-fix file the same probe returns `open: false`
with the name still `—` and `showModal` never called.

`tests/waiver-filed-claims.test.ts` now pins it: every `getElementById` and the
`resumePendingClaim()` call must appear after `function init()`, the
`astro:page-load` registration must exist, a bare `init();` must not, and the
click listener must be removed before it is added. Both new cases fail against
the pre-fix file.

**The general rule, now in `frontend.md`'s head and worth restating:** anything a
component script resolves at module scope is stale after the first ClientRouter
navigation. `document` survives the swap; every element inside it does not —
and that includes the `<script type="application/json">` config blob.


## 2026-09-03 - `BBID_AMT` — The One Field That Broke Every TheLeague Claim

**Context:** the queued-claim path was built and proven against the AFL. The
first time a TheLeague owner used it, MFL refused — and kept refusing, for every
owner, for as long as the route existed.

**MFL's answer, once the page was actually read for it:**

```
Error: invalid waiver request:
  Cannot Save Request: Invalid Bid Amount (bid amount must not include letters or symbols)
  Cannot Save Request: Bid amount ($) is below bid minimum ($425000)
```

The `($)` is MFL echoing back the empty value it read. Our POST body:

```
L=13522&add_settings=&PROJSRC=mfl&add_pid=8851&drop_pid=&FORCE_WAIVER=on&ROUND=1&COMMENTS=&SUBMIT=Submit+Request
```

**The two leagues do not share a form.** The AFL runs rolling waiver PRIORITY —
position in the order decides, so its `add_drop` has no amount box and none was
ever sent. TheLeague is blind-bid (`currentWaiverType: BBID_FCFS`) and its form
carries one. "It works in the AFL" was never evidence about TheLeague, and a
route that serves both leagues through one code path needs a test per SYSTEM,
not per league.

**The field is `BBID_AMT`, and it was not guessable.** MFL's own JS names the
wrapper `amt_field_id`:

```js
check_waiver_claim(this,'add_drop_submit','add_note_field_id','amt_field_id,round_field_id,comments_field_id')
```

and the sibling wrappers `round_field_id` / `comments_field_id` hold inputs named
`ROUND` and `COMMENTS`. So the convention points at `AMT`, and the English points
at `AMOUNT`. **Both are wrong.** This is the third time the curated rule "don't
ship inferred parameter names to a write endpoint"
(`docs/claude/insights/domains/mfl-api.md`) has paid for itself.

Full field list of the real form, for the next person:

```
L, add_settings, PROJSRC, add_pid, drop_pid,
FORCE_WAIVER (checkbox), BBID_AMT (text), ROUND (select), COMMENTS (textarea),
SUBMIT (submit)
```

Send `BBID_AMT` as **bare integer dollars** — MFL parses the field itself and
says so ("must not include letters or symbols"), so no `$`, no commas, no
decimals. Send it only when `rules.blindBid`; the AFL's form has no such field
and its claims work today.

**How to read the form when you need it again.** `scripts/inspect-mfl-form.ts`
needs `MFL_USER_ID`, which lives only in Vercel's environment — it is NOT in
`.env.local`, so `vercel env pull` does not supply it and the script cannot run
locally. The cheap path is the owner's own browser, anchored on an id you
already know rather than on where you think the box is:

```js
[...document.getElementById('add_drop_submit').form.elements].map(e => `${e.name} (${e.type})`)
```

That walks up from the submit button to its form, so it cannot be aimed at the
wrong element, and it lists hidden fields too — no need to tick FORCE_WAIVER
first. (The server can also do it: the session JWT carries the caller's MFL
cookie, so an admin-gated GET route can read the form as them. That was built
and thrown away here; the console one-liner was faster.)

**The reason this cost an afternoon is the error matcher, not the field.** MFL
named the cause in plain English in the page body, and the matcher only knew
`Transaction Would Create` and `Exceeds League Limit`. So the page classified as
"no error found", the `pendingWaivers` delta then reported the claim missing, and
the owner was told the generic "MFL did not record the claim". The route now
collects **every** `Cannot Save Request:` line — MFL emits one per problem and
the second is usually the actionable one — and returns MFL's own words.

**Generalize that.** A refusal this route cannot parse is indistinguishable from
a write that vanished, and both land on the same generic message. When adding a
new MFL write path, harvest the failure text FIRST: make it fail on purpose, read
what MFL says, and put that string in the matcher before shipping the success
path.
