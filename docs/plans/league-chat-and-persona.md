# League chat providers + commissioner-editable news persona

Status: Phase 1 shipped on `claude/slack-integration-groupme-ttsw77`. Phases 2–3 not started.

## Why

The standard custom package offers ONE chat integration per league, GroupMe or
Slack, and lets the league rename the news writer. The first client is MFL
league **10105** (Archie's Fantasy Football League). It is Slack-only, and it
wants just one thing in the chat: the weekly strength-of-schedule column, which
that league calls **the Guillotine**. The Guillotine is a column name, not a
competition format.

## Phase 1 — platform (done)

**Chat provider, from the registry.** `chat` on a league's entry in
`src/config/leagues-data.mjs`:

```js
chat: { provider: 'groupme', botEnv: 'GROUPME_SCHEFTER_BOT_ID' }
chat: { provider: 'slack', tokenEnv: 'SLACK_<LEAGUE>_BOT_TOKEN', channelEnv: 'SLACK_<LEAGUE>_CHANNEL_ID' }
```

The entry holds only env var names; the tokens are secrets. `scripts/lib/chat.mjs`
holds the Slack sender (`postToSlack`, `toSlackText`, `slackSenderFor`). The
queued-announcement sender (`scripts/schefter-announce-pending.mjs`) routes a
Slack league's promo through the same daily cap as GroupMe, via the new `send`
parameter on `postToGroupMeCapped`. GroupMe leagues take exactly the path they
took before.

Slack traps, pinned in `tests/league-chat-slack.test.ts`:
- `chat.postMessage` returns HTTP 200 with `ok: false` for most failures, so
  success means `ok === true` and nothing less.
- Links go out as `<url>`, so trailing punctuation never joins the URL. The
  GroupMe link-punctuation sanitizer is pinned to the GroupMe lanes and stays
  out of this path.
- `username` and `icon_url` come from the persona on every message, which needs
  the `chat:write.customize` scope.

**Persona.** `src/utils/persona.mjs` resolves a persona in this order:
1. The commissioner's saved override, in Redis at `persona:<registry slug>`.
2. The registry's `persona` default.
3. Claude Schefter.

The commissioner edits it on `/<league>/admin/schefter` (`PersonaEditor.astro`,
`/api/admin/persona`). The API always takes the league from the session, never
from a parameter.

`buildCachedSystem` keeps `BASE_SYSTEM_PROMPT` byte-for-byte for the default
persona, so an untouched league writes exactly as before. A custom persona gets
`PERSONA_NEUTRAL_RULES`: the same rules with no named writer, cached and shared
across personas. The persona's name and voice go in the uncached block, fenced
as tone-only. Every article type forwards `persona`, and
`tests/league-persona.test.ts` fails on any type that drops it.

## Slack app setup (per client)

The client creates an app from this manifest in their own workspace
(api.slack.com/apps → Create New App → From a manifest), installs it, invites
the bot to the channel (`/invite @<bot>`), then sends us the **Bot User OAuth
Token** (`xoxb-…`) and the **channel ID**. Those go in as the two secrets named
by the league's `chat` block, set in Vercel AND in GitHub Actions, because the
announce job runs in Actions.

```yaml
display_information:
  name: League News
features:
  bot_user:
    display_name: League News
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - chat:write.customize
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

## Phase 2 — onboard 10105 (next)

- Registry entry with every feature flag set explicitly, and
  `chat: { provider: 'slack', ... }`.
- Data sync, homepage with transactions (site only, not Slack), and a news page.
- 99 franchises in 9 divisions, each division its own player pool
  (`playerLimitUnit: DIVISION`). Anything roster- or free-agent-scoped must be
  keyed per division, generalizing the AFL's two-conference split to N pools.
  This is the main risk.
- The strength-of-schedule column's NAME per league ("The Gauntlet" today, "The
  Guillotine" for 10105): it is hardcoded in the prompt and in
  `components/shared/schedule-strength/*`.
- Wire the two Slack secrets into `schefter-articles.yml`'s announce step.
- Show the persona's name and avatar on the site's news byline (today
  `SCHEFTER_AUTHORS` in `src/types/schefter.ts` is static).
- Other chat senders (Roger reminders, the rumor mill, the Pecking Order) still
  post GroupMe-only. Route each through `chatConfigFor` when a Slack league
  turns that feature on.

## Phase 3 — later

- Pecking Order at 99-team scale.
- Two-way Slack (mentions → tips) through the Events API, if a client wants it.
