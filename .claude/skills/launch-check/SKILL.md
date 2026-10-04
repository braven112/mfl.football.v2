---
name: launch-check
description: Load every page a league has, in light and dark, against a running server, and report broken pages, script errors, leftover placeholders, dead links and another league's name or links leaking in — with a screenshot of each page. Use after launching a league (a launch/<slug> PR), after changing a league's features (a features/<slug>-… PR), or after editing the package-league templates. Trigger on /launch-check, "check the new league", "review the launch", "does <league> look right".
---

# /launch-check <slug> — review a league without clicking through it

`scripts/launch-check.mjs` visits the league's pages and writes
`.launch-check/<slug>/report.md` (gitignored) with one row per page, the
status in each theme linked to its full-page screenshot, and every problem.

**Which pages:** a package league's entitled routes (the ticked features,
`src/config/package-league-routes.mjs`); any other league's site-search
entries. Dynamic pages (a team's brand page, a news post, a Pecking Order
issue) are reached through a real link, one example each; a dynamic route no
page links to yet is listed under "Not reached" (e.g. a news post before the
feed has any).

## Procedure

1. **Check out the branch** (the launch or features PR) and start the dev
   server per `.claude/skills/verify/SKILL.md`:
   ```bash
   JWT_SECRET=x pnpm dev --port 4399
   ```
2. **Run it.**
   ```bash
   node scripts/launch-check.mjs <slug> --base http://localhost:4399
   ```
   Admin pages render their sign-in gate without a session. To check them as
   the commissioner, forge a cookie (verify skill) and add
   `--cookie "session_token=<jwt>"`.
3. **Read the report.** Exit 1 means at least one ✗.
   - **✗ (fails):** non-2xx (except `/forbidden`, which is a 403 by design),
     a script error, `__LEAGUE_…__` / `undefined` / `NaN` / `[object Object]`
     on screen, a broken same-origin image, or a body link that 404s.
   - **! (warns):** another league's name, or a link into another league, in
     the page body (`<main>`; the shared header, nav and footer legitimately
     name every league). Usually a copy-paste leak; sometimes deliberate.
4. **Before blaming the launch, run the same page on an established league.**
   A failure that also shows on `archies` or `theleague` is a shared-component
   bug, not this league's — fix it at the source (that is how the
   live-scoring hydration mismatch was found, and it was on every league).
5. **Look at the screenshots** for what text checks cannot see: an empty
   panel, the placeholder logo, unreadable contrast in dark. Send the report
   and the screenshots that matter to the user.

## Don'ts

- Don't edit a package league's route file to fix a finding — edit the
  template (`templates/package-league`) and run
  `node scripts/sync-league-routes.mjs --all` (docs/claude/rules/package-leagues.md).
- Don't commit `.launch-check/`.
