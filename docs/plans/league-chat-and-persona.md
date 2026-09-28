# League chat providers + commissioner-editable news persona

Status: Phase 1 done. Phase 2 piece 1 (onboard 10105 as `archies`) done on `claude/slack-integration-groupme-ttsw77`; the persona-everywhere and branding-editor pieces are next.

## Why

The standard custom package offers ONE chat integration per league, GroupMe or
Slack, and lets the league rename the news writer. The first client is MFL
league **10105** (Archie's Fantasy Football League). It is Slack-only, and it
wants just one thing in the chat: the weekly strength-of-schedule column,
**The Gauntlet**. It keeps the same name every other league uses, so no
per-league column naming is needed (decided 2026-09-28; an earlier draft
called it "the Guillotine").

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

The commissioner edits it on `/<league>/admin/news` (News Ops; the old `/admin/schefter` URL 301s there via vercel.json) (`PersonaEditor.astro`,
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

## Phase 2 — onboard 10105 (done: `archies`, mfl.football/archies)

What landed, and where the next package league plugs in:
- **Registry** (`leagues-data.mjs` → `archies`): every feature flag set
  explicitly, `chat: slack`, June 1 rollover, and the package-league fields:
  `optInNav`, `advertiseOnSharedHost: false`, `shortName`, `logo`,
  `themeColor`. The shared header, layout, footer and nav READ these, so the
  next package league needs no edits in those files.
- **Suggested branding**: `node scripts/suggest-league-branding.mjs --league <slug> --write`.
  Names are derived by rule; colours come from the MFL art, weighted by
  coverage × chroma, because this package's art is busy illustration where
  the most common colour is the background. MFL's `icon` and `logo` are the
  same 1500×636 banner, so the banner is used as-is and a 128px centre crop
  becomes the icon (`public/assets/<slug>/icons/`). The script refuses to
  overwrite edited branding without `--force`.
- **Pages** (thin routes under `src/pages/archies/`): the home page, standings,
  rosters, transactions, news, the news article page (`news/[id]`),
  schedule-strength (The Gauntlet), the brand book and team brand pages,
  login, forbidden, and admin/news. The shared bodies live in
  `src/components/shared/package-league/` and `SchefterArticlePage.astro`.
  The view models are in `src/utils/package-league.ts`; standings are GROUPED
  by division and never re-sorted.
- **Sync**: the archies row in `roster-sync.yml`. The Gauntlet runs on
  Wednesdays in `schefter-articles.yml`. `scripts/lib/article-leagues.mjs`
  limits archies to that one article type, and posts go to Slack through the
  announce step (`SLACK_ARCHIES_BOT_TOKEN`, `SLACK_ARCHIES_CHANNEL_ID`).
- **Findings the guards surfaced**:
  - Seven archies franchises are named exactly for NFL clubs. That is allowed
    in `tests/nfl-name-match.test.ts`: the name fallback is MFL-Live-only.
  - Its bids are FAAB dollars with cent increments, so the transaction-parse
    invariant takes a per-league budget.
  - The shared parser rounds bids to whole dollars, so a $15.01 bid shows as
    $15. That parser also feeds TheLeague's contract math, which is why it has
    not changed yet.

Still open for archies:

- 99 franchises in 9 divisions, each division its own player pool
  (`playerLimitUnit: DIVISION`). Anything roster- or free-agent-scoped must be
  keyed per division, generalizing the AFL's two-conference split to N pools.
  This is the main risk.
- Set the two Slack secrets (Vercel + GitHub Actions) once the client installs the app.
- Confirm the league's time zone and trade deadline (both TODO in the registry).
- Show the persona's name and avatar on the site's news byline (today
  `SCHEFTER_AUTHORS` in `src/types/schefter.ts` is static).
- Other chat senders (Roger reminders, the rumor mill, the Pecking Order) still
  post GroupMe-only. Route each through `chatConfigFor` when a Slack league
  turns that feature on.

### Phase 2 — the persona everywhere an owner sees it

The News Ops page (renamed from Schefter Ops) already names the league's
persona. Owner-facing surfaces still say Schefter and must read the persona
before 10105 launches:
- the main nav's "Tip Schefter" item and the tip form
- the Schefter-branded news pages, the byline and the post cards
  (`SCHEFTER_AUTHORS`)
- the page-directory titles and the OG images that say Schefter

The resolver is `resolvePersona`. Build-time surfaces use the registry
default; SSR surfaces use the commissioner's override.

### Phase 2 — commissioner-editable team branding

Decisions (2026-09-28):
- **Commissioner only.** Owners do not edit their own team's branding.
- **Everything is suggested first, then edited.** When a league is onboarded,
  each team starts from a generated draft:
  - name and logo from MFL
  - `nameMedium` (15 characters or fewer), `nameShort` (10 or fewer),
    `abbrev`, `aliases` and loader quips proposed by Claude
  - `colorPrimary`, `colorSecondary`, `colorTertiary` and `colorQuaternary`
    extracted from the MFL logo
  - the dark variants (`colorPrimaryDark`, `colorSecondaryDark`) computed
    with the Brand Book's ground rules, never guessed
  The commissioner reviews and edits the draft rather than starting blank.
  With 99 teams in 10105, that is the difference between usable and not.
- **Image uploads.** Icon, dark icon, banner and chat crest go to Vercel
  Blob, reusing the suggestion box's uploader (`ImageUploader.tsx`,
  `/api/suggestions/upload`). The MFL logo is the starting suggestion.
- **Every league, behind a registry flag** (`features.brandingEditor`): on for
  10105 and new leagues, off for TheLeague and the AFL until chosen, because
  their branding is hand-curated.
- **Publishing takes 2–3 minutes.** Save dispatches a workflow
  (`src/utils/workflow-dispatch.ts`, the announce composer's pattern) that
  writes the league's `src/data/<league>.config.json`, commits it and lets
  the deploy rebuild. Branding is read at build time in hundreds of places,
  so the committed file stays the single source of truth; a live override
  would reach only the SSR pages and split the site.
- **Validation happens before commit:**
  - name limits (`MAX_TEAM_NAME_LENGTH`, `MAX_SHORT_NAME_LENGTH`)
  - hex colours, and the contrast rules in
    `docs/claude/rules/theming-and-assets.md`
  - https image URLs on our Blob host only
  - a new or retired name also updates `aliases`, because Schefter's
    redaction must cover every name a team has had
    (`docs/claude/rules/schefter.md`)
- **Throwback eras are out of scope** for the first cut. The editor changes
  only the CURRENT identity. Era rewrites have their own recompute chain
  (`docs/claude/insights/features/throwback-week.md`).

### Platform super admin (done)

The site owner edits every league's settings, as that league's commissioner
would. `src/utils/league-admin.ts`:
- `isPlatformAdmin` matches the MFL account name in the signed session,
  case-insensitively, against `PLATFORM_ADMIN_USERNAMES`. Only the login route
  writes that name, and only after MFL accepts the password.
- `canAdministerLeague` gates the News Ops pages.
- `resolveAdministeredLeague` gates the settings APIs (`/api/admin/persona`,
  `/api/admin/schefter-stats`). A commissioner is held to their own session
  league, and a `?league=` that names another league is refused. A platform
  admin may name any league.

Scope is league settings only. MFL-write routes (lineups, contracts,
accounting) act AS a franchise and stay session-scoped. The branding editor
will use the same gate.

### Branding editor (done)

`/<league>/admin/branding` is live for archies behind `features.brandingEditor`,
and off for TheLeague and the AFL. It is gated by `canAdministerLeague`: the
commissioner or a platform admin.
- **Validation:** `src/utils/branding-edit.mjs` validates and applies. Names
  must fit the site limits, colours are hex, and images must be a Vercel Blob
  upload, the current value, or the league's own `/assets/<league>/` path. A
  rename keeps the old name as an alias.
- **Publishing:** `PUT /api/admin/branding` dispatches
  `.github/workflows/branding-edit.yml`. That workflow runs
  `scripts/apply-branding-edit.mjs`, which validates AGAIN (the workflow can be
  run by hand), writes the config and commits. The change is live after the
  deploy, about 2–3 minutes later.
- **Pending state:** edits still in flight sit in Redis
  (`branding:pending:<slug>`) so the editor can show them as "Publishing". Each
  is cleared once the published config matches.
- **Uploads:** `POST /api/admin/branding-upload` takes JSON with base64 image
  data. It is not multipart, because Astro's origin check rejects a form-typed
  POST from a browser that omits Origin. Needs `BLOB_READ_WRITE_TOKEN`.
- **Secrets:** needs `GH_PAT` (the existing dispatch token) and `DEPLOY_KEY`
  (existing).

### Persona on owner surfaces (done)

- **Label helpers:** `personaLabels` (src/utils/persona.mjs) derives every
  owner-facing label ("The Schefter Report", "Tip Schefter", the column byline)
  from the persona. `getPersonaLabels` / `postByline`
  (src/utils/persona-server.ts) read it server-side, cached for a minute.
- **Default persona:** the original wording, so a league that never renamed
  its writer sees no change.
- **Bylines:** posts carry their `league`, so each card resolves its own
  persona. Only the persona's author id (`claude`) is renamed; ESPN wire items,
  Roger and guest writers keep theirs.
- **Guard:** `tests/persona-literal-guard.test.ts` fails if a page hardcodes
  "The Schefter Report" / "Tip Schefter" again.
- **Deliberately unchanged:**
  - the site-level 404/500 pages and the What's New writer, which belong to no
    league
  - the static page-directory search titles
  - `afl-hero-resolver.ts`'s desk byline (a synchronous, pure resolver)

## Phase 3 — later

- Pecking Order at 99-team scale.
- Two-way Slack (mentions → tips) through the Events API, if a client wants it.
