---
name: new-page
description: Scaffold a new site page correctly on the first try — one shared component, a thin route wrapper per league with the auth gate in the page, and the page-directory entry with 10+ tags — using scripts/scaffold-page.mjs so the repo's page rules are generated rather than remembered. Use whenever a new route is being added under src/pages/<league>/, or when a page exists in one league and is wanted in another. Trigger on /new-page, "add a page", "new route", "give the AFL a copy of", "scaffold a page".
---

# /new-page — the page rules, generated

Three rules govern every page here and each has shipped a bug when skipped:

1. **Build a component, not a second page** (CLAUDE.md "Second league's copy
   of a page — build a component, not a second page"). 24 forked siblings and
   57,800 duplicated lines came from copying one league's page into the
   other; `tests/page-fork-ratchet.test.ts` fails a new one.
2. **The auth gate lives in the ROUTE, not the component** — `Astro.redirect()`
   from a component is a blank 200.
3. **Register it in `src/data/page-directory.json` with 10+ tags** or site
   search can't find it.

`scripts/scaffold-page.mjs` writes all three in the shape of
`src/pages/theleague/division-strength.astro`.

## Procedure

1. **Collect the inputs.** Ask the user for anything missing — do not invent
   tags or a description, they are the search index:
   - `route` (kebab-case), `title`, one-sentence `description`
   - `category`: `popular | my-team | reports | tools | info`
   - `icon`: reuse an id already in page-directory.json (`grep '"icon"' src/data/page-directory.json | sort | uniq -c`)
   - 10+ `tags`: synonyms, data types, actions, slang an owner might type
   - which leagues (default: every league with a `src/pages/<slug>/` dir;
     TheLeague-only features like contracts/salary → `--leagues theleague`)
   - whether it is owner-gated (`--auth`)

2. **Dry-run, then run.**
   ```bash
   node scripts/scaffold-page.mjs --route <r> --title "<t>" --description "<d>" \
     --category <c> --icon <i> --tags "<a,b,c,…>" [--leagues …] [--auth] --dry-run
   node scripts/scaffold-page.mjs … # same, without --dry-run
   ```
   It refuses to overwrite and refuses fewer than 10 tags.

3. **Build the page body in the shared component** only. If a league needs
   its own static data file, import it in that league's route wrapper and
   pass it as a prop — never `import.meta.glob` both leagues' data in the
   component. Follow `docs/claude/loading-standards.md` for the editorial
   standard and the domain's `docs/claude/rules/<domain>.md` for its traps.

4. **Verify the guards** the scaffold is designed to pass:
   ```bash
   node_modules/.bin/vitest run tests/page-directory-data.test.ts tests/page-fork-ratchet.test.ts tests/league-literal-guard.test.ts
   ```

5. **Year-shaped page?** `/rollover-check /<league>/<route>` before calling it
   done.

6. **What's New**: a new page requires an entry with a screenshot and inline,
   league-neutral links — run `/update-whats-new` and ask the user about hero
   eligibility; do not decide it silently.

## Don'ts

- Don't copy an existing league page file into another league directory.
- Don't put `Astro.redirect()` inside the shared component.
- Don't hardcode a league id, host, or data path — import from the registry.
- Don't pad tags to reach ten; ask.
