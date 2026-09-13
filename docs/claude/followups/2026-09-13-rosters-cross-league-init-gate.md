---
slug: rosters-cross-league-init-gate
status: open
severity: P3
opened: 2026-09-13
found_in_pr: https://github.com/braven112/mfl.football.v2/pull/1076
followup_issue: 1077
followup_pr:
---

# Follow-up: the AFL rosters controller binds TheLeague's rosters page

## What's wrong

`src/pages/afl-fantasy/rosters.astro`'s `initAflRosterPage` is registered on
`document` — which the ClientRouter does NOT replace — and gates on a bare
`.roster-page`:

```js
const pageRoot = document.querySelector<HTMLElement>('.roster-page');
if (!pageRoot || pageRoot.dataset.aflInit === '1') return;
```

TheLeague's rosters page also renders `<section class="roster-page">`
(`src/pages/theleague/rosters.astro:2009`), and a cross-league navigation is
same-origin — so it is a ClientRouter swap, not a fresh document. On the shared
host (`mfl.football`) the nav's own league switcher emits a relative href
(`buildSwitchUrl`, `src/utils/nav-utils.ts:588`), so AFL rosters → TheLeague
rosters is one chevron click.

After that click the AFL controller passes the gate on TheLeague's DOM and
binds. TheLeague's page has 14 `.view-tab` / `[data-view-content]` occurrences
for it to find, and AFL's `switchView`:

- sets `labelEl.textContent = VIEW_LABELS[viewName]`, where
  `VIEW_LABELS.roster === 'AFL Roster'` — so clicking a view tab on
  **TheLeague's** rosters page relabels the header "AFL Roster";
- sets `container.style.display = 'grid'` on TheLeague's panels, which may not
  be the layout they want.

**Only this direction is broken.** The reverse is already safe: TheLeague's
`initRosterPage` gates on `#roster-config`, which its page alone renders (0
occurrences in the AFL file), so it correctly bails on the AFL page.

## Severity

P3. Cosmetic and layout only — unlike the lineup case there is no wrong-league
write, and TheLeague's own init is not locked out (it uses a different guard,
so both run rather than one displacing the other). It needs a cross-league
navigation on the shared host to reach at all.

## Why it wasn't fixed in #1076

It was found by that PR's own cross-cutting review pass, and the fix was
written and verified — then deliberately backed out. Any `rosters.astro` edit
owes a `scripts/roster-parity-check.mjs` run before AND after
(`docs/plans/rosters-page-split.md`), and that script needs a dev server and a
populated `.env.local`, neither of which the cloud session had. Shipping an
unverified edit to that page was the wrong trade for a P3.

## Shape of the fix

Two lines, and they do **not** touch the 12k-line TheLeague page:

1. `src/pages/afl-fantasy/rosters.astro:713` — add the league marker to the
   page root, from the registry:
   ```astro
   <section class="roster-page" data-league={aflLeague!.slug} data-initial-view={initialView}>
   ```
   (`aflLeague` is already in scope at line 130.)
2. Narrow the gate to match:
   ```js
   const pageRoot = document.querySelector<HTMLElement>('.roster-page[data-league="afl-fantasy"]');
   ```

Then add the pair to `tests/cross-league-init-gate.test.ts`. That pair is
**asymmetric** — TheLeague's side is league-specific by virtue of a page-unique
id rather than a marker — so its entry also wants to pin the fact the
separation rests on: that no sibling grows a `#roster-config` of its own. The
guard's `GuardedPage` interface will need an optional
`siblingsMustNotRender` field for that; it was written and then removed from
#1076 along with the rest of this item, so it is in that PR's history.

Verified while writing #1076: narrowing the gate makes the new guard case fail
against the pre-fix source and pass after.

## Before you push

Run `node scripts/roster-parity-check.mjs` before AND after the edit, on a
machine with a dev server and `.env.local` (`pnpm dlx vercel env pull`). It
targets `/theleague/rosters` by default; pass `--league afl-fantasy` for the
page actually being edited, and run both.
