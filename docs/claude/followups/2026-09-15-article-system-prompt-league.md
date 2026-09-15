---
slug: article-system-prompt-league
status: open
severity: P3
opened: 2026-09-15
source_pr: https://github.com/braven112/mfl.football.v2/pull/1092
---

# Follow-up: the article AI persona always says "TheLeague", in every league

Found during the `/live` quality pass on PR #1092 (#1086 F1/F3/F4). **Not a
regression from that PR** — it is the layer underneath the fix that PR made, and
it already affects the AFL runs the workflow performs today.

## The shape

PR #1092 made the *data* league-correct: `buildPost` honours `{ league }` in all
9 article types, `buildFactSheet` loads the right league's franchise names, and
the fact-sheet header names the right league (`LEAGUES[league].name`).

The **prompt** is still hardcoded, in two places:

- `scripts/article-utils/ai-client.mjs:134` — `BASE_SYSTEM_PROMPT` declares the
  persona covers *"TheLeague — a 16-team dynasty fantasy football league"*. It is
  shared by every type, so it is wrong for every AFL run.
- `scripts/article-types/matchup-preview.mjs:186` — `getSystemPrompt()` opens
  *"Break down each fantasy matchup in TheLeague for the week."*

The AFL is 24 teams in two conferences, not 16, so the persona is not merely
mis-named — it states a league size the model will reason from.

This is live now, not latent: the workflow runs `schedule-strength` and
`schedule-release` for `--league afl-fantasy` (`.github/workflows/schefter-articles.yml:203-204`,
`:211-212`), and the AFL's one published article
(`sf_2026_schedule_release_afl`) was written under this persona.

## Why it was not fixed in #1092

`scripts/schefter-weekly-articles.mjs` calls `mod.getSystemPrompt()` with **no
arguments**, so a type has no `{ league }` to honour there — unlike
`buildFactSheet` and `buildPost`, which the runner already passes it to
(`:199`, `:241`). Fixing it means changing the runner's call, then threading the
option through all 9 types' `getSystemPrompt` plus `buildCachedSystem`. That is
a cross-cutting signature change on a shared pipeline, which is wider than a
findings-fix on a PR about something else.

`tests/article-type-interface.test.ts` derives its required-exports set from the
runner's source, so adding an argument to that call site is safe — it will not
silently make the option optional.

## The fix, when someone takes it

1. `scripts/schefter-weekly-articles.mjs` — pass `{ league }` to
   `mod.getSystemPrompt()` the way it already does for `buildFactSheet`.
2. `scripts/article-utils/ai-client.mjs` — `BASE_SYSTEM_PROMPT` becomes a
   function of the league, naming it from `LEAGUES[league].name` and taking its
   team count from the registry rather than the string `16-team`.
3. The 9 types' `getSystemPrompt` accept `{ league = DEFAULT_LEAGUE_SLUG } = {}`
   and stop naming a league in prose.

Guard to add with the fix: extend `tests/article-type-league-option.test.ts` —
which already asserts `buildPost` honours `{ league }` — with a case asserting
no type's `getSystemPrompt(  { league: 'afl-fantasy' } )` output contains a
league name other than the AFL's. The registry check belongs there rather than
in `tests/league-literal-guard.test.ts`, whose allowlist covers these files.
