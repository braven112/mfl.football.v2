# League literal guard (`tests/league-literal-guard.test.ts`)

Phase 3 of `docs/league-refactor-plan.md`. Scans src/ + scripts/ +
.github/workflows/ for hardcoded league ids/hosts/data-paths that bypass
`src/config/leagues-data.mjs`.

## Gotcha: regex literals break naive quote-toggling comment strippers

A hand-rolled "strip JS comments while preserving string contents" scanner
that just toggles an `inSingleQuote`/`inDoubleQuote` flag on every `'`/`"`
character will silently break on a regex literal that contains a quote
character, e.g. (this exact pattern lived in `src/utils/mfl-login.ts`):

```js
const cookieMatch = xml.match(/MFL_USER_ID="([^"]+)"/);
```

The two `"` inside the regex pattern toggle `inDoubleQuote` an odd number of
times, leaving the scanner permanently "inside a string" for the rest of the
file. Every comment after that point silently stops being stripped — which
either hides a real violation inside a comment, or (worse) turns
documentation prose into false-positive matches.

Fix: detect regex-literal boundaries before falling back to string-toggling.
Use the standard lightweight-tokenizer heuristic — a `/` following an
operator/keyword/start-of-statement (`(`, `,`, `=`, `:`, `;`, `!`, `&`, `|`,
`?`, `{`, `[`, newline, `return`, `typeof`, etc.) is a regex literal; a `/`
following an identifier/number/closing-bracket/string is division. Once
inside a regex literal, scan for its terminating unescaped `/`, respecting
`\`-escapes and `[...]` character classes (an unescaped `/` inside `[...]`
is literal, not a terminator). Bail to "division operator" if no closing
`/` is found before a newline (regex literals can't span lines unescaped).

Any future scanner/codemod that walks this codebase's `.ts`/`.mjs` files
with regex-based comment stripping should budget for this — it's not a
hypothetical, it broke the guard test's own dev-time validation before the
fix.

## Design: data-path literals need a *structural* exemption, not a per-file allowlist

`data/theleague` / `data/afl-fantasy` substrings can only ever appear inside
a string/template literal (they contain `/`, invalid in bare JS), so
"is this in a string" is always true and useless as a signal. The real
question — "is this a legitimate file-path reference vs. a hardcoded
league-selection literal that should come from the registry" — isn't
answerable by regex alone. Chasing it file-by-file produced ~30 allowlist
entries (import specifiers, `path.join()`/`readJsonFile()` arguments, and
Vite `import.meta.glob()` result-key reconstructions like
`feeds[\`.../mfl-feeds/${year}/x.json\`]`), which violates "keep the
allowlist short."

What worked: two structural exemption rules applied automatically (no
per-file entry needed) — (1) a nearby call-site marker (`readFile`,
`path.join`, `import.meta.glob`, `from '`, etc. within ~400 chars before the
match), and (2) the match sits inside a template literal that also contains
a `${` interpolation anywhere in the same literal. This shrank the
allowlist from ~30 files to 5 genuine outliers (two workflow files whose
scripts require a literal id, a `$comment` string in generated JSON, prose
on a dev-notes page, and the asymmetric feed-path map in `schefter-og.ts`). The id/host literals
(`13522`, `19621`, `www49.myfantasyleague`, `www44.myfantasyleague`) get
*no* such exemption — those are the ones that caused real historical bugs
(host fallbacks, id ternaries), so they stay strict everywhere including
workflow YAML.

## Design: workflow YAML literal ids

GitHub Actions YAML can't `import` `leagues-data.mjs`. Where the invoked
script already falls back to the registry's `DEFAULT_LEAGUE_ID` when the env
var is empty (`apply-pending-contracts.mjs`, `sync-draft-pick-contracts.mjs`),
the workflow passes `vars.MFL_LEAGUE_ID` through with no YAML-side fallback —
letting the script's own default apply. Where the script has no such
fallback and *requires* a non-empty id (`fetch-mfl-feeds.mjs`,
`fetch-trade-bait.mjs`), the workflow keeps a literal (documented inline,
allowlisted in the guard test) rather than risk breaking a scheduled run.
