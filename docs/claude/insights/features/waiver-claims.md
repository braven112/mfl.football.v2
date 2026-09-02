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

## Two things the window logic still gets wrong when the calendar is missing

`resolveWaiverWindow` returns `unknown` when it has no events, and both the modal
and the route then fall back to the QUEUED claim rather than an immediate add —
correct, since a bounced claim is recoverable and an unintended instant pickup is
not. But note the asymmetry that produced: for the whole period `calendar.json`
was unsynced, an FCFS-window pickup was filed as a `waiverRequest` into a round
nobody processes. The fallback is safe; it is not *harmless*, and "unknown" being
the permanent state is a bug in the feed, not a resting position.

Note also that the SERVER re-derives the window live from MFL's calendar with the
owner's own cookie, so it can disagree with the page — deliberately, because the
page's copy is a build-time feed and the endpoint choice must not be trusted from
the client.
