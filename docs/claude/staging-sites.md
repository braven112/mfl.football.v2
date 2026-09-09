# Per-league staging sites

Stable staging hostnames for TheLeague and the AFL, so a browser session
survives a deploy.

## Why they exist

`createSessionCookie` (`src/utils/session.ts`) sets `session_token` with
`Path=/; HttpOnly; SameSite=Lax; Secure` and **no `Domain`** — deliberately, so
the cookie belongs to exactly the host that set it (`leagueOrigin`'s doc
comment is built on that fact). Vercel's generated `*.vercel.app` preview
hostname changes on **every deployment**, which orphans the cookie every push.
That is the whole reason previews feel logged-out; the session is fine, the
host is not.

A fixed hostname fixes it with no cookie changes: log in once, stay logged in
for the cookie's 90 days.

Each test host holds its **own** session, separate from production. That is
the intended design, not a limitation — you can sit signed in as one owner on
test and another on prod. Sharing one session across both would mean setting
`Domain=.theleague.us`, which hands `session_token` to every subdomain
(`forum.theleague.us` included, which `vercel.json` rewrites to a third-party
forum) and lets the existing host-only cookies shadow the domain-scoped ones
until they expire. Not worth it.

## The hosts

| Host | Serves | Registry |
|---|---|---|
| `staging.theleague.us` | TheLeague | `stagingDomains` on `theleague` |
| `staging.afl-fantasy.com` | AFL | `stagingDomains` on `afl-fantasy` |
| `staging.mfl.football` | shared host — every league under its path prefix, which is the only way best-ball-1 is reachable | none, by design |

`staging.mfl.football` is attached in Vercel and nowhere in the registry, exactly
like `mfl.football` itself. Mapping a shared host to a slug would rewrite every
*other* league's paths under that one league.

## What is in code

- **`stagingDomains`** on each league in `src/config/leagues-data.mjs`, merged into
  `buildHostToSlugMap()` and nothing else. That map is what makes middleware
  rewrite `/rosters` → `/theleague/rosters` on a league-owned host; without it
  every path on the staging site 404s.
- It is a **separate field from `domains`** on purpose. `domains` feeds
  `leagueOrigin()`, and every absolute URL we emit (nav switch links, GroupMe,
  OG tags) must stay on production hosts — a staging host in a GroupMe link
  would send owners somewhere they are not logged in. `domains` also carries
  invariants a staging host cannot meet: a `www.` twin
  (`tests/leagues-registry.test.ts`) and prefix-strip redirects in `vercel.json`
  (`tests/league-url-prefix.test.ts`).
- **`STAGING_BRANCH`** in `scripts/vercel-ignore-build.mjs`. The `staging`
  branch is exempt from the no-PR build gate, and is the only exemption: the
  three domains are pinned to its latest deployment, so a skipped build serves
  stale code on all three staging sites with no signal (a skip shows as
  `CANCELED`; only the build log says why). The check runs *before* the GitHub
  call so an API outage can never stall a test-site deploy.

Guards: `tests/league-staging-domains.test.ts` (host map, rewrite, and the
separation from `domains`/`canonicalDomain`/`vercel.json`, in both directions)
and `tests/vercel-ignore-build.test.ts`.

## One-time manual setup

Not doable from code — Vercel's MCP surface has no domain or env-var tool.

1. **Branch:** `git fetch origin main && git checkout -B staging origin/main &&
   git push -u origin staging`.
2. **DNS:** at each registrar, `CNAME test → cname.vercel-dns.com` for
   `theleague.us`, `afl-fantasy.com`, `mfl.football`.
3. **Vercel → project `mfl.football.v2` → Settings → Domains:** add all three
   `test.*` hosts, and on each set **Git Branch = `staging`** (REST equivalent:
   `PATCH /v9/projects/{id}/domains/{domain}` with `{"gitBranch":"staging"}`).
   That pins the domain to the newest `staging` deployment.
4. **Preview env vars:** confirm the **Preview** scope carries `JWT_SECRET` and
   the Upstash credentials. `JWT_SECRET` is the one that must be set — without
   it `getJwtSecret()` falls back to a random per-cold-start secret, so logins
   appear to work and then evaporate.

**Deployment Protection needs nothing.** Checked 2026-09-07 on
`prj_Ab677jUnJXlKpHmVLaAYeJIbdG9E`: password protection, Vercel Authentication
and Trusted IPs are all disabled project-wide. (The `401` in
`docs/claude/insights/domains/deployment.md` from 2026-03-08 predates that.)
Re-enabling SSO protection later would 401 all three staging sites.

## Cloudflare challenges `/` on a new staging host

Every one of these hosts is proxied through Cloudflare (they resolve to the
same Cloudflare IPs as production), and on first setup all three answered the
ROOT path with a `403` + `cf-mitigated: challenge` — the "Verify you are human"
interstitial — while production's `/` served normally.

It is scoped to `/` alone. Measured on `staging.theleague.us` with a real
Chrome user-agent:

| Path | Result |
|---|---|
| `/` | 403, `cf-mitigated: challenge` |
| `/rosters` | 200 |
| `/favicon.ico`, `/manifest.json` | 200 |
| `/api/draft/status` | 200 |

So it is not bot detection — a browser UA is challenged identically — and it is
not the app. It is a zone rule keyed on hostname + path whose exception list
names the production hosts and not the new ones. Diagnose it in **Cloudflare →
Security → Events**, filtered to the staging hostname: the event names the
exact service and rule.

Fix by adding a **Skip** rule at the TOP of the WAF custom rules list:

```
(http.host in {"staging.theleague.us" "staging.afl-fantasy.com" "staging.mfl.football"})
```

Do NOT reach for the other obvious fix — setting the staging DNS records to
DNS-only (grey cloud). It works, but it takes Cloudflare out of the path and
production keeps it, so staging stops reproducing edge behavior that has
already caused a production bug here: the edge replaces an origin 5xx with its
own HTML page, discarding the JSON body (see
`docs/claude/insights/domains/deployment.md`, 2026-07-07). A staging site that
cannot reproduce that is worth less than one behind an annoying rule.

## What the staging sites are NOT

- **Not isolated.** They share production's Upstash, so a click on test moves
  real Board unread badges, watch lists and rankings. MFL writes hit the live
  league — there is no sandbox league.
- **Not a closed world.** The nav league switcher goes through `leagueOrigin`,
  which is `canonicalDomain` by design, so switching leagues from
  `staging.theleague.us` lands on production `www.afl-fantasy.com`.
- **Not fresh data.** `VERCEL_ENV=preview` runs the slim prebuild — 19 of 21
  steps skipped, committed artifacts read instead. Set `PREBUILD_FULL=1` if a
  test needs live feeds.
- **Not the tool for date testing.** `?testDate=YYYY-MM-DD` already does that,
  on production, with none of the above.
