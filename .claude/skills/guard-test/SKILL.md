---
name: guard-test
description: Turn a rule (a sentence from CLAUDE.md, a docs/claude/rules/ doc, or a bug that just shipped) into a scan-style guard test in tests/, wired into the path-guard hook so it runs on every edit in that domain. Use when adding a rule, when a review finds "we said never do X" and X happened, or when a rules doc has a rule with no test. Trigger on /guard-test, "write a guard for", "pin this with a test", "make this rule mechanical".
---

# /guard-test — make a rule mechanical

A rule in prose is skimmed. A rule in `tests/` is checked on every push and,
through `.claude/hooks/path-guard.mjs`, on every edit in its domain. This
skill takes a rule and leaves behind: the test, the map entry that runs it at
edit time, and a one-line pointer from the rules doc to the test.

Input: a rule sentence, a rules-doc section, or a bug description. If none was
given, ask for one and stop.

## Step 1 — classify the rule (pick ONE shape)

| Shape | The rule sounds like | Helper |
|---|---|---|
| **Forbidden pattern** | "never write X in Y" — a literal, a host, a raw `fetch`, a `vars.*` gate, an unscoped key | `scanForbidden` |
| **Required pairing** | "anything that has X must also have Y" — every article type declares `relatedLinks`, every page has a directory entry, every `var(--x)` has a definition | `scanRequired` |
| **Ratchet** | "this number may only go down" — type errors, forked siblings, files over N lines | `assertRatchet` + a `tests/fixtures/*-baseline.json` |
| **Data invariant** | "in this JSON, every row satisfies P" — every season lands on exactly one holding, every entry has 10+ tags | plain vitest over the data file (see `tests/owner-tenures-data.test.ts`, `tests/page-directory-data.test.ts`) |
| **Behavioral** | "function f given A returns B" — year rollover, punctuation stripping | plain unit test; this skill is not needed |

If the rule is behavioral, write an ordinary unit test and skip to Step 4.
If it does not fit any shape, say so — some rules ("prefer your team, else
the league, is the wrong shape") are judgment and belong in the doc only.

Helpers live in `tests/helpers/scan-guard.ts`; read its header once. Existing
worked examples: `tests/workflow-feature-flag-guard.test.ts` (forbidden, with
`exempt` and pinned legacy exceptions), `tests/league-literal-guard.test.ts`
(forbidden, hand-rolled, with a scoped allowlist — the shape the helper
distilled), `tests/page-fork-ratchet.test.ts` (ratchet).

## Step 2 — measure before you write

Write the test from the Step 3 template with an EMPTY allowlist, run it, and
LOOK at the hits — the failure message is the list:

```bash
node_modules/.bin/vitest run tests/<new>.test.ts
```

For each current hit decide, in order:
1. **Fix the file** — the guard exists because the pattern is wrong.
2. **Structural exemption** (`exempt`) — the match is not an instance of the
   rule (a literal inside an import path, a fixture, a comment). Keep it
   narrow and explain it in the test header.
3. **Allowlist entry** — the file must keep it for a reason you can write in
   one specific sentence. Scope it with `names` to the pattern it excuses.

An allowlist longer than ~5 entries means the rule or the scan is wrong, not
the repo. A guard that starts life with 40 exemptions is a list nobody reads.

## Step 3 — write the test

File: `tests/<domain>-<rule>-guard.test.ts` (forbidden/required) or
`tests/<thing>-ratchet.test.ts`. Template:

```ts
import { describe, it } from 'vitest';
import { expectClean, scanForbidden } from './helpers/scan-guard';

/**
 * <Rule name>.
 *
 * <The bug that shipped, in 2–4 lines: what happened, why the pattern is the
 * cause, which doc holds the rule — e.g. docs/claude/rules/league-urls.md
 * "Never concatenate origin + path">.
 *
 * Exemptions: <what `exempt` skips and why>. Allowlist: <what kind of file
 * may appear there>.
 */
describe('<rule> guard', () => {
  it('<one sentence stating the invariant>', () => {
    const result = scanForbidden({
      roots: ['src', 'scripts'],
      extensions: ['.ts', '.tsx', '.mjs', '.astro'],
      forbidden: [{ name: '<pattern name>', pattern: /<regex>/ }],
      allowlist: [
        // { file: 'src/…', names: ['<pattern name>'], reason: '<one specific sentence>' },
      ],
    });
    expectClean(result, '<Rule sentence with the doc citation>.');
  });
});
```

Requirements the template enforces and you must keep:
- The header comment names the bug and the doc. A guard with no story gets
  deleted the first time it is inconvenient.
- The failure message cites the doc section by its exact heading —
  `tests/claude-md-references.test.ts` checks that every citation of a
  CLAUDE.md section (the file name followed by the quoted heading) resolves
  to text that is actually there.
- Unused allowlist entries fail the test (`expectClean` does this). Do not
  work around it.

## Step 4 — prove it bites (mutation check, mandatory)

Plant one violation, run the test, confirm it fails naming `file:line`, then
revert. A guard that has never been seen red is a guard you are guessing about.

```bash
node_modules/.bin/vitest run tests/<new>.test.ts        # green
# add a violating line to a scanned file
node_modules/.bin/vitest run tests/<new>.test.ts        # red, with path:line
git checkout -- <that file>
```

## Step 5 — wire it to edit time

Add the test to the matching domain's `tests` in `.claude/hooks/path-guard.json`,
or add a domain (`name`, `rules`, `paths`, `tests`, optional `note`) when the
rule's files are not mapped yet. Then run:

```bash
node_modules/.bin/vitest run tests/path-guard-map.test.ts
```

It fails on a glob that matches nothing, a missing test, or a rules doc no
domain routes to. Keep the domain's total suite time under ~4 s — it runs on
every edit that matches.

## Step 6 — point the prose at the test

In the rules doc section (or CLAUDE.md paragraph) the rule came from, add:

```
Guard: `tests/<new>.test.ts`.
```

One line. The doc explains WHY; the test is WHAT. If the rule is new, write
the doc section first (see `docs/claude/rules/README.md` "Adding a rule").

## Step 7 — report

Say: the rule, the shape, the test path, how many hits the first scan found
and what happened to each (fixed / exempted / allowlisted), that the mutation
check went red, and which path-guard domain now runs it.

## Don'ts

- Don't scan `data/` (161 MB) unless the rule is about data; walk `src`,
  `scripts`, `tests`, `.github/workflows` and name the roots explicitly.
- Don't write a full parser. `exempt` on the line is enough for 95% of rules;
  the remaining 5% are documented as a known gap in the header, like
  `design-token-guard.test.ts` does.
- Don't raise a ratchet baseline. Ever. Fix the regression.
- Don't leave a rule with no test AND no note saying why it can't have one.
