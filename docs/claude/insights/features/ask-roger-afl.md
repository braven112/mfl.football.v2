# Ask Roger — AFL & Multi-League Pattern

## Component reuse: `RulesChat` works for any league via `apiEndpoint` prop

The `RulesChat` React component at `src/components/theleague/rules-chat/RulesChat.tsx` (despite the path) is league-agnostic. It accepts:
- `apiEndpoint` — POST/GET/DELETE endpoint (defaults to `/api/rules-qa` for TheLeague). For AFL pass `/api/afl-rules-qa`.
- `preSeeded` — initial Q&A seed array (league-specific JSON)
- `teamIcons` — `[{ franchiseId, icon }]` for asker avatars
- `isAuthenticated`, `isAdmin` — auth state from `getAuthUser()`

When adding another league, build a parallel API route (e.g. `src/pages/api/afl-rules-qa.ts`) that mirrors `src/pages/api/rules-qa.ts` with a different system prompt + constitution text. **Do not duplicate the component.**

## Constitution-as-data pattern

The rules text is embedded directly in the API's system prompt — see `src/data/afl-constitution.ts` and `src/data/league-constitution.ts`. Plain text, not parsed HTML. The HTML version at `src/pages/afl-fantasy/docs/rules.html` is for human readers; the `.ts` version is for the LLM. **Keep them in sync manually** — there's no build step that derives one from the other.

When updating the constitution, update both. The HTML is the source of truth for prose; the `.ts` version may include factually-true clarifications that aren't in the written constitution (e.g., cross-conference trades banned, conferences draft separately) — flag these clearly in the `.ts` file so future edits don't strip them.

## Per-league GroupMe bot routing

Scripts that scan multiple leagues (`scripts/schefter-scan.mjs`) route GroupMe posts to per-league bots via env-var lookup. The convention:

```
GROUPME_SCHEFTER_BOT_ID            # TheLeague Schefter
GROUPME_ROGER_BOT_ID               # TheLeague Roger
GROUPME_AFL_SCHEFTER_BOT_ID        # AFL Schefter
GROUPME_AFL_ROGER_BOT_ID           # AFL Roger
```

When the scan loop iterates leagues, it should pick the bot ID by `league.slug`, not by a global default. Falling back to TheLeague's bot for AFL transactions will spam the wrong chat.

## Nav-config: `leagueOnly` controls visibility, paths are league-relative

In `src/config/nav-config.json`, link entries with `path: "/foo"` automatically resolve to `/theleague/foo` or `/afl-fantasy/foo` depending on which league's nav is rendering. **A nav entry without a `leagueOnly` field shows for both leagues** — it just needs both `/theleague/foo` and `/afl-fantasy/foo` to actually exist.

This means enabling a shared feature for AFL after the fact = drop `leagueOnly: "theleague"` from the nav entry. No code change needed in the nav renderer.

For league-specific features, set `leagueOnly: "theleague" | "afl"`.

## Feature flag gating in `leagues-data.mjs`

Per-league features live in `src/config/leagues-data.mjs` under each league's `features` object (`schefterFeed`, `contracts`, `keepers`, etc.). Frontend pages that consume per-league data (e.g. `src/pages/afl-fantasy/news.astro`) read the league's data path and import the JSON directly — they don't check the feature flag. The flag controls whether the page/nav surfaces the feature, not whether the data exists.

## Page directory entries are per-path, not per-league

`src/data/page-directory.json` requires a separate entry per path. AFL Ask Roger needs its own entry (`id: "afl-rules-chat"`, `path: "/afl-fantasy/rules-chat"`) alongside TheLeague's (`id: "rules-chat"`, `path: "/rules-chat"`). The page-directory test enforces 10+ tags per entry — don't skimp.
