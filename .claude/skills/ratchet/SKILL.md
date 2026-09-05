---
name: ratchet
description: Re-measure and retighten the repo's ratchet baselines (astro check type-error total, forked sibling pages, ClientRouter init offenders) in one command. Use after a rebase, after unforking a page, after a type-cleanup pass, or whenever tests/typecheck-baseline.typecheck.ts or tests/page-fork-ratchet.test.ts fails saying the count DROPPED. Trigger on /ratchet, "retighten the baseline", "baseline is stale", "typecheck baseline moved".
---

# /ratchet — re-measure the baselines

Three counts in this repo may only go down, and their tests fail in BOTH
directions so progress gets recorded instead of leaving slack:

| Baseline | Test | Measures |
|---|---|---|
| `tests/fixtures/typecheck-baseline.json` | `pnpm test:types` | `astro check` error total (~2.5 min) |
| `tests/fixtures/page-fork-baseline.json` | `tests/page-fork-ratchet.test.ts` | sibling routes over 80 lines |
| `tests/fixtures/clientrouter-init-baseline.json` | `tests/clientrouter-init-ratchet.test.ts` | client scripts that init only on DOMContentLoaded |

`scripts/ratchet.mjs` measures all three with the SAME code the tests use.

## Procedure

1. **Measure.**
   ```bash
   node scripts/ratchet.mjs              # both (slow: runs astro check)
   node scripts/ratchet.mjs --skip-types # forks only, instant
   ```
2. **Read the verdict per baseline:**
   - `at baseline` → nothing to do.
   - `fell` / `unified` → progress. Run `node scripts/ratchet.mjs --write`
     to retighten. For the typecheck baseline, then open the fixture and add
     one line to `notes.provenance` saying what removed the errors (the file
     is a record, not just a number).
   - `ROSE` / `NEW forks` → a regression. **Never** raise a baseline or add a
     fork to it. Fix the code: see the errors with
     `NODE_OPTIONS=--max-old-space-size=12288 npx astro check --minimumSeverity error`,
     or unfork the page per `src/pages/theleague/division-strength.astro`.
3. **Confirm** with the real tests:
   ```bash
   node_modules/.bin/vitest run tests/page-fork-ratchet.test.ts
   pnpm test:types   # only if the typecheck baseline changed
   ```
4. Commit the fixture change in the same commit as the code that earned it.

## After a rebase

Both baselines are stale by construction: main's number counted main without
your change, yours counted a main that has moved. Neither side of the conflict
is right. Resolve the markers with anything, run `node scripts/ratchet.mjs
--write`, commit the measured numbers. (`/rebase` does this step for you.)

## Don'ts

- Don't hand-edit `total` — the script writes the measured value and the date.
- Don't run `--write` to make a regression go away; it refuses upward moves
  anyway.
- Don't touch `clearedClasses` — those are pinned at zero on purpose and the
  script leaves them alone.
