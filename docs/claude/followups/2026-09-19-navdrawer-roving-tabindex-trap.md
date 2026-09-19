---
slug: navdrawer-roving-tabindex-trap
status: open
severity: low
opened: 2026-09-19
hotfix_pr:
hotfix_sha:
followup_issue:
followup_pr:
followup_session: session_014LMZSvKspuVopcY6BxuSb4
---

# Follow-up: NavDrawer's focus trap counts non-tabbable roving buttons

Deferred out of PR #1170 (`/live` step 5c — "a real refactor with its own
blast radius"). That PR fixed this bug class in MFL Live's new drawer; this
brief records the same class still sitting in the drawer that serves both
production league sites, which is not something to fold into a PR about a
different surface.

## What

`src/components/nav/NavDrawer.astro:503` collects the focus trap's candidates
with:

```js
'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
```

The `:not([tabindex="-1"])` qualifies only the bare `[tabindex]` term. A
`<button tabindex="-1">` is still matched by `button:not([disabled])`.

`NavFooter.astro:466` renders `<ThemeToggle size="compact" />` inside that
drawer, and `ThemeToggle` is an ARIA radiogroup on roving tabindex
(`tabindex={i === 0 ? 0 : -1}`) — so two of its three buttons are never
tabbable, and the trap counts both.

## Why it is NOT currently broken

`footerLinks` (`NavDrawer.astro:99`) is a hardcoded one-element array, so the
"Back to MFL" anchor always renders after the theme row and is always the last
element the selector matches. `lastFocusable` is therefore tabbable and the
wrap fires correctly.

**This is an accident of ordering, not a contract.** Make `footerLinks`
conditional, empty it, or move the theme row below it, and Tab from the last
real control stops wrapping — focus leaves the open drawer for the page behind
it, which on mobile is under a backdrop.

Severity is `low` for exactly that reason: latent, not live. It is filed
because the ordering that saves it is invisible from the trap code, so the next
person to touch the footer has no way to know they are load-bearing.

## The fix

Same shape as the one applied in PR #1170 — bare selector, predicate does the
filtering:

```js
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';
return Array.from(drawer.querySelectorAll(FOCUSABLE)).filter((el) =>
  !el.disabled &&
  el.getAttribute('tabindex') !== '-1' &&
  el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility !== 'hidden');
```

Note `getClientRects().length > 0` is **not** redundant with the visibility
check and neither is redundant with the tabindex one: a `visibility: hidden`
element still reports client rects.

## Scope note

`NavDrawer` is shared by TheLeague and the AFL, so this is one edit reaching
two production navs — it wants its own PR, its own guard test, and a keyboard
pass on both sites with the account panel both open and closed (the panel
changes what is in the drawer).

The rule and its evidence are recorded in
`docs/claude/insights/domains/accessibility.md` under
"2026-09-19 - A focus-trap selector does not exclude a roving `tabindex=\"-1\"`",
which also corrects the 2026-01-18 entry that published this selector.
